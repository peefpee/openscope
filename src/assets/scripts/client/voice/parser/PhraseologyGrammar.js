import {
    parseSpokenAltitude,
    parseSpokenFrequency,
    parseSpokenNumber,
    parseSpokenRunway
} from './NumberNormalizer';
import { resolveWaypoint } from './WaypointResolver';

const CLAUSE_STARTERS = new RegExp(
    '(?<=\\s)(?=' +
    '(?:identified|turn\\s+(?:left|right)|fly\\s+heading|maintain\\s+present\\s+heading|' +
    'climb|descend|maintain|increase\\s+speed|reduce\\s+speed|resume\\s+normal\\s+speed|' +
    'proceed\\s+direct|direct\\s+to|cleared|cancel\\s+approach|go\\s+around|' +
    'contact|frequency\\s+change|remain\\s+outside|join\\s+(?:left|right|downwind|crosswind|base|final))\\b)',
    'i'
);

/**
 * Split a remainder string into individual instruction clauses while preserving order.
 * @param {string} remainder
 * @returns {Array<string>}
 */
export function splitClauses(remainder) {
    if (!remainder) return [];
    const byComma = remainder
        .split(/\s*,\s*/)
        .map((c) => c.trim())
        .filter(Boolean);

    const clauses = [];
    byComma.forEach((part) => {
        part.split(CLAUSE_STARTERS)
            .map((c) => c.trim())
            .filter(Boolean)
            .forEach((c) => clauses.push(c));
    });
    return clauses;
}

function stripStationPrefix(clause) {
    if (/^contact\b/i.test(clause)) return clause.trim();
    return clause
        .replace(/^(?:[a-z]+\s+)?(?:approach|tower|centre|center|control|radar|departure)\s+/i, '')
        .trim();
}

/**
 * Parse a single ATC clause into a structured command or diagnostic error.
 *
 * @param {string} rawClause
 * @param {Object} context
 * @returns {{ ok: boolean, ignore?: boolean, status?: string, reason?: string, command?: Object }}
 */
