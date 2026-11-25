import test from 'ava';
import parseMsaDat from '../../src/assets/scripts/client/airport/dat/parseMsaDat';

test('reads clockwise MSA sectors across north with a separate radius per altitude', (t) => {
    const data = parseMsaDat([
        'I', '1150 Version', '', '3 BCN ZZ ZAAA M 270 064 25 000 030 15 000 000 0',
        '1 ZAAA ZZ ZAAA T 180 017 20 000 000 0', '11 POINT ZZ ZBBB M 090 045 25 000 000 0', '99'
    ].join('\r\n'));
    t.deepEqual(data.ZAAA[0], { id: 'BCN', type: 'VHF navaid', region: 'ZZ', reference: 'M',
        sectors: [{ bearing: 270, altitude: 6400, radius: 25 }, { bearing: 0, altitude: 3000, radius: 15 }] });
    t.is(data.ZAAA[1].reference, 'T');
    t.is(data.ZAAA[1].sectors.length, 1);
    t.is(data.ZBBB[0].id, 'POINT');
});

test('skips entire malformed MSA rows and rejects a file without usable records', (t) => {
    const broken = [
        '3 BCN ZZ ZAAA M 090 035 25',
        '2 BAD ZZ ZBBB M 010 035 25 390 090 35 000 000 0',
        '1 ZBBB ZZ ZBBB M 000 040 0 000 000 0'
    ].join('\n');
    t.throws(() => parseMsaDat(broken), /No valid sectors/);
    t.deepEqual(Object.keys(parseMsaDat(`${broken}\n1 ZCCC ZZ ZCCC T 180 042 25 000 000 0`)), ['ZCCC']);
});
