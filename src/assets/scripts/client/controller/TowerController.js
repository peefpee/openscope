import TimeKeeper from '../engine/TimeKeeper';
import EventBus from '../lib/EventBus';
import { AIRCRAFT_EVENT } from '../constants/eventNames';
import {
    CONTROLLER_TYPE,
    HANDOFF_STATE,
    HANDOFF_THRESHOLDS_NM,
    DEPARTURE_CONTACT_ALTITUDE_AGL,
    DEPARTURE_CONTACT_MIN_AGL,
    isAustralianAirport
} from '../constants/controllerConstants';
import { FLIGHT_PHASE } from '../constants/aircraftConstants';
import { AIRPORT_CONTROL_POSITION_NAME } from '../constants/airportConstants';
import { digits_decimal } from '../utilities/radioUtilities';

/**
 * Lightweight simulated Tower controller for Australian airports.
 *
 * Manages:
 * - Accepting arrival handoffs from the player
 * - Landing clearance
 * - Departure sequencing and handoff to the player
 * - VFR circuit entry
 *
 * @class TowerController
 */
export default class TowerController {
    /**
     * @constructor
     * @param {AirportModel} airportModel
     */
    constructor(airportModel) {
        /**
         * @property _airportModel
         * @type {AirportModel}
         */
        this._airportModel = airportModel;

        /**
         * Aircraft currently managed by tower (after handoff from approach)
         * @property _arrivals
         * @type {Set<string>} aircraft IDs
         */
        this._arrivals = new Set();

        /**
         * Aircraft awaiting departure handoff to player
         * @property _departures
         * @type {Set<string>} aircraft IDs
         */
        this._departures = new Set();

        /**
         * Track which aircraft have already had their handoff threshold states triggered
         * to avoid duplicate events. Maps aircraft ID to the last triggered threshold.
         * @property _handoffThresholdTriggered
         * @type {Map<string, string>}
         */
        this._handoffThresholdTriggered = new Map();
    }

    /**
     * Whether this tower controller is active (Australian airport)
     * @type {boolean}
     */
    get isActive() {
        return isAustralianAirport(this._airportModel.icao);
    }

    /**
     * Get the handoff thresholds from airport config or use defaults
     * @return {Object}
     */
    getHandoffThresholds() {
        const config = this._airportModel.controllerConfig;

        if (config && typeof config.getHandoffThresholds === 'function') {
            const ht = config.getHandoffThresholds();
            return {
                recommended: ht.recommendedNm != null ? ht.recommendedNm : HANDOFF_THRESHOLDS_NM.RECOMMENDED,
                urgent: ht.urgentNm != null ? ht.urgentNm : HANDOFF_THRESHOLDS_NM.URGENT,
                mandatory: ht.mandatoryNm != null ? ht.mandatoryNm : HANDOFF_THRESHOLDS_NM.MANDATORY,
                recommendedNm: ht.recommendedNm != null ? ht.recommendedNm : HANDOFF_THRESHOLDS_NM.RECOMMENDED,
                urgentNm: ht.urgentNm != null ? ht.urgentNm : HANDOFF_THRESHOLDS_NM.URGENT,
                mandatoryNm: ht.mandatoryNm != null ? ht.mandatoryNm : HANDOFF_THRESHOLDS_NM.MANDATORY,
                deadlineSeconds: ht.deadlineSeconds != null ? ht.deadlineSeconds : null
            };
        }

        if (config && config.handoffThresholds) {
            const ht = config.handoffThresholds;
            const fallbackRec = ht.recommended != null ? ht.recommended : HANDOFF_THRESHOLDS_NM.RECOMMENDED;
            const fallbackUrg = ht.urgent != null ? ht.urgent : HANDOFF_THRESHOLDS_NM.URGENT;
            const fallbackMan = ht.mandatory != null ? ht.mandatory : HANDOFF_THRESHOLDS_NM.MANDATORY;
            const recommended = ht.recommendedNm != null ? ht.recommendedNm : fallbackRec;
            const urgent = ht.urgentNm != null ? ht.urgentNm : fallbackUrg;
            const mandatory = ht.mandatoryNm != null ? ht.mandatoryNm : fallbackMan;

            return {
                recommended,
                urgent,
                mandatory,
                recommendedNm: recommended,
                urgentNm: urgent,
                mandatoryNm: mandatory,
                deadlineSeconds: ht.deadlineSeconds != null ? ht.deadlineSeconds : null
            };
        }

        return {
            recommended: HANDOFF_THRESHOLDS_NM.RECOMMENDED,
            urgent: HANDOFF_THRESHOLDS_NM.URGENT,
            mandatory: HANDOFF_THRESHOLDS_NM.MANDATORY,
            recommendedNm: HANDOFF_THRESHOLDS_NM.RECOMMENDED,
            urgentNm: HANDOFF_THRESHOLDS_NM.URGENT,
            mandatoryNm: HANDOFF_THRESHOLDS_NM.MANDATORY,
            deadlineSeconds: null
        };
    }

