/* global prop */
import test from 'ava';
import sinon from 'sinon';
import AircraftCommander from '../../../src/assets/scripts/client/aircraft/AircraftCommander';
import AircraftController from '../../../src/assets/scripts/client/aircraft/AircraftController';
import AircraftModel from '../../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftTypeDefinitionModel from '../../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import AirlineController from '../../../src/assets/scripts/client/airline/AirlineController';
import AirportController from '../../../src/assets/scripts/client/airport/AirportController';
import CommandParser from '../../../src/assets/scripts/client/commands/parsers/CommandParser';
import AirportModel from '../../../src/assets/scripts/client/airport/AirportModel';
import { parseAirportDat } from '../../../src/assets/scripts/client/airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../../../src/assets/scripts/client/airport/dat/buildDatScope';
import { parseAustralianAirspace } from '../../../src/assets/scripts/client/airport/dat/australianAirspace';
import { circuitPoints, vfrEntry } from '../../../src/assets/scripts/client/aircraft/Pilot/VfrArrival';
import TimeKeeper from '../../../src/assets/scripts/client/engine/TimeKeeper';
import GameController from '../../../src/assets/scripts/client/game/GameController';
import NavigationLibrary from '../../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import ScopeModel from '../../../src/assets/scripts/client/scope/ScopeModel';
import SpawnPatternCollection from '../../../src/assets/scripts/client/trafficGenerator/SpawnPatternCollection';
import SpawnPatternModel from '../../../src/assets/scripts/client/trafficGenerator/SpawnPatternModel';
import SpawnScheduler from '../../../src/assets/scripts/client/trafficGenerator/SpawnScheduler';
import UiController from '../../../src/assets/scripts/client/ui/UiController';
import { degreesToRadians } from '../../../src/assets/scripts/client/utilities/unitConverters';
import c172 from '../../../assets/aircraft/c172.json';
import vh from '../../../assets/airlines/vh.json';
import yssy from '../../../assets/airports/yssy.json';

test('Australian fallback shelves and VFR entries use airport-relative distance and height', (t) => {
    const data = parseAirportDat('RWY:RW18, , ,00500, , , , ;S37000000,E145000000,0000;\n' +
        'RWY:RW36, , ,00500, , , , ;S37010000,E145000000,0000;', 'YTES.dat');
    const scope = buildDatScope(data, resolveWaypoints(data));
    const airport = new AirportModel(scope);
    airport.data = scope;
    try {
        const [surface, shelf] = airport.controlledShelves;
        t.is(surface.floor, 500);
        t.is(shelf.floor, 2500);
        t.is(surface.ceiling, 2500);
        t.is(shelf.ceiling, airport.ctr_ceiling);
        t.is(surface.source, 'simulated');
        t.deepEqual(shelf.relativePoly, airport.airspace[0].relativePoly);
        t.true(surface.isPointInside([0, 0], 1000));
        t.true(shelf.isPointInside([0, 0], 3000));
        airport.terrain = { 1000: [[[[-1, -1], [1, -1], [1, 1], [-1, 1]]]] };
        airport._terrainLevels = [1000];
        t.deepEqual(airport.getAirspaceAtPosition([0, 0], 2800), [surface]);
        t.deepEqual(airport.getAirspaceAtPosition([0, 0], 3100), [shelf]);
        const entry = vfrEntry(airport);
        t.truthy(entry);
        t.false(airport.controlledShelves.some((s) => s.isPointInside(entry.position.relativePosition, entry.orbit.altitude)));
        const runway = airport.getRunway('18');
        for (const [leg, count] of [['xw', 5], ['dw', 4], ['base', 3], ['final', 2]]) {
            const path = circuitPoints(runway, leg, true, 85);
            t.is(path.length, count);
            t.true(Math.abs(path[count - 1].position.distanceToPosition(runway.positionModel) - 3) < 0.001);
        }
        t.deepEqual(new CommandParser('ABC dw 18 r').parse().args[0], ['dw', '18', 'r']);
    } finally { airport.releaseWindListener(); }
});

test('imports X-Plane Australian CTA shelves with published vertical limits', (t) => {
    const [region] = parseAustralianAirspace('AC D\nAN TEST CTR\nAL GND\nAH 4500 MSL\n' +
        'DP 37:00:00 S 145:00:00 E\nDP 37:05:00 S 145:00:00 E\nDP 37:05:00 S 145:05:00 E');
    t.is(region.airspace_class, 'D');
    t.true(region.floor.agl);
    t.is(region.ceiling.feet, 4500);
});

