// Run after npm run build. Exercise the shipped entry point in independent DOM
// windows, serving the real built assets from disk without a network listener.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomFillSync } = require('node:crypto');
const { test } = require('node:test');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const origin = 'http://session.test';
const root = path.resolve(__dirname, '../../public');
const dat = [
    'RWY:RW12, , ,00012, , , , ;S42494800,E147294000,0000;',
    'RWY:RW30, , ,00014, , , , ;S42503200,E147311000,0000;'
].join('\n');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function read(url) {
    const location = new URL(url, origin);
    assert.equal(location.origin, origin);
    return fs.readFileSync(path.join(root, location.pathname === '/' ? 'index.html' : location.pathname), 'utf8');
}

async function until(predicate, description) {
    for (let attempt = 0; attempt < 250; attempt++) {
        if (predicate()) return;
        await delay(20);
    }
    assert.fail('Timed out waiting for ' + description);
}

function createSharedIndexedDb(sharedRecords = new Map()) {
    return {
        open() {
            const req = {
                result: {
                    createObjectStore() {},
                    transaction() {
                        const tx = {
                            oncomplete: null,
                            onabort: null,
                            objectStore() {
                                return {
                                    getAll() {
                                        const getReq = { result: [...sharedRecords.values()] };
                                        queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
                                        return getReq;
                                    },
                                    put(record) {
                                        sharedRecords.set(record.key, JSON.parse(JSON.stringify(record)));
                                        queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
                                        return {};
                                    },
                                    delete(key) {
                                        sharedRecords.delete(key);
                                        queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
                                        return {};
                                    }
                                };
                            }
                        };
                        return tx;
                    },
                    close() {}
                },
                onupgradeneeded: null,
                onsuccess: null,
                onerror: null
            };
            queueMicrotask(() => {
                if (req.onupgradeneeded) req.onupgradeneeded();
                if (req.onsuccess) req.onsuccess();
            });
            return req;
        }
    };
}

function createSharedStorage() {
    const store = Object.create(null);
    return new Proxy(store, {
        get(target, prop) {
            if (prop === 'getItem') return (k) => (Object.prototype.hasOwnProperty.call(target, k) ? target[k] : null);
            if (prop === 'setItem') return (k, v) => { target[k] = String(v); };
            if (prop === 'removeItem') return (k) => { delete target[k]; };
            if (prop === 'clear') return () => { Object.keys(target).forEach((k) => delete target[k]); };
            return target[prop];
        }
    });
}

