import $ from 'jquery';
import AircraftController from '../../../src/assets/scripts/client/aircraft/AircraftController';
import AirlineController from '../../../src/assets/scripts/client/airline/AirlineController';
import AirportController from '../../../src/assets/scripts/client/airport/AirportController';
import AirportGuideViewController from '../../../src/assets/scripts/client/airportGuide/AirportGuideViewController';
import AirportInfoController from '../../../src/assets/scripts/client/info/AirportInfoController';
import CanvasController from '../../../src/assets/scripts/client/canvas/CanvasController';
import CanvasStageModel from '../../../src/assets/scripts/client/canvas/CanvasStageModel';
import EventBus from '../../../src/assets/scripts/client/lib/EventBus';
import GameController from '../../../src/assets/scripts/client/game/GameController';
import InputController from '../../../src/assets/scripts/client/InputController';
import MeasureTool from '../../../src/assets/scripts/client/measurement/MeasureTool';
import NavigationLibrary from '../../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import ScopeModel from '../../../src/assets/scripts/client/scope/ScopeModel';
import ScoreController from '../../../src/assets/scripts/client/game/ScoreController';
import SpawnPatternCollection from '../../../src/assets/scripts/client/trafficGenerator/SpawnPatternCollection';
import SpawnPatternModel from '../../../src/assets/scripts/client/trafficGenerator/SpawnPatternModel';
import SpawnScheduler from '../../../src/assets/scripts/client/trafficGenerator/SpawnScheduler';
import TimeKeeper from '../../../src/assets/scripts/client/engine/TimeKeeper';
import UiController from '../../../src/assets/scripts/client/ui/UiController';
import navData from '../../../src/assets/scripts/client/airport/dat/NavDataCache';
import { speech_init } from '../../../src/assets/scripts/client/speech';
import { EVENT } from '../../../src/assets/scripts/client/constants/eventNames';
import { FLIGHT_CATEGORY, FLIGHT_RULES } from '../../../src/assets/scripts/client/constants/aircraftConstants';
import { SELECTORS } from '../../../src/assets/scripts/client/constants/selectors';
import { installDomAndGlobals } from './domEnv';
import {
    installCanvasMock,
    getRenderedDataBlocks,
    getRadarTargetViewModels
} from './canvasMock';
import {
    loadAirportJson,
    loadAirportLoadList,
    loadAllAircraftDefinitions,
    loadAllAirlines,
    importDatAirport as importDatAirportImpl
} from './airportLoader';
import {
    installObservers,
    getStrips,
    getFrequencyPanelState,
    getScoreState
} from './observers';
import {
    resolveClientPath,
    tryRequireClient,
    requireAvailable
} from './moduleResolver';

let activeSimulation = null;
let gameControllerListenersInstalled = false;

function cleanupUiControllerSafely() {
    if (UiController._eventBus && UiController.onAirportChangeHandler) {
        UiController._eventBus.off(EVENT.AIRPORT_CHANGE, UiController.onAirportChangeHandler);
    }

    if (UiController._eventBus && UiController.onChatLogDurationChangeHandler) {
        UiController._eventBus.off(EVENT.CHAT_LOG_DURATION_CHANGE, UiController.onChatLogDurationChangeHandler);
    }

    if (UiController.datImportView && typeof UiController.datImportView.destroy === 'function') {
        UiController.datImportView.destroy();
    }

    if (UiController.msaView && typeof UiController.msaView.destroy === 'function') {
        UiController.msaView.destroy();
    }

    if (UiController.tutorialView && typeof UiController.tutorialView.disable === 'function') {
        try {
            UiController.tutorialView.disable();
        } catch (error) {
            // Ignore partial tutorial teardown errors during reset
        }
    }

    clearTimeout(UiController._controlMenuCloseTimeout);
    UiController._controlMenuCloseTimeout = null;
    UiController._eventBus = null;
    UiController.tutorialView = null;
    UiController.settingsController = null;
    UiController.trafficRateController = null;
    UiController.videoMapController = null;
    UiController.msaView = null;
    UiController.datImportView = null;
    UiController.$element = null;
    UiController.$log = null;
}

