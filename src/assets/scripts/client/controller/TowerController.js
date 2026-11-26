import TimeKeeper from '../engine/TimeKeeper';
import EventBus from '../lib/EventBus';
import ClearanceStateManager from '../aircraft/ClearanceStateManager';
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
        this._arrivalSequences = new Map();
        this._traffic = [];
    }

    setTraffic(traffic = []) {
        this._traffic = traffic;
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

    _requiredWakeSeparationNm(lead, trail) {
        const leadClass = lead && lead.model && lead.model.weightClass;
        const trailClass = trail && trail.model && trail.model.weightClass;
        if (leadClass === 'J') {
            if (trailClass === 'L') return 8;
            if (trailClass === 'M') return 7;
            if (trailClass === 'H') return 6;
            return 4;
        }
        if (leadClass === 'H') {
            if (trailClass === 'L') return 6;
            if (trailClass === 'M') return 5;
            if (trailClass === 'H') return 4;
        }
        if (leadClass === 'M' && trailClass === 'L') return 5;
        return 3;
    }

    _hasRunwayConflict(runway, aircraft, traffic = []) {
        return traffic.some((other) => {
            if (other === aircraft) return false;
            const assigned = other.isArrival() ?
                (other.fms && other.fms.arrivalRunwayModel) :
                (other.fms && other.fms.departureRunwayModel);
            if (!assigned) return false;
            const sameOrOpposite = assigned === runway || assigned.name === runway.oppositeName;
            const intersecting = this._airportModel &&
                typeof this._airportModel.areRunwaysIntersecting === 'function' &&
                this._airportModel.areRunwaysIntersecting(runway, assigned);
            if (!sameOrOpposite && !intersecting) return false;
            if (other.isOnGround() && [FLIGHT_PHASE.TAKEOFF, FLIGHT_PHASE.LANDING].includes(other.flightPhase)) {
                return true;
            }
            if (assigned.name === runway.oppositeName && other.isAirborne() && other.isArrival()) {
                const dist = other.positionModel.distanceToPosition(assigned.positionModel);
                if (dist <= 4) return true;
            }
            return false;
        });
    }

    buildArrivalSequence(runway, traffic = []) {
        const sequence = traffic
            .filter((other) => other.isArrival() && !other.isOnGround() &&
                other.fms && other.fms.arrivalRunwayModel === runway &&
                other.pilot && other.pilot.hasApproachClearance)
            .map((other) => {
                const distanceNm = other.positionModel.distanceToPosition(runway.positionModel);
                const speed = Math.max(40, other.groundSpeed || other.speed || 120);
                const etaSeconds = (distanceNm / speed) * 3600;
                return { aircraft: other, distanceNm, etaSeconds };
            })
            .sort((a, b) => a.etaSeconds - b.etaSeconds);
        this._arrivalSequences.set(runway.name, sequence);
        return sequence;
    }

    isRunwayClearForDeparture(aircraft, runway, traffic = this._traffic) {
        if (!runway) return true;
        const activeTraffic = traffic && traffic.length ? traffic : this._traffic;
        if (this._hasRunwayConflict(runway, aircraft, activeTraffic)) return false;
        const arrivalConflict = activeTraffic.some((other) => {
            if (other === aircraft || !other.isArrival() || other.isOnGround()) return false;
            const arrRwy = other.fms && other.fms.arrivalRunwayModel;
            if (!arrRwy) return false;
            const sameOrOpp = arrRwy === runway || arrRwy.name === runway.oppositeName;
            if (!sameOrOpp) return false;
            const dist = other.positionModel.distanceToPosition(arrRwy.positionModel);
            const speed = Math.max(40, other.groundSpeed || other.speed || 120);
            const eta = (dist / speed) * 3600;
            return dist <= 4 || eta <= 90 || (Boolean(other.landingClearance) && dist <= 5);
        });
        return !arrivalConflict;
    }

    manageLandingClearance(aircraft, traffic = []) {
        if (!this._arrivals.has(aircraft.id) || aircraft.isOnGround() ||
            (aircraft.rules === 'vfr' && !aircraft.entryClearance)) return;
        const runway = aircraft.fms && aircraft.fms.arrivalRunwayModel;
        if (!runway || !aircraft.pilot.hasApproachClearance) return;
        const occupied = this._hasRunwayConflict(runway, aircraft, traffic);
        const sequence = this.buildArrivalSequence(runway, traffic);
        const idx = sequence.findIndex((item) => item.aircraft === aircraft);
        const leadItem = idx > 0 ? sequence[idx - 1] : null;
        const selfItem = idx >= 0 ? sequence[idx] : null;
        let separationBlocked = false;
        if (leadItem && selfItem) {
            const reqNm = this._requiredWakeSeparationNm(leadItem.aircraft, aircraft);
            const distGap = selfItem.distanceNm - leadItem.distanceNm;
            const etaGap = selfItem.etaSeconds - leadItem.etaSeconds;
            if (distGap < reqNm || etaGap < 50) {
                separationBlocked = true;
            }
        }
        if (occupied || separationBlocked) {
            if (aircraft.landingClearance) {
                aircraft.landingClearance = null;
                const reason = occupied ? 'runway occupied' : 'traffic ahead';
                aircraft.radioCall(`landing clearance cancelled, ${reason}`, AIRPORT_CONTROL_POSITION_NAME.TOWER);
            }
            if (selfItem && selfItem.distanceNm <= 1.0 && !aircraft.projected) {
                this._triggerMissedHandoffGoAround(aircraft, occupied ? 'going around, runway occupied' : 'going around, traffic on runway');
            }
            return;
        }
        if (aircraft.landingClearance) return;
        const [issued, clearance] = ClearanceStateManager.issueLandingClearance(
            aircraft,
            runway,
            CONTROLLER_TYPE.TWR,
            TimeKeeper.accumulatedDeltaTime
        );
        if (issued && clearance) {
            aircraft.radioCall(`cleared to land runway ${runway.name}`, AIRPORT_CONTROL_POSITION_NAME.TOWER);
        }
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

        if (aircraft.rules === 'vfr') {
            if (aircraft.octaRequired || !aircraft.entryClearance || !aircraft.entryClearance.valid) {
                return false;
            }
            const distNm = this.getDistanceToRunwayNm(aircraft);
            return Boolean(aircraft.circuitClearance || aircraft.pilot.hasApproachClearance || distNm <= 15);
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
    _triggerMissedHandoffGoAround(aircraft, reason = 'going around, negative tower contact') {
        if (aircraft.projected || aircraft.circuitPhase === 'GO AROUND') {
            return;
        }

        this._handoffThresholdTriggered.delete(aircraft.id);
        this.removeArrival(aircraft.id);
        ClearanceStateManager.onGoAround(aircraft);

        // Set up missed approach altitude and heading (runway heading synthetic fallback)
        const runwayModel = aircraft.fms.arrivalRunwayModel;
        const baseElevation = runwayModel ? runwayModel.elevation : this._airportModel.elevation;
        const missedApproachAltitude = Math.ceil((baseElevation + 2000) / 1000) * 1000;
        const missedHeading = runwayModel ? runwayModel.angle : aircraft.heading;

        aircraft.mcp.setAltitudeFieldValue(missedApproachAltitude);
        aircraft.mcp.setAltitudeHold();
        aircraft.mcp.setHeadingFieldValue(missedHeading);
        aircraft.mcp.setHeadingHold();
        aircraft.setFlightPhase(FLIGHT_PHASE.DESCENT);

        // Reset handoff state and return to APP so player can resequence
        const cs = aircraft.controllerState;
        if (cs.currentController === CONTROLLER_TYPE.TWR && this._airportModel.controllerConfig) {
            const appFreq = this._airportModel.controllerConfig.approach &&
                this._airportModel.controllerConfig.approach.frequency;
            aircraft.setControllerState({
                currentController: CONTROLLER_TYPE.APP,
                currentFrequency: appFreq || cs.currentFrequency,
                handoffState: HANDOFF_STATE.NONE,
                handoffRequired: false,
                targetController: null,
                targetFrequency: null
            });
        } else {
            cs.handoffState = HANDOFF_STATE.NONE;
            cs.handoffRequired = false;
            cs.targetController = null;
            cs.targetFrequency = null;
        }

        // Radio call
        aircraft.radioCall(reason, AIRPORT_CONTROL_POSITION_NAME.APPROACH, true);

        // Scoring penalty only for missed tower handoff
        if (!aircraft.projected && reason.includes('negative tower contact')) {
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
        this._arrivalSequences.clear();
    }
}