function createShell(options = {}) {
    let failAirlines = false;
    let frames = 0;
    const errors = [];
    const speechCalls = [];
    const speechCancels = { count: 0 };
    const sharedStorage = options.sharedStorage || null;
    const sharedIndexedDb = options.sharedIndexedDb || null;
    const mockVoices = options.voices || [{ name: 'Australian Test Voice', voiceURI: 'test-au-voice', lang: 'en-AU' }];

    function install(window) {
        // jsdom 13 predates native dialog, replaceChildren and Web Crypto.
        const prototype = window.HTMLElement.prototype;
        prototype.replaceChildren = function(...nodes) { this.textContent = ''; this.append(...nodes); };
        prototype.showModal = function() { this.open = true; this.setAttribute('open', ''); };
        prototype.close = function() {
            this.open = false;
            this.removeAttribute('open');
            this.dispatchEvent(new window.Event('close'));
        };
        if (sharedStorage) {
            Object.defineProperty(window, 'localStorage', { value: sharedStorage, configurable: true });
        }
        if (sharedIndexedDb) {
            Object.defineProperty(window, 'indexedDB', { value: sharedIndexedDb, configurable: true });
        }
        window.crypto = { getRandomValues: randomFillSync };
        window.fetch = async (url) => ({ ok: true, json: () => JSON.parse(read(url)) });
        window.focus = () => {};
        Object.defineProperty(window.document, 'hidden', { value: false, configurable: true });
        window._hasFocus = true;
        window.document.hasFocus = () => window._hasFocus;
        window.gtag = () => {};
        window.SpeechSynthesisUtterance = class {
            constructor(text = '') {
                this.text = text;
                this.lang = '';
                this.voice = null;
                this.volume = 1;
                this.rate = 1;
                this.pitch = 1;
            }
        };
        window.speechSynthesis = {
            getVoices: () => mockVoices,
            addEventListener() {},
            speak(utterance) {
                speechCalls.push({
                    isFrame: Boolean(window.frameElement),
                    text: utterance.text,
                    lang: utterance.lang,
                    voiceURI: utterance.voice ? utterance.voice.voiceURI : '',
                    volume: utterance.volume,
                    rate: utterance.rate
                });
            },
            cancel() { speechCancels.count += 1; }
        };
        window.XMLHttpRequest = class {
            constructor() { this.withCredentials = false; }
            open(method, url) { this.url = url; }
            setRequestHeader() {}
            getAllResponseHeaders() { return 'Content-Type: application/json\r\n'; }
            abort() {}
            send() {
                window.setTimeout(() => {
                    if (failAirlines && this.url.includes('airlines.json')) {
                        this.status = 503;
                        this.onerror();
                        return;
                    }
                    this.responseText = read(this.url);
                    this.status = 200;
                    this.onload();
                }, 1);
            }
        };
        window.HTMLCanvasElement.prototype.getContext = function() {
            const context = { canvas: this, measureText: () => ({ width: 12 }) };
            return new Proxy(context, { get: (obj, key) => key in obj ? obj[key] : () => {} });
        };
    }

    class Assets extends ResourceLoader {
        fetch(url, { element }) {
            if (!url.startsWith(origin + '/')) return null;
            if (url.includes('bundle.min.js')) {
                install(element.ownerDocument.defaultView);
                if (element.ownerDocument.defaultView.frameElement) frames++;
            }
            const p = Promise.resolve(Buffer.from(read(url)));
            p.abort = () => {};
            return p;
        }
    }

    const console = new VirtualConsole();
    console.on('jsdomError', (error) => errors.push(error.message));
    const dom = new JSDOM(read('/'), {
        url: origin, resources: new Assets(), runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console
    });
    const w = dom.window;
    const find = (selector) => w.document.querySelector(selector);
    const act = (action) => find('[data-page]:not([hidden]) [data-action="' + action + '"]').click();
    return {
        dom,
        w,
        find,
        act,
        errors,
        speechCalls,
        speechCancels,
        getFrames: () => frames,
        setFailAirlines: (val) => { failAirlines = val; }
    };
}

