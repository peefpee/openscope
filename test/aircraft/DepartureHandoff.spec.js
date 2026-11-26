import test from 'ava';
import sinon from 'sinon';
import AircraftCommander from '../../src/assets/scripts/client/aircraft/AircraftCommander';
import { MCP_MODE } from '../../src/assets/scripts/client/aircraft/ModeControl/modeControlConstants';
import AircraftModel from '../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftTypeDefinitionModel from '../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import { buildDatScope, resolveWaypoints } from '../../src/assets/scripts/client/airport/dat/buildDatScope';
import { parseAirportDat } from '../../src/assets/scripts/client/airport/dat/parseAirportDat';
import CommandParser from '../../src/assets/scripts/client/commands/parsers/CommandParser';
import { AIRCRAFT_EVENT } from '../../src/assets/scripts/client/constants/eventNames';
import TimeKeeper from '../../src/assets/scripts/client/engine/TimeKeeper';
import EventBus from '../../src/assets/scripts/client/lib/EventBus';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import UiController from '../../src/assets/scripts/client/ui/UiController';
import a320 from '../../assets/aircraft/a320.json';

function createDatAirportFixture(filename) {
    const data = parseAirportDat([
        'RWY:RW18, , ,00010, , , , ;S37000000,E145000000,0000;',
        'RWY:RW36, , ,00010, , , , ;S37010000,E145000000,0000;'
    ].join('\n'), filename);
    const scope = buildDatScope(data, resolveWaypoints(data, [
        '-37.9 145 EXITX ENRT YM 4530263', '-38 145.1 EXITY ENRT YM 4530263', '-37.4 145 INNER ENRT YM 4530263',
        '-37.91 145 RIVER ENRT YM 2105430 River Crossing'
    ].join('\n')));

    return scope;
}

test.serial('departures track the selected outbound and transfer ownership once', (t) => {
    const uiLogStub = sinon.stub(UiController, 'ui_log');
    const commander = new AircraftCommander();
    const frameTime = TimeKeeper.getDeltaTimeForGameStateAndTimewarp;
    TimeKeeper.getDeltaTimeForGameStateAndTimewarp = () => 1;
    const handoffs = [];
    const recordExit = (plane) => handoffs.push(plane);
    EventBus.on(AIRCRAFT_EVENT.AIRSPACE_EXIT, recordExit);
    try {
        for (const manual of [false, true]) {
            const icao = manual ? 'YTES' : 'KTES';
            const scope = createDatAirportFixture(`${icao}.dat`);
            const departure = scope.spawnPatterns.find((p) => p.category === 'departure');
            t.deepEqual(departure.outboundRoutes, ['_SIMOUT..EXITX', '_SIMOUT..EXITY']);
            const airport = new AirportModel(scope);
            airport.data = scope;
            AirportController.current = airport;
            NavigationLibrary.init(scope);
            const runway = airport.departureRunwayModel;

            const plane = new AircraftModel({
                airline: 'jst',
                callsign: '22',
                airlineCallsign: 'jetstar',
                category: 'departure',
                origin: icao,
                destination: '',
                altitude: 10,
                speed: 0,
                heading: runway.angle,
                model: new AircraftTypeDefinitionModel(a320),
                positionModel: runway.positionModel.generateDynamicPositionFromBearingAndDistance(0, 0),
                routeString: departure.outboundRoutes[0],
                vectors: departure.vectors
            });
            const transmit = (text) => {
                const [name, ...args] = new CommandParser(`jst22 ${text}`).parse().args[0];
                return commander.run(plane, name, args)[0];
            };
            t.false(transmit('outbound MISSING'));
            t.false(transmit('outbound RIVER'));
            t.regex(plane.getViewModel().flightPlan, /OUT EXITX$/);
            t.false(transmit('centre'));
            if (manual) {
                t.true(transmit('outbound EXITY'));
                t.deepEqual(plane.fms.waypoints.map((point) => point.name), ['_SIMOUT', 'EXITY']);
            }
            plane.takeoff(runway);
            t.is(plane.mcp.headingMode, MCP_MODE.HEADING.HOLD);
            t.is(plane.mcp.heading, runway.angle);
            for (let i = 0; i < 1400 && !plane.transferredToCentre; i++) {
                plane.update();
                if (airport.towerController && airport.towerController.shouldDepartureContactPlayer(plane)) {
                    airport.towerController.transferDepartureToPlayer(plane);
                }
                if (!manual && i === 370) {
                    t.true(plane.positionModel.distanceToPosition(runway.positionModel) > 12);
                    t.is(plane.mcp.headingMode, MCP_MODE.HEADING.HOLD);
                    t.false(transmit('centre'));
                    t.false(transmit('direct RIVER'));
                    t.true(transmit('direct EXITX'));
                }
                if (manual && i === 130) {
                    t.true(transmit('h 270'));
                    t.false(transmit('centre'));
                    t.true(transmit('outbound INNER'));
                    t.is(plane.fms.currentWaypoint.name, 'INNER');
                }
                if (manual && plane.isTrackingOutbound()) {
                    plane.projected = true;
                    t.false(plane.transferToCentre());
                    plane.projected = false;
                    t.true(transmit('center'));
                }
            }
            t.true(plane.transferredToCentre);
            t.false(plane.isControllable);
            if (!manual) {
                t.true(plane.isRemovable);
            } else {
                // Transferred Australian departures remain physically simulated while inside controlled airspace
                t.false(plane.isRemovable);
                for (let i = 0; i < 1400 && plane.isInsideAirspace(airport); i++) {
                    plane.update();
                }
                t.false(plane.isInsideAirspace(airport));
                t.true(plane.isRemovable);
            }
            t.false(plane.transferToCentre());
            plane._updateAircraftControllability();
            t.false(plane.isControllable);
            t.is(handoffs.filter((flight) => flight === plane).length, 1);

            airport.releaseWindListener();
            NavigationLibrary.reset();
            AirportController.reset();
        }
    } finally {
        uiLogStub.restore();
        EventBus.off(AIRCRAFT_EVENT.AIRSPACE_EXIT, recordExit);
        TimeKeeper.getDeltaTimeForGameStateAndTimewarp = frameTime;
        NavigationLibrary.reset();
        AirportController.reset();
    }
});

