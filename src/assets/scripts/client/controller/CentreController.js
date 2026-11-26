import {
    CONTROLLER_TYPE,
    isAustralianAirport
} from '../constants/controllerConstants';

/**
 * Lightweight simulated Centre (en-route) controller for Australian airports.
 *
 * Manages:
 * - Accepting departure handoffs from the player
 * - Continuing outbound navigation until aircraft leaves simulation area
 *
 * @class CentreController
 */
export default class CentreController {
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
         * Aircraft currently managed by centre
         * @property _aircraft
         * @type {Set<string>} aircraft IDs
         */
        this._aircraft = new Set();
    }

    /**
     * Whether this centre controller is active (Australian airport)
     * @type {boolean}
     */
    get isActive() {
        return isAustralianAirport(this._airportModel.icao);
    }

    /**
     * Accept an aircraft handed off by the player to centre.
     * The aircraft continues its outbound navigation and will be removed
     * when it leaves controlled airspace / simulation area.
     *
     * @param {AircraftModel} aircraft
     */
    acceptDeparture(aircraft) {
        if (!aircraft || aircraft.projected) {
            return;
        }

        this._aircraft.add(aircraft.id);

        const config = this._airportModel.controllerConfig;
        let sector = null;

        if (config && typeof config.selectCentreSector === 'function') {
            sector = config.selectCentreSector(aircraft, this._airportModel);
        } else if (config && typeof config.getPrimaryCentre === 'function') {
            sector = config.getPrimaryCentre();
        }

        const centreName = (sector && sector.callsign) || 'CTR';

        if (typeof aircraft.radioCall === 'function') {
            aircraft.radioCall('radar contact, continue as cleared', centreName);
        }
    }

    /**
     * Remove an aircraft from centre management
     *
     * @param {string} aircraftId
     */
    removeAircraft(aircraftId) {
        this._aircraft.delete(aircraftId);
    }

    /**
     * Check if a departure is eligible for centre handoff.
     *
     * Requirements:
     * - Departure aircraft
     * - Airborne
     * - Currently on player's frequency
     * - Tracking outbound OR outside controlled airspace boundary
     *
     * @param {AircraftModel} aircraft
     * @return {boolean}
     */
    isDepartureEligibleForCentreHandoff(aircraft) {
        if (!aircraft || !aircraft.isDeparture() || !aircraft.isAirborne()) {
            return false;
        }

        const cs = aircraft.controllerState;

        // Must currently be on player's frequency
        if (cs.currentController !== CONTROLLER_TYPE.APP &&
            cs.currentController !== CONTROLLER_TYPE.DEP) {
            return false;
        }

        // Must be tracking outbound
        if (aircraft.isTrackingOutbound && aircraft.isTrackingOutbound()) {
            return true;
        }

        // Also eligible if outside controlled airspace
        if (!aircraft.isInsideAirspace(this._airportModel)) {
            return true;
        }

        return false;
    }

    /**
     * Reset state when airport changes
     */
    reset() {
        this._aircraft.clear();
    }
}
