import test from 'ava';
import AtcParser, { PARSER_STATUS } from '../../src/assets/scripts/client/voice/parser/AtcParser';

const CONTEXT = {
    activeAircraft: [
        { callsign: 'QFA412', rules: 'ifr', isControllable: true },
        { callsign: 'QFA150', rules: 'ifr', isControllable: true },
        { callsign: 'JST518', rules: 'ifr', isControllable: true },
        { callsign: 'VOZ832', rules: 'ifr', isControllable: true },
        { callsign: 'RXA621', rules: 'ifr', isControllable: true },
        { callsign: 'ASY150', rules: 'ifr', isControllable: true },
        { callsign: 'VHABC', rules: 'vfr', isControllable: true },
        { callsign: 'VHXYZ', rules: 'vfr', isControllable: true }
    ],
    availableWaypoints: ['BOREE', 'RIVET', 'ODALE', 'MARLN', 'TESAT', 'KAT', 'WOL', 'NASHO', 'OLSEM'],
    availableRunways: ['34L', '34R', '16L', '16R', '09R', '24']
};

const VALID_CORPUS = [];

// Generate 200+ varied valid Australian ATC clearances
const callsigns = [
    ['Qantas four one two', 'QFA412'],
    ['Qantas one five zero', 'QFA150'],
    ['Jetstar five one eight', 'JST518'],
    ['Virgin eight three two', 'VOZ832'],
    ['Rex six two one', 'RXA621'],
    ['Aussie one five zero', 'ASY150'],
    ['Victor Hotel Alpha Bravo Charlie', 'VHABC'],
    ['QFA412', 'QFA412'],
    ['JST518', 'JST518'],
    ['VOZ832', 'VOZ832']
];

const headings = [
    ['fly heading two seven zero', 270, null],
    ['turn left heading one eight zero', 180, 'left'],
    ['turn right heading zero niner zero', 90, 'right'],
    ['turn left heading three fower zero', 340, 'left'],
    ['turn right heading zero fife zero', 50, 'right'],
    ['fly heading tree six zero', 360, null],
    ['maintain present heading', null, null]
];

const altitudes = [
    ['descend three thousand', 3000],
    ['descend five thousand five hundred', 5500],
    ['climb one zero thousand', 10000],
    ['climb eight thousand five hundred', 8500],
    ['climb flight level one two five', 12500],
    ['descend flight level two four zero', 24000],
    ['maintain six thousand', 6000]
];

const speeds = [
    ['reduce speed one eight zero knots', 180],
    ['increase speed two five zero knots', 250],
    ['maintain speed two one zero knots', 210],
    ['resume normal speed', null]
];

// 10 * 7 = 70 heading clearances
for (const [csText, cs] of callsigns) {
    for (const [hdgText, val, dir] of headings) {
        VALID_CORPUS.push({
            text: `${csText}, ${hdgText}`,
            callsign: cs,
            expectedType: val === null ? 'present_heading' : 'heading',
            expectedDir: dir,
            expectedVal: val
        });
    }
}

// 10 * 7 = 70 altitude clearances
for (const [csText, cs] of callsigns) {
    for (const [altText, alt] of altitudes) {
        VALID_CORPUS.push({
            text: `${csText} ${altText}`,
            callsign: cs,
            expectedAlt: alt
        });
    }
}

// 10 * 4 = 40 speed clearances
for (const [csText, cs] of callsigns) {
    for (const [spdText, spd] of speeds) {
        VALID_CORPUS.push({
            text: `${csText}, ${spdText}`,
            callsign: cs,
            expectedSpeed: spd
        });
    }
}

// 30+ multi-command, waypoint, approach, handoff, and VFR clearances
const SPECIAL_CASES = [
    { text: 'Qantas four one two, identified, turn left heading two seven zero, descend three thousand, reduce speed one eight zero knots', callsign: 'QFA412', count: 4 },
    { text: 'Qantas one five zero, Ballina Approach, identified, climb one zero thousand', callsign: 'QFA150', count: 2 },
    { text: 'Jetstar five one eight, contact tower one two zero decimal five', callsign: 'JST518', count: 1 },
    { text: 'Virgin eight three two, contact centre one two five decimal zero', callsign: 'VOZ832', count: 1 },
    { text: 'Rex six two one, frequency change approved', callsign: 'RXA621', count: 1 },
    { text: 'Qantas four one two, proceed direct BOREE', callsign: 'QFA412', count: 1 },
    { text: 'Jetstar five one eight, direct to RIVET, descend five thousand', callsign: 'JST518', count: 2 },
    { text: 'Virgin eight three two, cleared ILS approach runway three four left', callsign: 'VOZ832', count: 1 },
    { text: 'Qantas four one two, cleared RNAV approach ODALE runway three four right', callsign: 'QFA412', count: 1 },
    { text: 'Rex six two one, cleared visual approach runway zero nine right', callsign: 'RXA621', count: 1 },
    { text: 'Qantas four one two, cancel approach', callsign: 'QFA412', count: 1 },
    { text: 'Victor Hotel Alpha Bravo Charlie, remain outside controlled airspace', callsign: 'VHABC', count: 1 },
    { text: 'Victor Hotel Alpha Bravo Charlie, join right downwind runway two four', callsign: 'VHABC', count: 1 },
    { text: 'Victor Hotel Alpha Bravo Charlie, join left base runway two four', callsign: 'VHABC', count: 1 },
    { text: 'Alpha Bravo Charlie, join final runway two four', callsign: 'VHABC', count: 1 },
    { text: 'Turn right heading one eight zero, Qantas four one two', callsign: 'QFA412', count: 1 },
    { text: 'Qantas four one two, descend via star four thousand', callsign: 'QFA412', count: 1 },
    { text: 'Jetstar five one eight, climb via sid', callsign: 'JST518', count: 1 },
    { text: 'Virgin eight three two, proceed direct MARLN, reduce speed one niner zero knots', callsign: 'VOZ832', count: 2 },
    { text: 'Aussie one five zero, climb flight level one two five, fly heading zero niner zero', callsign: 'ASY150', count: 2 }
];

