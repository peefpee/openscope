import test from 'ava';
import AirspaceIndex, { authorised } from '../../src/assets/scripts/client/airport/AirspaceIndex';

function rectangle(left, right, floor, ceiling, source, classification) {
    return {
        bounds: [left, -1, right, 1],
        relativePoly: [[left, -1], [right, -1], [right, 1], [left, 1]],
        altitudeLimitsAt: () => [floor, ceiling],
        isPointInside: ([x, y], alt) => x >= left && x <= right && Math.abs(y) <= 1 && alt >= floor && alt <= ceiling,
        airspace_class: classification,
        source
    };
}

test('a route crossing a narrow polygon and a thin altitude band sees both', (t) => {
    const narrow = rectangle(20.005, 20.015, 0, 1000, 'imported', 'C');
    const thin = rectangle(-1, 50, 510, 511, 'imported', 'D');
    const index = new AirspaceIndex([narrow, thin]);
    t.deepEqual(new Set(index.along([[0, 0], [40, 0]], [0, 1000])), new Set([narrow, thin]));
    t.deepEqual(index.along([[0, 0], [40, 0]], 1001), []);
});

test('imported Class G wins within its band and preserves overlapping restricted airspace', (t) => {
    const fallback = rectangle(0, 10, 0, 3000, 'simulated', 'C');
    const corridor = rectangle(2, 8, 100, 1000, 'imported', 'G');
    const restricted = { ...corridor, type: 'R', airspace_class: null };
    const index = new AirspaceIndex([fallback, corridor, restricted]);
    t.deepEqual(index.at([4, 0], 500), [corridor, restricted]);
    t.deepEqual(index.at([4, 0], 1100), [fallback]);
});

test('entry permission is limited by jurisdiction, predicted altitude and type', (t) => {
    const airport = { icao: 'ytes', controllerConfig: { tower: [] } };
    const aircraft = { rules: 'vfr', altitude: 1500, entryClearance: { airport: 'ytes', ceiling: 2500 } };
    const area = { type: 'CTA', airspace_class: 'C' };
    t.true(authorised(aircraft, area, airport, 2500));
    t.false(authorised(aircraft, area, airport, 2501));
    t.false(authorised(aircraft, { ...area, type: 'P' }, airport, 1000));
    t.false(authorised(aircraft, { ...area, airspace_class: 'A' }, airport, 1000));
    t.false(authorised(aircraft, area, { ...airport, icao: 'yoth' }, 1000));
    aircraft.octaRequired = true;
    t.false(authorised(aircraft, area, airport, 1000));
});