function resetAirportControllersSafely(airport) {
    if (!airport) {
        return;
    }

    if (airport.towerController && typeof airport.towerController.reset === 'function') {
        airport.towerController.reset();
    }

    if (airport.centreController && typeof airport.centreController.reset === 'function') {
        airport.centreController.reset();
    }
}

function cleanupAirportsSafely() {
    const seen = new Set();
    const candidates = [AirportController.current, ...Object.values(AirportController.airports || {})];

    candidates.forEach((airport) => {
        if (!airport || seen.has(airport)) {
            return;
        }

        seen.add(airport);

        if (typeof airport.releaseWindListener === 'function') {
            airport.releaseWindListener();
        }

        resetAirportControllersSafely(airport);
    });
}

function resetNavDataCache() {
    if (navData.records && typeof navData.records.clear === 'function') {
        navData.records.clear();
    }

    if (navData.memoryOnly && typeof navData.memoryOnly.clear === 'function') {
        navData.memoryOnly.clear();
    }

    navData.ready = null;
    navData.db = null;
}

/**
 * Tear down an active simulation cleanly and idempotently.
 *
 * @function teardownSimulation
 * @param sim {object} [optional]
 */
export function teardownSimulation(sim = activeSimulation) {
    const target = sim || activeSimulation;

    if (!target || target._tornDown) {
        return;
    }

    target._tornDown = true;

    if (target.observers) {
        target.observers.uninstall();
    }

    if (target._onAirportChangeHandler) {
        EventBus.off(EVENT.AIRPORT_CHANGE, target._onAirportChangeHandler);
    }

    if (target._onTrafficResetHandler) {
        EventBus.off(EVENT.TRAFFIC_RESET, target._onTrafficResetHandler);
    }

    if (target.inputController && typeof target.inputController.disable === 'function') {
        target.inputController.disable();
    }

    if (target.canvasController && typeof target.canvasController.disable === 'function') {
        target.canvasController.disable();
    }

    if (target.scoreController && typeof target.scoreController.disable === 'function') {
        target.scoreController.disable();
    }

    if (target.airportInfoController && typeof target.airportInfoController.disable === 'function') {
        target.airportInfoController.disable();
        target.airportInfoController.reset();
    }

    if (target.airportGuideController && typeof target.airportGuideController.disable === 'function') {
        target.airportGuideController.disable();
    }

    if (target.aircraftController) {
        target.aircraftController.aircraft_remove_all();

        if (target.aircraftController._stripViewController &&
            typeof target.aircraftController._stripViewController.destroy === 'function') {
            target.aircraftController._stripViewController.destroy();
        }

        target.aircraftController.disable();
    }

    if (target.scopeModel) {
        if (target.scopeModel.radarTargetCollection) {
            target.scopeModel.radarTargetCollection.reset();
        }

        target.scopeModel.disable();
    }

    cleanupUiControllerSafely();
    cleanupAirportsSafely();

    SpawnScheduler.setVfrEnabled(false);
    SpawnScheduler._aircraftController = null;
    SpawnPatternCollection.reset();
    NavigationLibrary.reset();
    AirportController.reset();
    MeasureTool.reset();
    CanvasStageModel.reset();

    GameController.destroyTimers();
    GameController.destroy();
    GameController.initializeEventCount();

    delete TimeKeeper.gameTimeSeconds;
    delete TimeKeeper.gameTimeMilliseconds;
    TimeKeeper.reset();

    resetNavDataCache();
    EventBus.destroy();

    if (target.canvasMock) {
        target.canvasMock.restore();
    }

    if (target.domEnv) {
        target.domEnv.restore();
    }

    if (activeSimulation === target) {
        activeSimulation = null;
    }
}

/**
 * Boot a full, deterministic OpenScope simulation context for E2E testing.
 *
 * @function setupSimulation
 * @param options {object}
 * @return {object}
 */
