import test from 'ava';
import {
    buildAirportCatalogue,
    buildAirportFromImportedRecord,
    getUnsavedAirports,
    markImportedAirportSaved,
    unsaveImportedAirport
} from '../../src/assets/scripts/client/session/airportCatalogue';
import { parseAirportDat } from '../../src/assets/scripts/client/airport/dat/parseAirportDat';

const SAMPLE_YMHB_DAT = [
    'RWY:RW12, , ,00012, , , , ;S42494800,E147294000,0013;',
    'RWY:RW30, , ,00014, , , , ;S42503200,E147311000,0013;'
].join('\n');

const SAMPLE_YSSY_DAT = [
    'RWY:RW16R, , ,00012, , , , ;S33554800,E151103700,0021;',
    'RWY:RW34L, , ,00014, , , , ;S33573200,E151105000,0021;'
].join('\n');

function memoryStorage() {
    const store = Object.create(null);
    return {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
}

test('buildAirportCatalogue merges bundled and saved imported airports and migrates existing cache', (t) => {
    const storage = memoryStorage();
    const bundled = [
        { icao: 'yssy', name: 'Sydney Kingsford Smith International Airport', disabled: false },
        { icao: 'egll', name: 'London Heathrow', disabled: false },
        { icao: 'ymml', name: 'Melbourne', disabled: true }
    ];
    const details = new Map([
        ['yssy', {
            icao: 'YSSY',
            name: 'Sydney Kingsford Smith International Airport',
            position: ['S33d56m45.95', 'E151d10m37.21', '21ft'],
            runways: [{ name: ['16R', '34L'] }],
            has_terrain: true,
            airac: 2609
        }]
    ]);
    const navData = {
        db: {},
        memoryOnly: new Set(),
        records: new Map([
            ['airport/YMHB', {
                key: 'airport/YMHB',
                name: 'YMHB.dat',
                cycle: '2609',
                text: SAMPLE_YMHB_DAT,
                importedAt: '2026-11-28T00:00:00.000Z'
            }],
            ['fixes', { key: 'fixes', text: '' }],
            ['terrain/YMHB', { key: 'terrain/YMHB', formatVersion: 1, geojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] } }]
        ]),
        getTerrain: (icao) => (icao === 'YMHB' ? { geojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] } } : null)
    };

    const catalogue = buildAirportCatalogue(bundled, details, navData, storage);
    t.deepEqual(catalogue.map((a) => a.icao), ['YSSY', 'YMHB']);

    const ymhb = catalogue.find((a) => a.icao === 'YMHB');
    t.is(ymhb.sourceType, 'imported');
    t.true(ymhb.saved);
    t.true(ymhb.hasTerrain);
    t.is(ymhb.airac, '2609');
    t.truthy(ymhb.coordinates);
});

test('memory-only imports are excluded from durable Classic catalogue', (t) => {
    const storage = memoryStorage();
    const navData = {
        db: {},
        memoryOnly: new Set(['airport/YMHB']),
        records: new Map([
            ['airport/YMHB', { key: 'airport/YMHB', name: 'YMHB.dat', text: SAMPLE_YMHB_DAT }]
        ])
    };
    const catalogue = buildAirportCatalogue([], new Map(), navData, storage);
    t.deepEqual(catalogue, []);
});

test('duplicate ICAO merges bundled and imported into one entry and unsave preserves bundled + shared data', (t) => {
    const storage = memoryStorage();
    const bundled = [{ icao: 'yssy', name: 'Sydney', disabled: false }];
    const details = new Map([
        ['yssy', { icao: 'YSSY', name: 'Sydney', position: ['S33d56m45.95', 'E151d10m37.21', '21ft'], runways: [] }]
    ]);
    const navData = {
        db: {},
        memoryOnly: new Set(),
        records: new Map([
            ['airport/YSSY', { key: 'airport/YSSY', name: 'YSSY.dat', text: SAMPLE_YSSY_DAT }],
            ['airport/YMHB', { key: 'airport/YMHB', name: 'YMHB.dat', text: SAMPLE_YMHB_DAT }],
            ['fixes', { key: 'fixes', text: 'FIX' }],
            ['msa', { key: 'msa', airports: {} }]
        ])
    };

    let catalogue = buildAirportCatalogue(bundled, details, navData, storage);
    const yssy = catalogue.find((a) => a.icao === 'YSSY');
    t.is(yssy.sourceType, 'both');
    t.deepEqual(yssy.sources, ['bundled', 'imported']);

    // Unsave YSSY imported version -> bundled YSSY remains, shared fixes/msa remain
    unsaveImportedAirport('YSSY', storage);
    catalogue = buildAirportCatalogue(bundled, details, navData, storage);
    const yssyAfter = catalogue.find((a) => a.icao === 'YSSY');
    t.is(yssyAfter.sourceType, 'bundled');
    t.true(navData.records.has('fixes'));
    t.true(navData.records.has('msa'));

    // Unsave YMHB -> removed from Classic; re-saving restores it
    unsaveImportedAirport('YMHB', storage);
    catalogue = buildAirportCatalogue(bundled, details, navData, storage);
    t.is(catalogue.find((a) => a.icao === 'YMHB'), undefined);
    t.true(getUnsavedAirports(storage).has('YMHB'));

    markImportedAirportSaved('YMHB', storage);
    catalogue = buildAirportCatalogue(bundled, details, navData, storage);
    t.truthy(catalogue.find((a) => a.icao === 'YMHB'));
});

test('buildAirportFromImportedRecord preserves spoken name, centre sector, and terrain', (t) => {
    const navData = {
        records: new Map(),
        getTerrain: () => ({ geojson: { type: 'FeatureCollection', features: [{ type: 'Feature' }] } })
    };
    const scope = buildAirportFromImportedRecord({
        name: 'YMHB.dat',
        text: SAMPLE_YMHB_DAT,
        spokenAirportName: 'Hobart Custom',
        controllerSettings: { centreSector: 'YMMM' }
    }, navData);

    t.truthy(scope);
    t.is(scope.icao, 'YMHB');
    t.is(scope.spokenAirportName, 'Hobart Custom');
    t.is(scope.centreSector, 'YMMM');
    t.true(scope.has_terrain);
});
