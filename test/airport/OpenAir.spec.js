import test from 'ava';
import { readOpenAir } from '../../src/assets/scripts/client/airport/dat/parseOpenAir';

const base = 'AN Test\nAL 1000 FT AGL\nAH FL125\nV X=37:00 S 145:00 E\n';
const circle = 'AC C\n' + base + 'DC 5';

test('circle import retains vertical references and reports curve approximation', (t) => {
    const report = readOpenAir(circle);
    const [region] = report.regions;
    t.is(region.floor.label, '1000 FT AGL');
    t.true(region.floor.agl);
    t.is(region.ceiling.feet, 12500);
    t.true(region.poly.length >= 72);
    t.is(report.approximated, 1);
});

test('bearing arcs honour both directions', (t) => {
    const arc = (direction) => readOpenAir('AC D\n' + base + 'V D=' + direction +
        '\nDA 5,0,90\nDP 37:00 S 145:00 E').regions[0];
    const clockwise = arc('+');
    const anticlockwise = arc('-');
    t.true(clockwise.poly[1][1] > 145);
    t.true(anticlockwise.poly[1][1] < 145);
    t.true(anticlockwise.poly.length > clockwise.poly.length);
});

test('endpoint arcs retain exact endpoints and special-use airspace type', (t) => {
    const [area] = readOpenAir('AC Q\n' + base.replace('FL125', 'UNL') +
        'DB 36:55 S 145:00 E, 37:05 S 145:00 E').regions;
    t.deepEqual(area.poly[0], [-36 - 55 / 60, 145]);
    t.deepEqual(area.poly[area.poly.length - 1], [-37 - 5 / 60, 145]);
    t.is(area.airspace_class, null);
    t.is(area.type, 'Q');
    t.is(area.ceiling.feet, Infinity);
});

test('partial import preserves usable regions and explains rejected records', (t) => {
    const report = readOpenAir([circle, circle, 'AC D\n' + base + 'DC -1',
        'AC C\n' + base + 'DP 37:90 S 145:00 E', 'AC C\nAN Missing\nDC 5'].join('\n'));
    t.is(report.regions.length, 1);
    t.is(report.rejected, 4);
    t.true(report.warnings.some((warning) => warning.includes('Duplicate')));
    t.true(report.warnings.some((warning) => warning.includes('Invalid coordinate')));
});

test('self-intersecting boundaries are rejected with their region name', (t) => {
    const report = readOpenAir(circle + '\nAC D\nAN Crossed\nAL GND\nAH 5000 FT AMSL\n' +
        'DP 37 S 145 E\nDP 38 S 146 E\nDP 37 S 146 E\nDP 38 S 145 E');
    t.is(report.regions.length, 1);
    t.true(report.warnings.some((warning) => warning.includes('Crossed') && warning.includes('Self-intersecting')));
});
