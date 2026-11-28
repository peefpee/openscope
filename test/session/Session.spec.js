import 'regenerator-runtime/runtime';
import test from 'ava';
import $ from 'jquery';
import sinon from 'sinon';
import airport from '../../assets/airports/yssy.json';
import { airportPreview, controllerDraft, positions, prepareAirport } from '../../src/assets/scripts/client/session/configuration';
import { finalizeScore, preferences, resolveOption, savePreferences } from '../../src/assets/scripts/client/session/storage';
import Menu from '../../src/assets/scripts/client/session/Menu';
import { GAME_OPTION_VALUES } from '../../src/assets/scripts/client/constants/gameOptionConstants';
import GameController from '../../src/assets/scripts/client/game/GameController';
import GameOptions from '../../src/assets/scripts/client/game/GameOptions';
import InputController from '../../src/assets/scripts/client/InputController';
import TimeKeeper from '../../src/assets/scripts/client/engine/TimeKeeper';

const traffic = { arrivals: true, departures: true, vfr: false, rate: 1.5, arrivalShare: 0.75 };
const rows = () => positions(controllerDraft(airport)).map(([, entry]) => ({ ...entry }));

test('parallel runway flow restricts actual spawn routes and preserves the airport defaults', (t) => {
    const edits = rows();
    edits[0].frequency = '129.4';
    edits[0].radioName = 'Sydney Test';
    const session = prepareAirport(airport, traffic, { arrival: '34L', departure: '34R' }, edits);
    t.is(session.controllers.approach.frequency, '129.400');
    t.is(session.radio.app, 'Sydney Test');
    t.is(session.controllers.centre.length, 1);
    t.deepEqual(session.spawnPatterns.map((p) => p.route).sort(), ['NASHO.NASHO1.YSSY34L', 'YSSY34R.OLSEM1.OLSEM']);
    const total = session.spawnPatterns.reduce((n, p) => n + p.rate, 0);
    t.is(session.spawnPatterns.find((p) => p.category === 'arrival').rate / total, 0.75);
    t.is(airport.controllers.approach.frequency, '124.400');
    t.is(airport.departureRunway, '16R');
});

test('rejects unsupported flow, invalid frequencies and disabled traffic', (t) => {
    t.throws(() => prepareAirport(airport, { ...traffic, arrivals: false, departures: false }, null, rows()), /traffic/);
    t.throws(() => prepareAirport(airport, traffic, { arrival: '34L', departure: '16R' }, rows()), /runway/);
    const edits = rows();
    edits[0].frequency = '120.1X';
    t.throws(() => prepareAirport(airport, traffic, null, edits), /frequency/);
    edits[0].frequency = edits[2].frequency;
    t.throws(() => prepareAirport(airport, traffic, null, edits), /distinct frequencies/);
});

test.serial('speech migration, corrupt preferences and reset preserve unrelated data', (t) => {
    localStorage.setItem('atc-speech-enabled', 'false');
    localStorage.setItem('openscope.clientSettings.v1', '{');
    localStorage.setItem('nav-marker', 'preserved');
    t.false(preferences().enabled);
    const next = preferences(true);
    next.volume = 0.4;
    savePreferences(next);
    t.true(preferences().enabled);
    t.is(preferences().volume, 0.4);
    t.is(localStorage.getItem('nav-marker'), 'preserved');
});

test.serial('scoring is DOM-independent, suspended during menu pause and finalized once per session', (t) => {
    GameController.initializeEventCount();
    GameController.game_reset_score_and_events();
    window.sessionBridge = { suspended: false };
    try {
        GameController.events_recordNew('TOWER_HANDOFF');
        window.sessionBridge.suspended = true;
        GameController.events_recordNew('TOWER_HANDOFF');
        t.is(GameController.game.score, 5);
        t.is(GameController.game.events.TOWER_HANDOFF, 1);
        const record = { id: 'example', score: 5 };
        finalizeScore(record, localStorage);
        finalizeScore({ ...record, score: 10 }, localStorage);
        t.is(JSON.parse(localStorage.getItem('openscope.sessionScore.v1.example')).score, 5);
        t.notThrows(() => finalizeScore(record, { getItem() { throw Error('storage unavailable'); } }));
    } finally {
        delete window.sessionBridge;
        GameController.game_reset_score_and_events();
    }
});