export function parseClause(rawClause, context = {}) {
    const clause = stripStationPrefix(rawClause).replace(/\band\s+maintain\b/gi, '').replace(/\s+/g, ' ').trim();
    if (!clause) return { ok: false, ignore: true };

    const tokens = clause.split(/\s+/);
    const joined = tokens.join(' ');

    // Pure courtesy / station-only tokens
    if (/^(?:roger|wilco|affirm|affirmative|thanks|thank you|good morning|good afternoon|good day|hello)$/i.test(joined) ||
        (!/^(?:cancel|contact|cleared)\b/i.test(joined) &&
            /^(?:[a-z]+\s+)?(?:approach|tower|centre|center|control|radar|departure)$/i.test(joined))) {
        return { ok: false, ignore: true };
    }

    // 1. Identification
    if (/^identified$/i.test(joined)) {
        return { ok: true, command: { type: 'identify' } };
    }

    // 2. Present heading
    if (/^(?:maintain|fly)\s+present\s+heading$/i.test(joined)) {
        return { ok: true, command: { type: 'present_heading' } };
    }

    // 3. Heading: turn left/right heading <hdg> | fly heading <hdg> | heading <hdg>
    const turnMatch = /^turn\s+(left|right)\s+(?:heading\s+)?(.+)$/i.exec(joined);
    if (turnMatch) {
        const direction = turnMatch[1].toLowerCase();
        const value = parseSpokenNumber(turnMatch[2].replace(/\bdegrees?\b/gi, '').trim().split(/\s+/));
        if (!Number.isFinite(value) || value < 1 || value > 360) {
            return { ok: false, status: 'invalid_parameters', reason: `Invalid heading: ${turnMatch[2]}` };
        }
        return { ok: true, command: { type: 'heading', direction, value } };
    }

    const flyHdgMatch = /^(?:fly\s+heading|heading)\s+(.+)$/i.exec(joined);
    if (flyHdgMatch) {
        const value = parseSpokenNumber(flyHdgMatch[1].replace(/\bdegrees?\b/gi, '').trim().split(/\s+/));
        if (!Number.isFinite(value) || value < 1 || value > 360) {
            return { ok: false, status: 'invalid_parameters', reason: `Invalid heading: ${flyHdgMatch[1]}` };
        }
        return { ok: true, command: { type: 'heading', direction: null, value } };
    }

    // 4. Altitude: climb / descend / maintain <alt|FL>
    const altMatch = /^(climb|descend|maintain)\s+(?:to\s+)?(.+)$/i.exec(joined);
    if (altMatch && !/speed|knots|kts|present\s+heading/i.test(altMatch[2])) {
        const action = altMatch[1].toLowerCase();
        if (/^via\s+star/i.test(altMatch[2])) {
            const rest = altMatch[2].replace(/^via\s+star\s*/i, '').trim();
            const parsed = rest ? parseSpokenAltitude(rest.split(/\s+/)) : null;
            return { ok: true, command: { type: 'descend_via_star', altitude: parsed ? parsed.feet : null } };
        }
        if (/^via\s+sid/i.test(altMatch[2])) {
            const rest = altMatch[2].replace(/^via\s+sid\s*/i, '').trim();
            const parsed = rest ? parseSpokenAltitude(rest.split(/\s+/)) : null;
            return { ok: true, command: { type: 'climb_via_sid', altitude: parsed ? parsed.feet : null } };
        }
        const parsed = parseSpokenAltitude(altMatch[2].split(/\s+/));
        if (!parsed) {
            return { ok: false, status: 'invalid_parameters', reason: `Invalid altitude: ${altMatch[2]}` };
        }
        return {
            ok: true,
            command: {
                type: action,
                altitude: parsed.feet,
                isFlightLevel: parsed.isFlightLevel
            }
        };
    }

    // 5. Speed
    if (/^resume\s+normal\s+speed$/i.test(joined)) {
        return { ok: true, command: { type: 'resume_speed' } };
    }
    const speedMatch = /^(?:(increase|reduce)\s+speed(?:\s+to)?|maintain\s+speed|speed)\s+(.+)$/i.exec(joined);
    if (speedMatch) {
        const mode = speedMatch[1] ? speedMatch[1].toLowerCase() : 'maintain';
        const clean = speedMatch[2].replace(/\b(?:knots?|kts?)\b/gi, '').trim();
        const knots = parseSpokenNumber(clean.split(/\s+/));
        if (!Number.isFinite(knots) || knots < 90 || knots > 450) {
            return { ok: false, status: 'invalid_parameters', reason: `Invalid speed: ${speedMatch[2]}` };
        }
        return { ok: true, command: { type: 'speed', mode, knots } };
    }

    // 6. Direct to waypoint
    const directMatch = /^(?:proceed\s+)?direct(?:\s+to)?\s+(.+)$/i.exec(joined);
    if (directMatch) {
        const wpResult = resolveWaypoint(directMatch[1].split(/\s+/), context.availableWaypoints || []);
        if (wpResult.status === 'ambiguous') {
            return { ok: false, status: 'ambiguous_instruction', reason: `Ambiguous waypoint: ${wpResult.candidates.join(', ')}` };
        }
        if (wpResult.status !== 'resolved') {
            return { ok: false, status: 'invalid_parameters', reason: `Unknown waypoint: ${directMatch[1]}` };
        }
        return { ok: true, command: { type: 'direct', waypoint: wpResult.waypoint } };
    }

    // 7. Approaches & Cancel
    if (/^(?:cancel\s+approach|go\s+around)$/i.test(joined)) {
        return { ok: true, command: { type: 'abort' } };
    }
    const approachMatch = /^cleared\s+(ils|rnav|visual)\s+(?:approach\s+)?(?:(.+?)\s+)?(?:runway\s+)?([a-z0-9\s]+)$/i.exec(joined);
    if (approachMatch) {
        const kind = approachMatch[1].toLowerCase();
        const mid = approachMatch[2] ? approachMatch[2].trim() : '';
        const runway = parseSpokenRunway(approachMatch[3].split(/\s+/));
        if (!runway) {
            return { ok: false, status: 'invalid_parameters', reason: `Invalid runway: ${approachMatch[3]}` };
        }
        let waypoint = null;
        if (kind === 'rnav' && mid) {
            const wp = resolveWaypoint(mid.split(/\s+/), context.availableWaypoints || []);
            if (wp.status === 'resolved') waypoint = wp.waypoint;
        }
        return { ok: true, command: { type: 'approach', kind, runway, waypoint } };
    }

    // 8. Controller coordination: contact tower/centre [freq] | frequency change approved
    if (/^frequency\s+change\s+approved$/i.test(joined)) {
        return { ok: true, command: { type: 'frequency_change_approved' } };
    }
    const contactMatch = /^contact\s+(tower|centre|center|approach|departure)(?:\s+on)?(?:\s+(.+))?$/i.exec(joined);
    if (contactMatch) {
        const role = contactMatch[1].toLowerCase() === 'center' ? 'centre' : contactMatch[1].toLowerCase();
        const freq = contactMatch[2] ? parseSpokenFrequency(contactMatch[2].split(/\s+/)) : null;
        if (contactMatch[2] && !freq) {
            return { ok: false, status: 'invalid_parameters', reason: `Invalid frequency: ${contactMatch[2]}` };
        }
        return { ok: true, command: { type: 'contact', role, frequency: freq } };
    }

    // 9. VFR OCTA & Circuit
    if (/^remain\s+outside\s+controlled\s+airspace$/i.test(joined)) {
        return { ok: true, command: { type: 'octa' } };
    }
    const circuitMatch = /^join\s+(?:(left|right)\s+)?(downwind|crosswind|base|final)\s+(?:runway\s+)?(.+)$/i.exec(joined);
    if (circuitMatch) {
        const direction = circuitMatch[1] ? circuitMatch[1].toLowerCase()[0] : null;
        const leg = circuitMatch[2].toLowerCase();
        const runway = parseSpokenRunway(circuitMatch[3].split(/\s+/));
        if (!runway) {
            return { ok: false, status: 'invalid_parameters', reason: `Invalid runway: ${circuitMatch[3]}` };
        }
        return { ok: true, command: { type: 'circuit', leg, direction, runway } };
    }

    // 10. Unsupported explicit ATC phrases
    if (/\b(?:squawk|hold|mach|rate of|expedite|pan pan|mayday)\b/i.test(joined)) {
        return { ok: false, status: 'unsupported_instruction', reason: `Unsupported instruction: ${joined}` };
    }

    return { ok: false, status: 'unrecognised', reason: `Unrecognised phrase: ${joined}` };
}
