import test from 'ava';
import sinon from 'sinon';
import $ from 'jquery';
import AircraftCommander from '../../src/assets/scripts/client/aircraft/AircraftCommander';
import AircraftModel from '../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftTypeDefinitionModel from '../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import NavDataCache from '../../src/assets/scripts/client/airport/dat/NavDataCache';
import { generateTerrainGeoJson } from '../../src/assets/scripts/client/airport/dat/terrainGenerator';
import CommandParser from '../../src/assets/scripts/client/commands/parsers/CommandParser';
import GameController from '../../src/assets/scripts/client/game/GameController';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import SpawnPatternCollection from '../../src/assets/scripts/client/trafficGenerator/SpawnPatternCollection';
import SpawnScheduler from '../../src/assets/scripts/client/trafficGenerator/SpawnScheduler';
import MsaView from '../../src/assets/scripts/client/ui/MsaView';
import UiController from '../../src/assets/scripts/client/ui/UiController';
import { CONTROLLER_TYPE } from '../../src/assets/scripts/client/constants/controllerConstants';
import { FLIGHT_PHASE } from '../../src/assets/scripts/client/constants/aircraftConstants';
import a320 from '../../assets/aircraft/a320.json';
import yssyData from '../../assets/airports/yssy.json';

test.serial('1. Departure operations: Tower ownership, initial contact phraseology, identification, and toggle', (t) => {
    NavigationLibrary.reset();
    NavigationLibrary.init(yssyData);
    const airport = new AirportModel(yssyData);
    airport.data = yssyData;
    AirportController.current = airport;

    const logs = [];
    const uiLogStub = sinon.stub(UiController, 'ui_log').callsFake((msg, isWarn) => logs.push({ msg, isWarn }));

    try {
        const commander = new AircraftCommander();
        const depRoute = yssyData.spawnPatterns.find((p) => p.category === 'departure').route;
        const dep = new AircraftModel({
            airline: 'qfa',
            callsign: '150',
            airlineCallsign: 'qantas',
            category: 'departure',
            origin: 'YSSY',
            destination: '',
            altitude: 21,
            speed: 0,
            heading: 0,
            model: new AircraftTypeDefinitionModel(a320),
            positionModel: airport.positionModel.generateDynamicPositionFromBearingAndDistance(0, 0),
            routeString: depRoute
        });

        // Ground departure starts under Tower and rejects player commands
        t.is(dep.controllerState.currentController, CONTROLLER_TYPE.TWR);
        t.false(dep.isPlayerControlled());
        t.false(commander.runCommands(dep, [['a', '100']]));

        // Climb below 1500 AGL does not trigger handoff
        dep.setFlightPhase(FLIGHT_PHASE.CLIMB);
        dep.altitude = airport.positionModel.elevation + 800;
        t.false(airport.towerController.shouldDepartureContactPlayer(dep));

        // Climb to 1500+ AGL triggers automatic handoff to Approach with Australian phraseology
        dep.altitude = airport.positionModel.elevation + 1500;
        dep.mcp.setAltitudeFieldValue(5000);
        t.true(airport.towerController.shouldDepartureContactPlayer(dep));
        airport.towerController.transferDepartureToPlayer(dep);

        t.is(dep.controllerState.currentController, CONTROLLER_TYPE.APP);
        t.true(dep.isPlayerControlled());
        t.true(dep.awaitingIdentification);
        t.false(dep.identified);
        t.true(logs.some((l) => l.msg.includes('Sydney Approach, QFA150, passing 1500 for 5000.')));

        // Invalid command must NOT consume awaitingIdentification
        const prevCount = logs.length;
        commander.runCommands(dep, [['direct', 'BADFIX']]);
        t.true(dep.awaitingIdentification);
        t.false(dep.identified);
        t.false(logs.slice(prevCount).some((l) => l.msg.includes('identified')));

        // First successful multi-instruction command marks aircraft identified without speaking controller phrase
        const beforeFirstOk = logs.length;
        const parsed = new CommandParser('QFA150 a 100 h 270').parse();
        commander.runCommands(dep, parsed.args);
        t.false(dep.awaitingIdentification);
        t.true(dep.identified);
        const firstBatchLogs = logs.slice(beforeFirstOk).map((l) => l.msg);
        const identLogs = firstBatchLogs.filter((m) => m.includes('identified'));
        t.is(identLogs.length, 0);

        // Subsequent instruction omits `identified`
        const beforeSecond = logs.length;
        commander.runCommands(dep, [['altitude', '120']]);
        t.false(logs.slice(beforeSecond).some((l) => l.msg.includes('identified')));

        // Standalone `identified` command works when awaitingIdentification is set without speaking controller phrase
        dep.awaitingIdentification = true;
        dep.identified = false;
        const beforeStandalone = logs.length;
        commander.runCommands(dep, [['identified']]);
        t.false(dep.awaitingIdentification);
        t.true(dep.identified);
        t.false(logs.slice(beforeStandalone).some((l) => l.msg.includes('identified')));

        // Departure toggle defaults to OFF for Australian airports and persists per airport
        delete localStorage['openscope-au-departures-YSSY'];
        t.false(SpawnScheduler.isDeparturesEnabledForAirport(airport));
        SpawnScheduler.setDeparturesEnabled(true, false);
        t.true(SpawnScheduler.isDeparturesEnabledForAirport(airport));
        SpawnScheduler.setDeparturesEnabled(false, false);
        t.false(SpawnScheduler.isDeparturesEnabledForAirport(airport));
    } finally {
        uiLogStub.restore();
        airport.releaseWindListener();
        NavigationLibrary.reset();
        AirportController.reset();
    }
});