    /**
     * Accept an aircraft handed off by the player to tower.
     * Tower takes over management of the final approach and landing.
     *
     * @param {AircraftModel} aircraft
     */
    acceptArrival(aircraft) {
        if (!aircraft || aircraft.projected) {
            return;
        }

        this._arrivals.add(aircraft.id);
    }

    manageLandingClearance(aircraft, traffic = []) {
        if (!this._arrivals.has(aircraft.id) || aircraft.isOnGround() ||
            (aircraft.rules === 'vfr' && !aircraft.entryClearance)) return;
        const runway = aircraft.fms && aircraft.fms.arrivalRunwayModel;
        if (!runway || !aircraft.pilot.hasApproachClearance) return;
        const occupied = traffic.some((other) => {
            if (other === aircraft || ![FLIGHT_PHASE.TAKEOFF, FLIGHT_PHASE.LANDING].includes(other.flightPhase)) return false;
            const assigned = other.isArrival() ? other.fms.arrivalRunwayModel : other.fms.departureRunwayModel;
            return assigned && (assigned === runway || assigned.name === runway.oppositeName) && other.isOnGround();
        });
        if (occupied) {
            if (aircraft.landingClearance) {
                aircraft.landingClearance = null;
                aircraft.radioCall('landing clearance cancelled, runway occupied', AIRPORT_CONTROL_POSITION_NAME.TOWER);
            }
            return;
        }
        if (aircraft.landingClearance) return;
        aircraft.landingClearance = { runway: runway.name, issuer: CONTROLLER_TYPE.TWR, issued: TimeKeeper.accumulatedDeltaTime };
        aircraft.radioCall(`cleared to land runway ${runway.name}`, AIRPORT_CONTROL_POSITION_NAME.TOWER);
    }

    /**
     * Remove a managed arrival (e.g., after full stop or go around)
     *
     * @param {string} aircraftId
     */
    removeArrival(aircraftId) {
        this._arrivals.delete(aircraftId);
        this._handoffThresholdTriggered.delete(aircraftId);
    }

    /**
     * Check whether an IFR arrival is eligible for tower handoff.
     * Uses actual aircraft geometry, not just approach clearance.
     *
     * @param {AircraftModel} aircraft
     * @return {boolean}
     */
    isArrivalEligibleForTowerHandoff(aircraft) {
        if (!aircraft.isArrival() || aircraft.isOnGround()) {
            return false;
        }

        // Must have approach clearance and be established on the approach
        if (!aircraft.pilot.hasApproachClearance) {
            return false;
        }

        // Must be established on the approach course
        if (!aircraft.isEstablishedOnCourse()) {
            return false;
        }

        // Must be on final portion of approach (past intermediate waypoints)
        if (aircraft.pilot.approachGuidance && !aircraft.pilot.approachGuidance.onFinal) {
            return false;
        }

        return true;
    }

    /**
     * Calculate the distance from aircraft to the runway threshold, in NM
     *
     * @param {AircraftModel} aircraft
     * @return {number} distance in NM, or Infinity if no runway model
     */
    getDistanceToRunwayNm(aircraft) {
        const runwayModel = aircraft.fms.arrivalRunwayModel;

        if (!runwayModel) {
            return Infinity;
        }

        return aircraft.positionModel.distanceToPosition(runwayModel.positionModel);
    }