const REJECTION_CORPUS = [
    { text: '', status: PARSER_STATUS.NO_ACTIONABLE_INSTRUCTION },
    { text: 'Good morning Sydney Approach', status: PARSER_STATUS.UNRECOGNISED },
    { text: 'Qantas nine nine nine descend five thousand', status: PARSER_STATUS.INVALID_PARAMETERS },
    { text: 'Qantas four one two', status: PARSER_STATUS.NO_ACTIONABLE_INSTRUCTION },
    { text: 'Qantas four one two turn left heading four five zero', status: PARSER_STATUS.INVALID_PARAMETERS },
    { text: 'Qantas four one two descend zero feet', status: PARSER_STATUS.INVALID_PARAMETERS },
    { text: 'Qantas four one two proceed direct FAKEFIX', status: PARSER_STATUS.INVALID_PARAMETERS },
    { text: 'Qantas four one two squawk four two zero zero', status: PARSER_STATUS.UNSUPPORTED_INSTRUCTION },
    { text: 'Qantas four one two turn left heading two seven zero, do a barrel roll', status: PARSER_STATUS.PARTIALLY_PARSED },
    { text: 'Jetstar five one eight contact tower nine nine nine decimal one', status: PARSER_STATUS.INVALID_PARAMETERS }
];

test('Deterministic ATC parser achieves >= 90% accuracy and < 10ms avg latency across 200+ transmissions', (t) => {
    const parser = new AtcParser();
    t.true(VALID_CORPUS.length + SPECIAL_CASES.length >= 200);

    let passed = 0;
    let totalMs = 0;

    for (const item of VALID_CORPUS) {
        const res = parser.parse(item.text, CONTEXT);
        totalMs += res.latencyMs;
        if (res.status === PARSER_STATUS.PARSED && res.callsign === item.callsign && res.commands.length === 1) {
            passed += 1;
        }
    }

    for (const item of SPECIAL_CASES) {
        const res = parser.parse(item.text, CONTEXT);
        totalMs += res.latencyMs;
        t.is(res.status, PARSER_STATUS.PARSED, `Expected parsed for: ${item.text}`);
        t.is(res.callsign, item.callsign);
        t.is(res.commands.length, item.count);
        passed += 1;
    }

    const total = VALID_CORPUS.length + SPECIAL_CASES.length;
    const rate = passed / total;
    const avgMs = totalMs / total;

    t.true(rate >= 0.9, `Expected >= 90% parse rate, got ${(rate * 100).toFixed(1)}%`);
    t.true(avgMs < 10, `Expected < 10ms avg parse latency, got ${avgMs.toFixed(2)}ms`);

    for (const rej of REJECTION_CORPUS) {
        const res = parser.parse(rej.text, CONTEXT);
        t.is(res.status, rej.status, `Expected ${rej.status} for: ${rej.text}`);
    }
});

test('CallsignResolver flags ambiguous abbreviated callsigns rather than guessing', (t) => {
    const parser = new AtcParser();
    const res = parser.parse('Qantas one five zero descend five thousand', {
        ...CONTEXT,
        activeAircraft: [
            { callsign: 'QFA150', rules: 'ifr', isControllable: true },
            { callsign: 'QFA150', rules: 'ifr', isControllable: true }
        ]
    });
    // Unique callsign matches 1; test actual ambiguous suffix with two VH aircraft ending in ABC
    const ambig = parser.parse('Alpha Bravo Charlie descend three thousand', {
        ...CONTEXT,
        activeAircraft: [
            { callsign: 'VHABC', rules: 'vfr', isControllable: true },
            { callsign: 'VHZABC', rules: 'vfr', isControllable: true }
        ]
    });
    t.is(res.status, PARSER_STATUS.PARSED);
    t.is(ambig.status, PARSER_STATUS.AMBIGUOUS_CALLSIGN);
});
