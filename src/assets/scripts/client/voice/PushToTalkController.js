const DEFAULT_MAX_DURATION_MS = 15000;

function isEditableElement(el) {
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(el.isContentEditable);
}

/**
 * Push-to-Talk controller for microphone capture, audio level metering,
 * keyboard + optional Gamepad PTT bindings, and safe session teardown.
 */
export default class PushToTalkController {
    /**
     * @param {Object} [options]
     */
    constructor(options = {}) {
        this.enabled = Boolean(options.enabled);
        this.pttKey = options.pttKey || 'ControlLeft';
        this.gamepadButton = Number.isInteger(options.gamepadButton) ? options.gamepadButton : null;
        this.deviceId = options.deviceId || '';
        this.maxDurationMs = options.maxDurationMs || DEFAULT_MAX_DURATION_MS;

        this.onStart = options.onStart || (() => {});
        this.onStop = options.onStop || (() => {});
        this.onCancel = options.onCancel || (() => {});
        this.onLevel = options.onLevel || (() => {});
        this.onError = options.onError || (() => {});

        this.active = false;
        this.destroyed = false;
        this.stream = null;
        this.audioContext = null;
        this.analyser = null;
        this.levelRaf = null;
        this.maxTimer = null;
        this.gamepadRaf = null;
        this.lastGamepadPressed = false;
        this.keybindCaptureActive = false;

        this._onKeyDown = (e) => this._handleKeyDown(e);
        this._onKeyUp = (e) => this._handleKeyUp(e);
        this._onBlur = () => {
            if (this.active) this.cancel('focus-lost');
        };
        this._onVisibility = () => {
            if (document.hidden && this.active) this.cancel('document-hidden');
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', this._onKeyDown, true);
            window.addEventListener('keyup', this._onKeyUp, true);
            window.addEventListener('blur', this._onBlur);
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this._onVisibility);
        }
    }

    configure(settings = {}) {
        if (typeof settings.enabled === 'boolean') this.enabled = settings.enabled;
        if (settings.pttKey) this.pttKey = settings.pttKey;
        if (settings.deviceId !== undefined) this.deviceId = settings.deviceId;
        if (settings.gamepadButton !== undefined) {
            this.gamepadButton = Number.isInteger(settings.gamepadButton) ? settings.gamepadButton : null;
        }
        this._syncGamepadLoop();
    }

    setKeybindCapture(capturing) {
        this.keybindCaptureActive = Boolean(capturing);
    }

    async requestPermission() {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            throw new Error('Microphone access is not supported in this browser.');
        }
        const constraints = {
            audio: {
                ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}),
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        return stream;
    }

    async enumerateMicrophones() {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
            return [];
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter((d) => d.kind === 'audioinput');
    }

    async beginTransmission() {
        if (!this.enabled || this.destroyed || this.active) return false;
        this.active = true;

        try {
            this.stream = await this.requestPermission();
            if (!this.active || this.destroyed) {
                this._releaseStream();
                return false;
            }
            this._startLevelMeter(this.stream);
            this.maxTimer = setTimeout(() => {
                if (this.active) this.endTransmission();
            }, this.maxDurationMs);
            await this.onStart({ stream: this.stream });
            return true;
        } catch (err) {
            this.active = false;
            this._releaseStream();
            const message = err && err.name === 'NotAllowedError'
                ? 'Microphone permission denied.'
                : ((err && err.message) || 'Unable to access microphone.');
            this.onError(new Error(message));
            return false;
        }
    }

    async endTransmission() {
        if (!this.active) return;
        this.active = false;
        clearTimeout(this.maxTimer);
        this.maxTimer = null;
        this._stopLevelMeter();
        this._releaseStream();
        await this.onStop();
    }

    cancel(reason = 'cancelled') {
        if (!this.active) return;
        this.active = false;
        clearTimeout(this.maxTimer);
        this.maxTimer = null;
        this._stopLevelMeter();
        this._releaseStream();
        this.onCancel(reason);
    }

    _handleKeyDown(event) {
        if (!this.enabled || this.destroyed || this.keybindCaptureActive) return;
        if (event.repeat || event.code !== this.pttKey) return;
        if (isEditableElement(document.activeElement)) return;
        event.preventDefault();
        this.beginTransmission();
    }

    _handleKeyUp(event) {
        if (!this.active || event.code !== this.pttKey) return;
        event.preventDefault();
        this.endTransmission();
    }

    _syncGamepadLoop() {
        if (this.gamepadRaf !== null) {
            window.cancelAnimationFrame(this.gamepadRaf);
            this.gamepadRaf = null;
        }
        if (!this.enabled || this.gamepadButton === null || this.destroyed ||
            !navigator || typeof navigator.getGamepads !== 'function') {
            return;
        }
        const poll = () => {
            if (this.destroyed || !this.enabled || this.gamepadButton === null) return;
            const pads = navigator.getGamepads() || [];
            const pressed = Array.from(pads).some((pad) => (
                pad && pad.buttons && pad.buttons[this.gamepadButton] && pad.buttons[this.gamepadButton].pressed
            ));
            if (pressed && !this.lastGamepadPressed) {
                this.beginTransmission();
            } else if (!pressed && this.lastGamepadPressed) {
                this.endTransmission();
            }
            this.lastGamepadPressed = pressed;
            this.gamepadRaf = window.requestAnimationFrame(poll);
        };
        this.gamepadRaf = window.requestAnimationFrame(poll);
    }

    _startLevelMeter(stream) {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            this.audioContext = new AudioCtx();
            const source = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            source.connect(this.analyser);
            const data = new Uint8Array(this.analyser.frequencyBinCount);

            const tick = () => {
                if (!this.active || !this.analyser) return;
                this.analyser.getByteTimeDomainData(data);
                let sum = 0;
                for (let i = 0; i < data.length; i += 1) {
                    const v = (data[i] - 128) / 128;
                    sum += v * v;
                }
                const rms = Math.sqrt(sum / data.length);
                this.onLevel(Math.min(1, rms * 3.5));
                this.levelRaf = window.requestAnimationFrame(tick);
            };
            this.levelRaf = window.requestAnimationFrame(tick);
        } catch (e) {
            // AudioContext metering is optional
        }
    }

    _stopLevelMeter() {
        if (this.levelRaf !== null) {
            window.cancelAnimationFrame(this.levelRaf);
            this.levelRaf = null;
        }
        this.onLevel(0);
        if (this.audioContext && typeof this.audioContext.close === 'function') {
            this.audioContext.close().catch(() => {});
        }
        this.audioContext = null;
        this.analyser = null;
    }

    _releaseStream() {
        if (this.stream && typeof this.stream.getTracks === 'function') {
            this.stream.getTracks().forEach((track) => track.stop());
        }
        this.stream = null;
    }

    destroy() {
        this.cancel('destroyed');
        this.destroyed = true;
        if (this.gamepadRaf !== null) {
            window.cancelAnimationFrame(this.gamepadRaf);
            this.gamepadRaf = null;
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', this._onKeyDown, true);
            window.removeEventListener('keyup', this._onKeyUp, true);
            window.removeEventListener('blur', this._onBlur);
        }
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._onVisibility);
        }
    }
}