    /**
     * Evaluate arrival handoff state for an aircraft.
     * Returns the current handoff threshold based on distance.
     *
     * @param {AircraftModel} aircraft
     * @return {string|null} 'RECOMMENDED', 'URGENT', 'MANDATORY', or null if not eligible
     */
    evaluateArrivalHandoffUrgency(aircraft) {
        if (!this.isArrivalEligibleForTowerHandoff(aircraft)) {
            return null;
        }

        const distanceNm = this.getDistanceToRunwayNm(aircraft);
        const thresholds = this.getHandoffThresholds();

        if (distanceNm <= thresholds.mandatory) {
            return 'MANDATORY';
        }

        if (distanceNm <= thresholds.urgent) {
            return 'URGENT';
        }

        if (distanceNm <= thresholds.recommended) {
            return 'RECOMMENDED';
        }

        return null;
    }

    /**
     * Update a single arrival aircraft's handoff state.
     * Called each tick from the aircraft update loop.
     *
     * @param {AircraftModel} aircraft
     * @return {boolean} true if a go-around was triggered
     */
    updateArrivalHandoff(aircraft, traffic = []) {
        if (!aircraft || aircraft.projected) {
            return false;
        }

        if (aircraft.controllerState.currentController === CONTROLLER_TYPE.TWR) {
            this.manageLandingClearance(aircraft, traffic);
            return false;
        }

        // Skip if already transferred to tower or not on our frequency
        if (aircraft.controllerState.currentController !== CONTROLLER_TYPE.APP) {
            return false;
        }

        const urgency = this.evaluateArrivalHandoffUrgency(aircraft);

        if (!urgency) {
            return false;
        }

        const previousThreshold = this._handoffThresholdTriggered.get(aircraft.id);

        // Don't re-trigger the same threshold
        if (previousThreshold === urgency) {
            return false;
        }

        // Track that we've triggered this threshold
        this._handoffThresholdTriggered.set(aircraft.id, urgency);

        const cs = aircraft.controllerState;

        switch (urgency) {
            case 'RECOMMENDED':
                if (cs.handoffState === HANDOFF_STATE.NONE) {
                    cs.handoffState = HANDOFF_STATE.REQUIRED;
                    cs.handoffRequired = true;
                    cs.targetController = CONTROLLER_TYPE.TWR;
                }
                break;

            case 'URGENT':
                if (cs.handoffState === HANDOFF_STATE.NONE ||
                    cs.handoffState === HANDOFF_STATE.REQUIRED) {
                    cs.handoffState = HANDOFF_STATE.REQUIRED;
                    cs.handoffRequired = true;
                    cs.targetController = CONTROLLER_TYPE.TWR;
                }
                break;

            case 'MANDATORY':
                if (cs.handoffState !== HANDOFF_STATE.COMPLETED &&
                    cs.handoffState !== HANDOFF_STATE.RELEASED) {
                    // Missed handoff! Trigger go-around
                    cs.handoffState = HANDOFF_STATE.OVERDUE;
                    this._triggerMissedHandoffGoAround(aircraft);
                    return true;
                }
                break;

            default:
                break;
        }

        return false;
    }

    /**
     * Trigger a go-around due to missed tower handoff.
     *
     * @param {AircraftModel} aircraft
     * @private
     */
    _triggerMissedHandoffGoAround(aircraft) {
        if (aircraft.projected) {
            return;
        }

        this._handoffThresholdTriggered.delete(aircraft.id);
        aircraft.landingClearance = null;
        aircraft.circuitClearance = null;
        aircraft.circuitPhase = 'GO AROUND';
        // Cancel the approach
        aircraft.pilot.hasApproachClearance = false;
        aircraft.pilot.approachGuidance = null;

        // Set up missed approach altitude
        const runwayModel = aircraft.fms.arrivalRunwayModel;
        const baseElevation = runwayModel ? runwayModel.elevation : this._airportModel.elevation;
        const missedApproachAltitude = Math.ceil((baseElevation + 2000) / 1000) * 1000;

        aircraft.mcp.setAltitudeFieldValue(missedApproachAltitude);
        aircraft.mcp.setAltitudeHold();
        aircraft.mcp.setHeadingFieldValue(aircraft.heading);
        aircraft.mcp.setHeadingHold();
        aircraft.setFlightPhase(FLIGHT_PHASE.DESCENT);

        // Reset handoff state so player can resequence
        const cs = aircraft.controllerState;
        cs.handoffState = HANDOFF_STATE.NONE;
        cs.handoffRequired = false;
        cs.targetController = null;
        cs.targetFrequency = null;

        // Radio call
        const radioMsg = 'going around, negative tower contact';
        aircraft.radioCall(radioMsg, AIRPORT_CONTROL_POSITION_NAME.APPROACH, true);

        // Scoring penalty
        if (!aircraft.projected) {
            EventBus.trigger(AIRCRAFT_EVENT.MISSED_TOWER_HANDOFF, aircraft);
        }
    }

