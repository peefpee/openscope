import test from 'ava';
import { parseAirportDat } from '../../src/assets/scripts/client/airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../../src/assets/scripts/client/airport/dat/buildDatScope';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import SpawnPatternCollection from '../../src/assets/scripts/client/trafficGenerator/SpawnPatternCollection';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';

const thresholds = [
    'RWY:RW09L, , ,00395, , , , ;S37393870,E144492011,0000;',
    'RWY:RW27R, , ,00407, , , , ;S37394412,E144505313,0000;'
];
const leg = (sequence, fix, route = 'RW09L', path = 'TF') =>
    `SID:${sequence},4,TEST1,${route},${fix},YM,E,A, , , ,${path}, , , , , , , , ,0900, ,+,04000, , ,-,210;`;
const read = (lines) => parseAirportDat(lines.join('\r\n'), 'YMML (2).DAT');

test('keeps procedures, transitions and non-fix legs in sequence', (t) => {
    const data = read([leg('020', '', 'RW09L', 'VA'), leg('010', 'FIRST'), leg('010', 'OTHER', 'RW27R'),
        leg('010', 'FIRST').replace('SID:', 'STAR:'), leg('010', 'OTHER').replace('SID:', 'APPCH:')]);
    const { branches } = data.procedures.SID.get('TEST1');
    const { legs } = branches.get('4/RW09L');
    t.is(data.icao, 'YMML');
    t.is(branches.size, 2);
    t.deepEqual(legs.map((item) => item.path), ['TF', 'VA']);
    t.is(legs[0].altitude, '+ 04000');
    t.is(legs[0].speed, '- 210');
    t.is(legs[1].course, 90);
    t.true(data.procedures.STAR.has('TEST1'));
    t.true(data.procedures.APPCH.has('TEST1'));
});

test('pairs reciprocal runway sides, converts DMS thresholds, and loads into the simulator', (t) => {
    const data = read(thresholds);
    const scope = buildDatScope(data, resolveWaypoints(data));
    t.deepEqual(scope.runways[0].name, ['09L', '27R']);
    const [lat, lon, elevation] = scope.runways[0].end[0];
    t.true(Math.abs(lat + 37.66075) < 0.000001);
    t.true(Math.abs(lon - 144.82225278) < 0.000001);
    t.is(elevation, 395);
    const model = new AirportModel(scope);
    t.is(model.arrivalRunwayModel.name, '09L');
    t.deepEqual(model.mapCollection.getVisibleMapNames(), ['Runways']);
    model.releaseWindListener();
});

test('keeps missing fixes and vectors from bridging known segments', (t) => {
    const data = read([...thresholds, leg('010', 'FIRST'), leg('020', 'GAP'), leg('030', 'LAST'),
        leg('040', '', 'RW09L', 'VM'), leg('050', 'FINAL')]);
    const fixes = [
        '-37.6 144.8 FIRST ENRT YM 4530263',
        '-37.8 144.6 GAP WRONG YM 4530263',
        '-37.8 144.6 GAP ENRT ZZ 4530263',
        '-37.8 144.6 LAST ENRT YM 4530263',
        '-37.9 144.6 FINAL ENRT YM 4530263'
    ].join('\n');
    const resolved = resolveWaypoints(data, fixes);
    t.is(resolved.missing, 1);
    const scope = buildDatScope(data, resolved);
    t.deepEqual(scope.sids, {});
    t.is(scope.routeLabels['_SIMOUT FINAL'], 'Departure vectors');
    t.deepEqual(scope.maps[1].lines, [[...scope.runways[0].end[0].slice(0, 2), -37.6, 144.8]]);
    t.false(Object.keys(scope.fixes).includes('GAP'));
});

test('reports bad rows, allows partial previews, and rejects unrelated data', (t) => {
    const data = read([thresholds[0], thresholds[1].replace('S37394412', 'S37614412'), 'SID:invalid']);
    t.is(data.runways.size, 1);
    t.is(data.warnings.length, 2);
    t.regex(data.warnings[0], /Line 2/);
    t.is(buildDatScope(data, resolveWaypoints(data)), null);
    t.throws(() => read(['not an airport']), /No airport records/);
});

