import { WHISPER_MODELS } from '../providers/WhisperBrowserProvider';
import WhisperBrowserProvider from '../providers/WhisperBrowserProvider';
import WhisperServerProvider from '../providers/WhisperServerProvider';
import LlmFallbackClient from '../integration/LlmFallbackClient';
import AtcParser from '../parser/AtcParser';

/**
 * Manages the Voice Control section in Main Menu V2 Settings.
 */
export default class VoiceSettingsView {
    constructor(menuEl, settings, onSave) {
        this.menu = menuEl;
        this.settings = settings;
        this.onSave = onSave;
        this.parser = new AtcParser();
        this.llmClient = new LlmFallbackClient();
        this._bind();
        this.render();
    }

    _el(id) {
        return this.menu ? this.menu.querySelector(`#${id}`) : null;
    }

    _vc() {
        if (!this.settings.voiceControl) {
            this.settings.voiceControl = {
                enabled: false,
                provider: 'browser',
                pttKey: 'ControlLeft',
                deviceId: '',
                lang: 'en-AU',
                whisperModel: 'base.en',
                whisperServerUrl: 'http://localhost:8080/v1/audio/transcriptions',
                whisperServerModel: 'whisper-1',
                llmFallbackEnabled: false,
                confirmationMode: 'local-auto'
            };
        }
        return this.settings.voiceControl;
    }