test('built shell recovers from a failed load and alternates ten independent radar sessions', async () => {
    const shell = createShell();
    const { dom, w, find, act, errors } = shell;
    try {
        const records = () => Object.keys(w.localStorage).filter((key) => key.startsWith('openscope.sessionScore.v1.'));
        await until(() => find('#session-menu')?.open, 'main menu');
        assert.equal(find('iframe'), null);
        for (let i = 0; i < 10; i++) {
            const custom = i % 2 === 1;
            act('play');
            if (custom) {
                act('custom');
                find('#dat-terrain-auto').checked = false;
                if (i === 1) {
                    const input = find('#dat-airport-file');
                    Object.defineProperty(input, 'files', { value: [new w.File([dat], 'YMHB.dat')] });
                    input.dispatchEvent(new w.Event('change', { bubbles: true }));
                }
                await until(() => !find('#dat-import footer').hidden, 'prepared custom airport');
                find('#dat-import .dat-open').click();
            } else {
                act('classic');
                await until(() => find('#session-airport').value, 'airport list');
                act('configure');
            }
            await until(() => !find('[data-page=setup]').hidden, 'setup');
            assert.equal(find('iframe'), null);
            if (!i) {
                shell.setFailAirlines(true);
                act('start');
                await until(() => find('#session-error').textContent.includes('Could not load'), 'loading rollback');
                assert.equal(find('iframe'), null);
                shell.setFailAirlines(false);
            }
            if (custom) {
                find('#session-arrivals').checked = false;
                find('#session-vfr').checked = true;
            }
            act('start');
            await until(() => {
                const error = find('#session-error').textContent;
                if (error) throw new Error('Session ' + i + ': ' + error + ' ' + errors.join(', '));
                return find('iframe')?.contentWindow?.prop?.complete;
            }, 'initialized radar');
            const frame = find('iframe');
            const radar = frame.contentWindow;
            assert.equal(frame.session.airport.icao.toUpperCase(), custom ? 'YMHB' : 'YSSY');
            const aircraft = radar.aircraftController.aircraft.list;
            assert.ok(aircraft.length);
            assert.ok(aircraft.every((a) => custom ? a.rules === 'vfr' : a.isArrival()));
            assert.equal(frame.contentDocument.querySelector('#score, #score-log, .switch-airport, .toggle-dat-import'), null);
            radar.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            await until(() => !find('[data-page=pause]').hidden && find('#session-menu').open, 'pause');
            const frozen = frame.session.runtime.snapshot();
            act('settings');
            await delay(45);
            assert.deepEqual(frame.session.runtime.snapshot(), frozen);
            act('settingsBack');
            act('confirm');
            act('pause');
            act('resume');
            await until(() => frame.session.runtime.snapshot().simulatedSeconds > frozen.simulatedSeconds, 'resumed clock');
            frame.contentDocument.querySelector('.toggle-pause').click();
            act('confirm');
            act('exit');
            assert.equal(find('iframe'), null);
            assert.equal(records().length, i + 1);
        }
        assert.equal(shell.getFrames(), 11);
        assert.deepEqual(errors, []);
    } finally {
        dom.window.close();
    }
});

