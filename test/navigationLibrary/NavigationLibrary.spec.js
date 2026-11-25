import ava from 'ava';
import NavigationLibrary from '../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import { AIRPORT_JSON_KLAS_MOCK } from '../airport/_mocks/airportJsonMock';

ava('throws when attempting to create an instance', (t) => {
    t.throws(() => new NavigationLibrary());
    t.throws(() => new NavigationLibrary(AIRPORT_JSON_KLAS_MOCK));
});

ava('.getAllFixNamesInUse() returns list of all fix names used in all procedures and airways', (t) => {
    NavigationLibrary.init(AIRPORT_JSON_KLAS_MOCK);

    const fixNameList = NavigationLibrary._getAllFixNamesInUse();

    t.true(fixNameList.length === 93);
});

ava('._holdCollection() is populated correctly', (t) => {
    NavigationLibrary.reset();
    NavigationLibrary.init(AIRPORT_JSON_KLAS_MOCK);
    const bakkrHold = NavigationLibrary.findHoldParametersByFix('BAKRR');
    // "360|right|4nm|S230-"
    const expectedResult = {
        inboundHeading: Math.PI,
        turnDirection: 'right',
        legLength: '4nm',
        speedMaximum: 230
    };

    t.deepEqual(bakkrHold, expectedResult);
});

ava('.getFixSpokenName() returns input in lowercase if fix does not exist', (t) => {
    NavigationLibrary.reset();
    NavigationLibrary.init(AIRPORT_JSON_KLAS_MOCK);
    const result = NavigationLibrary.getFixSpokenName('ASDFG');

    t.deepEqual(result, 'asdfg');
});

ava.serial('speaks Australian coded approach fixes with the airport name and phonetic suffix', (t) => {
    const airport = { ...AIRPORT_JSON_KLAS_MOCK, icao: 'YMHB', spokenAirportName: 'Hobart',
        fixGroups: { approach: ['HB2EF', 'HB410', 'KANLI'] } };
    NavigationLibrary.reset();
    try {
        NavigationLibrary.init(airport);
        t.is(NavigationLibrary.getFixSpokenName('hb2ef'), 'Hobart two echo foxtrot');
        t.is(NavigationLibrary.getFixSpokenName('HB410'), 'Hobart four one zero');
        t.is(NavigationLibrary.getFixSpokenName('KANLI'), 'kanli');
        t.is(NavigationLibrary.getFixSpokenName('Z'), 'zulu');
        NavigationLibrary.reset();
        NavigationLibrary.init({ ...airport, icao: 'NZAA' });
        t.is(NavigationLibrary.getFixSpokenName('HB2EF'), 'hb2ef');
    } finally {
        NavigationLibrary.reset();
    }
});