    _bind() {
        const bindToggle = (id, key) => {
            const el = this._el(id);
            if (!el) return;
            el.addEventListener('change', () => {
                this._vc()[key] = el.checked;
                this.onSave();
                this.render();
            });
        };
        const bindValue = (id, key) => {
            const el = this._el(id);
            if (!el) return;
            el.addEventListener('change', () => {
                this._vc()[key] = el.value;
                this.onSave();
                this.render();
            });
        };

        bindToggle('vc-enabled', 'enabled');
        bindValue('vc-device', 'deviceId');
        bindValue('vc-lang', 'lang');
        bindValue('vc-provider', 'provider');
        bindValue('vc-whisper-model', 'whisperModel');
        bindValue('vc-whisper-url', 'whisperServerUrl');
        bindValue('vc-whisper-server-model', 'whisperServerModel');
        bindToggle('vc-llm-enabled', 'llmFallbackEnabled');
        bindValue('vc-confirm-mode', 'confirmationMode');

        const pttInput = this._el('vc-ptt-key');
        if (pttInput) {
            pttInput.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') return;
                e.preventDefault();
                e.stopPropagation();
                this._vc().pttKey = e.code;
                pttInput.value = e.code;
                this.onSave();
            });
        }

        const bindClick = (id, handler) => {
            const el = this._el(id);
            if (el) el.addEventListener('click', handler);
        };

        bindClick('vc-test-mic', () => this._testMic());
        bindClick('vc-whisper-prepare', () => this._prepareWhisper());
        bindClick('vc-whisper-clear', () => this._clearWhisper());
        bindClick('vc-whisper-test', () => this._testWhisperServer());
        bindClick('vc-llm-test', () => this._testLlmStatus());
        bindClick('vc-parser-test-run', () => this._runParserTest());
    }

    render() {
        const vc = this._vc();
        const setVal = (id, val) => {
            const el = this._el(id);
            if (el) el.value = val != null ? val : '';
        };
        const setChk = (id, val) => {
            const el = this._el(id);
            if (el) el.checked = Boolean(val);
        };

        setChk('vc-enabled', vc.enabled);
        setVal('vc-ptt-key', vc.pttKey || 'ControlLeft');
        setVal('vc-lang', vc.lang || 'en-AU');
        setVal('vc-provider', vc.provider || 'browser');
        setVal('vc-whisper-model', vc.whisperModel || 'base.en');
        setVal('vc-whisper-url', vc.whisperServerUrl || '');
        setVal('vc-whisper-server-model', vc.whisperServerModel || 'whisper-1');
        setChk('vc-llm-enabled', vc.llmFallbackEnabled);
        setVal('vc-confirm-mode', vc.confirmationMode || 'local-auto');

        const browserNote = this._el('vc-browser-note');
        const whisperBox = this._el('vc-whisper-browser-box');
        const serverBox = this._el('vc-whisper-server-box');
        if (browserNote) browserNote.hidden = vc.provider !== 'browser';
        if (whisperBox) whisperBox.hidden = vc.provider !== 'whisper-browser';
        if (serverBox) serverBox.hidden = vc.provider !== 'whisper-server';

        const modelInfo = WHISPER_MODELS[vc.whisperModel || 'base.en'];
        const sizeEl = this._el('vc-whisper-size');
        if (sizeEl && modelInfo) {
            sizeEl.textContent = `${modelInfo.label} · ${modelInfo.sizeLabel} · ${navigator && navigator.gpu ? 'WebGPU' : 'WASM fallback'}`;
        }
    }

    async _testMic() {
        const status = this._el('vc-mic-status');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const devices = await navigator.mediaDevices.enumerateDevices();
            const mics = devices.filter((d) => d.kind === 'audioinput');
            const select = this._el('vc-device');
            if (select) {
                select.replaceChildren(new Option('System default microphone', ''));
                mics.forEach((m, i) => select.add(new Option(m.label || `Microphone ${i + 1}`, m.deviceId)));
                select.value = this._vc().deviceId || '';
            }
            stream.getTracks().forEach((t) => t.stop());
            if (status) status.textContent = `Microphone ready (${mics.length} input device(s) detected).`;
        } catch (err) {
            if (status) status.textContent = `Microphone unavailable: ${err.message}`;
        }
    }

    async _prepareWhisper() {
        const status = this._el('vc-whisper-status');
        const provider = new WhisperBrowserProvider({
            modelKey: this._vc().whisperModel,
            onProgress: (p) => {
                if (status && p && p.progress != null) {
                    status.textContent = `Downloading model: ${Math.round(p.progress)}%`;
                }
            }
        });
        if (status) status.textContent = 'Loading Whisper model...';
        try {
            const res = await provider.prepare();
            if (status) status.textContent = `Ready (${res.backend.toUpperCase()}): ${res.model}`;
        } catch (err) {
            if (status) status.textContent = `Whisper load failed: ${err.message}`;
        } finally {
            provider.dispose();
        }
    }

    async _clearWhisper() {
        const provider = new WhisperBrowserProvider();
        await provider.clearCachedModels();
        provider.dispose();
        const status = this._el('vc-whisper-status');
        if (status) status.textContent = 'Cleared cached local Whisper models.';
    }

    async _testWhisperServer() {
        const status = this._el('vc-whisper-server-status');
        const provider = new WhisperServerProvider({
            serverUrl: this._vc().whisperServerUrl,
            model: this._vc().whisperServerModel
        });
        if (status) status.textContent = 'Testing connection...';
        const res = await provider.testConnection();
        if (status) status.textContent = res.ok ? `Connected (HTTP ${res.status}).` : `Failed: ${res.error}`;
    }

    async _testLlmStatus() {
        const status = this._el('vc-llm-status');
        if (status) status.textContent = 'Checking backend /api/voice/status...';
        const res = await this.llmClient.checkStatus();
        if (status) {
            status.textContent = res.enabled
                ? `Enabled (${res.provider}, model: ${res.model || 'default'})`
                : 'Disabled on server (set VOICE_LLM_ENABLED=true in .env).';
        }
    }

    _runParserTest() {
        const input = this._el('vc-parser-test-input');
        const output = this._el('vc-parser-test-output');
        if (!input || !output) return;
        const result = this.parser.parse(input.value, {
            activeAircraft: [{ callsign: 'QFA412' }, { callsign: 'JST518' }, { callsign: 'VOZ832' }, { callsign: 'VHABC' }],
            availableWaypoints: ['BOREE', 'RIVET', 'ODALE', 'SY', 'MARLN'],
            availableRunways: ['34L', '34R', '16L', '16R', '24']
        });
        output.textContent = JSON.stringify(result, null, 2);
    }
}
