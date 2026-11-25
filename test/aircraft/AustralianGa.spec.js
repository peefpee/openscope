import test from 'ava';
import sinon from 'sinon';
import AircraftCommander from '../../src/assets/scripts/client/aircraft/AircraftCommander';
import AircraftController from '../../src/assets/scripts/client/aircraft/AircraftController';
import AircraftModel from '../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftTypeDefinitionModel from '../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import AirlineController from '../../src/assets/scripts/client/airline/AirlineController';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import { buildDatScope, resolveWaypoints } from '../../src/assets/scripts/client/airport/dat/buildDatScope';
import { parseAirportDat } from '../../src/assets/scripts/client/airport/dat/parseAirportDat';
import CommandParser from '../../src/assets/scripts/client/commands/parsers/CommandParser';
import UiController from '../../src/assets/scripts/client/ui/UiController';
import vh from '../../assets/airlines/vh.json';
import c172 from '../../assets/aircraft/c172.json';

function scenario(icao) {
    const data = parseAirportDat([
        'RWY:RW18, , ,00010, , , , ;S37000000,E145000000,0000;',
        'RWY:RW36, , ,00010, , , , ;S37010000,E145000000,0000;'
    ].join('\n'), `${icao}.dat`);
    return buildDatScope(data, resolveWaypoints(data));
}

test('Australian vector arrivals and departures can spawn light GA', (t) => {
    for (const stream of scenario('YMHB').spawnPatterns) {
        t.true(stream.airlines.some(([fleet, weight]) => fleet === 'vh/lightGA' && weight > 0));
    }
    for (const stream of scenario('NZAA').spawnPatterns) {
        t.false(stream.airlines.some(([fleet]) => fleet.startsWith('vh/')));
    }
});

test.serial('registration and suffix command the same aircraft and produce suffix-only readbacks', (t) => {
    const scope = scenario('YMHB');
    const airport = new AirportModel(scope);
    airport.data = scope;
    AirportController.current = airport;
    NavigationLibrary.init(scope);
    const log = sinon.stub(UiController, 'ui_log');
    const previousSpeech = prop.speech;
    prop.speech = { enabled: false };
    try {
        const airlines = new AirlineController([vh]);
        const operator = airlines.findAirlineById('vh');
        const suffix = airlines.generateFlightNumberWithAirlineModel(operator);
        t.regex(suffix, /^[a-z]{3}$/);
        const runway = airport.departureRunwayModel;
        const plane = new AircraftModel({
            callsign: suffix, airline: operator.icao, airlineCallsign: operator.radioName,
            model: new AircraftTypeDefinitionModel(c172), transponderCode: 1234, origin: 'YMHB', destination: '',
            heading: runway.angle, altitude: 10, speed: 0, category: 'departure', vectors: true,
            positionModel: runway.positionModel.generateDynamicPositionFromBearingAndDistance(0, 0),
            routeString: scope.spawnPatterns[1].route
        });
        const registration = `VH${suffix.toUpperCase()}`;
        t.is(plane.getViewModel().callsign, registration);
        const controller = Object.create(AircraftController.prototype);
        controller.aircraft = { list: [plane] };
        controller._airlineController = airlines;
        const commander = new AircraftCommander();
        for (const address of [registration, suffix]) {
            const parsed = new CommandParser(`${address} sh`).parse();
            t.true(plane.matchCallsign(parsed.callsign));
            t.is(controller.findAircraftByCallsign(parsed.callsign), plane);
            commander.runCommands(plane, parsed.args);
            t.true(log.lastCall.args[0].startsWith(`${suffix.toUpperCase()},`));
        }
        controller.removeFlightNumberFromList(plane);
        t.false(airlines.flightNumbers.includes(suffix));
        plane.flightNumber = 'abc';
        t.is(plane.getRadioCallsign(), 'alpha bravo charlie');
    } finally {
        prop.speech = previousSpeech;
        log.restore();
        NavigationLibrary.reset();
        airport.releaseWindListener();
        AirportController.reset();
    }
});
