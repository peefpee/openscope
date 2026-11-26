import TimeKeeper from '../engine/TimeKeeper';
import { FLIGHT_RULES } from '../constants/aircraftConstants';

/**
 * Centralised clearance and ownership state manager for AircraftModel.
 * Enforces invariants across entry, circuit, approach, landing, and OCTA states
 * without breaking legacy callers.
 */
export default class ClearanceStateManager {
    /**
     * Grant an airspace-specific entry clearance to an aircraft.
     * Supersedes any previous active entry clearance.
     *
     * @param {AircraftModel} aircraft
     * @param {AirportModel} airport
     * @param {Object} [options={}]
     * @return {Object} clearance
     */
    static grantEntryClearance(aircraft, airport, options = {}) {
        if (aircraft.entryClearance && aircraft.entryClearance.status === 'active') {
            aircraft.entryClearance.status = 'superseded';
            aircraft.entryClearance.valid = false;
        }

        const maxAltitude = options.maxAltitude != null ? options.maxAltitude : airport.ctr_ceiling;
        const minAltitude = options.minAltitude != null ? options.minAltitude : 0;

        const clearance = {
            id: `${airport.icao}-${Math.round(TimeKeeper.accumulatedDeltaTime * 10)}`,
            airport: airport.icao,
            issuer: (aircraft.controllerState && aircraft.controllerState.currentController) || 'APP',
            issued: TimeKeeper.accumulatedDeltaTime,
            sector: options.sector || null,
            regions: Array.isArray(options.regions) && options.regions.length ? options.regions : null,
            airspaceClasses: options.airspaceClasses || ['C', 'D', 'E'],
            minAltitude,
            maxAltitude,
            ceiling: maxAltitude,
            route: options.route || null,
            reportingPoints: options.reportingPoints || null,
            status: 'active',
            valid: true
        };

        aircraft.entryClearance = clearance;
        aircraft.octaRequired = false;
        aircraft.octaGuidance = null;
        aircraft.predictedEntry = null;
        aircraft.octaStatus = 'normal';

        if (aircraft.controllerState) {
            aircraft.controllerState.airspaceEntryCleared = true;
        }

        if (aircraft.circuitClearance && aircraft.circuitPhase === 'AWAITING ENTRY') {
            const legNames = {
                dw: 'DOWNWIND',
                xw: 'CROSSWIND',
                base: 'BASE',
                final: 'FINAL'
            };
            const legLabel = legNames[aircraft.circuitClearance.leg] || aircraft.circuitClearance.leg || 'CIRCUIT';
            aircraft.circuitPhase = `JOINING ${String(legLabel).toUpperCase()}`;
        }

        return clearance;
    }

    /**
     * Revoke or invalidate an aircraft's active entry clearance.
     *
     * @param {AircraftModel} aircraft
     * @param {string} [status='revoked']
     */
    static revokeEntryClearance(aircraft, status = 'revoked') {
        if (aircraft.entryClearance) {
            aircraft.entryClearance.status = status;
            aircraft.entryClearance.valid = false;
        }

        aircraft.entryClearance = null;

        if (aircraft.controllerState) {
            aircraft.controllerState.airspaceEntryCleared = false;
        }
    }

    /**
     * Set or clear the OCTA (remain outside controlled airspace) restriction.
     * Instructing OCTA revokes any incompatible entry clearance and landing clearance.
     *
     * @param {AircraftModel} aircraft
     * @param {boolean} required
     */
    static setOctaRequired(aircraft, required) {
        aircraft.octaRequired = Boolean(required);

        if (aircraft.octaRequired) {
            this.revokeEntryClearance(aircraft, 'revoked');
            aircraft.nextOctaCheck = 0;
            aircraft.octaStatus = aircraft.infringing ? 'actual_infringement' : 'normal';

            if (aircraft.landingClearance) {
                aircraft.landingClearance = null;
            }

            if (aircraft.circuitClearance) {
                aircraft.circuitPhase = 'AWAITING ENTRY';
            }
        } else {
            aircraft.octaGuidance = null;
            aircraft.predictedEntry = null;
            aircraft.octaStatus = 'normal';
        }
    }