test('acceptance criteria: NAV-02..04, CUS-02..04, CFG-03/05, SET-01/03, PAU-02..05, SCORE-01/07, REG-04', async () => {
    const sharedStorage = createSharedStorage();
    const sharedIndexedDb = createSharedIndexedDb();
    sharedStorage.setItem('atc-last-airport', 'kjfk');

    const shell1 = createShell({ sharedStorage, sharedIndexedDb });
    try {
        const { w, find, act, errors, speechCalls } = shell1;
        await until(() => find('#session-menu')?.open, 'main menu');
        assert.equal(find('[data-page="home"]').hidden, false);
        assert.equal(find('iframe'), null);

        // SET-01: configure numeric rangeRings & speech preferences before reload
        act('settings');
        const rangeRingsSelect = [...w.document.querySelectorAll('#radar-preferences select')]
            .find((sel) => sel.parentElement.textContent.includes('Range rings'));
        assert.ok(rangeRingsSelect);
        rangeRingsSelect.value = '5';
        rangeRingsSelect.dispatchEvent(new w.Event('change'));
        find('#voice-rate').value = '1.4';
        find('#voice-rate').dispatchEvent(new w.Event('change'));
        find('#voice-volume').value = '0.6';
        find('#voice-volume').dispatchEvent(new w.Event('change'));
        find('#voice-choice').value = 'test-au-voice';
        find('#voice-choice').dispatchEvent(new w.Event('change'));
        const savedSettings = JSON.parse(sharedStorage.getItem('openscope.clientSettings.v1'));
        assert.equal(savedSettings.radar.rangeRings, 5);
        assert.equal(savedSettings.rate, 1.4);
        assert.equal(savedSettings.volume, 0.6);
        assert.equal(savedSettings.voiceURI, 'test-au-voice');
        act('settingsBack');

        // CUS-02 & CUS-03: valid DAT without optional MSA/terrain succeeds, invalid DAT preserves valid cache
        act('play');
        act('custom');
        find('#dat-terrain-auto').checked = false;
        const airportInput = find('#dat-airport-file');
        Object.defineProperty(airportInput, 'files', { value: [new w.File([dat], 'YMHB.dat')], configurable: true });
        airportInput.dispatchEvent(new w.Event('change', { bubbles: true }));
        await until(() => !find('#dat-import footer').hidden, 'valid YMHB import');
        assert.ok(find('#dat-import .dat-status').textContent.includes('YMHB'));

        Object.defineProperty(airportInput, 'files', { value: [new w.File(['INVALID\n'], 'BAD1.dat')], configurable: true });
        airportInput.dispatchEvent(new w.Event('change', { bubbles: true }));
        await until(() => find('#dat-import .dat-status').textContent.includes('No airport records found'), 'invalid DAT error');
        assert.equal(find('#dat-import footer').hidden, true);
        find('#dat-import').close();
        act('home');
        assert.deepEqual(errors, []);
    } finally {
        shell1.dom.window.close();
    }

    // Reload into a fresh JSDOM window sharing storage + IndexedDB (NAV-01, SET-01, CUS-03)
    const shell2 = createShell({ sharedStorage, sharedIndexedDb });
    try {
        const { w, find, act, errors, speechCalls } = shell2;
        await until(() => find('#session-menu')?.open, 'reloaded main menu');
        assert.equal(find('[data-page="home"]').hidden, false);
        assert.equal(find('iframe'), null);

        // Verify SET-01 persistence across reload
        act('settings');
        const rangeRingsSelect = [...w.document.querySelectorAll('#radar-preferences select')]
            .find((sel) => sel.parentElement.textContent.includes('Range rings'));
        assert.equal(rangeRingsSelect.value, '5');
        assert.equal(find('#voice-rate').value, '1.4');
        assert.equal(find('#voice-volume').value, '0.6');
        assert.equal(find('#voice-choice').value, 'test-au-voice');
        act('settingsBack');

        // Verify CUS-03 cache persistence across reload
        act('play');
        act('custom');
        await until(() => [...find('#dat-cached-airport').options].some((o) => o.value === 'airport/YMHB'), 'cached YMHB after reload');
        find('#dat-import').close();

        // NAV-02 & CLS-01: Classic search/filter + metadata + draft retention across Back
        act('classic');
        await until(() => find('#session-airport').value === 'yssy', 'classic yssy');
        await until(() => find('#session-airport-meta').textContent.includes('Runways:'), 'classic runway metadata');
        find('#session-airport-search').value = 'none-match';
        find('#session-airport-search').dispatchEvent(new w.Event('input'));
        assert.equal(find('#session-airport').options.length, 0);
        find('#session-airport-search').value = 'sydney';
        find('#session-airport-search').dispatchEvent(new w.Event('input'));
        assert.equal(find('#session-airport').value, 'yssy');
        act('configure');
        await until(() => !find('[data-page=setup]').hidden, 'setup');

        // CFG-03: All-disabled traffic rejected in UI
        find('#session-arrivals').checked = false;
        find('#session-departures').checked = false;
        find('#session-vfr').checked = false;
        act('start');
        await until(() => find('#session-error').textContent.includes('traffic category'), 'CFG-03 error');
        assert.equal(find('iframe'), null);

        // Edit draft (CFG-05), navigate Back & return to verify draft preserved (NAV-02)
        find('#session-arrivals').checked = true;
        const appInputs = [...find('#session-frequencies').querySelectorAll('fieldset')][0].querySelectorAll('input');
        appInputs[0].value = 'YSSY_TST';
        appInputs[1].value = 'Sydney Override';
        appInputs[2].value = '126.3';
        appInputs[0].dispatchEvent(new w.Event('input'));
        act('selection');
        await until(() => !find('[data-page=classic]').hidden, 'back to classic');
        act('configure');
        await until(() => !find('[data-page=setup]').hidden, 'back to setup');
        assert.equal([...find('#session-frequencies').querySelectorAll('fieldset')][0].querySelectorAll('input')[0].value, 'YSSY_TST');

        // NAV-04: Cancel during loading + late ready() guard
        act('start');
        const cancelledFrame = find('iframe');
        assert.ok(cancelledFrame);
        await until(() => cancelledFrame.contentWindow?.sessionBridge, 'loading bridge before cancel');
        assert.equal(find('[data-page=loading]').hidden, false);
        const lateReady = cancelledFrame.session.ready;
        act('cancel');
        assert.equal(find('iframe'), null);
        assert.equal(find('[data-page=setup]').hidden, false);
        lateReady();
        assert.equal(find('iframe'), null);
        assert.equal(find('[data-page=setup]').hidden, false);

        // NAV-03: Rapid double-click Start creates only 1 iframe/session
        const framesBefore = shell2.getFrames();
        const startBtn = find('[data-page=setup] [data-action="start"]');
        startBtn.click();
        startBtn.click();
        await until(() => find('iframe')?.contentWindow?.prop?.complete, 'double-start single session');
        assert.equal(shell2.getFrames(), framesBefore + 1);
        assert.equal(w.document.querySelectorAll('iframe').length, 1);

        const frame = find('iframe');
        const radar = frame.contentWindow;
        const rdoc = frame.contentDocument;

        // Verify SET-01 applied in radar & CFG-05 controller overrides + single Centre sector
        assert.equal(radar.sessionBridge.settings.radar.rangeRings, 5);
        assert.equal(frame.session.airport.controllers.approach.callsign, 'YSSY_TST');
        assert.equal(frame.session.airport.controllers.approach.frequency, '126.300');
        assert.equal(frame.session.airport.controllers.approach.source, 'user');
        assert.equal(frame.session.airport.radio.app, 'Sydney Override');
        assert.equal(frame.session.airport.controllers.centre.length, 1);
        assert.ok(rdoc.querySelector('#frequency-panel').textContent.includes('YSSY_TST 126.300'));

        // REG-04: no switch/import/score buttons; bare `airport`, `airport YSSY`, and `clear` log guidance
        assert.equal(rdoc.querySelector('#score, #score-log, .switch-airport, .toggle-dat-import'), null);
        const cmdInput = rdoc.getElementById('command');
        for (const text of ['airport', 'airport yssy']) {
            cmdInput.value = text;
            radar.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        }
        assert.ok(rdoc.getElementById('log').textContent.includes('Exit to the main menu to select another airport.'));
        cmdInput.value = 'clear';
        radar.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        assert.ok(rdoc.getElementById('log').textContent.includes('Use Reset client settings in the Settings menu.'));

        // CUS-04 & PAU-04: Escape closes MSA (and restores focus), ignores repeat Escape, Tutorial, Airport Guide, Changelog, and MeasureTool without opening Pause
        const msaToggle = rdoc.querySelector('.toggle-msa');
        msaToggle.focus();
        msaToggle.click();
        assert.equal(rdoc.getElementById('msa-panel').hidden, false);
        rdoc.querySelector('#msa-panel header button').dispatchEvent(
            new radar.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', repeat: true, bubbles: true, cancelable: true })
        );
        assert.equal(rdoc.getElementById('msa-panel').hidden, false);
        assert.equal(find('#session-menu').open, false);
        rdoc.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        assert.equal(rdoc.getElementById('msa-panel').hidden, true);
        assert.equal(find('#session-menu').open, false);
        assert.equal(radar.sessionBridge.suspended, false);
        assert.equal(rdoc.activeElement, msaToggle);

        rdoc.querySelector('.toggle-tutorial').click();
        assert.ok(rdoc.getElementById('tutorial').classList.contains('open'));
        rdoc.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        assert.equal(rdoc.getElementById('tutorial').classList.contains('open'), false);
        assert.equal(find('#session-menu').open, false);

        rdoc.querySelector('.toggle-airport-guide').click();
        assert.ok(rdoc.getElementById('airportGuide-container').classList.contains('open'));
        rdoc.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        assert.equal(rdoc.getElementById('airportGuide-container').classList.contains('open'), false);
        assert.equal(find('#session-menu').open, false);

        rdoc.querySelector('.js-changelogToggle').click();
        assert.ok(rdoc.querySelector('.js-changelogContainer').classList.contains('open'));
        rdoc.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        assert.equal(rdoc.querySelector('.js-changelogContainer').classList.contains('open'), false);
        assert.equal(find('#session-menu').open, false);

        // PAU-04: MeasureTool Escape resets without deselecting aircraft or opening Pause; repeat Escape ignored
        await until(() => radar.aircraftController.aircraft.list.some((a) => a.isControllable), 'controllable aircraft');
        const firstAircraft = radar.aircraftController.aircraft.list.find((a) => a.isControllable);
        radar.aircraftController._eventBus.trigger('strip-click', firstAircraft.callsign);
        assert.equal(radar.prop.input.callsign, firstAircraft.callsign);
        radar.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', bubbles: true }));
        radar.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        assert.equal(find('#session-menu').open, false);
        assert.equal(radar.prop.input.callsign, firstAircraft.callsign);
        radar.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', repeat: true, bubbles: true }));
        assert.equal(find('#session-menu').open, false);

        // SCORE-01: trigger genuine scoring event -> internal score/events/history update, zero score DOM
        radar.aircraftController._eventBus.trigger('tower-handoff', firstAircraft);
        const scoredSnap = frame.session.runtime.snapshot();
        assert.equal(scoredSnap.score, 5);
        assert.equal(scoredSnap.events.TOWER_HANDOFF, 1);
        assert.equal(scoredSnap.history.length, 1);
        assert.equal(rdoc.querySelector('#score, #score-log'), null);

        // PAU-02 & PAU-03: 2x speed, Escape pause freezes clock/spawns/score/speech, Test Voice works while paused, Resume keeps 2x
        rdoc.querySelector('.fast-forwards').click();
        assert.ok(rdoc.querySelector('.fast-forwards').classList.contains('speed-2'));
        radar.dispatchEvent(new radar.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await until(() => !find('[data-page=pause]').hidden && find('#session-menu').open, 'pause menu');
        const pausedSnap = frame.session.runtime.snapshot();
        const aircraftCountPaused = radar.aircraftController.aircraft.list.length;
        const frameSpeechBefore = speechCalls.filter((c) => c.isFrame).length;
        act('settings');
        act('testVoice');
        assert.ok(speechCalls.some((c) => !c.isFrame && c.text === 'OpenScope radio check.'));
        await delay(120);
        assert.deepEqual(frame.session.runtime.snapshot(), pausedSnap);
        assert.equal(radar.aircraftController.aircraft.list.length, aircraftCountPaused);
        assert.equal(speechCalls.filter((c) => c.isFrame).length, frameSpeechBefore);

        // PAU-04 nested Escape/cancel navigation in dialog: settings -> pause -> confirm -> pause
        find('#session-menu').dispatchEvent(new w.Event('cancel'));
        assert.equal(find('[data-page=pause]').hidden, false);
        act('confirm');
        assert.equal(find('[data-page=confirm]').hidden, false);
        find('#session-menu').dispatchEvent(new w.Event('cancel'));
        assert.equal(find('[data-page=pause]').hidden, false);

        // PAU-05: resuming while radar window is blurred keeps sim frozen until focus returns
        radar._hasFocus = false;
        radar.dispatchEvent(new radar.Event('blur'));
        act('resume');
        assert.equal(radar.sessionBridge.suspended, false);
        await delay(60);
        assert.equal(frame.session.runtime.snapshot().simulatedSeconds, pausedSnap.simulatedSeconds);
        radar._hasFocus = true;
        radar.dispatchEvent(new radar.Event('focus'));
        await until(() => frame.session.runtime.snapshot().simulatedSeconds > pausedSnap.simulatedSeconds, 'unpaused after focus return');
        assert.ok(rdoc.querySelector('.fast-forwards').classList.contains('speed-2'));

        // Confirmed exit persists full score record (SCORE-01)
        const sessionId = frame.session.record.id;
        rdoc.querySelector('.toggle-pause').click();
        act('confirm');
        act('exit');
        const storedRecord = JSON.parse(sharedStorage.getItem('openscope.sessionScore.v1.' + sessionId));
        assert.equal(storedRecord.version, 1);
        assert.equal(storedRecord.rulesVersion, 1);
        assert.equal(storedRecord.icao, 'YSSY');
        assert.equal(storedRecord.mode, 'classic');
        assert.equal(storedRecord.score, 5);
        assert.equal(storedRecord.events.TOWER_HANDOFF, 1);
        assert.equal(storedRecord.history.length, 1);
        assert.ok(storedRecord.startedAt && storedRecord.endedAt && storedRecord.simulatedSeconds > 0);

        // SET-03: Reset client settings preserves score records and cached custom airports
        act('settings');
        act('reset');
        act('resetYes');
        act('settingsBack');
        assert.equal(JSON.parse(sharedStorage.getItem('openscope.clientSettings.v1')).radar.rangeRings, 'default');
        assert.equal(JSON.parse(sharedStorage.getItem('openscope.sessionScore.v1.' + sessionId)).score, 5);
        act('play');
        act('custom');
        await until(() => [...find('#dat-cached-airport').options].some((o) => o.value === 'airport/YMHB'), 'cached YMHB after reset');
        find('#dat-import').close();

        // SCORE-07 & EXIT-02 & SET-02: Storage write failure during live Settings & double-click Exit still tear down cleanly
        act('classic');
        await until(() => find('#session-airport').value === 'yssy', 'classic yssy 2');
        act('configure');
        await until(() => !find('[data-page=setup]').hidden, 'setup 2');
        act('start');
        await until(() => find('iframe')?.contentWindow?.prop?.complete, 'second session');
        const frame2 = find('iframe');
        const radar2 = frame2.contentWindow;
        // PAU-04: Escape with empty code === '' pauses the session
        radar2.dispatchEvent(new radar2.KeyboardEvent('keydown', { key: 'Escape', code: '', bubbles: true }));
        await until(() => !find('[data-page=pause]').hidden && find('#session-menu').open, 'pause via empty-code Escape');

        // SET-02: Live settings change under QuotaExceededError updates GameOptions without throwing
        act('settings');
        const prevSetItem = w.localStorage.setItem;
        const prevFrameSetItem = radar2.localStorage.setItem;
        const throwQuota = () => { throw new Error('QuotaExceededError'); };
        w.localStorage.setItem = throwQuota;
        radar2.localStorage.setItem = throwQuota;
        try {
            const rrSelect2 = [...w.document.querySelectorAll('#radar-preferences select')]
                .find((sel) => sel.parentElement.textContent.includes('Range rings'));
            rrSelect2.value = '10';
            rrSelect2.dispatchEvent(new w.Event('change'));
            assert.equal(radar2.sessionBridge.settings.radar.rangeRings, 10);
            act('settingsBack');
            const resumeBtn = find('[data-page=pause] [data-action="resume"]');
            resumeBtn.click();
            resumeBtn.click();
            assert.equal(radar2.sessionBridge.suspended, false);
            assert.equal(find('#session-error').textContent, '');

            frame2.contentDocument.querySelector('.toggle-pause').click();
            act('confirm');
            const exitBtn = find('[data-page=confirm] [data-action="exit"]');
            exitBtn.click();
            exitBtn.click();
        } finally {
            w.localStorage.setItem = prevSetItem;
            radar2.localStorage.setItem = prevFrameSetItem;
        }
        assert.equal(find('iframe'), null);
        assert.equal(find('[data-page=home]').hidden, false);
        assert.equal(find('#session-error').textContent, '');
        assert.deepEqual(errors, []);
    } finally {
        shell2.dom.window.close();
    }
});
