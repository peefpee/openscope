import SpeechProvider from '../SpeechProvider';

/**
 * Web Speech API provider (`SpeechRecognition` / `webkitSpeechRecognition`).
 * Note: Browser speech recognition may send audio to an external cloud service.
 */
export default class BrowserSpeechProvider extends SpeechProvider {
    constructor(options = {}) {
        super('browser', options);
        this.lang = options.lang || 'en-AU';
        this.recognition = null;
        this.startedAt = 0;
        this.finalProcessed = false;
        this.resolveStop = null;
        this.rejectStop = null;
        this.lastTranscript = '';
        this.lastAlternatives = [];
        this.lastConfidence = null;
    }

    get isExternalService() {
        return true;
    }

    _ctor() {
        return (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
    }

    isSupported() {
        return Boolean(this._ctor());
    }

    start({ onInterim = () => {} } = {}) {
        const Recognition = this._ctor();
        if (!Recognition) {
            return Promise.reject(new Error('Browser SpeechRecognition is not supported in this browser.'));
        }

        this.cancel();
        this.finalProcessed = false;
        this.lastTranscript = '';
        this.lastAlternatives = [];
        this.lastConfidence = null;
        this.startedAt = Date.now();

        const rec = new Recognition();
        rec.lang = this.lang;
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 3;

        rec.onresult = (event) => {
            if (this.finalProcessed) return;
            let interim = '';
            let finalText = '';
            const alts = [];
            let conf = null;

            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const res = event.results[i];
                if (res.isFinal) {
                    this.finalProcessed = true;
                    finalText = res[0] ? res[0].transcript : '';
                    conf = res[0] && typeof res[0].confidence === 'number' ? res[0].confidence : null;
                    for (let j = 1; j < res.length; j += 1) {
                        if (res[j] && res[j].transcript) alts.push(res[j].transcript.trim());
                    }
                } else if (res[0]) {
                    interim += res[0].transcript;
                }
            }

            if (interim) {
                onInterim(interim.trim());
            }

            if (this.finalProcessed) {
                this.lastTranscript = finalText.trim();
                this.lastAlternatives = alts;
                this.lastConfidence = conf;
                if (this.resolveStop) {
                    const resolve = this.resolveStop;
                    this.resolveStop = null;
                    this.rejectStop = null;
                    resolve(this.formatResult(this.lastTranscript, {
                        confidence: this.lastConfidence,
                        alternatives: this.lastAlternatives,
                        durationMs: Date.now() - this.startedAt
                    }));
                }
            }
        };

        rec.onerror = (event) => {
            const errCode = event && event.error ? event.error : 'recognition-error';
            if (errCode === 'no-speech' || errCode === 'aborted') {
                if (this.resolveStop) {
                    const resolve = this.resolveStop;
                    this.resolveStop = null;
                    this.rejectStop = null;
                    resolve(this.formatResult('', { durationMs: Date.now() - this.startedAt }));
                }
                return;
            }
            if (this.rejectStop) {
                const reject = this.rejectStop;
                this.resolveStop = null;
                this.rejectStop = null;
                reject(new Error(`Speech recognition failed: ${errCode}`));
            }
        };

        rec.onend = () => {
            if (this.resolveStop) {
                const resolve = this.resolveStop;
                this.resolveStop = null;
                this.rejectStop = null;
                resolve(this.formatResult(this.lastTranscript, {
                    confidence: this.lastConfidence,
                    alternatives: this.lastAlternatives,
                    durationMs: Date.now() - this.startedAt
                }));
            }
        };

        this.recognition = rec;
        rec.start();
        return Promise.resolve();
    }

    stop() {
        if (!this.recognition) {
            return Promise.resolve(this.formatResult(''));
        }
        if (this.finalProcessed) {
            const result = this.formatResult(this.lastTranscript, {
                confidence: this.lastConfidence,
                alternatives: this.lastAlternatives,
                durationMs: Date.now() - this.startedAt
            });
            this.recognition = null;
            return Promise.resolve(result);
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.resolveStop = null;
                this.rejectStop = null;
                resolve(this.formatResult(this.lastTranscript, {
                    confidence: this.lastConfidence,
                    alternatives: this.lastAlternatives,
                    durationMs: Date.now() - this.startedAt
                }));
            }, 1200);
            this.resolveStop = (res) => {
                clearTimeout(timer);
                this.recognition = null;
                resolve(res);
            };
            this.rejectStop = (err) => {
                clearTimeout(timer);
                this.recognition = null;
                reject(err);
            };
            try {
                this.recognition.stop();
            } catch (e) {
                clearTimeout(timer);
                this.recognition = null;
                resolve(this.formatResult(''));
            }
        });
    }

    cancel() {
        this.resolveStop = null;
        this.rejectStop = null;
        if (this.recognition) {
            try {
                this.recognition.abort();
            } catch (e) { /* ignore */ }
            this.recognition = null;
        }
    }
}