test('controller provenance ignores callsign case differences and arrival share ignores overflights', (t) => {
    const withOverflight = {
        ...airport,
        spawnPatterns: [
            ...airport.spawnPatterns,
            { origin: 'KAT', destination: 'WOL', category: 'overflight', route: 'KAT..WOL', altitude: 28000, speed: 420, rate: 2, airlines: [['qfa', 1]] }
        ]
    };
    const edits = rows();
    const expectedAppSource = edits[0].source;
    edits[0].callsign = edits[0].callsign.toLowerCase();
    const session = prepareAirport(withOverflight, traffic, null, edits);
    t.is(session.controllers.approach.source, expectedAppSource);
    t.is(session.controllers.approach.callsign, edits[0].callsign.toUpperCase());
    const overflight = session.spawnPatterns.find((p) => p.category === 'overflight');
    t.is(overflight.rate, 3);
    edits[0].radioName = 'Custom Approach';
    const overridden = prepareAirport(withOverflight, traffic, null, edits);
    t.is(overridden.controllers.approach.source, 'user');
});

test.serial('numeric rangeRings options coerce and persist cleanly across preferences and legacy migration', (t) => {
    const rangeRingsOption = GAME_OPTION_VALUES.find((opt) => opt.name === 'rangeRings');
    t.is(resolveOption(rangeRingsOption, '5'), 5);
    t.is(resolveOption(rangeRingsOption, 10), 10);
    t.is(resolveOption(rangeRingsOption, 'invalid'), 'default');

    delete localStorage['openscope.clientSettings.v1'];
    localStorage.setItem('zlsa.atc.option.rangeRings', '10');
    localStorage.setItem('openscope.sessionScore.v1.keep', JSON.stringify({ id: 'keep', score: 15 }));
    try {
        const migrated = preferences();
        t.is(migrated.radar.rangeRings, 10);
        migrated.radar.rangeRings = resolveOption(rangeRingsOption, '5');
        savePreferences(migrated);
        t.is(preferences().radar.rangeRings, 5);

        const reset = preferences(true);
        t.is(reset.radar.rangeRings, 'default');
        savePreferences(reset);
        t.is(JSON.parse(localStorage.getItem('openscope.sessionScore.v1.keep')).score, 15);
    } finally {
        delete localStorage['zlsa.atc.option.rangeRings'];
        delete localStorage['openscope.sessionScore.v1.keep'];
        delete localStorage['openscope.clientSettings.v1'];
    }
});

test.serial('PAU-03 & PAU-05: resume zeroes _frameDeltaTime, preserves simulationRate, and respects focus-loss dual pause', (t) => {
    const prevPaused = TimeKeeper.isPaused;
    const prevFocused = GameController.game.focused;
    const prevRate = TimeKeeper.simulationRate;
    window.sessionBridge = { suspended: true };
    try {
        TimeKeeper.updateSimulationRate(2);
        TimeKeeper.setPause(true);
        t.is(TimeKeeper._frameDeltaTime, 0);
        GameController._onWindowBlur();
        t.false(GameController.game.focused);
        t.true(TimeKeeper.isPaused);

        // Focus returns while Pause menu is still open -> MUST stay paused
        GameController._onWindowFocus();
        t.true(GameController.game.focused);
        t.true(TimeKeeper.isPaused);

        // Blur again, then resume while blurred (!document.hasFocus()) -> MUST stay paused
        GameController._onWindowBlur();
        window.sessionBridge.suspended = false;
        GameController.game_unpause();
        TimeKeeper.setPause(true); // mirrors runtime.resume(): TimeKeeper.setPause(!document.hasFocus())
        t.true(TimeKeeper.isPaused);

        // Focus returns -> unpauses with zero frame delta and preserved simulationRate
        GameController._onWindowFocus();
        t.false(TimeKeeper.isPaused);
        t.is(TimeKeeper._frameDeltaTime, 0);
        t.is(TimeKeeper.simulationRate, 2);
    } finally {
        delete window.sessionBridge;
        TimeKeeper.updateSimulationRate(prevRate);
        TimeKeeper.setPause(prevPaused);
        GameController.game.focused = prevFocused;
    }
});

