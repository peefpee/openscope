import { VOICE_STATE } from '../VoiceController';

/**
 * Compact in-game voice control status bar & collapsible debug/parser-test panel
 * integrated into the radar scope without obscuring the display.
 */
export default class VoiceStatusView {
    constructor(rootElement, voiceController) {
        this.root = rootElement;
        this.voice = voiceController;
        this.el = null;
        this._mount();
    }

    _mount() {
        if (!this.root) return;
        const bar = document.createElement('div');
        bar.id = 'voice-status-bar';
        bar.className = 'voice-status-bar voice-state--idle';
        bar.hidden = !this.voice || !this.voice.settings.enabled;
        bar.innerHTML = [
            '<span class="voice-ptt-dot" aria-hidden="true"></span>',
            '<span class="voice-tx-label">VOICE IDLE</span>',
            '<span class="voice-level-meter" aria-hidden="true"><i class="voice-level-fill"></i></span>',
            '<span class="voice-transcript" role="status"></span>',
            '<span class="voice-confirm-actions" hidden>',
            '<button type="button" class="voice-confirm-btn">Execute</button>',
            '<button type="button" class="voice-reject-btn">Dismiss</button>',
            '</span>',
            '<button type="button" class="voice-debug-toggle" aria-expanded="false" title="Toggle voice debug panel">DBG</button>',
            '<div class="voice-debug-panel" hidden>',
            '<div class="voice-debug-row"><strong>Normalized:</strong> <span data-dbg="normalized">—</span></div>',
            '<div class="voice-debug-row"><strong>Callsign:</strong> <span data-dbg="callsign">—</span> · <strong>Source:</strong> <span data-dbg="source">—</span></div>',
            '<div class="voice-debug-row"><strong>Commands:</strong> <span data-dbg="commands">—</span></div>',
            '<div class="voice-debug-row"><strong>Latency:</strong> <span data-dbg="latency">—</span></div>',
            '<div class="voice-debug-row"><strong>Error:</strong> <span data-dbg="error">—</span></div>',
            '<div class="voice-debug-test">',
            '<input type="text" class="voice-test-input" placeholder="Test ATC phrase (dry-run)..." aria-label="Test ATC phrase" />',
            '<button type="button" class="voice-test-run">Test</button>',
            '</div>',
            '</div>'
        ].join('');

        bar.querySelector('.voice-debug-toggle').addEventListener('click', (e) => {
            const panel = bar.querySelector('.voice-debug-panel');
            const open = !panel.hidden;
            panel.hidden = open;
            e.currentTarget.setAttribute('aria-expanded', open ? 'false' : 'true');
        });
        bar.querySelector('.voice-confirm-btn').addEventListener('click', () => {
            if (this.voice) this.voice.confirmPending();
        });
        bar.querySelector('.voice-reject-btn').addEventListener('click', () => {
            if (this.voice) this.voice.rejectPending();
        });
        bar.querySelector('.voice-test-run').addEventListener('click', () => {
            const input = bar.querySelector('.voice-test-input');
            if (this.voice && input && input.value.trim()) {
                this.voice.processTranscript(input.value.trim(), { dryRun: true }).then((res) => {
                    this.update({
                        type: 'status',
                        state: res.validation && res.validation.valid ? VOICE_STATE.LOCAL_OK : VOICE_STATE.REJECTED,
                        transcript: input.value.trim(),
                        normalizedTranscript: res.parsed && res.parsed.normalizedTranscript,
                        callsign: res.parsed && res.parsed.callsign,
                        commands: res.parsed && res.parsed.commands,
                        source: 'local-dryrun',
                        parsingMs: res.parsed && res.parsed.latencyMs,
                        error: (res.validation && res.validation.reason) || (res.parsed && res.parsed.reason) || null
                    });
                });
            }
        });

        this.root.appendChild(bar);
        this.el = bar;
    }

    setEnabled(enabled) {
        if (this.el) this.el.hidden = !enabled;
    }

    update(event) {
        if (!this.el || !event) return;
        if (event.type === 'level') {
            const fill = this.el.querySelector('.voice-level-fill');
            if (fill) fill.style.width = `${Math.round((event.level || 0) * 100)}%`;
            return;
        }

        const labels = {
            [VOICE_STATE.IDLE]: 'VOICE IDLE',
            [VOICE_STATE.TRANSMITTING]: 'TX',
            [VOICE_STATE.TRANSCRIBING]: 'STT...',
            [VOICE_STATE.LOCAL_OK]: 'LOCAL OK',
            [VOICE_STATE.LLM_PENDING]: 'LLM...',
            [VOICE_STATE.LLM_OK]: 'LLM OK',
            [VOICE_STATE.CONFIRM_REQUIRED]: 'CONFIRM',
            [VOICE_STATE.CLARIFICATION]: 'CLARIFY',
            [VOICE_STATE.REJECTED]: 'REJECTED'
        };

        this.el.className = `voice-status-bar voice-state--${event.state || 'idle'}`;
        this.el.querySelector('.voice-tx-label').textContent = labels[event.state] || 'VOICE';

        const transcriptEl = this.el.querySelector('.voice-transcript');
        if (transcriptEl) {
            transcriptEl.textContent = event.commandString || event.transcript || event.reason || event.error || '';
        }

        const confirmBox = this.el.querySelector('.voice-confirm-actions');
        if (confirmBox) confirmBox.hidden = event.state !== VOICE_STATE.CONFIRM_REQUIRED;

        const setDbg = (k, v) => {
            const node = this.el.querySelector(`[data-dbg="${k}"]`);
            if (node) node.textContent = v || '—';
        };
        setDbg('normalized', event.normalizedTranscript);
        setDbg('callsign', event.callsign);
        setDbg('source', event.source);
        setDbg('commands', Array.isArray(event.commands) ? JSON.stringify(event.commands) : '—');
        const latParts = [
            event.recognitionMs ? `STT ${event.recognitionMs}ms` : null,
            event.parsingMs != null ? `Parse ${event.parsingMs}ms` : null,
            event.llmMs != null ? `LLM ${event.llmMs}ms` : null
        ].filter(Boolean);
        setDbg('latency', latParts.join(' · ') || '—');
        setDbg('error', event.error || event.reason);
    }

    destroy() {
        if (this.el) {
            this.el.remove();
            this.el = null;
        }
    }
}