test.serial('imports a runway-only Hobart scenario with controllable arrivals and a ready departure', (t) => {
    const data = parseAirportDat([
        'RWY:RW12, , ,00012, , , , ;S42494800,E147294000,0000;',
        'RWY:RW30, , ,00014, , , , ;S42503200,E147311000,0000;'
    ].join('\n'), 'YMHB.dat');
    const scope = buildDatScope(data, resolveWaypoints(data));
    const model = new AirportModel(scope);
    AirportController.current = model;
    try {
        t.is(AirportController.airport_get('YMHB'), model);
        NavigationLibrary.init(scope);
        SpawnPatternCollection.init(scope);
        const [arrival, departure] = SpawnPatternCollection.spawnPatternModels;
        t.deepEqual(SpawnPatternCollection.getDepartureModelsForPreSpawn(), [departure]);
        t.is(arrival.preSpawnAircraftList.length, 1);
        t.is(scope.routeLabels['_SIMIN _SIMFINAL'], 'Arrival vectors');
        for (const aircraft of arrival.preSpawnAircraftList) {
            t.true(model.isPointWithinAirspace(aircraft.positionModel.relativePosition, aircraft.altitude));
        }
        // Entries always point toward the next filed fix, including the startup arrival.
        const originalRandom = Math.random;
        try {
            const headings = [0, 0.25, 0.5, 0.75].map((fraction) => {
                Math.random = () => fraction;
                const { positionModel, heading, nextFix } = arrival.createVectorArrivalEntry();
                const target = NavigationLibrary.findFixByName(nextFix).positionModel;
                t.is(heading, positionModel.bearingToPosition(target));
                t.true(model.isPointWithinAirspace(positionModel.relativePosition, 8000));
                return heading;
            });
            t.is(new Set(headings).size, 4);
        } finally {
            Math.random = originalRandom;
        }
        const routes = Array.from({ length: 8 }, () => departure.nextRouteString());
        t.is(new Set(routes.slice(0, 4)).size, 4);
        t.is(new Set(routes.slice(4)).size, 4);
        t.not(routes[3], routes[4]);
        for (const pattern of [arrival, departure]) {
            const delay = pattern.getNextDelayValue();
            t.true(Number.isFinite(delay) && delay > 0);
        }
    } finally {
        SpawnPatternCollection.reset();
        NavigationLibrary.reset();
        model.releaseWindListener();
        AirportController.reset();
    }
});

test.serial('builds flyable runway and en-route transitions, including restrictions at shared fixes', (t) => {
    const transitionLeg = (sequence, fix, transition, path) =>
        leg(sequence, fix, transition, path).replace(',4,TEST1', ',6,TEST1');
    const starLeg = (sequence, fix, branch, path) =>
        leg(sequence, fix, branch, path).replace('SID:', 'STAR:').replace(',4,TEST1', branch ? ',6,TEST2' : ',5,TEST2');
    const data = read([...thresholds, leg('010', 'FIRST'), leg('020', 'JOINT'),
        transitionLeg('010', 'JOINT', 'OUTER', 'IF').replace('+,04000', '-,08000'),
        transitionLeg('020', 'OUTER', 'OUTER', 'TF'),
        starLeg('010', 'ENTRY', '', 'IF').replace('+,04000', ' ,06000'),
        starLeg('020', 'MID', '', 'TF'), starLeg('010', 'MID', 'RW09L', 'IF'),
        starLeg('020', 'FINAL', 'RW09L', 'TF')]);
    const ids = ['FIRST', 'JOINT', 'OUTER', 'ENTRY', 'MID', 'FINAL'];
    const coordinates = ids.map((id, i) => `-37.${63 + i} 144.80 ${id} ENRT YM 4530263`).join('\n');
    const scope = buildDatScope(data, resolveWaypoints(data, coordinates));
    t.deepEqual(scope.spawnPatterns.map((pattern) => pattern.route), ['ENTRY.TEST2.YMML09L', 'YMML09L.TEST1.OUTER']);
    t.deepEqual(scope.routeLabels, {});
    t.false(Object.keys(scope.fixes).some((fix) => fix.startsWith('_SIM')));
    t.truthy(scope.spawnPatterns.every((pattern) => pattern.airlines.some(([fleet]) => fleet === 'jst/domestic')));
    t.is(scope.spawnPatterns[0].altitude, 6000);

    const model = new AirportModel(scope);
    AirportController.current = model;
    try {
        NavigationLibrary.init(scope);
        SpawnPatternCollection.init(scope);
        const sid = NavigationLibrary.getProcedure('TEST1');
        const fixes = sid.getWaypointModelsForEntryAndExit('YMML09L', 'OUTER');
        t.false(sid.hasEntry('YMML27R'));
        t.deepEqual(fixes.map((fix) => fix.name), ['FIRST', 'JOINT', 'OUTER']);
        t.is(fixes[1].altitudeMinimum, 4000);
        t.is(fixes[1].altitudeMaximum, 8000);
        t.is(fixes[1].speedMaximum, 210);
        const star = NavigationLibrary.getProcedure('TEST2');
        const arrival = star.getWaypointModelsForEntryAndExit('ENTRY', 'YMML09L');
        t.deepEqual(arrival.map((fix) => fix.name), ['ENTRY', 'MID', 'FINAL']);
        t.is(SpawnPatternCollection.spawnPatternModels[0].preSpawnAircraftList.length, 1);
    } finally {
        SpawnPatternCollection.reset();
        NavigationLibrary.reset();
        model.releaseWindListener();
        AirportController.reset();
    }
});