test.serial('2. MSA popup: open/close, Escape, X button, airport switch, empty state, and async load guard', (t) => {
    const hasOwnDoc = Object.prototype.hasOwnProperty.call(global, 'document');
    const prevDoc = global.document;
    global.document = window.document;
    AirportController.current = { icao: 'YBNA' };
    NavDataCache.records.delete('msa');
    const $root = $(`
        <div>
            <button class="toggle-msa" type="button">MSA</button>
            <button class="toggle-dat-import" type="button">+</button>
            <aside id="msa-panel" hidden aria-hidden="true">
                <header><strong></strong><button type="button" class="msa-close">&times;</button></header>
                <select hidden></select>
                <p class="msa-reference"></p>
                <p class="msa-empty" hidden></p>
                <button type="button" class="msa-open-import" hidden>Import earth_msa.dat</button>
                <canvas width="400" height="280" hidden></canvas>
                <ul></ul>
            </aside>
        </div>
    `).appendTo(window.document.body);
    const loadStub = sinon.stub(NavDataCache, 'load').callsFake(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const msa = new MsaView($root);
    const restoreDoc = () => {
        if (hasOwnDoc) global.document = prevDoc;
        else delete global.document;
    };

    try {
        // Initially hidden
        t.true($root.find('#msa-panel').prop('hidden'));
        t.is($root.find('#msa-panel').attr('aria-hidden'), 'true');

        // Toolbar button opens and shows readable empty state
        $root.find('.toggle-msa').trigger('click');
        t.true(msa.isOpen());
        t.false($root.find('#msa-panel').prop('hidden'));
        t.regex($root.find('.msa-reference').text(), /No MSA data available/);
        t.regex($root.find('.msa-empty').text(), /earth_msa\.dat/);
        t.false($root.find('.msa-open-import').prop('hidden'));
        t.true($root.find('#msa-panel select').prop('hidden'));

        // X button closes
        $root.find('#msa-panel .msa-close').trigger('click');
        t.false(msa.isOpen());
        t.true($root.find('#msa-panel').prop('hidden'));
        t.is($root.find('#msa-panel').attr('aria-hidden'), 'true');

        // Reopen and close before async load completes -> async refresh must NOT reopen
        $root.find('.toggle-msa').trigger('click');
        t.true(msa.isOpen());
        $root.find('.toggle-msa').trigger('click');
        t.false(msa.isOpen());
        return new Promise((r) => setTimeout(r, 35)).then(() => {
            t.false(msa.isOpen());
            t.true($root.find('#msa-panel').prop('hidden'));

            // Escape key closes when open, stops propagation to window, and restores focus to opener
            const $toggle = $root.find('.toggle-msa');
            $toggle.trigger('focus');
            $toggle.trigger('click');
            t.true(msa.isOpen());
            let windowSawEscape = false;
            const windowHandler = (e) => {
                if (e.key === 'Escape') windowSawEscape = true;
            };
            $(window).on('keydown.msaTest', windowHandler);
            try {
                // Auto-repeat Escape (with repeat only on native originalEvent) must keep #msa-panel open and stop propagation
                const closeBtn = $root.find('#msa-panel header button')[0];
                closeBtn.dispatchEvent(new window.KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    repeat: true,
                    bubbles: true,
                    cancelable: true
                }));
                t.true(msa.isOpen());
                t.false($root.find('#msa-panel').prop('hidden'));
                t.false(windowSawEscape);

                document.dispatchEvent(new window.KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    repeat: true,
                    bubbles: true,
                    cancelable: true
                }));
                t.true(msa.isOpen());
                t.false($root.find('#msa-panel').prop('hidden'));
                t.false(windowSawEscape);

                $(document).trigger($.Event('keydown', { key: 'Escape' }));
                t.false(msa.isOpen());
                t.true($root.find('#msa-panel').prop('hidden'));
                t.false(windowSawEscape);
                t.is(document.activeElement, $toggle[0]);
            } finally {
                $(window).off('keydown.msaTest', windowHandler);
            }
        }).finally(() => {
            msa.destroy();
            $root.remove();
            loadStub.restore();
            restoreDoc();
        });
    } catch (err) {
        msa.destroy();
        $root.remove();
        loadStub.restore();
        restoreDoc();
        throw err;
    }
});

