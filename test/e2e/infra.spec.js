import test from 'ava';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import EventBus from '../../src/assets/scripts/client/lib/EventBus';
import GameController from '../../src/assets/scripts/client/game/GameController';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import SpawnPatternCollection from '../../src/assets/scripts/client/trafficGenerator/SpawnPatternCollection';
import TimeKeeper from '../../src/assets/scripts/client/engine/TimeKeeper';
import navData from '../../src/assets/scripts/client/airport/dat/NavDataCache';
import { FLIGHT_RULES } from '../../src/assets/scripts/client/constants/aircraftConstants';
import {
    setupSimulation,
    teardownSimulation,
    stepSimulation,
    stepUntil,
    issueCommand,
    selectAircraft,
    switchAirport,
    resetTraffic,
    importDatAirport,
    spawnIfrArrival,
    spawnVfrArrival,
    spawnDeparture,
    getAircraft,
    getAircraftState,
    getRunwayQueue,
    getFrequencyPanelState,
    getRenderedDataBlocks,
    getRadarTargetViewModels,
    getStrips,
    getScoreState,
    tryRequireClient
} from './helpers/e2eHarness';

test.serial('setupSimulation boots real OpenScope stack on YSSY and teardown is idempotent with zero leaks', (t) => {
    const sim = setupSimulation({ icao: 'yssy' });

    try {
        t.is(AirportController.current.icao, 'yssy');
        t.true(NavigationLibrary.hasSids);
        t.true(SpawnPatternCollection.spawnPatternModels.length > 0);
        t.truthy(window.document.getElementById('e2e-sim-root'));
        t.truthy(window.document.getElementById('dynamic-canvas'));
        t.truthy(window.document.getElementById('static-canvas'));
        t.truthy(window.document.getElementById('frequency-panel'));
    } finally {
        teardownSimulation(sim);
        // Second teardown on the same handle (and with no active sim) must be a safe no-op
        t.notThrows(() => teardownSimulation(sim));
        t.notThrows(() => teardownSimulation());
    }

    t.is(AirportController.current, null);
    t.is(SpawnPatternCollection.spawnPatternModels.length, 0);
    t.is(navData.records.size, 0);
    t.is(Object.keys(EventBus._events).length, 0);
    t.false('atc-last-airport' in global.localStorage);
    t.false('atc-speech-enabled' in global.localStorage);
    t.is(typeof window.gtag, 'undefined');
    t.is(window.document.getElementById('e2e-sim-root'), null);

    // Verify a second sequential boot starts cleanly from scratch
    const sim2 = setupSimulation({ icao: 'yssy' });

    try {
        t.is(AirportController.current.icao, 'yssy');
        t.is(sim2.aircraftController.aircraft.list.length, 0);
    } finally {
        teardownSimulation(sim2);
    }
});

test.serial('stepSimulation advances virtual TimeKeeper deterministically at 1x, 2x, and dt > 100 clamping, and stepUntil converges', (t) => {
    const sim1x = setupSimulation({ icao: 'yssy', timewarp: 1 });

    try {
        const tAfter5 = stepSimulation(5, 1);
        t.true(Math.abs(tAfter5 - 5) < 1e-6);
        t.true(Math.abs(TimeKeeper.accumulatedDeltaTime - 5) < 1e-6);

        const result = stepUntil(() => TimeKeeper.accumulatedDeltaTime >= 8, { maxSeconds: 20, dt: 1 });
        t.true(result.satisfied);
        t.true(TimeKeeper.accumulatedDeltaTime >= 8);
    } finally {
        teardownSimulation(sim1x);
    }

    const sim2x = setupSimulation({ icao: 'yssy', timewarp: 2 });

    try {
        const tAfter10 = stepSimulation(10, 0.5);
        t.true(Math.abs(tAfter10 - 10) < 1e-6);
        t.is(TimeKeeper.simulationRate, 2);

        // dt > 100 must sub-step at <= 100s per tick so TimeKeeper.deltaTime cap never drops delta
        const tAfter210 = stepSimulation(200, 200);
        t.true(Math.abs(tAfter210 - 210) < 1e-6);
        t.true(Math.abs(TimeKeeper.accumulatedDeltaTime - 210) < 1e-6);
    } finally {
        teardownSimulation(sim2x);
    }
});

