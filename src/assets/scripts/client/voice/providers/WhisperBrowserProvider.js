import SpeechProvider from '../SpeechProvider';

export const WHISPER_MODELS = {
    'tiny.en': { id: 'Xenova/whisper-tiny.en', label: 'Whisper Tiny.en', sizeLabel: '~40 MB' },
    'base.en': { id: 'Xenova/whisper-base.en', label: 'Whisper Base.en', sizeLabel: '~75 MB' },
    'small.en': { id: 'Xenova/whisper-small.en', label: 'Whisper Small.en', sizeLabel: '~240 MB' }
};

function resampleTo16k(samples, inputRate) {
    if (inputRate === 16000) return samples;
    const ratio = inputRate / 16000;
    const outLen = Math.max(1, Math.round(samples.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i += 1) {
        const idx = Math.min(samples.length - 1, Math.floor(i * ratio));
        out[i] = samples[idx];
    }
    return out;
}

/**
 * Local in-browser Whisper speech recognition provider (WebGPU / WASM via Web Worker).
 * Downloads models on demand only when selected.
 */
export default class WhisperBrowserProvider extends SpeechProvider {
    constructor(options = {}) {
        super('whisper-browser', options);
        this.modelKey = options.modelKey || 'base.en';
        this.onProgress = options.onProgress || (() => {});
        this.worker = null;
        this.audioContext = null;
        this.processor = null;
        this.chunks = [];
        this.sampleRate = 16000;
        this.startedAt = 0;
        this.modelReady = false;
        this.backend = this.hasWebGpu() ? 'webgpu' : 'wasm';
    }

    hasWebGpu() {
        return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
    }

    isSupported() {
        return typeof window !== 'undefined' &&
            typeof Worker !== 'undefined' &&
            Boolean(window.AudioContext || window.webkitAudioContext);
    }

    getModelInfo() {
        return WHISPER_MODELS[this.modelKey] || WHISPER_MODELS['base.en'];
    }

    async prepare() {
        if (!this.isSupported()) {
            throw new Error('WebAssembly/WebWorker audio processing is unavailable in this browser.');
        }
        const model = this.getModelInfo();
        if (!this.worker) {
            this._createWorker();
        }
        return new Promise((resolve, reject) => {
            const onMsg = (event) => {
                const msg = event.data || {};
                if (msg.type === 'progress') {
                    this.onProgress(msg);
                } else if (msg.type === 'ready') {
                    this.worker.removeEventListener('message', onMsg);
                    this.modelReady = true;
                    resolve({ ready: true, backend: this.backend, model: model.id });
                } else if (msg.type === 'error') {
                    this.worker.removeEventListener('message', onMsg);
                    reject(new Error(msg.error || 'Failed to load local Whisper model'));
                }
            };
            this.worker.addEventListener('message', onMsg);
            this.worker.postMessage({
                type: 'load',
                modelId: model.id,
                device: this.backend
            });
        });
    }

    _createWorker() {
        const script = `
            let transcriber = null;
            self.onmessage = async (e) => {
                const msg = e.data || {};
                if (msg.type === 'load') {
                    try {
                        const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
                        mod.env.allowLocalModels = false;
                        transcriber = await mod.pipeline('automatic-speech-recognition', msg.modelId, {
                            progress_callback: (p) => self.postMessage({ type: 'progress', ...p })
                        });
                        self.postMessage({ type: 'ready' });
                    } catch (err) {
                        self.postMessage({ type: 'error', error: err.message || 'Whisper model load failed' });
                    }
                } else if (msg.type === 'transcribe') {
                    if (!transcriber) {
                        return self.postMessage({ type: 'result', id: msg.id, error: 'Model not loaded' });
                    }
                    try {
                        const out = await transcriber(msg.audio, {
                            language: 'en',
                            task: 'transcribe',
                            initial_prompt: msg.prompt || ''
                        });
                        self.postMessage({ type: 'result', id: msg.id, text: (out && out.text) || '' });
                    } catch (err) {
                        self.postMessage({ type: 'result', id: msg.id, error: err.message || 'Transcription failed' });
                    }
                }
            };
        `;
        const blob = new Blob([script], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob), { type: 'module' });
    }

    async start({ stream } = {}) {
        if (!stream) throw new Error('Microphone stream required for Whisper.');
        this.chunks = [];
        this.startedAt = Date.now();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioCtx();
        this.sampleRate = this.audioContext.sampleRate || 48000;
        const source = this.audioContext.createMediaStreamSource(stream);
        this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
        this.processor.onaudioprocess = (e) => {
            const channel = e.inputBuffer.getChannelData(0);
            this.chunks.push(new Float32Array(channel));
        };
        source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
    }

    async stop({ vocabularyPrompt = '' } = {}) {
        const durationMs = Date.now() - this.startedAt;
        this._stopAudio();

        const totalLen = this.chunks.reduce((sum, c) => sum + c.length, 0);
        if (!totalLen) {
            return this.formatResult('', { durationMs });
        }

        const merged = new Float32Array(totalLen);
        let offset = 0;
        this.chunks.forEach((c) => {
            merged.set(c, offset);
            offset += c.length;
        });
        this.chunks = [];

        if (!this.modelReady) {
            await this.prepare();
        }

        const pcm16k = resampleTo16k(merged, this.sampleRate);
        const reqId = `${Date.now()}-${Math.random()}`;
        const text = await new Promise((resolve, reject) => {
            const onMsg = (event) => {
                const msg = event.data || {};
                if (msg.type === 'result' && msg.id === reqId) {
                    this.worker.removeEventListener('message', onMsg);
                    if (msg.error) reject(new Error(msg.error));
                    else resolve(msg.text || '');
                }
            };
            this.worker.addEventListener('message', onMsg);
            this.worker.postMessage({
                type: 'transcribe',
                id: reqId,
                audio: pcm16k,
                prompt: vocabularyPrompt
            });
        });

        return this.formatResult(text, { durationMs });
    }

    async clearCachedModels() {
        this.modelReady = false;
        if (typeof caches !== 'undefined' && typeof caches.delete === 'function') {
            await caches.delete('transformers-cache').catch(() => {});
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
    }

    dispose() {
        super.dispose();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}