test('uses departure vectors when a SID has only one positioned fix', (t) => {
    const data = read([...thresholds, leg('010', 'FIRST')]);
    const scope = buildDatScope(data, resolveWaypoints(data, '-37.63 144.80 FIRST ENRT YM 4530263'));
    t.truthy(scope.sids.TEST1);
    const departure = scope.spawnPatterns.find((pattern) => pattern.category === 'departure');
    t.deepEqual(departure.outboundRoutes, ['_SIMOUT..EXITN', '_SIMOUT..EXITE', '_SIMOUT..EXITS', '_SIMOUT..EXITW']);
    t.is(scope.routeLabels['_SIMOUT EXITN'], 'Departure vectors');
});

test.serial('imports an RNAV transition through the MAP and filters shared and nearby fixes independently', (t) => {
    const approach = (sequence, fix, branch, flag, path) => leg(sequence, fix, branch, path)
        .replace('SID:', 'APPCH:').replace(',4,TEST1', branch ? ',A,R09L' : ',R,R09L')
        .replace(',E,A, ,', `,E,A,${flag},`);
    const data = read([...thresholds, leg('010', 'SHARE'),
        approach('010', 'SHARE', 'SHARE', 'E  A', 'IF'), approach('020', 'JOIN', 'SHARE', 'E   ', 'TF'),
        approach('010', 'JOIN', '', 'E  I', 'IF'), approach('020', 'FAFIX', '', 'E  F', 'TF'),
        approach('030', 'MAPFX', '', 'EY M', 'TF'), approach('040', 'AFTER', '', 'E M ', 'DF')]);
    const names = ['SHARE', 'JOIN', 'FAFIX', 'MAPFX', 'AFTER', 'OTHER'];
    const text = [...names.map((name, i) => `-37.65 144.${60 + i} ${name} ENRT YM 4530263`),
        '-32.00 144.60 FARAWAY ENRT YM 4530263'].join('\n');
    const scope = buildDatScope(data, resolveWaypoints(data, text));
    t.deepEqual(scope.rnavApproaches[1].points.map((point) => point.name), ['SHARE', 'JOIN', 'FAFIX', 'MAPFX']);
    NavigationLibrary.init(scope);
    try {
        t.true(NavigationLibrary.isFixVisible('SHARE', { procedure: true }));
        t.true(NavigationLibrary.isFixVisible('SHARE', { approach: true }));
        t.falsy(NavigationLibrary.isFixVisible('SHARE', { other: true }));
        t.falsy(NavigationLibrary.isFixVisible('FAFIX', { procedure: true }));
        t.true(NavigationLibrary.isFixVisible('OTHER', { other: true }));
        t.truthy(scope.fixes.OTHER);
        t.falsy(scope.fixes.FARAWAY);
    } finally {
        NavigationLibrary.reset();
    }
});

test.serial('reserves visual reporting points and keeps them out of instrument procedures and vector routes', (t) => {
    const data = read([...thresholds, leg('010', 'OLD'), leg('020', 'RIVER')]);
    const resolved = resolveWaypoints(data, [
        '-37.6 144.8 OLD ENRT YM', // Legacy format, explicitly used by the instrument procedure
        '-37.8 144.8 RIVER ENRT YM 2105430 River Crossing',
        '-37.7 144.8 EXITN YMML YM 2105430 North Gate',
        '-37.8 144.8 SPARE ENRT YM', // No type or instrument procedure
        '-37.9 144.8 ERROR ENRT YM 16777216',
        '-39.5 144.8 FAR ENRT YM 2105430 Distant Town',
        '-37.6 144.8 LOCAL YOTH YM 2105430 Another Airport'
    ].join('\n'));
    const scope = buildDatScope(data, resolved);
    t.deepEqual(scope.vfrWaypoints, [
        { id: 'RIVER', name: 'River Crossing', airport: 'ENRT', region: 'YM', position: [-37.8, 144.8] },
        { id: 'EXITN', name: 'North Gate', airport: 'YMML', region: 'YM', position: [-37.7, 144.8] }
    ]);
    t.is(resolved.missing, 1);
    t.deepEqual(scope.sids, {});
    t.deepEqual([...resolved.enrouteNames], ['OLD']);
    const departure = scope.spawnPatterns.find((pattern) => pattern.category === 'departure');
    t.true(departure.outboundRoutes.includes('_SIMOUT..EXITNX'));
    NavigationLibrary.init(scope);
    try {
        t.truthy(NavigationLibrary.findFixByName('OLD'));
        for (const name of ['RIVER', 'EXITN', 'SPARE', 'ERROR']) {
            t.is(NavigationLibrary.findFixByName(name), null);
        }
    } finally {
        NavigationLibrary.reset();
    }
});