export function setupSimulation(options = {}) {
    if (activeSimulation) {
        teardownSimulation(activeSimulation);
    }

    const {
        icao = 'yssy',
        airportData = null,
        timewarp = 1,
        autoTraffic = false,
        enableSpeech = false,
        gameOptions = {}
    } = options;

    const domEnv = installDomAndGlobals();
    const canvasMock = installCanvasMock();
    const sim = {
        $root: domEnv.$root,
        domEnv,
        canvasMock,
        observers: null,
        airlineController: null,
        scopeModel: null,
        aircraftController: null,
        scoreController: null,
        canvasController: null,
        inputController: null,
        airportInfoController: null,
        airportGuideController: null,
        logs: [],
        speech: [],
        radioCalls: [],
        scoreEvents: [],
        aircraftEvents: [],
        _onAirportChangeHandler: null,
        _onTrafficResetHandler: null,
        _advanceVirtualTime: null,
        _tornDown: false,
        teardown: () => {}
    };

    try {
        resetNavDataCache();
        EventBus.destroy();
        TimeKeeper.reset();
        GameController.destroyTimers();
        GameController.destroy();
        GameController.initializeEventCount();

        Object.keys(gameOptions).forEach((optionName) => {
            GameController.game.option.setOptionByName(optionName, gameOptions[optionName]);
        });

        let virtualTimeSec = 1000;

        Object.defineProperty(TimeKeeper, 'gameTimeSeconds', {
            configurable: true,
            get: () => virtualTimeSec
        });
        Object.defineProperty(TimeKeeper, 'gameTimeMilliseconds', {
            configurable: true,
            get: () => virtualTimeSec * 1000
        });
        TimeKeeper._previousFrameTimestamp = virtualTimeSec;
        TimeKeeper._frameStartTimestamp = virtualTimeSec;
        TimeKeeper.setPause(false);
        TimeKeeper.updateSimulationRate(timewarp);
        GameController.game.focused = true;

        const initialIcao = String(icao).toLowerCase();
        const initialAirportData = airportData || loadAirportJson(initialIcao);
        const airportLoadList = loadAirportLoadList();
        const airlines = loadAllAirlines();
        const aircraftDefs = loadAllAircraftDefinitions();

        AirportController.init(initialIcao, initialAirportData, airportLoadList);
        NavigationLibrary.init(initialAirportData);
        SpawnPatternCollection.init(initialAirportData);

        const airlineController = new AirlineController(airlines);
        const scopeModel = new ScopeModel();
        const aircraftController = new AircraftController(aircraftDefs, airlineController, scopeModel);
        const scoreController = new ScoreController(aircraftController);

        sim.airlineController = airlineController;
        sim.scopeModel = scopeModel;
        sim.aircraftController = aircraftController;
        sim.scoreController = scoreController;

        if (autoTraffic) {
            SpawnScheduler.init(aircraftController);
        } else {
            SpawnScheduler._aircraftController = aircraftController;
        }

        window.aircraftController = aircraftController;

        UiController.init(domEnv.$root);

        const $canvases = domEnv.$root.find(SELECTORS.DOM_SELECTORS.CANVASES);
        const canvasController = new CanvasController($canvases, aircraftController, scopeModel);
        sim.canvasController = canvasController;
        canvasController.canvas_init();
        canvasController.canvas_resize();

        const inputController = new InputController(domEnv.$root, aircraftController, scopeModel);
        const airportInfoController = new AirportInfoController(domEnv.$root);
        const airportGuideController = new AirportGuideViewController(domEnv.$root, {}, initialAirportData.icao);

        sim.inputController = inputController;
        sim.airportInfoController = airportInfoController;
        sim.airportGuideController = airportGuideController;

        if (!gameControllerListenersInstalled) {
            GameController.init_pre();
            gameControllerListenersInstalled = true;
        } else {
            GameController._eventBus.on(EVENT.SET_THEME, GameController._setTheme);
            GameController.initializeEventCount();
        }

        speech_init();
        inputController.input_init_pre();
        UiController.ui_init();
        UiController.ui_complete();
        GameController.complete();

        const updateViewControls = () => {
            const airport = AirportController.current;

            if (!airport) {
                return;
            }

            EventBus.trigger(EVENT.MARK_SHALLOW_RENDER);
            $(SELECTORS.DOM_SELECTORS.TOGGLE_RESTRICTED_AREAS).toggle((airport.restricted_areas || []).length > 0);
            $(SELECTORS.DOM_SELECTORS.TOGGLE_SIDS).toggle(NavigationLibrary.hasSids);
            $(SELECTORS.DOM_SELECTORS.TOGGLE_TERRAIN).toggle(airport.data.has_terrain);
        };

        const onAirportChangeHandler = (nextAirportJson) => {
            if (!AirportController.current) {
                return;
            }

            NavigationLibrary.reset();
            airlineController.reset();
            aircraftController.aircraft_remove_all();
            scopeModel.radarTargetCollection.reset();
            SpawnPatternCollection.reset();
            GameController.destroyTimers();
            resetAirportControllersSafely(AirportController.current);

            NavigationLibrary.init(nextAirportJson);
            SpawnPatternCollection.init(nextAirportJson);

            if (autoTraffic) {
                SpawnScheduler.startScheduler();
            } else {
                SpawnScheduler.setVfrEnabled(false);
            }

            updateViewControls();
        };

        const onTrafficResetHandler = () => {
            aircraftController.aircraft_remove_all();
            scopeModel.radarTargetCollection.reset();
            resetAirportControllersSafely(AirportController.current);

            if (AirportController.current) {
                AirportController.current.resetAllRunwayQueues();
            }

            if (autoTraffic) {
                SpawnScheduler.createPreSpawnDepartures();
                SpawnScheduler.resetAirborneTraffic();
            }
        };

        sim._onAirportChangeHandler = onAirportChangeHandler;
        sim._onTrafficResetHandler = onTrafficResetHandler;
        EventBus.on(EVENT.AIRPORT_CHANGE, onAirportChangeHandler);
        EventBus.on(EVENT.TRAFFIC_RESET, onTrafficResetHandler);
        updateViewControls();

        const observers = installObservers({ enableSpeech });

        sim.observers = observers;
        sim.logs = observers.logs;
        sim.speech = observers.speech;
        sim.radioCalls = observers.radioCalls;
        sim.scoreEvents = observers.scoreEvents;
        sim.aircraftEvents = observers.aircraftEvents;
        sim._advanceVirtualTime = (deltaFrameSeconds) => {
            virtualTimeSec += deltaFrameSeconds;
        };
        sim.teardown = () => teardownSimulation(sim);

        canvasController._markDeepRender();
        canvasController.canvasUpdatePost();

        activeSimulation = sim;

        return sim;
    } catch (error) {
        teardownSimulation(sim);
        throw error;
    }
}

