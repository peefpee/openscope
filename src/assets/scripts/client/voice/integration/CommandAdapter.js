import CommandParser from '../../commands/parsers/CommandParser';

function formatHeading(value) {
    const n = Math.round(Number(value));
    const wrapped = ((n - 1 + 360) % 360) + 1;
    return String(wrapped).padStart(3, '0');
}

function formatAltitudeArg(feet) {
    return String(Math.round(Number(feet) / 100));
}

/**
 * Converts validated structured voice commands into openScope command strings
 * and executes them through the existing CommandParser + AircraftCommander pipeline.
 */
export default class CommandAdapter {
    /**
     * @param {Object} [options]
     * @param {Object} [options.aircraftCommander]
     * @param {Function} [options.ParserClass]
     */
    constructor(options = {}) {
        this.aircraftCommander = options.aircraftCommander || null;
        this.ParserClass = options.ParserClass || CommandParser;
    }

    /**
     * Convert a structured command object into an openScope command token string.
     * @param {Object} cmd
     * @param {Object} [context]
     * @returns {string|null}
     */
    toCommandSegment(cmd, context = {}) {
        if (!cmd || !cmd.type) return null;
        switch (cmd.type) {
            case 'identify':
                return 'id';
            case 'present_heading':
                return 'fph';
            case 'heading': {
                const hdg = formatHeading(cmd.value);
                if (cmd.direction === 'left') return `tlh ${hdg}`;
                if (cmd.direction === 'right') return `trh ${hdg}`;
                return `fh ${hdg}`;
            }
            case 'climb':
                return `c ${formatAltitudeArg(cmd.altitude)}`;
            case 'descend':
                return `d ${formatAltitudeArg(cmd.altitude)}`;
            case 'maintain':
                return `a ${formatAltitudeArg(cmd.altitude)}`;
            case 'descend_via_star':
                return cmd.altitude ? `dvs ${formatAltitudeArg(cmd.altitude)}` : 'dvs';
            case 'climb_via_sid':
                return cmd.altitude ? `cvs ${formatAltitudeArg(cmd.altitude)}` : 'cvs';
            case 'speed':
                return `sp ${Math.round(cmd.knots)}`;
            case 'resume_speed':
                return 'sp 0';
            case 'direct':
                return `dct ${String(cmd.waypoint).toUpperCase()}`;
            case 'approach':
                if (cmd.kind === 'ils') return `ils ${cmd.runway}`;
                if (cmd.kind === 'vis' || cmd.kind === 'visual') return `vis ${cmd.runway}`;
                if (cmd.kind === 'rnav') {
                    return cmd.waypoint ? `rnav ${cmd.waypoint} ${cmd.runway}` : `rnav ${cmd.runway}`;
                }
                return null;
            case 'abort':
                return 'abort';
            case 'contact': {
                const freqs = context.controllerFrequencies || {};
                const freq = cmd.frequency || freqs[String(cmd.role || '').toUpperCase()];
                return freq ? `contact ${freq}` : null;
            }
            case 'frequency_change_approved':
                return 'fca';
            case 'octa':
                return 'octa';
            case 'circuit': {
                const map = { downwind: 'dw', crosswind: 'xw', base: 'base', final: 'final' };
                const token = map[cmd.leg];
                if (!token) return null;
                return cmd.direction ? `${token} ${cmd.runway} ${cmd.direction}` : `${token} ${cmd.runway}`;
            }
            default:
                return null;
        }
    }

    /**
     * Build the full command string for an aircraft callsign + command list.
     * @param {string} callsign
     * @param {Array<Object>} commands
     * @param {Object} [context]
     * @returns {string}
     */
    buildCommandString(callsign, commands = [], context = {}) {
        const segments = commands
            .map((cmd) => this.toCommandSegment(cmd, context))
            .filter(Boolean);
        return segments.length ? `${callsign} ${segments.join(' ')}` : '';
    }

    /**
     * Execute validated commands against the live aircraft via CommandParser + AircraftCommander.
     *
     * @param {Object} validationResult
     * @param {Object} context
     * @returns {{ executed: boolean, commandString: string, result: * }}
     */
    execute(validationResult, context = {}) {
        if (!validationResult || !validationResult.valid || !validationResult.aircraft) {
            return { executed: false, commandString: '', result: [false, 'Validation failed'] };
        }

        const { aircraft, commands } = validationResult;
        if (aircraft.isRemovable || aircraft.isControllable === false) {
            return { executed: false, commandString: '', result: [false, 'Aircraft no longer controllable'] };
        }

        const commandString = this.buildCommandString(aircraft.callsign, commands, context);
        if (!commandString) {
            return { executed: false, commandString: '', result: [false, 'No executable command segments'] };
        }

        const parsed = new this.ParserClass(commandString);
        if (!this.aircraftCommander || typeof this.aircraftCommander.runCommands !== 'function') {
            return { executed: false, commandString, result: [false, 'AircraftCommander unavailable'] };
        }

        const result = this.aircraftCommander.runCommands(aircraft, parsed);
        const accepted = Array.isArray(result) ? Boolean(result[0]) : true;
        return { executed: accepted, commandString, result };
    }
}
