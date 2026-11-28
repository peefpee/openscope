import AtcParser, { PARSER_STATUS } from './parser/AtcParser';
import CommandValidator from './parser/CommandValidator';
import CommandAdapter from './integration/CommandAdapter';
import VoiceSessionContext from './integration/VoiceSessionContext';
import LlmFallbackClient from './integration/LlmFallbackClient';
import PushToTalkController from './PushToTalkController';
import BrowserSpeechProvider from './providers/BrowserSpeechProvider';
import WhisperBrowserProvider from './providers/WhisperBrowserProvider';
import WhisperServerProvider from './providers/WhisperServerProvider';
import { speech_say } from '../speech';

export const VOICE_STATE = {
    IDLE: 'idle',
    TRANSMITTING: 'transmitting',
    TRANSCRIBING: 'transcribing',
    LOCAL_OK: 'local_ok',
    LLM_PENDING: 'llm_pending',
    LLM_OK: 'llm_ok',
    CONFIRM_REQUIRED: 'confirm_required',
    CLARIFICATION: 'clarification',
    REJECTED: 'rejected'
};

export const CONFIRMATION_MODE = {
    LOCAL_AUTO_LLM_CONFIRM: 'local-auto',
    ALL_AUTO: 'all-auto',
    ALWAYS_CONFIRM: 'always-confirm'
};

/**
 * Top-level hybrid voice control orchestrator for an active radar session.
 */
export default class VoiceController {
    constructor(options = {}) {
        this.settings = {
            enabled: false,
            provider: 'browser',
            pttKey: 'ControlLeft',
            gamepadButton: null,
            deviceId: '',
            lang: 'en-AU',
            whisperModel: 'base.en',
            whisperServerUrl: 'http://localhost:8080/v1/audio/transcriptions',
            whisperServerModel: 'whisper-1',
            llmFallbackEnabled: false,
            confirmationMode: CONFIRMATION_MODE.LOCAL_AUTO_LLM_CONFIRM,
            ...(options.settings || {})
        };

        this.sessionToken = 0;
        this.disposed = false;
        this.pendingConfirmation = null;
        this.onStateChange = options.onStateChange || (() => {});

        this.parser = options.parser || new AtcParser();
        this.validator = options.validator || new CommandValidator();
        this.context = options.context || new VoiceSessionContext({
            aircraftController: options.aircraftController,
            isSessionActive: () => !this.disposed && !this.paused
        });
        this.adapter = options.adapter || new CommandAdapter({
            aircraftCommander: options.aircraftCommander
        });
        this.llmClient = options.llmClient || new LlmFallbackClient();

        this.providers = {
            browser: new BrowserSpeechProvider({ lang: this.settings.lang }),
            'whisper-browser': new WhisperBrowserProvider({ modelKey: this.settings.whisperModel }),
            'whisper-server': new WhisperServerProvider({
                serverUrl: this.settings.whisperServerUrl,
                model: this.settings.whisperServerModel
            })
        };

        this.ptt = new PushToTalkController({
            enabled: this.settings.enabled,
            pttKey: this.settings.pttKey,
            gamepadButton: this.settings.gamepadButton,
            deviceId: this.settings.deviceId,
            onStart: ({ stream }) => this._onPttStart(stream),
            onStop: () => this._onPttStop(),
            onCancel: (reason) => this._onPttCancel(reason),
            onLevel: (level) => this.onStateChange({ type: 'level', level }),
            onError: (err) => this._emitStatus(VOICE_STATE.REJECTED, { error: err.message })
        });

        this.paused = false;
        this.lastDebug = {};
    }

    configure(nextSettings = {}) {
        Object.assign(this.settings, nextSettings);
        this.ptt.configure({
            enabled: Boolean(this.settings.enabled) && !this.paused && !this.disposed,
            pttKey: this.settings.pttKey,
            gamepadButton: this.settings.gamepadButton,
            deviceId: this.settings.deviceId
        });
        if (this.providers['whisper-browser']) {
            this.providers['whisper-browser'].modelKey = this.settings.whisperModel || 'base.en';
        }
        if (this.providers['whisper-server']) {
            this.providers['whisper-server'].configure({
                serverUrl: this.settings.whisperServerUrl,
                model: this.settings.whisperServerModel
            });
        }
        if (this.providers.browser) {
            this.providers.browser.lang = this.settings.lang || 'en-AU';
        }
    }

    getActiveProvider() {
        return this.providers[this.settings.provider] || this.providers.browser;
    }

    setPaused(paused) {
        this.paused = Boolean(paused);
        if (this.paused) {
            this.invalidatePending();
        }
        this.ptt.configure({
            enabled: Boolean(this.settings.enabled) && !this.paused && !this.disposed
        });
    }

    invalidatePending() {
        this.sessionToken += 1;
        this.pendingConfirmation = null;
        this.ptt.cancel('session-suspended');
        Object.values(this.providers).forEach((p) => p.cancel());
        this.llmClient.cancel();
    }