test.serial('Australian departures do not silently auto-transfer when passing outbound fix', (t) => {
    const uiLogStub = sinon.stub(UiController, 'ui_log');
    const scope = createDatAirportFixture('YTES.dat');
    const departure = scope.spawnPatterns.find((p) => p.category === 'departure');
    const airport = new AirportModel(scope);
    airport.data = scope;
    AirportController.current = airport;
    NavigationLibrary.init(scope);
    const runway = airport.departureRunwayModel;
    const commander = new AircraftCommander();
    const frameTime = TimeKeeper.getDeltaTimeForGameStateAndTimewarp;
    TimeKeeper.getDeltaTimeForGameStateAndTimewarp = () => 1;
    const handoffs = [];
    const recordExit = (plane) => handoffs.push(plane);
    EventBus.on(AIRCRAFT_EVENT.AIRSPACE_EXIT, recordExit);
    try {
        const plane = new AircraftModel({
            airline: 'jst',
            callsign: '23',
            airlineCallsign: 'jetstar',
            category: 'departure',
            origin: 'YTES',
            destination: '',
            altitude: 10,
            speed: 0,
            heading: runway.angle,
            model: new AircraftTypeDefinitionModel(a320),
            positionModel: runway.positionModel.generateDynamicPositionFromBearingAndDistance(0, 0),
            routeString: departure.outboundRoutes[0],
            vectors: departure.vectors
        });
        const transmit = (text) => {
            const [name, ...args] = new CommandParser(`jst23 ${text}`).parse().args[0];
            return commander.run(plane, name, args)[0];
        };
        plane.takeoff(runway);
        let passedOutboundFix = false;
        for (let i = 0; i < 1400; i++) {
            plane.update();
            if (airport.towerController && airport.towerController.shouldDepartureContactPlayer(plane)) {
                airport.towerController.transferDepartureToPlayer(plane);
            }
            if (i === 370) {
                t.true(transmit('direct EXITX'));
            }
            if (i > 370 && !plane.fms.currentWaypoint) {
                passedOutboundFix = true;
                break;
            }
        }
        t.true(passedOutboundFix || plane.positionModel.distanceToPosition(runway.positionModel) > 45);
        t.false(plane.transferredToCentre);
        t.true(plane.isControllable);
        t.true(plane.isPlayerControlled());
        t.is(handoffs.length, 0);
    } finally {
        uiLogStub.restore();
        EventBus.off(AIRCRAFT_EVENT.AIRSPACE_EXIT, recordExit);
        TimeKeeper.getDeltaTimeForGameStateAndTimewarp = frameTime;
        airport.releaseWindListener();
        NavigationLibrary.reset();
        AirportController.reset();
    }
});
