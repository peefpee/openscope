import _forEach from 'lodash/forEach';
import AirportController from '../airport/AirportController';
import SpawnPatternCollection from './SpawnPatternCollection';
import TimeKeeper from '../engine/TimeKeeper';
import GameController from '../game/GameController';
import { INVALID_NUMBER } from '../constants/globalConstants';
import { isAustralianAirport } from '../constants/controllerConstants';

/**
 * Used to create a game_timer for a `SpawnPatternModel` and provide
 * methods for re-creating a new timer on timer expiration.
 *
 * This is designed to be a stateless class.
 *
 * @class SpawnScheduler
 */
class SpawnScheduler {
    /**
     * @constructor
     * @for SpawnScheduler
     * @param aircraftController {AircraftController}
     */
    constructor() {
        /**
         * @property _aircraftController
         * @type {AircraftController}
         * @default null
         * @private
         */
        this._aircraftController = null;
    }

    /**
     * @for SpawnScheduler
     * @method init
     * @param aircraftController {AircraftController}
     * @chainable
     */
    init(aircraftController) {
        if (typeof aircraftController === 'undefined') {
            throw new TypeError('Invalid parameter. SpawnScheduler requires aircraftController to be defined.');
        }

        this._aircraftController = aircraftController;

        this.startScheduler();

        return this;
    }

    /**
     * Starts the scheduler and prespawns departures
     *
     * @for SpawnScheduler
     * @method startScheduler
     */
    setVfrEnabled(enabled, spawnImmediately = true) {
        if (this.vfrTimer && GameController.game.timeouts.includes(this.vfrTimer)) GameController.destroyTimer(this.vfrTimer);
        this.vfrEnabled = enabled;
        this.vfrTimer = null;
        if (!enabled) return;
        const spawn = () => {
            const arrival = SpawnPatternCollection.spawnPatternModels.find((pattern) => pattern.isArrival());
            this._aircraftController.createVfrArrival(arrival);
        };
        if (spawnImmediately) spawn();
        this.vfrTimer = GameController.game_interval(spawn, Math.max(10, (AirportController.current.data.vfrOptions || {}).intervalSeconds || 300));
    }

    _departuresStorageKey(icao) {
        return `openscope-au-departures-${String(icao || '').trim().toUpperCase()}`;
    }

    isDeparturesEnabledForAirport(airport = AirportController.current) {
        if (airport && airport.data && airport.data.sessionTraffic) return airport.data.sessionTraffic.departures;
        if (!airport || !isAustralianAirport(airport.icao)) {
            return true;
        }
        if (typeof this._departuresEnabled === 'boolean' && this._departuresAirportIcao === airport.icao) {
            return this._departuresEnabled;
        }
        try {
            if (typeof localStorage !== 'undefined') {
                const key = this._departuresStorageKey(airport.icao);
                const stored = typeof localStorage.getItem === 'function' ? localStorage.getItem(key) : localStorage[key];
                if (stored === 'true') return true;
                if (stored === 'false') return false;
            }
        } catch (e) { /* ignore storage errors */ }
        return false;
    }

    setDeparturesEnabled(enabled, spawnImmediately = true) {
        const airport = AirportController.current;
        const next = Boolean(enabled);
        this._departuresEnabled = next;
        this._departuresAirportIcao = airport ? airport.icao : null;
        if (airport && airport.data && airport.data.sessionTraffic) {
            airport.data.sessionTraffic.departures = next;
        } else if (airport && isAustralianAirport(airport.icao)) {
            try {
                if (typeof localStorage !== 'undefined') {
                    const key = this._departuresStorageKey(airport.icao);
                    if (typeof localStorage.setItem === 'function') localStorage.setItem(key, String(next));
                    else localStorage[key] = String(next);
                }
            } catch (e) { /* ignore storage errors */ }
        }

        if (!next) {
            SpawnPatternCollection.spawnPatternModels
                .filter((s) => !s.isAirborneAtSpawn())
                .forEach((pattern) => {
                    if (pattern.scheduleId && pattern.scheduleId !== INVALID_NUMBER) {
                        GameController.destroyTimer(pattern.scheduleId);
                        pattern.scheduleId = null;
                    }
                });
            return;
        }

        SpawnPatternCollection.spawnPatternModels
            .filter((s) => !s.isAirborneAtSpawn())
            .forEach((pattern) => {
                pattern.cycleStart(TimeKeeper.accumulatedDeltaTime);
                if (!pattern.scheduleId || pattern.scheduleId === INVALID_NUMBER) {
                    pattern.scheduleId = this.createNextSchedule(pattern);
                }
            });

        if (spawnImmediately && this._aircraftController) {
            this.createPreSpawnDepartures();
        }
    }

    startScheduler() {
        const traffic = AirportController.current.data.sessionTraffic;
        this.setVfrEnabled(Boolean(traffic && traffic.vfr));
        this._departuresEnabled = this.isDeparturesEnabledForAirport();
        this._departuresAirportIcao = AirportController.current ? AirportController.current.icao : null;
        // TODO: rename to createSchedulesWithTimer
        this.createSchedulesFromList();
        // TODO: create getter on collection to get all preSpawn including departures
        // TODO: create method `createPreSpawnDeparturesAndArrivals`
        this.createPreSpawnDepartures();
    }