    async _onPttStart(stream) {
        if (this.disposed || this.paused) return;
        // Prevent audio feedback: cancel ongoing pilot TTS playback while controller transmits
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        this.pendingConfirmation = null;
        const provider = this.getActiveProvider();
        this._emitStatus(VOICE_STATE.TRANSMITTING, { transcript: '', provider: provider.id });

        try {
            await provider.start({
                stream,
                onInterim: (interim) => {
                    this._emitStatus(VOICE_STATE.TRANSMITTING, { transcript: interim, interim: true });
                }
            });
        } catch (err) {
            this.ptt.cancel('provider-start-failed');
            this._emitStatus(VOICE_STATE.REJECTED, { error: err.message });
        }
    }

    async _onPttStop() {
        if (this.disposed || this.paused) return;
        const token = this.sessionToken;
        const provider = this.getActiveProvider();
        this._emitStatus(VOICE_STATE.TRANSCRIBING, { provider: provider.id });

        try {
            const snap = this.context.snapshot();
            const vocab = [
                ...snap.activeAircraft.map((a) => a.callsign),
                ...snap.availableWaypoints.slice(0, 30)
            ].join(', ');
            const sttResult = await provider.stop({ vocabularyPrompt: vocab });
            if (token !== this.sessionToken || this.disposed || this.paused) return;

            if (!sttResult || !sttResult.transcript) {
                this._emitStatus(VOICE_STATE.IDLE, {
                    transcript: '',
                    recognitionMs: sttResult ? sttResult.durationMs : 0
                });
                return;
            }

            await this.processTranscript(sttResult.transcript, {
                token,
                recognitionMs: sttResult.durationMs,
                providerId: sttResult.provider
            });
        } catch (err) {
            if (token !== this.sessionToken) return;
            this._emitStatus(VOICE_STATE.REJECTED, { error: err.message });
        }
    }

    _onPttCancel() {
        Object.values(this.providers).forEach((p) => p.cancel());
        this._emitStatus(VOICE_STATE.IDLE, {});
    }

    /**
     * Interpret, validate, and optionally execute a transcript.
     * Can be invoked both by PTT STT output and text-only testing tools.
     */
    async processTranscript(transcript, options = {}) {
        const token = options.token != null ? options.token : this.sessionToken;
        const dryRun = Boolean(options.dryRun);
        const snap = this.context.snapshot();
        const localResult = this.parser.parse(transcript, snap);

        if (localResult.status === PARSER_STATUS.PARSED) {
            return this._handleParsedResult(localResult, snap, {
                token,
                dryRun,
                recognitionMs: options.recognitionMs || 0
            });
        }

        const shouldUseLlm = Boolean(this.settings.llmFallbackEnabled) &&
            !dryRun &&
            [
                PARSER_STATUS.PARTIALLY_PARSED,
                PARSER_STATUS.UNRECOGNISED,
                PARSER_STATUS.AMBIGUOUS_INSTRUCTION
            ].includes(localResult.status);

        if (shouldUseLlm) {
            this._emitStatus(VOICE_STATE.LLM_PENDING, {
                transcript,
                normalizedTranscript: localResult.normalizedTranscript,
                parsingMs: localResult.latencyMs
            });
            try {
                const payload = this.context.toLlmPayload(transcript, snap);
                const llmResult = await this.llmClient.interpret(payload);
                if (token !== this.sessionToken || this.disposed || this.paused) {
                    return { executed: false, cancelled: true };
                }

                if (llmResult.status === 'parsed') {
                    return this._handleParsedResult(llmResult, this.context.snapshot(), {
                        token,
                        dryRun,
                        recognitionMs: options.recognitionMs || 0,
                        parsingMs: localResult.latencyMs,
                        llmMs: llmResult.latencyMs
                    });
                }

                this._emitStatus(VOICE_STATE.CLARIFICATION, {
                    transcript,
                    normalizedTranscript: localResult.normalizedTranscript,
                    callsign: llmResult.callsign,
                    reason: llmResult.reason,
                    source: 'llm',
                    llmMs: llmResult.latencyMs
                });
                return { executed: false, status: llmResult.status, reason: llmResult.reason };
            } catch (err) {
                if (token !== this.sessionToken) return { executed: false, cancelled: true };
                this._emitStatus(VOICE_STATE.REJECTED, {
                    transcript,
                    normalizedTranscript: localResult.normalizedTranscript,
                    error: err.message
                });
                return { executed: false, error: err.message };
            }
        }

        // Handle local ambiguity / failure without inventing aircraft
        const state = localResult.status === PARSER_STATUS.AMBIGUOUS_CALLSIGN ||
            localResult.status === PARSER_STATUS.AMBIGUOUS_INSTRUCTION
            ? VOICE_STATE.CLARIFICATION
            : VOICE_STATE.REJECTED;

        this._emitStatus(state, {
            transcript,
            normalizedTranscript: localResult.normalizedTranscript,
            callsign: localResult.callsign,
            reason: localResult.reason,
            error: localResult.reason,
            parsingMs: localResult.latencyMs,
            source: 'local'
        });
        return { executed: false, parsed: localResult };
    }