test.serial('spawning helpers (including VFR departures) and state/runway observers work on YSSY without wall-clock delays', (t) => {
    const sim = setupSimulation({ icao: 'yssy' });

    try {
        const arrival = spawnIfrArrival({ airline: 'qfa' });
        t.truthy(arrival);
        t.is(arrival.category, 'arrival');
        t.true(getAircraftState(arrival.callsign).distanceToAirportNm > 0);

        const vfr = spawnVfrArrival();
        t.truthy(vfr);
        t.is(vfr.rules, 'vfr');

        const departure = spawnDeparture({ airline: 'qfa' });
        t.truthy(departure);
        t.is(departure.category, 'departure');
        const depState = getAircraftState(departure);
        t.is(depState.callsign, departure.callsign);

        const assignedDepRunway = departure.fms.departureRunwayModel.name;
        const queueInfo = getRunwayQueue(assignedDepRunway);
        t.is(queueInfo.runwayName, assignedDepRunway);
        t.true(Array.isArray(queueInfo.queue));
        t.true(queueInfo.queue.includes(departure.id));
        t.truthy(getAircraft(arrival.callsign));

        const radioCountBeforeVfrDep = sim.radioCalls.length;
        const vfrDeparture = spawnDeparture({ rules: FLIGHT_RULES.VFR });
        t.truthy(vfrDeparture);
        t.is(vfrDeparture.category, 'departure');
        t.is(vfrDeparture.rules, FLIGHT_RULES.VFR);
        const vfrDepQueue = getRunwayQueue(vfrDeparture.fms.departureRunwayModel.name);
        t.true(vfrDepQueue.queue.includes(vfrDeparture.id));
        const newRadioCalls = sim.radioCalls.slice(radioCountBeforeVfrDep);
        t.false(newRadioCalls.some((call) => /VFR arrival/i.test(call.msg)));
    } finally {
        teardownSimulation(sim);
    }
});

test.serial('issueCommand executes aircraft and system commands (timewarp/pause) without EventTracker._gtag errors', (t) => {
    const sim = setupSimulation({ icao: 'yssy', timewarp: 1, enableSpeech: true });

    try {
        const timewarpResult = issueCommand('timewarp 5');
        t.false(timewarpResult.threw);
        t.is(TimeKeeper.simulationRate, 5);

        const pauseResult = issueCommand('pause');
        t.false(pauseResult.threw);
        t.true(TimeKeeper.isPaused);

        const unpauseResult = issueCommand('pause');
        t.false(unpauseResult.threw);
        t.false(TimeKeeper.isPaused);

        const arrival = spawnIfrArrival({ airline: 'qfa' });
        const entered = stepUntil(() => arrival.isControllable, { maxSeconds: 900, dt: 2 });
        t.true(entered.satisfied);
        stepSimulation(1, 0.5);

        const selected = selectAircraft(arrival.callsign);
        t.is(selected, arrival.callsign);

        const validResult = issueCommand(`${arrival.callsign} fh 180 c 50`);
        t.false(validResult.threw);
        t.true(validResult.accepted);
        t.true(validResult.logs.length > 0);
        t.true(validResult.speech.length > 0);
        t.is(validResult.speech[0].lang, 'en-AU');

        const unknownAcResult = issueCommand('ZZZ999 fh 180');
        t.false(unknownAcResult.threw);
        t.false(unknownAcResult.accepted);
        t.true(unknownAcResult.logs.some((entry) => entry.warn && /no such aircraft/i.test(entry.message)));

        const syntaxErrorResult = issueCommand(`${arrival.callsign} fh notanumber`);
        t.true(syntaxErrorResult.threw);
        t.true(syntaxErrorResult.logs.some((entry) => entry.warn));
    } finally {
        teardownSimulation(sim);
    }
});

test.serial('switchAirport resets AI controllers across YSSY/KJFK/YSSY/EGCC and resetTraffic does not arm timers when autoTraffic is false', (t) => {
    const sim = setupSimulation({ icao: 'yssy', autoTraffic: false });

    try {
        const arrival = spawnIfrArrival({ airline: 'qfa' });
        t.is(sim.aircraftController.aircraft.list.length, 1);

        const yssyAirport = AirportController.current;
        t.truthy(yssyAirport.towerController);
        t.truthy(yssyAirport.centreController);
        yssyAirport.towerController._arrivals.add(arrival.id);
        yssyAirport.towerController._departures.add('dep-probe');
        yssyAirport.towerController._handoffThresholdTriggered.set(arrival.id, 'RECOMMENDED');
        yssyAirport.centreController._aircraft.add('ctr-probe');

        switchAirport('kjfk');
        t.is(AirportController.current.icao, 'kjfk');
        t.is(sim.aircraftController.aircraft.list.length, 0);
        t.is(yssyAirport.towerController._arrivals.size, 0);
        t.is(yssyAirport.towerController._departures.size, 0);
        t.is(yssyAirport.towerController._handoffThresholdTriggered.size, 0);
        t.is(yssyAirport.centreController._aircraft.size, 0);

        const jfkArrival = spawnIfrArrival({ airline: 'aal' });
        t.truthy(jfkArrival);
        t.is(sim.aircraftController.aircraft.list.length, 1);

        resetTraffic();
        t.is(getAircraft(jfkArrival.callsign), null);
        t.is(sim.aircraftController.aircraft.list.length, 0);
        t.is(GameController.game.timeouts.length, 0);

        switchAirport('yssy');
        t.is(AirportController.current.icao, 'yssy');
        t.true(NavigationLibrary.hasSids);
        t.is(AirportController.current.towerController._arrivals.size, 0);
        t.is(AirportController.current.towerController._departures.size, 0);
        t.is(AirportController.current.towerController._handoffThresholdTriggered.size, 0);
        t.is(AirportController.current.centreController._aircraft.size, 0);

        switchAirport('egcc');
        t.is(AirportController.current.icao, 'egcc');
        t.is(sim.aircraftController.aircraft.list.length, 0);
    } finally {
        teardownSimulation(sim);
    }
});

