import AirportController from '../../airport/AirportController';
import NavigationLibrary from '../../navigationLibrary/NavigationLibrary';
import AirlineController from '../../airline/AirlineController';

/**
 * Extracts minimal live session context for deterministic ATC parsing,
 * validation, and optional LLM fallback.
 */
export default class VoiceSessionContext {
    /**
     * @param {Object} [options]
     * @param {Object} [options.aircraftController]
     * @param {Function} [options.isSessionActive]
     */
    constructor(options = {}) {
        this.aircraftController = options.aircraftController || null;
        this.isSessionActive = options.isSessionActive || (() => true);
    }

    snapshot() {
        const airport = AirportController.airport_get();
        const activeAircraft = this.aircraftController && this.aircraftController.aircraft
            ? this.aircraftController.aircraft.list.filter((ac) => !ac.isRemovable)
            : [];

        const availableRunways = [];
        if (airport && Array.isArray(airport.runways)) {
            airport.runways.forEach((pair) => {
                if (Array.isArray(pair.name)) {
                    pair.name.forEach((n) => availableRunways.push(String(n).toUpperCase()));
                }
            });
        }

        const availableWaypoints = [];
        if (NavigationLibrary && NavigationLibrary.waypoints && Array.isArray(NavigationLibrary.waypoints.list)) {
            NavigationLibrary.waypoints.list.forEach((wp) => {
                if (wp && wp.name) availableWaypoints.push(String(wp.name).toUpperCase());
            });
        }

        const controllerFrequencies = {};
        const config = airport && airport.controllerConfig;
        if (config) {
            const app = typeof config.getApproach === 'function' ? config.getApproach() : null;
            const dep = typeof config.getDeparture === 'function' ? config.getDeparture() : null;
            const twr = Array.isArray(config.tower) && config.tower[0] ? config.tower[0] : null;
            const ctr = Array.isArray(config.centre) && config.centre[0] ? config.centre[0] : null;
            if (app && app.frequency) controllerFrequencies.APP = app.frequency;
            if (dep && dep.frequency) controllerFrequencies.DEP = dep.frequency;
            if (twr && twr.frequency) controllerFrequencies.TWR = twr.frequency;
            if (ctr && ctr.frequency) controllerFrequencies.CTR = ctr.frequency;
        }

        const airlines = AirlineController && AirlineController.airlines && Array.isArray(AirlineController.airlines.list)
            ? AirlineController.airlines.list
            : [];

        return {
            airport: airport ? String(airport.icao || '').toUpperCase() : '',
            activeAircraft,
            airlines,
            availableRunways: [...new Set(availableRunways)],
            availableWaypoints: [...new Set(availableWaypoints)],
            controllerFrequencies
        };
    }

    toLlmPayload(transcript, contextSnapshot) {
        const snap = contextSnapshot || this.snapshot();
        return {
            transcript,
            airport: snap.airport,
            activeAircraft: snap.activeAircraft
                .filter((ac) => ac.isControllable !== false)
                .map((ac) => ac.callsign),
            availableRunways: snap.availableRunways,
            availableWaypoints: snap.availableWaypoints.slice(0, 60),
            controllerFrequencies: snap.controllerFrequencies,
            supportedCommands: [
                'identify', 'heading', 'present_heading', 'climb', 'descend',
                'maintain', 'speed', 'resume_speed', 'direct', 'approach',
                'abort', 'contact', 'frequency_change_approved', 'octa', 'circuit'
            ]
        };
    }
}