test.serial('SCORE-06: finalizeScore evicts oldest score record before writing 101st record at 100-entry quota cap', (t) => {
    const store = Object.create(null);
    for (let i = 0; i < 100; i++) {
        const ts = String(1700000000000 + i);
        store[`openscope.sessionScore.v1.${ts}-s`] = JSON.stringify({ id: `${ts}-s`, score: i });
    }
    const quotaDb = new Proxy(store, {
        get(target, prop) {
            if (prop === 'getItem') return (k) => (Object.prototype.hasOwnProperty.call(target, k) ? target[k] : null);
            if (prop === 'setItem') {
                return (k, v) => {
                    if (!Object.prototype.hasOwnProperty.call(target, k) && Object.keys(target).length >= 100) {
                        const err = new Error('QuotaExceededError');
                        err.name = 'QuotaExceededError';
                        throw err;
                    }
                    target[k] = String(v);
                };
            }
            if (prop === 'removeItem') return (k) => { delete target[k]; };
            return target[prop];
        }
    });

    finalizeScore({ id: '1700000000100-new', score: 42 }, quotaDb);

    const remainingKeys = Object.keys(store).filter((k) => k.startsWith('openscope.sessionScore.v1.'));
    t.is(remainingKeys.length, 100);
    t.is(quotaDb.getItem('openscope.sessionScore.v1.1700000000000-s'), null);
    t.is(JSON.parse(quotaDb.getItem('openscope.sessionScore.v1.1700000000100-new')).score, 42);
});

test.serial('SET-02: GameOptions.setOptionByName survives QuotaExceededError and updates live option state', (t) => {
    const prevSetItem = global.localStorage.setItem;
    const prevGetItem = global.localStorage.getItem;
    try {
        const options = new GameOptions();
        global.localStorage.setItem = () => {
            const err = new Error('QuotaExceededError');
            err.name = 'QuotaExceededError';
            throw err;
        };
        t.notThrows(() => options.setOptionByName('rangeRings', 10));
        t.is(options.getOptionByName('rangeRings'), 10);

        global.localStorage.getItem = () => {
            throw new Error('SecurityError');
        };
        t.notThrows(() => new GameOptions());
    } finally {
        global.localStorage.setItem = prevSetItem;
        global.localStorage.getItem = prevGetItem;
    }
});

test.serial('PAU-04: InputController._onKeydown handles Escape when code is empty string', (t) => {
    const hasOwnDoc = Object.prototype.hasOwnProperty.call(global, 'document');
    const prevDoc = global.document;
    global.document = window.document;
    const $root = $(`
        <div>
            <div id="canvases"></div>
            <input id="command" value="" />
            <div id="autocomplete">
                <input class="autocomplete-input" />
                <div class="autocomplete-output"></div>
                <div class="autocomplete-spacer"></div>
                <div class="autocomplete-suggests"></div>
            </div>
        </div>
    `).appendTo(window.document.body);
    const getJsonStub = sinon.stub($, 'getJSON').returns({ done: () => ({ fail: () => {} }) });
    let pauseCount = 0;
    window.sessionBridge = {
        suspended: false,
        pause() { pauseCount += 1; }
    };
    const controller = new InputController(
        $root,
        { findAircraftByCallsign: () => null },
        { decreasePtlLength() {}, increasePtlLength() {} }
    );
    try {
        const cmdEl = $root.find('#command')[0];
        let focusCalled = false;
        const origFocus = cmdEl.focus;
        cmdEl.focus = () => { focusCalled = true; };
        try {
            // key="Escape" with code="" and keyCode=0
            controller._onKeydown({
                originalEvent: { key: 'Escape', code: '', keyCode: 0, repeat: false },
                target: window.document.body,
                preventDefault() {}
            });
            t.is(pauseCount, 1);
            t.false(focusCalled);

            // Legacy keyCode=27 with code=""
            controller._onKeydown({
                originalEvent: { key: '', code: '', keyCode: 27, repeat: false },
                target: window.document.body,
                preventDefault() {}
            });
            t.is(pauseCount, 2);
            t.false(focusCalled);
        } finally {
            cmdEl.focus = origFocus;
        }
    } finally {
        controller.disable();
        $root.remove();
        getJsonStub.restore();
        delete window.sessionBridge;
        if (hasOwnDoc) global.document = prevDoc;
        else delete global.document;
    }
});