    /**
     * Loop through each `SpawnPatternModel` and create a `game_timeout` for each
     *
     * @for SpawnScheduler
     * @method createSchedulesFromList
     */
    createSchedulesFromList() {
        const traffic = AirportController.current.data.sessionTraffic;
        const departuresAllowed = this.isDeparturesEnabledForAirport();
        _forEach(SpawnPatternCollection.spawnPatternModels, (spawnPatternModel) => {
            const skipArrival = traffic && !traffic.arrivals && spawnPatternModel.isArrival();
            if (skipArrival || (!departuresAllowed && !spawnPatternModel.isAirborneAtSpawn())) {
                spawnPatternModel.scheduleId = null;
                return;
            }
            // set the #cycleStartTime for this `spawnPatternModel` with current game time
            spawnPatternModel.cycleStart(TimeKeeper.accumulatedDeltaTime);
            spawnPatternModel.scheduleId = this.createNextSchedule(spawnPatternModel);
            spawnPatternModel.createPreSpawnAircraft(this._aircraftController);
        });
    }

    /**
     * Loop through each airborne `SpawnPatternModel` and reset the spawned and preSpawned traffic.
     *
     * Used when resetting the traffic in the traffic settings panel.
     *
     * @for SpawnScheduler
     * @method resetAirborneTraffic
     */
    resetAirborneTraffic() {
        const traffic = AirportController.current.data.sessionTraffic;
        if (traffic && !traffic.arrivals) return;
        SpawnPatternCollection.spawnPatternModels.filter((s) => s.isAirborneAtSpawn()).forEach((spawnPatternModel) => {
            spawnPatternModel.preSpawnAircraftList = [];
            spawnPatternModel.createPreSpawnAircraft(this._aircraftController);
            this.resetTimer(spawnPatternModel);
        });
    }

    /**
     * Send `SpawnPatternModel` objects off the the `AircraftController` to create
     * new aircraft onLoad or onAirportChange.
     *
     * When starting a session there should always be at least one departure waiting
     * to taxi. The logic for determining _which_ patterns to use, and how many,
     * is handled within the `SpawnPatternCollection`. Here we simply get the
     * result and loop through each `SpawnPatternModel`.
     *
     * @for SpawnScheduler
     * @method createPreSpawnDepartures
     */
    createPreSpawnDepartures() {
        if (!this.isDeparturesEnabledForAirport()) {
            return;
        }

        const departureModelsToPreSpawn = SpawnPatternCollection.getDepartureModelsForPreSpawn();

        for (let i = 0; i < departureModelsToPreSpawn.length; i++) {
            const spawnPatternModel = departureModelsToPreSpawn[i];

            this._aircraftController.createAircraftWithSpawnPatternModel(spawnPatternModel);
        }
    }

    /**
     * Registers a new timeout, its callback and callback arguments with the `GameController`
     *
     * @for SpawnScheduler
     * @method createNextSchedule
     * @param spawnPatternModel {SpawnPatternModel}
     * @return {array}
     */
    createNextSchedule(spawnPatternModel) {
        const delay = spawnPatternModel.getNextDelayValue(TimeKeeper.accumulatedDeltaTime);

        return this._createTimeout(spawnPatternModel, delay);
    }

    /**
     * Resets the timer for a specific spawn pattern
     *
     * @for SpawnScheduler
     * @method resetTimer
     * @param spawnPatternModel {SpawnPatternModel}
     */
    resetTimer(spawnPatternModel) {
        const traffic = AirportController.current.data.sessionTraffic;
        if (traffic && (spawnPatternModel.isArrival() ? !traffic.arrivals : !traffic.departures)) return;
        let timePassed = 0;
        const { scheduleId } = spawnPatternModel;

        if (scheduleId && scheduleId !== INVALID_NUMBER) {
            GameController.destroyTimer(spawnPatternModel.scheduleId);

            const timerStart = spawnPatternModel.scheduleId[1] - spawnPatternModel.scheduleId[3];
            timePassed = TimeKeeper.accumulatedDeltaTime - timerStart;
            spawnPatternModel.scheduleId = null;
        }

        if (spawnPatternModel.rate <= 0) {
            return;
        }

        let nextDelay = spawnPatternModel.getNextDelayValue(TimeKeeper.accumulatedDeltaTime);

        if (timePassed < nextDelay) {
            nextDelay -= timePassed;
        } else {
            this._aircraftController.createAircraftWithSpawnPatternModel(spawnPatternModel);
        }

        spawnPatternModel.scheduleId = this._createTimeout(spawnPatternModel, nextDelay);
    }

    /**
     * Registers a new timeout, its callback and callback arguments with the `GameController`
     *
     * @for SpawnScheduler
     * @method _createTimeout
     * @param spawnPatternModel {SpawnPatternModel}
     * @param delay {number} time in seconds
     * @return {array}
     */
    _createTimeout(spawnPatternModel, delay) {
        return GameController.game_timeout(
            this.createAircraftAndRegisterNextTimeout,
            // lifespan of timeout
            delay,
            // passing null only to match existing api
            null,
            // arguments sent to callback as it's first parameter. using array so multiple arg can be sent
            [spawnPatternModel, this._aircraftController]
        );
    }

    /**
     * Method sent to `game_timeout` as the callback
     *
     * When fired, this method will call `createAircraftWithSpawnPatternModel` and then
     * create a new time by calling `createNextSchedule`. Doing so will also result
     * in calculating a new delay period.
     *
     * Accepts two arguments; `spawnPattern` and `aircraftController`.
     *
     * @for SpawnScheduler
     * @method createAircraftAndRegisterNextTimeout
     * @param args {*[]}
     */
    createAircraftAndRegisterNextTimeout = (...args) => {
        const spawnPatternModel = args[0][0];
        const aircraftController = args[0][1];

        aircraftController.createAircraftWithSpawnPatternModel(spawnPatternModel);

        spawnPatternModel.scheduleId = this.createNextSchedule(spawnPatternModel);
    };
}


export default new SpawnScheduler();