    /**
     * Issue a landing clearance only if approach/circuit and entry state are consistent.
     *
     * @param {AircraftModel} aircraft
     * @param {RunwayModel} runway
     * @param {string} issuer
     * @param {number} [issuedTime]
     * @return {Array} [success, clearanceOrReason]
     */
    static issueLandingClearance(aircraft, runway, issuer, issuedTime = TimeKeeper.accumulatedDeltaTime) {
        if (!runway) {
            return [false, 'no arrival runway assigned'];
        }

        if (!aircraft.pilot || !aircraft.pilot.hasApproachClearance) {
            return [false, 'request approach or circuit clearance to the assigned runway first'];
        }

        const assignedRunway = aircraft.fms && aircraft.fms.arrivalRunwayModel;

        if (!assignedRunway || assignedRunway.name !== runway.name) {
            return [false, `aircraft is not cleared for runway ${runway.name}`];
        }

        if (aircraft.rules === FLIGHT_RULES.VFR &&
            (aircraft.octaRequired || !aircraft.entryClearance || !aircraft.entryClearance.valid)) {
            return [false, 'request controlled airspace entry first'];
        }

        const clearance = {
            runway: runway.name,
            issuer,
            issued: issuedTime
        };

        aircraft.landingClearance = clearance;

        return [true, clearance];
    }

    /**
     * Cancel approach, circuit, and landing clearances together.
     *
     * @param {AircraftModel} aircraft
     */
    static cancelApproachClearance(aircraft) {
        aircraft.landingClearance = null;
        aircraft.circuitClearance = null;

        if (aircraft.circuitPhase !== 'GO AROUND' && aircraft.circuitPhase !== 'LANDED') {
            aircraft.circuitPhase = null;
        }

        if (aircraft.pilot) {
            aircraft.pilot.hasApproachClearance = false;
            aircraft.pilot.approachGuidance = null;
        }
    }

    /**
     * Invalidate incompatible approach, circuit, and landing clearances when arrival runway changes.
     *
     * @param {AircraftModel} aircraft
     * @param {RunwayModel|null} newRunway
     */
    static onArrivalRunwayChanged(aircraft, newRunway) {
        const nextName = newRunway ? newRunway.name : null;

        if (aircraft.landingClearance && aircraft.landingClearance.runway !== nextName) {
            aircraft.landingClearance = null;
        }

        if (aircraft.circuitClearance && aircraft.circuitClearance.runway !== nextName) {
            aircraft.circuitClearance = null;
            aircraft.circuitPhase = null;
        }

        if (aircraft.pilot && aircraft.pilot.approachGuidance &&
            aircraft.pilot.approachGuidance.runway &&
            aircraft.pilot.approachGuidance.runway.name !== nextName) {
            this.cancelApproachClearance(aircraft);
        }
    }

    /**
     * Clear obsolete clearances when an aircraft goes around.
     *
     * @param {AircraftModel} aircraft
     */
    static onGoAround(aircraft) {
        aircraft.landingClearance = null;
        aircraft.circuitClearance = null;
        aircraft.circuitPhase = 'GO AROUND';

        if (aircraft.pilot) {
            aircraft.pilot.hasApproachClearance = false;
            aircraft.pilot.approachGuidance = null;
        }
    }

    /**
     * Validate and repair any contradictory clearance states on an aircraft.
     *
     * @param {AircraftModel} aircraft
     */
    static validateState(aircraft) {
        if (aircraft.octaRequired && aircraft.entryClearance) {
            this.revokeEntryClearance(aircraft, 'revoked');
        }

        if (aircraft.entryClearance && (!aircraft.entryClearance.valid || aircraft.entryClearance.status !== 'active')) {
            aircraft.entryClearance = null;

            if (aircraft.controllerState) {
                aircraft.controllerState.airspaceEntryCleared = false;
            }
        }

        if (aircraft.landingClearance && (!aircraft.pilot || !aircraft.pilot.hasApproachClearance)) {
            aircraft.landingClearance = null;
        }

        if (aircraft.circuitPhase === 'GO AROUND' && aircraft.landingClearance) {
            aircraft.landingClearance = null;
        }
    }
}