function getActiveSim() {
    if (!activeSimulation) {
        throw new Error('No active E2E simulation. Call setupSimulation() first.');
    }

    return activeSimulation;
}

/**
 * Load an airport JSON definition from `assets/airports/<icao>.json`.
 *
 * @function loadAirportByIcao
 * @param icao {string}
 * @return {object}
 */
export function loadAirportByIcao(icao) {
    return loadAirportJson(icao);
}

/**
 * Switch the active airport by ICAO or custom airport JSON object.
 *
 * @function switchAirport
 * @param icaoOrData {string|object}
 * @return {AirportModel}
 */
export function switchAirport(icaoOrData) {
    getActiveSim();
    resetAirportControllersSafely(AirportController.current);

    if (typeof icaoOrData === 'string') {
        AirportController.airport_set(icaoOrData.toLowerCase());

        return AirportController.current;
    }

    const icao = String(icaoOrData.icao).toLowerCase();

    if (!AirportController.hasAirport(icao)) {
        AirportController.airport_load({
            icao,
            level: icaoOrData.level || 'medium',
            name: icaoOrData.name || icao.toUpperCase()
        });
    }

    const targetModel = AirportController.airports[icao];
    targetModel.loaded = false;
    AirportController.airport_set(icao, icaoOrData);
    EventBus.trigger(EVENT.AIRPORT_CHANGE, icaoOrData);

    return AirportController.current;
}

/**
 * Reset traffic at the current airport via `EVENT.TRAFFIC_RESET`.
 *
 * @function resetTraffic
 */
export function resetTraffic() {
    getActiveSim();
    EventBus.trigger(EVENT.TRAFFIC_RESET);
}

/**
 * Import and open a DAT airport into the active simulation.
 *
 * @function importDatAirport
 * @param opts {object}
 * @return {object}
 */
export function importDatAirport(opts) {
    const sim = getActiveSim();
    const result = importDatAirportImpl(opts);

    sim.canvasController._markDeepRender();
    sim.canvasController.canvasUpdatePost();

    return result;
}