function createVfrScenario() {
    const data = parseAirportDat([
        'RWY:RW18, , ,00010, , , , ;S37000000,E145000000,0000;',
        'RWY:RW36, , ,00010, , , , ;S37010000,E145000000,0000;'
    ].join('\n'), 'YTES.dat');
    const scope = buildDatScope(data, resolveWaypoints(data));
    const airport = new AirportModel(scope);
    airport.data = scope;
    const targetFixPos = airport.positionModel.generateCoordinatesFromBearingAndDistance(degreesToRadians(90), 25);
    scope.fixes.VFRFX = targetFixPos;
    airport.data = scope;
    AirportController.current = airport;
    NavigationLibrary.init(scope);
    return { airport, scope };
}

function createOrbitingVfrAircraft(airport, scope) {
    const entry = vfrEntry(airport);
    entry.orbit.reportingPoint = null;
    const model = new AircraftTypeDefinitionModel(c172);
    const aircraft = new AircraftModel({
        airline: 'vh',
        airlineCallsign: 'vh',
        callsign: 'abc',
        category: 'arrival',
        origin: '',
        destination: 'YTES',
        rules: 'vfr',
        orbit: entry.orbit,
        positionModel: entry.position,
        altitude: entry.orbit.altitude,
        speed: model.speed.cruise,
        heading: entry.orbit.center.bearingToPosition(entry.position) + Math.PI / 2,
        model,
        routeString: scope.spawnPatterns.find((p) => p.category === 'arrival').route,
        transponderCode: 1200
    });
    aircraft.trueAirspeed = aircraft.speed;
    return aircraft;
}

function runCommand(commander, aircraft, commandText) {
    const parsed = new CommandParser(`abc ${commandText}`).parse();
    const [command, ...args] = parsed.args[0];
    return commander.run(aircraft, command, args);
}

test.serial('VFR arrivals accept altitude and speed instructions while remaining in their entry orbit', (t) => {
    const { airport, scope } = createVfrScenario();
    const logStub = sinon.stub(UiController, 'ui_log');
    const previousSpeech = prop.speech;
    prop.speech = { enabled: false };
    const frameTime = TimeKeeper.getDeltaTimeForGameStateAndTimewarp;
    TimeKeeper.getDeltaTimeForGameStateAndTimewarp = () => 1;
    try {
        const commander = new AircraftCommander();
        const aircraft = createOrbitingVfrAircraft(airport, scope);
        const orbitCenter = aircraft.vfrOrbit.center;

        // Invalid altitude below MSA is rejected without leaving orbit
        const badAlt = runCommand(commander, aircraft, 'a 5');
        t.false(badAlt[0]);
        t.truthy(aircraft.vfrOrbit);

        // Altitude-only instruction succeeds and keeps aircraft in entry orbit
        const altResult = runCommand(commander, aircraft, 'a 30');
        t.true(altResult[0]);
        t.is(aircraft.mcp.altitude, 3000);
        t.truthy(aircraft.vfrOrbit);

        // Speed instruction succeeds and keeps aircraft in entry orbit
        const badSpeed = runCommand(commander, aircraft, 'sp 300');
        t.false(badSpeed[0]);
        const speedResult = runCommand(commander, aircraft, 'sp 90');
        t.true(speedResult[0]);
        t.is(aircraft.mcp.speed, 90);
        t.truthy(aircraft.vfrOrbit);

        for (let i = 0; i < 60; i++) {
            aircraft.update();
        }

        t.is(aircraft.target.altitude, 3000);
        t.is(aircraft.target.speed, 90);
        t.true(aircraft.altitude > 1600);
        t.true(aircraft.speed < 110);
        t.truthy(aircraft.vfrOrbit);
        t.true(orbitCenter.distanceToPosition(aircraft.positionModel) <= 1.5);
    } finally {
        TimeKeeper.getDeltaTimeForGameStateAndTimewarp = frameTime;
        prop.speech = previousSpeech;
        logStub.restore();
        NavigationLibrary.reset();
        airport.releaseWindListener();
        AirportController.reset();
    }
});

