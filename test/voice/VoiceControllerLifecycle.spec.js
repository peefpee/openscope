import 'regenerator-runtime/runtime';
import test from 'ava';
import VoiceController, { CONFIRMATION_MODE, VOICE_STATE } from '../../src/assets/scripts/client/voice/VoiceController';
import LlmFallbackClient, { validateLlmResponse } from '../../src/assets/scripts/client/voice/integration/LlmFallbackClient';
import CommandAdapter from '../../src/assets/scripts/client/voice/integration/CommandAdapter';
import BrowserSpeechProvider from '../../src/assets/scripts/client/voice/providers/BrowserSpeechProvider';

function makeController(overrides = {}) {
    const executed = [];
    const states = [];
    const aircraft = [
        {
            callsign: 'QFA412',
            rules: 'ifr',
            isControllable: true,
            isRemovable: false,
            model: { ceiling: 41000, speed: { min: 130, max: 350 } }
        },
        {
            callsign: 'VHABC',
            rules: 'vfr',
            isControllable: true,
            isRemovable: false,
            model: { ceiling: 12500, speed: { min: 65, max: 160 } }
        },
        {
            callsign: 'JST518',
            rules: 'ifr',
            isControllable: false,
            isRemovable: false,
            model: { ceiling: 39000, speed: { min: 130, max: 340 } }
        }
    ];

    const context = {
        snapshot: () => ({
            airport: 'YSSY',
            activeAircraft: aircraft,
            airlines: [],
            availableWaypoints: ['BOREE', 'RIVET'],
            availableRunways: ['34L', '34R', '24'],
            controllerFrequencies: { APP: '124.400', TWR: '120.500', CTR: '125.000' }
        }),
        toLlmPayload: (transcript, snap) => ({ transcript, airport: snap.airport, activeAircraft: ['QFA412'] })
    };

    const adapter = new CommandAdapter({
        aircraftCommander: {
            runCommands(ac, parsed) {
                executed.push({ callsign: ac.callsign, parsed });
                return [true, 'readback'];
            }
        }
    });

    const controller = new VoiceController({
        settings: {
            enabled: true,
            llmFallbackEnabled: true,
            confirmationMode: CONFIRMATION_MODE.LOCAL_AUTO_LLM_CONFIRM,
            ...(overrides.settings || {})
        },
        context,
        adapter,
        llmClient: overrides.llmClient || new LlmFallbackClient({
            fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) })
        }),
        onStateChange: (ev) => states.push(ev)
    });

    return { controller, executed, states, aircraft };
}

test('Valid local command executes immediately and NEVER calls LLM', async (t) => {
    let llmCalled = false;
    const { controller, executed } = makeController({
        llmClient: {
            cancel() {},
            async interpret() {
                llmCalled = true;
                return {};
            }
        }
    });

    const res = await controller.processTranscript('Qantas four one two, turn left heading two seven zero, descend three thousand');
    t.true(res.executed);
    t.false(llmCalled);
    t.is(executed.length, 1);
    t.is(executed[0].callsign, 'QFA412');
    t.is(res.commandString, 'QFA412 tlh 270 d 30');
    controller.destroy();
});

test('VFR aircraft cannot be cleared for ILS or RNAV approach', async (t) => {
    const { controller, executed, states } = makeController();
    const res = await controller.processTranscript('Victor Hotel Alpha Bravo Charlie cleared ILS runway two four');
    t.false(res.executed);
    t.is(executed.length, 0);
    t.is(states[states.length - 1].state, VOICE_STATE.REJECTED);
    controller.destroy();
});

test('Aircraft not under player control is rejected safely', async (t) => {
    const { controller, executed } = makeController();
    const res = await controller.processTranscript('Jetstar five one eight descend five thousand');
    t.false(res.executed);
    t.is(executed.length, 0);
    controller.destroy();
});

test('LLM fallback requires confirmation in default mode and ignores late responses after session exit', async (t) => {
    let resolveLlm;
    const { controller, executed, states } = makeController({
        llmClient: {
            cancel() {},
            interpret() {
                return new Promise((resolve) => { resolveLlm = resolve; });
            }
        }
    });

    const pending = controller.processTranscript('Qantas four one two come left onto two seven zero');
    // Simulate session exit / pause before LLM responds
    controller.invalidatePending();
    resolveLlm({
        status: 'parsed',
        callsign: 'QFA412',
        commands: [{ type: 'heading', direction: 'left', value: 270 }],
        source: 'llm'
    });
    const res = await pending;
    t.true(res.cancelled);
    t.is(executed.length, 0);

    // Now test active LLM confirmation flow
    const { controller: c2, executed: exec2, states: st2 } = makeController({
        llmClient: {
            cancel() {},
            async interpret() {
                return {
                    status: 'parsed',
                    callsign: 'QFA412',
                    commands: [{ type: 'heading', direction: 'left', value: 270 }],
                    source: 'llm'
                };
            }
        }
    });
    const r2 = await c2.processTranscript('Qantas four one two come left onto two seven zero');
    t.true(r2.confirmationRequired);
    t.is(exec2.length, 0);
    t.is(st2[st2.length - 1].state, VOICE_STATE.CONFIRM_REQUIRED);

    const confirmed = c2.confirmPending();
    t.true(confirmed.executed);
    t.is(exec2.length, 1);
    controller.destroy();
    c2.destroy();
});

test('validateLlmResponse rejects malformed, injected, or unsupported LLM payloads', (t) => {
    t.throws(() => validateLlmResponse(null));
    t.throws(() => validateLlmResponse({ status: 'hacked' }));
    t.throws(() => validateLlmResponse({ status: 'parsed', callsign: 'QFA412', commands: [] }));
    t.throws(() => validateLlmResponse({ status: 'parsed', callsign: 'QFA412', commands: [{ type: 'eval_js' }] }));
    t.throws(() => validateLlmResponse({ status: 'parsed', callsign: 'QFA412', commands: [{ type: 'heading', value: 'NaN' }] }));

    const clar = validateLlmResponse({ status: 'clarification_required', callsign: 'QFA412', reason: 'Unclear altitude' });
    t.is(clar.status, 'clarification_required');
});

test('BrowserSpeechProvider processes final recognition result only once', async (t) => {
    const prevRec = window.SpeechRecognition;
    let instance;
    window.SpeechRecognition = class MockRecognition {
        constructor() { instance = this; }
        start() {}
        stop() {}
        abort() {}
    };

    try {
        const provider = new BrowserSpeechProvider();
        await provider.start();
        const stopPromise = provider.stop();
        instance.onresult({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: 'Qantas four one two descend three thousand', confidence: 0.9 } }]
        });
        // Duplicate final event should be ignored
        instance.onresult({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: 'Duplicate', confidence: 0.9 } }]
        });
        const result = await stopPromise;
        t.is(result.transcript, 'Qantas four one two descend three thousand');
        t.is(result.provider, 'browser');
    } finally {
        window.SpeechRecognition = prevRec;
    }
});