test.serial('importDatAirport imports a synthetic Australian DAT airport (YMHB) into AirportController with controller-name DOM inputs', (t) => {
    const sim = setupSimulation({ icao: 'yssy' });

    try {
        t.is(sim.$root.find('#dat-approach-radio-name').length, 1);
        t.is(sim.$root.find('#dat-departure-radio-name').length, 1);
        t.is(sim.$root.find('#dat-tower-radio-name').length, 1);
        t.is(sim.$root.find('#dat-centre-radio-name').length, 1);

        const datLines = [
            'RWY:RW12 , , ,00012, , , , ;S42495000,E147295000,0000;',
            'RWY:RW30 , , ,00013, , , , ;S42505000,E147311000,0000;',
            'SID:010,4,HB1,RW12,HBFIX,YM,E,A, , , ,TF, , , , , , , , ,1200, ,+,03000, , ,-,210;'
        ];
        const fixText = '-42.85 147.60 HBFIX ENRT YM 4530263\n';

        const imported = importDatAirport({
            datText: datLines.join('\n'),
            filename: 'YMHB.dat',
            fixText
        });

        t.is(imported.data.icao, 'YMHB');
        t.is(AirportController.current.icao, 'ymhb');
        t.true(AirportController.current.data.isDatImport);
    } finally {
        teardownSimulation(sim);
    }
});

test.serial('observers and moduleResolver operate cleanly without crashing on optional/missing modules', (t) => {
    const sim = setupSimulation({ icao: 'yssy', timewarp: 5 });

    try {
        const arrival = spawnIfrArrival({ airline: 'qfa' });
        const entered = stepUntil(() => arrival.isControllable, { maxSeconds: 900, dt: 2 });
        t.true(entered.satisfied);
        stepSimulation(1, 0.5);

        const strips = getStrips(sim.aircraftController);
        t.true(Array.isArray(strips));
        t.true(strips.some((s) => s.callsign === arrival.callsign));

        const rendered = getRenderedDataBlocks(sim.canvasController);
        t.true(Array.isArray(rendered.calls));
        t.true(rendered.fillTexts.some((draw) => draw.text.includes(arrival.callsign)));

        const radarTargets = getRadarTargetViewModels(sim.scopeModel);
        t.true(radarTargets.some((rt) => rt.callsign === arrival.callsign));

        const scoreState = getScoreState();
        t.is(typeof scoreState.score, 'number');
        t.is(typeof scoreState.domScoreText, 'string');

        const panelState = getFrequencyPanelState(sim.$root);
        t.true(panelState.exists);
        t.false(panelState.overlapsAirportInfo);
        t.false(panelState.overlapsMsaPanel);

        const { controllerConfig } = AirportController.current;

        if (controllerConfig && typeof controllerConfig.getAdjacentFrequencyList === 'function') {
            const expectedFrequencies = controllerConfig.getAdjacentFrequencyList();

            if (expectedFrequencies.length > 0) {
                t.true(panelState.visible);
                t.is(panelState.items.length, expectedFrequencies.length);
            }
        }

        const missingMod = tryRequireClient('nonexistent/OptionalM4Module');
        t.false(missingMod.available);
        t.is(missingMod.exports, null);
        t.truthy(missingMod.error);
        t.is(typeof missingMod.resolvedPath, 'string');
        t.true(missingMod.resolvedPath.endsWith('OptionalM4Module'));

        const existingMod = tryRequireClient('constants/controllerConstants');
        t.true(existingMod.available);
        t.is(typeof existingMod.resolvedPath, 'string');
        t.true(existingMod.resolvedPath.endsWith('controllerConstants.js'));
    } finally {
        teardownSimulation(sim);
    }
});