test.serial('EXIT-02: Menu double act("exit") and double act("resume") do not throw into #session-error', async (t) => {
    const hasOwnDoc = Object.prototype.hasOwnProperty.call(global, 'document');
    const prevDoc = global.document;
    global.document = window.document;
    const $container = $(`
        <div>
            <dialog id="session-menu" open>
                <h1 id="session-title"></h1>
                <section data-page="home"><button data-action="play">Play</button></section>
                <section data-page="pause" hidden><button data-action="resume">Resume</button></section>
                <section data-page="confirm" hidden><button data-action="exit">Exit</button></section>
                <p id="session-error"></p>
            </dialog>
        </div>
    `).appendTo(window.document.body);
    const menuEl = $container.find('#session-menu')[0];
    menuEl.showModal = () => { menuEl.open = true; };
    menuEl.close = () => { menuEl.open = false; };
    const ctx = {
        menu: menuEl,
        page: 'pause',
        airport: { icao: 'yssy' },
        frame: {
            contentWindow: { focus() {} },
            session: {
                record: { id: 'double-act-test' },
                runtime: {
                    resumeCalls: 0,
                    resume() { this.resumeCalls += 1; },
                    stop() {},
                    snapshot: () => ({ score: 0, events: {}, history: [], simulatedSeconds: 1 })
                }
            },
            remove() {}
        },
        show: Menu.prototype.show,
        error: Menu.prototype.error,
        dispose: Menu.prototype.dispose
    };
    try {
        await Promise.all([
            Menu.prototype.act.call(ctx, 'resume'),
            Menu.prototype.act.call(ctx, 'resume')
        ]);
        t.is(ctx.page, 'playing');
        t.is(ctx.frame.session.runtime.resumeCalls, 1);
        t.is($container.find('#session-error').text(), '');

        ctx.page = 'confirm';
        await Promise.all([
            Menu.prototype.act.call(ctx, 'exit').catch((e) => ctx.error(e)),
            Menu.prototype.act.call(ctx, 'exit').catch((e) => ctx.error(e))
        ]);
        t.is(ctx.page, 'home');
        t.is(ctx.frame, null);
        t.is($container.find('#session-error').text(), '');
    } finally {
        delete localStorage['openscope.sessionScore.v1.double-act-test'];
        $container.remove();
        if (hasOwnDoc) global.document = prevDoc;
        else delete global.document;
    }
});

test('preview exposes ordered numeric runway ends and active flows independently of the source', (t) => {
    const view = airportPreview(airport, { arrival: '34L', departure: '34R' });
    const pair = view.runways.find((runway) => runway.arrivalThreshold >= 0);
    t.is(pair.identifiers[pair.arrivalThreshold], '34L');
    t.true(pair.thresholds.every((point) => point.every(Number.isFinite)));
    t.true(Object.isFrozen(view.runways[0].thresholds));
    t.false(Object.isFrozen(airport.runways[0].end));
    t.is(view.controllers.centre.length, 1);
});
