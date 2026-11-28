const VALID_COMMAND_TYPES = new Set([
    'identify',
    'heading',
    'present_heading',
    'climb',
    'descend',
    'maintain',
    'descend_via_star',
    'climb_via_sid',
    'speed',
    'resume_speed',
    'direct',
    'approach',
    'abort',
    'contact',
    'frequency_change_approved',
    'octa',
    'circuit'
]);

/**
 * Validate structured voice commands (from either local parser or LLM fallback)
 * against live aircraft, airport, ownership, and operational rules before execution.
 */
export default class CommandValidator {
    /**
     * @param {Object} parsedResult
     * @param {Object} context
     * @returns {{ valid: boolean, reason: string|null, clarificationHint: string|null, aircraft: Object|null, commands: Array<Object> }}
     */
    validate(parsedResult, context = {}) {
        if (!parsedResult || parsedResult.status !== 'parsed' || !parsedResult.callsign) {
            return {
                valid: false,
                reason: (parsedResult && parsedResult.reason) || 'Transmission not parsed',
                clarificationHint: null,
                aircraft: null,
                commands: []
            };
        }

        const activeAircraft = context.activeAircraft || [];
        const aircraft = activeAircraft.find(
            (ac) => String(ac.callsign || '').toUpperCase() === String(parsedResult.callsign).toUpperCase()
        );

        if (!aircraft) {
            return {
                valid: false,
                reason: `Aircraft ${parsedResult.callsign} is not active`,
                clarificationHint: null,
                aircraft: null,
                commands: []
            };
        }

        if (aircraft.isControllable === false ||
            (typeof aircraft.isPlayerControlled === 'function' && !aircraft.isPlayerControlled())) {
            return {
                valid: false,
                reason: `${aircraft.callsign} is not currently under player control`,
                clarificationHint: null,
                aircraft,
                commands: []
            };
        }

        if (!Array.isArray(parsedResult.commands) || !parsedResult.commands.length) {
            return {
                valid: false,
                reason: 'No commands to execute',
                clarificationHint: 'Say again clearance.',
                aircraft,
                commands: []
            };
        }

        const availableRunways = new Set((context.availableRunways || []).map((r) => String(r).toUpperCase()));
        const availableWaypoints = new Set((context.availableWaypoints || []).map((w) => String(w).toUpperCase()));
        const maxAlt = (aircraft.model && aircraft.model.ceiling) || 60000;
        const minSpeed = (aircraft.model && aircraft.model.speed && aircraft.model.speed.min) || 90;
        const maxSpeed = (aircraft.model && aircraft.model.speed && aircraft.model.speed.max) || 450;

        for (let i = 0; i < parsedResult.commands.length; i += 1) {
            const cmd = parsedResult.commands[i];
            if (!cmd || !VALID_COMMAND_TYPES.has(cmd.type)) {
                return this._fail(aircraft, `Unsupported command type: ${cmd && cmd.type}`, 'Say again clearance.');
            }

            if (cmd.type === 'heading') {
                if (!Number.isFinite(cmd.value) || cmd.value < 1 || cmd.value > 360) {
                    return this._fail(aircraft, 'Heading must be between 001 and 360', 'Say again heading.');
                }
            } else if (cmd.type === 'climb' || cmd.type === 'descend' || cmd.type === 'maintain') {
                if (!Number.isFinite(cmd.altitude) || cmd.altitude < 500 || cmd.altitude > maxAlt) {
                    return this._fail(
                        aircraft,
                        `Altitude ${cmd.altitude} outside aircraft limits`,
                        'Say again assigned altitude.'
                    );
                }
            } else if (cmd.type === 'speed') {
                if (!Number.isFinite(cmd.knots) || cmd.knots < minSpeed || cmd.knots > maxSpeed) {
                    return this._fail(aircraft, `Speed ${cmd.knots} outside aircraft envelope`, 'Say again speed.');
                }
            } else if (cmd.type === 'direct') {
                if (!cmd.waypoint || (availableWaypoints.size && !availableWaypoints.has(cmd.waypoint.toUpperCase()))) {
                    return this._fail(aircraft, `Unknown waypoint ${cmd.waypoint}`, 'Say again clearance.');
                }
            } else if (cmd.type === 'approach') {
                if (aircraft.rules === 'vfr' && (cmd.kind === 'ils' || cmd.kind === 'rnav')) {
                    return this._fail(aircraft, 'VFR aircraft cannot be cleared for ILS or RNAV approach', 'Say again clearance.');
                }
                if (!cmd.runway || (availableRunways.size && !availableRunways.has(cmd.runway.toUpperCase()))) {
                    return this._fail(aircraft, `Unknown runway ${cmd.runway}`, 'Confirm runway.');
                }
            } else if (cmd.type === 'circuit') {
                if (!cmd.runway || (availableRunways.size && !availableRunways.has(cmd.runway.toUpperCase()))) {
                    return this._fail(aircraft, `Unknown runway ${cmd.runway}`, 'Confirm runway.');
                }
            } else if (cmd.type === 'contact') {
                const freqs = context.controllerFrequencies || {};
                if (cmd.frequency && freqs[cmd.role.toUpperCase()]) {
                    const expected = String(freqs[cmd.role.toUpperCase()]);
                    if (expected !== String(cmd.frequency)) {
                        return this._fail(aircraft, `Invalid ${cmd.role} frequency ${cmd.frequency}`, 'Say again frequency.');
                    }
                }
            }
        }

        return {
            valid: true,
            reason: null,
            clarificationHint: null,
            aircraft,
            commands: parsedResult.commands
        };
    }

    _fail(aircraft, reason, clarificationHint) {
        return {
            valid: false,
            reason,
            clarificationHint,
            aircraft,
            commands: []
        };
    }
}
