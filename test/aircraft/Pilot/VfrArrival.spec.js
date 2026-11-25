import test from 'ava';
import CommandParser from '../../../src/assets/scripts/client/commands/parsers/CommandParser';
import AirportModel from '../../../src/assets/scripts/client/airport/AirportModel';
import { parseAirportDat } from '../../../src/assets/scripts/client/airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../../../src/assets/scripts/client/airport/dat/buildDatScope';
import { parseAustralianAirspace } from '../../../src/assets/scripts/client/airport/dat/australianAirspace';
import { circuitPoints, vfrEntry } from '../../../src/assets/scripts/client/aircraft/Pilot/VfrArrival';

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
        t.is(surface.ceiling, airport.ctr_ceiling);
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
