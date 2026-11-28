import SpeechProvider from '../SpeechProvider';

/**
 * Encode mono Float32 PCM samples at 16 kHz into a standard WAV Blob.
 * @param {Float32Array} samples
 * @param {number} [sampleRate=16000]
 * @returns {Blob}
 */
export function encodeWav16k(samples, sampleRate = 16000) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i += 1) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Custom Whisper server provider supporting OpenAI-compatible
 * `/v1/audio/transcriptions` or local whisper.cpp `/inference` endpoints.
 */
export default class WhisperServerProvider extends SpeechProvider {
    constructor(options = {}) {
        super('whisper-server', options);
        this.serverUrl = options.serverUrl || 'http://localhost:8080/v1/audio/transcriptions';
        this.model = options.model || 'whisper-1';
        this.timeoutMs = options.timeoutMs || 5000;
        this.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(window) : null);
        this.audioContext = null;
        this.processor = null;
        this.chunks = [];
        this.sampleRate = 16000;
        this.startedAt = 0;
        this.activeController = null;
    }

    get isExternalService() {
        return true;
    }

    isSupported() {
        return Boolean(this.fetchImpl) && typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
    }

    configure(settings = {}) {
        if (settings.serverUrl) this.serverUrl = settings.serverUrl;
        if (settings.model) this.model = settings.model;
        if (settings.timeoutMs) this.timeoutMs = Number(settings.timeoutMs);
    }

    async testConnection() {
        if (!this.fetchImpl || !this.serverUrl) {
            return { ok: false, error: 'Server URL not configured' };
        }
        try {
            const url = new URL(this.serverUrl);
            const res = await this.fetchImpl(url.origin, { method: 'HEAD' });
            return { ok: res.ok || res.status < 500, status: res.status };
        } catch (err) {
            return { ok: false, error: err.message || 'Connection failed' };
        }
    }

    async start({ stream } = {}) {
        if (!stream) throw new Error('Microphone stream required.');
        this.chunks = [];
        this.startedAt = Date.now();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioCtx();
        this.sampleRate = this.audioContext.sampleRate || 48000;
        const source = this.audioContext.createMediaStreamSource(stream);
        this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
        this.processor.onaudioprocess = (e) => {
            this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
    }

    async stop({ vocabularyPrompt = '' } = {}) {
        const durationMs = Date.now() - this.startedAt;
        this._stopAudio();

        const totalLen = this.chunks.reduce((sum, c) => sum + c.length, 0);
        if (!totalLen) return this.formatResult('', { durationMs });

        const merged = new Float32Array(totalLen);
        let offset = 0;
        this.chunks.forEach((c) => {
            merged.set(c, offset);
            offset += c.length;
        });
        this.chunks = [];

        const ratio = this.sampleRate / 16000;
        const downLen = Math.max(1, Math.round(merged.length / ratio));
        const pcm16k = new Float32Array(downLen);
        for (let i = 0; i < downLen; i += 1) {
            pcm16k[i] = merged[Math.min(merged.length - 1, Math.floor(i * ratio))];
        }

        const wav = encodeWav16k(pcm16k, 16000);
        const form = new FormData();
        form.append('file', wav, 'transmission.wav');
        form.append('model', this.model);
        form.append('language', 'en');
        if (vocabularyPrompt) form.append('prompt', vocabularyPrompt);

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        this.activeController = controller;
        const timer = setTimeout(() => { if (controller) controller.abort(); }, this.timeoutMs);

        try {
            const res = await this.fetchImpl(this.serverUrl, {
                method: 'POST',
                body: form,
                signal: controller ? controller.signal : undefined
            });
            if (!res.ok) throw new Error(`Whisper server HTTP ${res.status}`);
            const data = await res.json();
            return this.formatResult(data && data.text ? data.text : '', { durationMs });
        } finally {
            clearTimeout(timer);
            if (this.activeController === controller) this.activeController = null;
        }
    }

    _stopAudio() {
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.audioContext && typeof this.audioContext.close === 'function') {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }
    }

    cancel() {
        this._stopAudio();
        this.chunks = [];
        if (this.activeController) {
            this.activeController.abort();
            this.activeController = null;
        }
    }
}
