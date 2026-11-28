const ALLOWED_STATUSES = new Set(['parsed', 'clarification_required', 'unsupported']);
const ALLOWED_COMMAND_TYPES = new Set([
    'identify', 'heading', 'present_heading', 'climb', 'descend',
    'maintain', 'descend_via_star', 'climb_via_sid', 'speed', 'resume_speed',
    'direct', 'approach', 'abort', 'contact', 'frequency_change_approved',
    'octa', 'circuit'
]);

/**
 * Strict schema validation for structured LLM voice interpretation responses.
 * Rejects unexpected fields, invalid command types, or malformed JSON.
 *
 * @param {*} raw
 * @returns {Object}
 */
export function validateLlmResponse(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Malformed LLM response object');
    }
    if (!ALLOWED_STATUSES.has(raw.status)) {
        throw new Error(`Invalid LLM response status: ${raw.status}`);
    }

    if (raw.status === 'clarification_required' || raw.status === 'unsupported') {
        return {
            status: raw.status,
            callsign: typeof raw.callsign === 'string' ? raw.callsign.toUpperCase() : null,
            commands: [],
            reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 240) : 'Clarification required',
            source: 'llm'
        };
    }

    if (typeof raw.callsign !== 'string' || !/^[A-Z0-9]{2,10}$/i.test(raw.callsign.trim())) {
        throw new Error('Missing or invalid callsign in LLM response');
    }
    if (!Array.isArray(raw.commands) || !raw.commands.length || raw.commands.length > 6) {
        throw new Error('Invalid commands array in LLM response');
    }

    const commands = raw.commands.map((cmd) => {
        if (!cmd || typeof cmd !== 'object' || !ALLOWED_COMMAND_TYPES.has(cmd.type)) {
            throw new Error(`Invalid command type in LLM response: ${cmd && cmd.type}`);
        }
        const out = { type: cmd.type };
        if (cmd.direction !== undefined) {
            if (!['left', 'right', 'l', 'r', null].includes(cmd.direction)) {
                throw new Error('Invalid direction');
            }
            out.direction = cmd.direction;
        }
        if (cmd.value !== undefined) {
            const val = Number(cmd.value);
            if (!Number.isFinite(val)) throw new Error('Invalid numeric value');
            out.value = val;
        }
        if (cmd.altitude !== undefined) {
            const alt = Number(cmd.altitude);
            if (!Number.isFinite(alt)) throw new Error('Invalid altitude');
            out.altitude = alt;
        }
        if (cmd.knots !== undefined) {
            const kts = Number(cmd.knots);
            if (!Number.isFinite(kts)) throw new Error('Invalid speed');
            out.knots = kts;
        }
        if (cmd.waypoint !== undefined && cmd.waypoint !== null) {
            out.waypoint = String(cmd.waypoint).trim().toUpperCase();
        }
        if (cmd.kind !== undefined) out.kind = String(cmd.kind).toLowerCase();
        if (cmd.runway !== undefined) out.runway = String(cmd.runway).trim().toUpperCase();
        if (cmd.role !== undefined) out.role = String(cmd.role).toLowerCase();
        if (cmd.frequency !== undefined && cmd.frequency !== null) out.frequency = String(cmd.frequency).trim();
        if (cmd.leg !== undefined) out.leg = String(cmd.leg).toLowerCase();
        return out;
    });

    return {
        status: 'parsed',
        callsign: raw.callsign.trim().toUpperCase(),
        commands,
        reason: null,
        source: 'llm'
    };
}

/**
 * Client for the backend `/api/voice/interpret` (9Router / OpenAI-compatible) endpoint.
 */
export default class LlmFallbackClient {
    constructor(options = {}) {
        this.endpoint = options.endpoint || '/api/voice/interpret';
        this.statusEndpoint = options.statusEndpoint || '/api/voice/status';
        this.timeoutMs = options.timeoutMs || 3000;
        this.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(window) : null);
        this.activeController = null;
    }

    async checkStatus() {
        if (!this.fetchImpl) return { enabled: false, configured: false };
        try {
            const res = await this.fetchImpl(this.statusEndpoint);
            if (!res.ok) return { enabled: false, configured: false };
            return await res.json();
        } catch (e) {
            return { enabled: false, configured: false };
        }
    }

    cancel() {
        if (this.activeController) {
            this.activeController.abort();
            this.activeController = null;
        }
    }

    /**
     * Request structured interpretation for a transcript that the local parser
     * could not completely resolve.
     *
     * @param {Object} payload
     * @returns {Promise<Object>}
     */
    async interpret(payload) {
        if (!this.fetchImpl) {
            throw new Error('Fetch API unavailable for LLM fallback');
        }
        this.cancel();

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        this.activeController = controller;
        const timer = setTimeout(() => {
            if (controller) controller.abort();
        }, this.timeoutMs);

        const startedAt = Date.now();
        try {
            const response = await this.fetchImpl(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller ? controller.signal : undefined
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                const msg = (data && data.error) || `Voice LLM endpoint returned HTTP ${response.status}`;
                throw new Error(msg);
            }
            const validated = validateLlmResponse(data);
            validated.latencyMs = Date.now() - startedAt;
            return validated;
        } finally {
            clearTimeout(timer);
            if (this.activeController === controller) {
                this.activeController = null;
            }
        }
    }
}