/**
 * Advance simulation time deterministically in virtual ticks without wall-clock timers.
 *
 * @function stepSimulation
 * @param seconds {number} Simulation seconds to advance
 * @param dt {number} Maximum simulation-time step per tick
 * @return {number} Current `TimeKeeper.accumulatedDeltaTime`
 */
export function stepSimulation(seconds, dt = 0.5) {
    const sim = getActiveSim();
    const rate = TimeKeeper.simulationRate || 1;
    const requestedDt = Number(dt) > 0 ? Number(dt) : 0.5;
    // Cap at 0.5s for 1x (avoids _isReturningFromPauseAndNotFutureTrack zeroing delta)
    // and at 100s for >1x (matches TimeKeeper.deltaTime's 100s frame cap).
    const maxSimStep = rate === 1 ? Math.min(requestedDt, 0.5) : Math.min(requestedDt, 100);
    let remaining = Math.max(0, Number(seconds) || 0);

    while (remaining > 1e-9) {
        const simStep = Math.min(remaining, maxSimStep);
        const frameDt = simStep / rate;

        sim._advanceVirtualTime(frameDt);
        TimeKeeper.update();
        sim.airportInfoController.updateClock();
        GameController.update_pre();
        sim.aircraftController.update();
        sim.canvasController.canvasUpdatePost();
        sim.aircraftController.updateAircraftStrips();

        remaining -= simStep;
    }

    return TimeKeeper.accumulatedDeltaTime;
}

/**
 * Step the simulation until `predicate` returns truthy or `maxSeconds` elapses.
 *
 * @function stepUntil
 * @param predicate {function}
 * @param options {object}
 * @return {object} { satisfied, elapsedSeconds }
 */
export function stepUntil(predicate, { maxSeconds = 600, dt = 0.5 } = {}) {
    const startSimTime = TimeKeeper.accumulatedDeltaTime;

    if (predicate()) {
        return {
            satisfied: true,
            elapsedSeconds: 0
        };
    }

    while (TimeKeeper.accumulatedDeltaTime - startSimTime < maxSeconds - 1e-9) {
        const remaining = maxSeconds - (TimeKeeper.accumulatedDeltaTime - startSimTime);

        stepSimulation(Math.min(dt, remaining), dt);

        if (predicate()) {
            return {
                satisfied: true,
                elapsedSeconds: TimeKeeper.accumulatedDeltaTime - startSimTime
            };
        }
    }

    return {
        satisfied: false,
        elapsedSeconds: TimeKeeper.accumulatedDeltaTime - startSimTime
    };
}

/**
 * Execute an opaque-box user command through `InputController.processCommand()`.
 *
 * @function issueCommand
 * @param commandText {string}
 * @return {object}
 */
export function issueCommand(commandText) {
    const sim = getActiveSim();
    const logStart = sim.logs.length;
    const speechStart = sim.speech.length;
    const radioStart = sim.radioCalls.length;
    let threw = false;
    let error = null;
    let returnValue;

    sim.inputController.$commandInput.val(commandText);

    try {
        returnValue = sim.inputController.processCommand();
    } catch (err) {
        threw = true;
        error = err;
    }

    const logs = sim.logs.slice(logStart);
    const speech = sim.speech.slice(speechStart);
    const radioCalls = sim.radioCalls.slice(radioStart);

    return {
        command: commandText,
        threw,
        error,
        returnValue,
        logs,
        speech,
        radioCalls,
        accepted: !threw && logs.length > 0 && logs.every((entry) => !entry.warn),
        silentNoOp: !threw && logs.length === 0
    };
}

/**
 * Select an aircraft via `InputController.selectAircraftByCallsign`.
 *
 * @function selectAircraft
 * @param callsign {string}
 * @return {string} Active selected callsign in `InputController`
 */
export function selectAircraft(callsign) {
    const sim = getActiveSim();

    sim.inputController.selectAircraftByCallsign(callsign);

    return sim.inputController.input.callsign;
}