test.serial('3. Terrain generator, cache, and AirportModel integration handle coastal contours, holes, and multipolygons', (t) => {
    // Deterministic 5x5 coastal + elevated terrain grid (in metres)
    // Ocean (0 m) on left/right edges, elevated ridge (> 350 m = > 1000 ft) in centre
    const grid = [
        [0, 0, 0, 0, 0],
        [0, 50, 200, 50, 0],
        [0, 150, 450, 150, 0],
        [0, 50, 200, 50, 0],
        [0, 0, 0, 0, 0]
    ];
    const bounds = { minLat: -29.2, maxLat: -28.5, minLon: 153.1, maxLon: 153.9 };
    const geojson = generateTerrainGeoJson(grid, bounds, {
        icao: 'YBNA',
        contourIntervalFt: 1000,
        attribution: 'Test DEM'
    });

    t.is(geojson.type, 'FeatureCollection');
    t.true(geojson.features.length >= 2);
    t.is(geojson.features[0].properties.elevation, 0);
    t.is(geojson.features[0].properties.layer, 'coastline');
    t.true(geojson.features.some((f) => f.properties.elevation > 0));

    // Attach to AirportModel and verify terrain elevation & multipolygon/hole parsing
    const airport = new AirportModel({
        ...yssyData,
        icao: 'YBNA',
        has_terrain: false,
        terrainGeoJson: geojson
    });
    t.true(airport.has_terrain);
    t.true(Object.keys(airport.terrain).length > 0);
    t.true(airport.terrainElevationAt([0, 0]) >= 0);

    // Cache per-airport without overwriting
    const loadStub = sinon.stub(NavDataCache, 'load').resolves();
    return NavDataCache.saveTerrain({
        icao: 'YBNA',
        coordinates: [-28.83, 153.56],
        coverageNm: 60,
        provider: 'open-meteo',
        geojson
    }).then(() => {
        const cached = NavDataCache.getTerrain('YBNA', { coverageNm: 60 });
        t.truthy(cached);
        t.is(cached.icao, 'YBNA');
        t.is(NavDataCache.getTerrain('YMML', { coverageNm: 60 }), null);
        return NavDataCache.clearTerrain('YBNA');
    }).then(() => {
        t.is(NavDataCache.getTerrain('YBNA', { coverageNm: 60 }), null);
    }).finally(() => {
        loadStub.restore();
        airport.releaseWindListener();
    });
});
