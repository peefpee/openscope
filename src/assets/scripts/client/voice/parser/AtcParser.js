import { normalizeTranscript } from './NumberNormalizer';
import { resolveCallsign } from './CallsignResolver';
import { parseClause, splitClauses } from './PhraseologyGrammar';

export const PARSER_STATUS = {
    PARSED: 'parsed',
    PARTIALLY_PARSED: 'partially_parsed',
    AMBIGUOUS_CALLSIGN: 'ambiguous_callsign',
    AMBIGUOUS_INSTRUCTION: 'ambiguous_instruction',
    UNSUPPORTED_INSTRUCTION: 'unsupported_instruction',
    INVALID_PARAMETERS: 'invalid_parameters',
    NO_ACTIONABLE_INSTRUCTION: 'no_actionable_instruction',
    UNRECOGNISED: 'unrecognised'
};

/**
 * Deterministic Australian ATC transcript parser.
 * Parses the full transmission before returning `parsed`.
 */
export default class AtcParser {
    /**
     * @param {string} transcript
     * @param {Object} [context]
     * @param {Array<Object>} [context.activeAircraft]
     * @param {Array<Object>} [context.airlines]
     * @param {Array<string>} [context.availableWaypoints]
     * @returns {Object}
     */
    parse(transcript, context = {}) {
        const start = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();

        const normalized = normalizeTranscript(transcript);
        if (!normalized) {
            return this._result(PARSER_STATUS.NO_ACTIONABLE_INSTRUCTION, null, [], normalized, 'Empty transmission', start);
        }

        const csResult = resolveCallsign(normalized, context.activeAircraft || [], context.airlines || []);
        if (csResult.status === 'ambiguous') {
            return this._result(
                PARSER_STATUS.AMBIGUOUS_CALLSIGN,
                null,
                [],
                normalized,
                `Ambiguous callsign: ${csResult.candidates.join(', ')}`,
                start,
                csResult.candidates
            );
        }

        if (csResult.status === 'not_found') {
            return this._result(
                PARSER_STATUS.INVALID_PARAMETERS,
                null,
                [],
                normalized,
                'Spoken callsign does not match any active aircraft',
                start
            );
        }

        if (csResult.status === 'missing') {
            return this._result(
                PARSER_STATUS.UNRECOGNISED,
                null,
                [],
                normalized,
                'No active aircraft callsign recognised',
                start
            );
        }

        const clauses = splitClauses(csResult.remainder);
        if (!clauses.length) {
            return this._result(
                PARSER_STATUS.NO_ACTIONABLE_INSTRUCTION,
                csResult.callsign,
                [],
                normalized,
                'Callsign only, no clearance given',
                start
            );
        }

        const commands = [];
        const failures = [];

        for (let i = 0; i < clauses.length; i += 1) {
            const parsed = parseClause(clauses[i], context);
            if (parsed.ok) {
                commands.push(parsed.command);
            } else if (!parsed.ignore) {
                failures.push(parsed);
            }
        }

        if (failures.length && commands.length) {
            return this._result(
                PARSER_STATUS.PARTIALLY_PARSED,
                csResult.callsign,
                commands,
                normalized,
                failures[0].reason,
                start
            );
        }

        if (failures.length && !commands.length) {
            return this._result(
                failures[0].status || PARSER_STATUS.UNRECOGNISED,
                csResult.callsign,
                [],
                normalized,
                failures[0].reason,
                start
            );
        }

        if (!commands.length) {
            return this._result(
                PARSER_STATUS.NO_ACTIONABLE_INSTRUCTION,
                csResult.callsign,
                [],
                normalized,
                'No actionable ATC instruction found',
                start
            );
        }

        return this._result(PARSER_STATUS.PARSED, csResult.callsign, commands, normalized, null, start);
    }

    _result(status, callsign, commands, normalizedTranscript, reason, startMs, candidates = []) {
        const endMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        return {
            status,
            callsign,
            commands,
            normalizedTranscript,
            reason,
            candidates,
            source: 'local',
            latencyMs: Math.max(0, Number((endMs - startMs).toFixed(2)))
        };
    }
}