function buildCustomPattern(basePattern, overrides = {}) {
    const json = {
        origin: basePattern.origin || '',
        destination: basePattern.destination || '',
        category: basePattern.category,
        route: overrides.route || basePattern.routeString,
        altitude: overrides.altitude !== undefined ? overrides.altitude : basePattern.altitude,
        speed: overrides.speed !== undefined ? overrides.speed : basePattern.speed,
        method: basePattern.method || 'random',
        rate: basePattern.rate || 5,
        airlines: overrides.airline ? [[overrides.airline, 1]] : basePattern.airlines
    };

    return new SpawnPatternModel(json);
}

/**
 * Spawn an IFR arrival aircraft using an airport arrival pattern.
 *
 * @function spawnIfrArrival
 * @param opts {object}
 * @return {AircraftModel}
 */
export function spawnIfrArrival(opts = {}) {
    const sim = getActiveSim();
    const arrivals = SpawnPatternCollection.findSpawnPatternsByCategory(FLIGHT_CATEGORY.ARRIVAL);

    if (arrivals.length === 0) {
        throw new Error(`No arrival spawn patterns defined for ${AirportController.current.icao}`);
    }

    let pattern = arrivals[0];

    if (opts.route) {
        const matched = arrivals.find((p) => p.routeString === opts.route);
        pattern = matched || buildCustomPattern(pattern, opts);
    } else if (opts.airline || opts.altitude !== undefined || opts.speed !== undefined) {
        pattern = buildCustomPattern(pattern, opts);
    }

    const beforeCount = sim.aircraftController.aircraft.list.length;

    if (opts.preSpawn) {
        sim.aircraftController.createPreSpawnAircraftWithSpawnPatternModel(pattern);
    } else {
        sim.aircraftController.createAircraftWithSpawnPatternModel(pattern);
    }

    return sim.aircraftController.aircraft.list[beforeCount] || null;
}

/**
 * Spawn a VFR arrival aircraft at an Australian airport.
 *
 * @function spawnVfrArrival
 * @param opts {object}
 * @return {AircraftModel}
 */
export function spawnVfrArrival(opts = {}) {
    const sim = getActiveSim();
    const arrivals = SpawnPatternCollection.findSpawnPatternsByCategory(FLIGHT_CATEGORY.ARRIVAL);

    if (arrivals.length === 0) {
        throw new Error(`No arrival spawn patterns defined for ${AirportController.current.icao}`);
    }

    const pattern = opts.route ?
        (arrivals.find((p) => p.routeString === opts.route) || arrivals[0]) :
        arrivals[0];
    const beforeCount = sim.aircraftController.aircraft.list.length;

    sim.aircraftController.createVfrArrival(pattern);

    return sim.aircraftController.aircraft.list[beforeCount] || null;
}

/**
 * Spawn a departure aircraft using an airport departure pattern.
 *
 * When `opts.rules === FLIGHT_RULES.VFR`, uses `AircraftController.createVfrDeparture` if
 * available; otherwise falls back to spawning the departure cleanly via IFR initialization
 * (avoiding `AircraftController._createAircraftWithInitializationProps` line 625's
 * VFR-arrival-only early return that emits a bogus `"VFR arrival, undefined..."` radio call
 * and skips runway queuing) before switching `aircraft.rules` and its strip label to VFR.
 *
 * @function spawnDeparture
 * @param opts {object}
 * @return {AircraftModel}
 */