    /**
     * Manage departure sequencing.
     * Checks if airborne departures should contact the player.
     *
     * @param {AircraftModel} aircraft
     * @return {boolean} true if the aircraft should now contact player
     */
    shouldDepartureContactPlayer(aircraft) {
        if (!aircraft.isDeparture() || !aircraft.isAirborne()) {
            return false;
        }

        const cs = aircraft.controllerState;

        // Already handed off or already on player frequency
        if (cs.currentController === CONTROLLER_TYPE.APP ||
            cs.currentController === CONTROLLER_TYPE.DEP) {
            return false;
        }

        // Must be assigned to tower
        if (cs.currentController !== CONTROLLER_TYPE.TWR) {
            return false;
        }

        const airportElevation = this._airportModel.positionModel.elevation;
        const agl = aircraft.altitude - airportElevation;

        // Get the contact altitude from config or use default
        const config = this._airportModel.controllerConfig;
        const contactCfg = config && typeof config.getDepartureContactAltitudeAgl === 'function' ?
            config.getDepartureContactAltitudeAgl() :
            null;
        const contactAlt = (contactCfg && contactCfg.targetAgl != null) ?
            contactCfg.targetAgl :
            DEPARTURE_CONTACT_ALTITUDE_AGL;
        const minAlt = (contactCfg && contactCfg.minAgl != null) ?
            contactCfg.minAgl :
            DEPARTURE_CONTACT_MIN_AGL;

        // Must be above minimum altitude and at or above contact altitude
        return agl >= minAlt && agl >= contactAlt;
    }

    /**
     * Transfer a departure to the player's frequency.
     * Generates the initial contact radio call.
     *
     * @param {AircraftModel} aircraft
     */
    transferDepartureToPlayer(aircraft) {
        if (!aircraft || aircraft.projected) {
            return;
        }

        const cs = aircraft.controllerState;

        if (typeof aircraft.setControllerState === 'function') {
            aircraft.setControllerState({
                currentController: CONTROLLER_TYPE.DEP,
                handoffState: HANDOFF_STATE.COMPLETED,
                handoffCompleted: true
            });
        } else {
            cs.currentController = CONTROLLER_TYPE.DEP;
            cs.handoffState = HANDOFF_STATE.COMPLETED;
            cs.handoffCompleted = true;
            aircraft.isControllable = true;
        }

        // Generate initial contact radio call
        this._generateDepartureContactCall(aircraft);
    }

    /**
     * Generate the initial contact radio call for a departure.
     *
     * @param {AircraftModel} aircraft
     * @private
     */
    _generateDepartureContactCall(aircraft) {
        if (aircraft.projected) {
            return;
        }

        const alt = digits_decimal(aircraft.altitude, -2);
        const altdiff = aircraft.altitude - aircraft.mcp.altitude;
        let altLog;

        if (Math.abs(altdiff) > 200) {
            if (altdiff > 0) {
                altLog = `passing ${alt}, descending to ${aircraft.mcp.altitude}`;
            } else {
                altLog = `passing ${alt}, climbing to ${aircraft.mcp.altitude}`;
            }
        } else {
            altLog = `maintaining ${alt}`;
        }

        if (typeof aircraft.radioCall === 'function') {
            aircraft.radioCall(altLog, AIRPORT_CONTROL_POSITION_NAME.DEPARTURE);
        }
    }

    /**
     * Reset state when airport changes
     */
    reset() {
        this._arrivals.clear();
        this._departures.clear();
        this._handoffThresholdTriggered.clear();
    }
}