test.serial('VFR arrivals exit entry orbit on heading, fly present heading, direct, and circuit instructions', (t) => {
    const { airport, scope } = createVfrScenario();
    const logStub = sinon.stub(UiController, 'ui_log');
    const previousSpeech = prop.speech;
    prop.speech = { enabled: false };
    const frameTime = TimeKeeper.getDeltaTimeForGameStateAndTimewarp;
    TimeKeeper.getDeltaTimeForGameStateAndTimewarp = () => 1;
    try {
        const commander = new AircraftCommander();

        // 1. Heading instruction exits entry orbit and retains assigned altitude
        const headingAc = createOrbitingVfrAircraft(airport, scope);
        const orbitCenter = headingAc.vfrOrbit.center;
        t.true(runCommand(commander, headingAc, 'a 30')[0]);
        t.true(runCommand(commander, headingAc, 'h 270')[0]);
        t.is(headingAc.vfrOrbit, null);
        t.is(headingAc.mcp.headingMode, 'HOLD');
        for (let i = 0; i < 90; i++) {
            headingAc.update();
        }
        t.is(headingAc.target.altitude, 3000);
        t.true(orbitCenter.distanceToPosition(headingAc.positionModel) > 1.5);

        // 1b. Re-entering OCTA from clear airspace restores an orbit at current altitude and syncs MCP
        const octaAc = createOrbitingVfrAircraft(airport, scope);
        octaAc.altitude = 1800;
        t.true(runCommand(commander, octaAc, 'a 25')[0]);
        t.true(runCommand(commander, octaAc, 't l 270')[0]);
        t.is(octaAc.vfrOrbit, null);
        t.is(octaAc.mcp.altitude, 2500);
        t.true(runCommand(commander, octaAc, 'octa')[0]);
        t.truthy(octaAc.vfrOrbit);
        t.is(octaAc.vfrOrbit.altitude, 1800);
        t.is(octaAc.mcp.altitude, 1800);
        t.is(octaAc.mcp.altitudeMode, 'HOLD');
        t.is(octaAc.mcp.headingMode, 'OFF');
        t.is(octaAc.target.turn, null);
        t.false(commander.run(octaAc, 'sayAssignedHeading', [])[0]);
        octaAc.update();
        t.is(octaAc.target.altitude, 1800);

        // 2. Fly present heading exits entry orbit
        const fphAc = createOrbitingVfrAircraft(airport, scope);
        t.true(runCommand(commander, fphAc, 'fph')[0]);
        t.is(fphAc.vfrOrbit, null);
        t.is(fphAc.mcp.headingMode, 'HOLD');

        // 3. Direct instruction accepts real fixes, rejects invalid/hidden fixes, and exits entry orbit
        const directAc = createOrbitingVfrAircraft(airport, scope);
        t.false(runCommand(commander, directAc, 'dct MISSING')[0]);
        t.truthy(directAc.vfrOrbit);
        t.false(runCommand(commander, directAc, 'dct _SIMIN')[0]);
        t.truthy(directAc.vfrOrbit);

        const initialDistToFix = directAc.positionModel.distanceToPosition(NavigationLibrary.findFixByName('VFRFX').positionModel);
        t.true(runCommand(commander, directAc, 'dct VFRFX')[0]);
        t.is(directAc.vfrOrbit, null);
        t.is(directAc.mcp.headingMode, 'LNAV');
        t.is(directAc.fms.currentWaypoint.name, 'VFRFX');
        for (let i = 0; i < 60; i++) {
            directAc.update();
        }
        const laterDistToFix = directAc.positionModel.distanceToPosition(NavigationLibrary.findFixByName('VFRFX').positionModel);
        t.true(laterDistToFix < initialDistToFix);

        // 3b. Direct instruction normalizes lowercase fix names in direct pilot calls
        const lowerDirectAc = createOrbitingVfrAircraft(airport, scope);
        const lowerDirectResult = lowerDirectAc.pilot.proceedDirect('vfrfx', lowerDirectAc);
        t.true(lowerDirectResult[0]);
        t.is(lowerDirectResult[1].log, 'proceed direct VFRFX');
        t.is(lowerDirectAc.vfrOrbit, null);
        t.is(lowerDirectAc.fms.currentWaypoint.name, 'VFRFX');
        t.truthy(lowerDirectAc.fms.findWaypoint('VFRFX'));

        // 3c. Reroute and visual approach instructions exit entry orbit
        const rerouteAc = createOrbitingVfrAircraft(airport, scope);
        t.true(runCommand(commander, rerouteAc, 'rr VFRFX')[0]);
        t.is(rerouteAc.vfrOrbit, null);
        t.is(rerouteAc.mcp.headingMode, 'LNAV');

        const visualAc = createOrbitingVfrAircraft(airport, scope);
        t.true(runCommand(commander, visualAc, 'vis 18')[0]);
        t.is(visualAc.vfrOrbit, null);
        t.truthy(visualAc.pilot.approachGuidance);
        t.true(visualAc.pilot.hasApproachClearance);

        // 4. Circuit instruction exits entry orbit and joins circuit
        const circuitAc = createOrbitingVfrAircraft(airport, scope);
        t.true(runCommand(commander, circuitAc, 'dw 18 r')[0]);
        t.is(circuitAc.vfrOrbit, null);
        t.truthy(circuitAc.pilot.approachGuidance);
        t.true(circuitAc.pilot.hasApproachClearance);

        // 5. Instrument / RNAV clearances remain rejected for VFR
        t.false(runCommand(commander, circuitAc, 'i 18')[0]);
        t.false(runCommand(commander, circuitAc, 'rnav VFRFX 18')[0]);
    } finally {
        TimeKeeper.getDeltaTimeForGameStateAndTimewarp = frameTime;
        prop.speech = previousSpeech;
        logStub.restore();
        NavigationLibrary.reset();
        airport.releaseWindListener();
        AirportController.reset();
    }
});