export function spawnDeparture(opts = {}) {
    const sim = getActiveSim();
    const departures = SpawnPatternCollection.departureModels;

    if (departures.length === 0) {
        throw new Error(`No departure spawn patterns defined for ${AirportController.current.icao}`);
    }

    let pattern = departures[0];

    if (opts.runwayName) {
        const byRunway = departures.find((p) => p.routeString.startsWith(`${opts.runwayName}.`) ||
            p.routeString.includes(`.${opts.runwayName}.`) ||
            p.routeString.includes(opts.runwayName));

        if (byRunway) {
            pattern = byRunway;
        }
    }

    if (opts.route || opts.airline || opts.altitude !== undefined || opts.speed !== undefined) {
        pattern = buildCustomPattern(pattern, opts);
    }

    const beforeCount = sim.aircraftController.aircraft.list.length;

    if (opts.rules === FLIGHT_RULES.VFR) {
        if (typeof sim.aircraftController.createVfrDeparture === 'function') {
            sim.aircraftController.createVfrDeparture(pattern, opts);

            return sim.aircraftController.aircraft.list[beforeCount] || null;
        }

        const props = sim.aircraftController._buildAircraftProps(
            pattern,
            false,
            opts.airline || 'vh/lightGA'
        );

        sim.aircraftController._createAircraftWithInitializationProps({
            ...props,
            rules: FLIGHT_RULES.IFR
        });

        const aircraft = sim.aircraftController.aircraft.list[beforeCount] || null;

        if (aircraft) {
            aircraft.rules = FLIGHT_RULES.VFR;

            const stripController = sim.aircraftController._stripViewController;
            const stripModel = stripController &&
                stripController._collection &&
                typeof stripController._collection.findStripByAircraftId === 'function' ?
                stripController._collection.findStripByAircraftId(aircraft.id) :
                null;

            if (stripModel) {
                stripModel._rulesLabel = 'V';

                if (stripModel.$element) {
                    stripModel.$element.find('.js-stripView-flightRules').text('V');
                }
            }
        }

        return aircraft;
    }

    sim.aircraftController.createAircraftWithSpawnPatternModel(pattern);

    return sim.aircraftController.aircraft.list[beforeCount] || null;
}

/**
 * Find an active `AircraftModel` by callsign (case-insensitive).
 *
 * @function getAircraft
 * @param callsign {string}
 * @return {AircraftModel|null}
 */
export function getAircraft(callsign) {
    const sim = getActiveSim();

    return sim.aircraftController.findAircraftByCallsign(callsign) || null;
}

/**
 * Return an observable snapshot of an aircraft's state.
 *
 * @function getAircraftState
 * @param callsignOrModel {string|AircraftModel}
 * @return {object|null}
 */
export function getAircraftState(callsignOrModel) {
    const aircraft = typeof callsignOrModel === 'string' ?
        getAircraft(callsignOrModel) :
        callsignOrModel;

    if (!aircraft) {
        return null;
    }

    const airport = AirportController.current;
    const distanceToAirportNm = airport && aircraft.positionModel ?
        aircraft.positionModel.distanceToPosition(airport.positionModel) :
        aircraft.distance;
    const agl = airport ? aircraft.altitude - airport.elevation : aircraft.altitude;

    return {
        id: aircraft.id,
        callsign: aircraft.callsign,
        readbackCallsign: aircraft.readbackCallsign,
        category: aircraft.category,
        rules: aircraft.rules,
        flightPhase: aircraft.fms ? aircraft.fms.currentPhase : null,
        altitude: aircraft.altitude,
        agl,
        speed: aircraft.speed,
        heading: aircraft.heading,
        distanceToAirportNm,
        isControllable: aircraft.isControllable,
        transferredToCentre: aircraft.transferredToCentre,
        isRemovable: aircraft.isRemovable,
        vfrOrbit: aircraft.vfrOrbit,
        hasApproachClearance: aircraft.pilot ? aircraft.pilot.hasApproachClearance : false,
        controllerState: aircraft.controllerState ? { ...aircraft.controllerState } : null,
        viewModel: typeof aircraft.getViewModel === 'function' ? aircraft.getViewModel() : null,
        alerts: typeof aircraft.getAlerts === 'function' ? aircraft.getAlerts() : null
    };
}

/**
 * Return the departure queue and last departed aircraft for a runway.
 *
 * @function getRunwayQueue
 * @param runwayName {string}
 * @return {object}
 */
export function getRunwayQueue(runwayName) {
    getActiveSim();
    const airport = AirportController.current;
    const runway = runwayName ? airport.getRunway(runwayName) : airport.departureRunwayModel;

    if (!runway) {
        return {
            runwayName: runwayName || null,
            queue: [],
            lastDepartedCallsign: null
        };
    }

    return {
        runwayName: runway.name,
        queue: runway.queue.slice(),
        lastDepartedCallsign: runway.lastDepartedAircraftModel ?
            runway.lastDepartedAircraftModel.callsign :
            null
    };
}

export {
    getFrequencyPanelState,
    getRenderedDataBlocks,
    getRadarTargetViewModels,
    getStrips,
    getScoreState,
    resolveClientPath,
    tryRequireClient,
    requireAvailable
};