    _handleParsedResult(parsedResult, snap, meta = {}) {
        const validation = this.validator.validate(parsedResult, snap);
        if (!validation.valid) {
            if (!meta.dryRun && validation.aircraft && validation.clarificationHint) {
                this._speakClarification(validation.aircraft, validation.clarificationHint);
            }
            this._emitStatus(VOICE_STATE.REJECTED, {
                transcript: meta.transcript || parsedResult.normalizedTranscript || '',
                normalizedTranscript: parsedResult.normalizedTranscript || '',
                callsign: parsedResult.callsign,
                commands: parsedResult.commands,
                error: validation.reason,
                source: parsedResult.source,
                parsingMs: meta.parsingMs || parsedResult.latencyMs,
                llmMs: meta.llmMs || null,
                recognitionMs: meta.recognitionMs || 0
            });
            return { executed: false, parsed: parsedResult, validation };
        }

        if (meta.dryRun) {
            return { executed: false, dryRun: true, parsed: parsedResult, validation };
        }

        const mode = this.settings.confirmationMode || CONFIRMATION_MODE.LOCAL_AUTO_LLM_CONFIRM;
        const needsConfirm = mode === CONFIRMATION_MODE.ALWAYS_CONFIRM ||
            (mode === CONFIRMATION_MODE.LOCAL_AUTO_LLM_CONFIRM && parsedResult.source === 'llm');

        if (needsConfirm) {
            this.pendingConfirmation = {
                token: meta.token,
                parsedResult,
                validation,
                commandString: this.adapter.buildCommandString(validation.aircraft.callsign, validation.commands, snap)
            };
            this._emitStatus(VOICE_STATE.CONFIRM_REQUIRED, {
                callsign: validation.aircraft.callsign,
                commands: validation.commands,
                commandString: this.pendingConfirmation.commandString,
                source: parsedResult.source,
                llmMs: meta.llmMs || null
            });
            return { executed: false, confirmationRequired: true, commandString: this.pendingConfirmation.commandString };
        }

        return this._executeValidated(validation, snap, parsedResult, meta);
    }

    confirmPending() {
        if (!this.pendingConfirmation || this.disposed || this.paused) return { executed: false };
        const { token, parsedResult } = this.pendingConfirmation;
        this.pendingConfirmation = null;
        if (token !== this.sessionToken) return { executed: false, cancelled: true };

        const freshSnap = this.context.snapshot();
        const revalidated = this.validator.validate(parsedResult, freshSnap);
        if (!revalidated.valid) {
            this._emitStatus(VOICE_STATE.REJECTED, { error: revalidated.reason });
            return { executed: false, validation: revalidated };
        }
        return this._executeValidated(revalidated, freshSnap, parsedResult, { token });
    }

    rejectPending() {
        this.pendingConfirmation = null;
        this._emitStatus(VOICE_STATE.IDLE, {});
    }

    _executeValidated(validation, snap, parsedResult, meta = {}) {
        if (meta.token != null && meta.token !== this.sessionToken) {
            return { executed: false, cancelled: true };
        }
        const exec = this.adapter.execute(validation, snap);
        const successState = parsedResult.source === 'llm' ? VOICE_STATE.LLM_OK : VOICE_STATE.LOCAL_OK;
        this._emitStatus(exec.executed ? successState : VOICE_STATE.REJECTED, {
            callsign: validation.aircraft.callsign,
            commands: validation.commands,
            commandString: exec.commandString,
            normalizedTranscript: parsedResult.normalizedTranscript || '',
            source: parsedResult.source,
            recognitionMs: meta.recognitionMs || 0,
            parsingMs: meta.parsingMs || parsedResult.latencyMs || 0,
            llmMs: meta.llmMs || null,
            error: exec.executed ? null : (Array.isArray(exec.result) ? exec.result[1] : 'Command rejected')
        });
        return exec;
    }

    _speakClarification(aircraft, phrase) {
        try {
            speech_say(
                [{ type: 'callsign', content: aircraft }, { type: 'text', content: `, ${phrase}` }],
                aircraft.pilotVoice
            );
        } catch (e) { /* ignore speech errors in headless tests */ }
    }

    _emitStatus(state, payload = {}) {
        this.lastDebug = { state, ...payload, timestamp: Date.now() };
        this.onStateChange({ type: 'status', state, ...payload });
    }

    destroy() {
        this.disposed = true;
        this.invalidatePending();
        this.ptt.destroy();
        Object.values(this.providers).forEach((p) => p.dispose());
    }
}
