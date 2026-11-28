/**
 * Base speech-to-text provider interface and common result builder.
 */
export default class SpeechProvider {
    constructor(id, options = {}) {
        this.id = id;
        this.options = options;
    }

    get isExternalService() {
        return false;
    }

    isSupported() {
        return false;
    }

    async prepare() {
        return { ready: this.isSupported() };
    }

    async start() {
        throw new Error(`${this.id}: start() not implemented`);
    }

    async stop() {
        return this.formatResult('');
    }

    cancel() {}

    dispose() {
        this.cancel();
    }

    formatResult(transcript, { confidence = null, alternatives = [], durationMs = 0 } = {}) {
        return {
            transcript: String(transcript || '').trim(),
            provider: this.id,
            confidence: typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null,
            alternatives: Array.isArray(alternatives) ? alternatives : [],
            durationMs: Math.max(0, Math.round(durationMs || 0))
        };
    }
}