test.serial('AircraftController.createVfrArrival handles airborne commands end-to-end with STARs and reporting points', (t) => {
    const baseAirport = new AirportModel(yssy);
    const reportPos = baseAirport.positionModel.generateCoordinatesFromBearingAndDistance(0, 30);
    baseAirport.releaseWindListener();
    const yssyData = {
        ...yssy,
        vfrWaypoints: [{
            id: 'RPTPT',
            name: 'Report Point',
            airport: 'YSSY',
            region: 'YM',
            position: reportPos
        }]
    };
    const airport = new AirportModel(yssyData);
    airport.data = yssyData;
    AirportController.current = airport;
    NavigationLibrary.init(yssyData);
    const logStub = sinon.stub(UiController, 'ui_log');
    const previousSpeech = prop.speech;
    prop.speech = { enabled: false };
    const frameTime = TimeKeeper.getDeltaTimeForGameStateAndTimewarp;
    TimeKeeper.getDeltaTimeForGameStateAndTimewarp = () => 1;
    let controller = null;
    try {
        const airlines = new AirlineController([vh]);
        const scopeModel = new ScopeModel();
        controller = new AircraftController([c172], airlines, scopeModel);
        const arrivalPattern = new SpawnPatternModel(yssyData.spawnPatterns.find((p) => p.category === 'arrival'));
        const commander = new AircraftCommander();

        // Spawn a VFR arrival via AircraftController with a reporting point
        controller.createVfrArrival(arrivalPattern);
        const vfrAc = controller.aircraft.list[0];
        t.truthy(vfrAc);
        t.true(vfrAc.isControllable);
        t.true(Number.isFinite(vfrAc.positionModel.gps[0]) && Number.isFinite(vfrAc.positionModel.gps[1]));
        t.true(Number.isFinite(vfrAc.heading));
        t.truthy(vfrAc.vfrOrbit);
        t.truthy(vfrAc.vfrOrbit.reportingPoint);
        t.is(vfrAc.mcp.headingMode, 'OFF');
        t.is(vfrAc.mcp.speedMode, 'OFF');
        t.false(commander.run(vfrAc, 'sayAssignedHeading', [])[0]);
        t.false(commander.run(vfrAc, 'sayAssignedSpeed', [])[0]);
        t.true(commander.run(vfrAc, 'sayAssignedAltitude', [])[0]);

        // Altitude and speed commands via commander.runCommands keep reportingPoint & orbit
        commander.runCommands(vfrAc, new CommandParser(`${vfrAc.callsign} a 30 sp 95`).parse().args);
        t.truthy(vfrAc.vfrOrbit);
        t.truthy(vfrAc.vfrOrbit.reportingPoint);
        t.is(vfrAc.vfrOrbit.altitude, 3000);
        for (let i = 0; i < 30; i++) {
            vfrAc.update();
        }
        t.is(vfrAc.target.altitude, 3000);
        t.is(vfrAc.target.speed, 95);
        t.true(vfrAc.altitude > 1600);
        t.true(vfrAc.speed < 115);

        // Direct command exits orbit and replaces dummy IFR STAR with single-fix route
        const starFix = vfrAc.fms.waypoints.find((w) => !w.name.startsWith('_')).name;
        const starFixModel = NavigationLibrary.findFixByName(starFix);
        const distBeforeDirect = vfrAc.positionModel.distanceToPosition(starFixModel.positionModel);
        commander.runCommands(vfrAc, new CommandParser(`${vfrAc.callsign} dct ${starFix}`).parse().args);
        t.is(vfrAc.vfrOrbit, null);
        t.is(vfrAc.mcp.headingMode, 'LNAV');
        t.deepEqual(vfrAc.fms.waypoints.map((w) => w.name), [starFix]);
        for (let i = 0; i < 60; i++) {
            vfrAc.update();
        }
        t.true(vfrAc.positionModel.distanceToPosition(starFixModel.positionModel) < distBeforeDirect);

        // Heading and incremental turn commands while inbound to a reporting point exit orbit immediately
        controller.createVfrArrival(arrivalPattern);
        const headingAc = controller.aircraft.list[1];
        t.truthy(headingAc.vfrOrbit);
        t.truthy(headingAc.vfrOrbit.reportingPoint);
        commander.runCommands(headingAc, new CommandParser(`${headingAc.callsign} h 180`).parse().args);
        t.is(headingAc.vfrOrbit, null);
        t.is(headingAc.mcp.headingMode, 'HOLD');
        t.true(commander.run(headingAc, 'sayAssignedHeading', [])[0]);

        controller.createVfrArrival(arrivalPattern);
        const turnAc = controller.aircraft.list[2];
        t.truthy(turnAc.vfrOrbit);
        commander.runCommands(turnAc, new CommandParser(`${turnAc.callsign} t l 30`).parse().args);
        t.is(turnAc.vfrOrbit, null);
        t.is(turnAc.mcp.headingMode, 'HOLD');

        // Hold command on an orbiting VFR arrival clears orbit and engages LNAV
        controller.createVfrArrival(arrivalPattern);
        const holdAc = controller.aircraft.list[3];
        const holdFix = holdAc.fms.waypoints.find((w) => !w.name.startsWith('_')).name;
        const holdResult = commander.run(holdAc, 'hold', [null, null, holdFix, null]);
        t.true(holdResult[0]);
        t.is(holdAc.vfrOrbit, null);
        t.is(holdAc.mcp.headingMode, 'LNAV');
    } finally {
        if (controller) {
            controller.disable();
        }
        TimeKeeper.getDeltaTimeForGameStateAndTimewarp = frameTime;
        prop.speech = previousSpeech;
        logStub.restore();
        NavigationLibrary.reset();
        airport.releaseWindListener();
        AirportController.reset();
    }
});

