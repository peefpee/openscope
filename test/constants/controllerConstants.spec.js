import test from 'ava';
import {
    CONTROLLER_TYPE,
    PLAYER_CONTROLLED_TYPES,
    HANDOFF_STATE,
    FREQUENCY_SOURCE,
    HANDOFF_THRESHOLDS_NM,
    DEPARTURE_CONTACT_ALTITUDE_AGL,
    DEPARTURE_CONTACT_MIN_AGL,
    HANDOFF_REMINDER_COOLDOWN_S,
    frequencyToKhz,
    normalizeFrequency,
    frequenciesEqual,
    isValidFrequency,
    isAustralianAirport
} from '../../src/assets/scripts/client/constants/controllerConstants';
import { EVENT, AIRCRAFT_EVENT } from '../../src/assets/scripts/client/constants/eventNames';

test('exports required controller constants and event names', (t) => {
    t.is(CONTROLLER_TYPE.TWR, 'TWR');
    t.is(CONTROLLER_TYPE.APP, 'APP');
    t.is(CONTROLLER_TYPE.DEP, 'DEP');
    t.is(CONTROLLER_TYPE.CTR, 'CTR');
    t.is(CONTROLLER_TYPE.UNICOM, 'UNICOM');
    t.is(CONTROLLER_TYPE.NONE, 'NONE');

    t.true(PLAYER_CONTROLLED_TYPES.has(CONTROLLER_TYPE.APP));
    t.true(PLAYER_CONTROLLED_TYPES.has(CONTROLLER_TYPE.DEP));
    t.false(PLAYER_CONTROLLED_TYPES.has(CONTROLLER_TYPE.TWR));
    t.false(PLAYER_CONTROLLED_TYPES.has(CONTROLLER_TYPE.CTR));

    t.is(HANDOFF_STATE.NONE, 'NONE');
    t.is(HANDOFF_STATE.REQUIRED, 'REQUIRED');
    t.is(HANDOFF_STATE.INITIATED, 'INITIATED');
    t.is(HANDOFF_STATE.COMPLETED, 'COMPLETED');
    t.is(HANDOFF_STATE.OVERDUE, 'OVERDUE');
    t.is(HANDOFF_STATE.RELEASED, 'RELEASED');

    t.is(FREQUENCY_SOURCE.PUBLISHED, 'published');
    t.is(FREQUENCY_SOURCE.SIMULATED, 'simulated');
    t.is(FREQUENCY_SOURCE.USER, 'user');

    t.is(HANDOFF_THRESHOLDS_NM.RECOMMENDED, 12);
    t.is(HANDOFF_THRESHOLDS_NM.URGENT, 6);
    t.is(HANDOFF_THRESHOLDS_NM.MANDATORY, 2);
    t.is(DEPARTURE_CONTACT_ALTITUDE_AGL, 1500);
    t.is(DEPARTURE_CONTACT_MIN_AGL, 500);
    t.is(HANDOFF_REMINDER_COOLDOWN_S, 30);

    t.is(EVENT.CONTROLLER_CONFIG_CHANGED, 'controller-config-changed');
    t.is(AIRCRAFT_EVENT.TOWER_HANDOFF, 'tower-handoff');
    t.is(AIRCRAFT_EVENT.CENTRE_HANDOFF, 'centre-handoff');
    t.is(AIRCRAFT_EVENT.FREQ_CHANGE_APPROVED, 'freq-change-approved');
    t.is(AIRCRAFT_EVENT.MISSED_TOWER_HANDOFF, 'missed-tower-handoff');
    t.is(AIRCRAFT_EVENT.MISSED_CENTRE_HANDOFF, 'missed-centre-handoff');
    t.is(AIRCRAFT_EVENT.VFR_AIRSPACE_INFRINGEMENT, 'vfr-airspace-infringement');
    t.is(AIRCRAFT_EVENT.INVALID_FCA_RELEASE, 'invalid-fca-release');
});

test('normalizeFrequency, frequencyToKhz, and isValidFrequency handle valid VHF COM frequencies', (t) => {
    t.is(normalizeFrequency('120.5'), '120.500');
    t.is(normalizeFrequency('120.50'), '120.500');
    t.is(normalizeFrequency('120.500'), '120.500');
    t.is(normalizeFrequency(120.5), '120.500');
    t.is(normalizeFrequency(' 133.15 '), '133.150');
    t.is(normalizeFrequency('118'), '118.000');
    t.is(normalizeFrequency('136.975'), '136.975');

    t.is(frequencyToKhz('120.5'), 120500);
    t.is(frequencyToKhz(124.7), 124700);
    t.is(frequencyToKhz('118.000'), 118000);
    t.is(frequencyToKhz('136.975'), 136975);

    t.true(isValidFrequency('120.5'));
    t.true(isValidFrequency(132));
});

test('frequency helpers reject malformed, empty, negative, and out-of-band values', (t) => {
    const invalidInputs = [
        '120.5abc',
        '120.',
        '.500',
        '120.1234',
        '',
        '   ',
        null,
        undefined,
        NaN,
        Infinity,
        -Infinity,
        -120.5,
        0,
        '117.975',
        117.975,
        '137.000',
        137.0,
        true,
        {}
    ];

    for (const input of invalidInputs) {
        t.is(frequencyToKhz(input), null, `expected null kHz for ${String(input)}`);
        t.is(normalizeFrequency(input), null, `expected null normalized for ${String(input)}`);
        t.false(isValidFrequency(input), `expected invalid for ${String(input)}`);
    }
});

test('frequenciesEqual compares via integer kHz and returns false for invalid inputs', (t) => {
    t.true(frequenciesEqual('120.5', '120.500'));
    t.true(frequenciesEqual(120.5, '120.50'));
    t.true(frequenciesEqual(133.15, '133.150'));

    t.false(frequenciesEqual('120.500', '124.700'));
    t.false(frequenciesEqual('bad1', 'bad2'));
    t.false(frequenciesEqual('120.5abc', '120.500'));
    t.false(frequenciesEqual(null, null));
});

test('isAustralianAirport detects Y* ICAO codes safely', (t) => {
    t.true(isAustralianAirport('YSSY'));
    t.true(isAustralianAirport('yssy'));
    t.true(isAustralianAirport(' ymhb '));
    t.false(isAustralianAirport('KSEA'));
    t.false(isAustralianAirport('EGLL'));
    t.false(isAustralianAirport(''));
    t.false(isAustralianAirport(null));
    t.false(isAustralianAirport(undefined));
});