test.serial('SpawnScheduler.setVfrEnabled spawns a controllable VFR arrival end-to-end', (t) => {
    const baseAirport = new AirportModel(yssy);
    const reportPos = baseAirport.positionModel.generateCoordinatesFromBearingAndDistance(0, 30);
    baseAirport.releaseWindListener();
    const yssyData = {
        ...yssy,
        vfrWaypoints: [{
            id: 'RPTPT',
            name: 'Report Point',
            airport: 'YSSY',
            region: 'YM',
            position: reportPos
        }]
    };
    const airport = new AirportModel(yssyData);
    airport.data = yssyData;
    AirportController.current = airport;
    NavigationLibrary.init(yssyData);
    SpawnPatternCollection.init(yssyData);
    const logStub = sinon.stub(UiController, 'ui_log');
    const gameIntervalStub = sinon.stub(GameController, 'game_interval').returns(['vfr-timer']);
    const destroyTimerStub = sinon.stub(GameController, 'destroyTimer');
    const previousSpeech = prop.speech;
    prop.speech = { enabled: false };
    const previousController = SpawnScheduler._aircraftController;
    let controller = null;
    try {
        const airlines = new AirlineController([vh]);
        const scopeModel = new ScopeModel();
        controller = new AircraftController([c172], airlines, scopeModel);
        const commander = new AircraftCommander();
        SpawnScheduler._aircraftController = controller;
        SpawnScheduler.setVfrEnabled(true);

        t.true(SpawnScheduler.vfrEnabled);
        t.true(gameIntervalStub.calledOnce);
        t.is(controller.aircraft.list.length, 1);
        const vfrAc = controller.aircraft.list[0];
        t.is(vfrAc.rules, 'vfr');
        t.truthy(vfrAc.vfrOrbit);
        t.true(commander.runCommands(vfrAc, new CommandParser(`${vfrAc.callsign} a 30 sp 95`).parse().args));
        t.truthy(vfrAc.vfrOrbit);
        t.is(vfrAc.vfrOrbit.altitude, 3000);
        t.true(commander.runCommands(vfrAc, new CommandParser(`${vfrAc.callsign} h 180`).parse().args));
        t.is(vfrAc.vfrOrbit, null);
        t.is(vfrAc.mcp.headingMode, 'HOLD');
    } finally {
        SpawnScheduler.setVfrEnabled(false);
        SpawnScheduler._aircraftController = previousController;
        if (controller) {
            controller.disable();
        }
        SpawnPatternCollection.reset();
        prop.speech = previousSpeech;
        destroyTimerStub.restore();
        gameIntervalStub.restore();
        logStub.restore();
        NavigationLibrary.reset();
        airport.releaseWindListener();
        AirportController.reset();
    }
});
