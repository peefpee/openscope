import fs from 'fs';
import path from 'path';
import AirportController from '../../../src/assets/scripts/client/airport/AirportController';
import navData from '../../../src/assets/scripts/client/airport/dat/NavDataCache';
import { parseAirportDat } from '../../../src/assets/scripts/client/airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../../../src/assets/scripts/client/airport/dat/buildDatScope';
import { parseAustralianAirspace } from '../../../src/assets/scripts/client/airport/dat/australianAirspace';
import parseMsaDat from '../../../src/assets/scripts/client/airport/dat/parseMsaDat';

const ASSETS_ROOT = path.resolve(__dirname, '../../../assets');

function readJsonFile(relPath) {
    const fullPath = path.resolve(ASSETS_ROOT, relPath);
    const raw = fs.readFileSync(fullPath, 'utf8');

    return JSON.parse(raw);
}

/**
 * Load an airport JSON definition directly from `assets/airports/<icao>.json`.
 *
 * @function loadAirportJson
 * @param icao {string}
 * @return {object}
 */
export function loadAirportJson(icao) {
    return readJsonFile(`airports/${String(icao).toLowerCase()}.json`);
}

/**
 * Load `assets/airports/airportLoadList.json`.
 *
 * @function loadAirportLoadList
 * @return {array<object>}
 */
export function loadAirportLoadList() {
    return readJsonFile('airports/airportLoadList.json');
}

/**
 * Load all aircraft type definitions from `assets/aircraft/aircraft.json`.
 *
 * @function loadAllAircraftDefinitions
 * @return {array<object>}
 */
export function loadAllAircraftDefinitions() {
    const data = readJsonFile('aircraft/aircraft.json');

    return data.aircraft || [];
}

/**
 * Load all airline definitions from `assets/airlines/*.json`.
 *
 * @function loadAllAirlines
 * @return {array<object>}
 */
export function loadAllAirlines() {
    const airlinesDir = path.resolve(ASSETS_ROOT, 'airlines');
    const files = fs.readdirSync(airlinesDir)
        .filter((name) => name.endsWith('.json'))
        .sort();

    return files.map((fileName) => readJsonFile(`airlines/${fileName}`));
}

/**
 * Parse and open a DAT-format airport into `AirportController`.
 *
 * @function importDatAirport
 * @param options {object} { datText, filename, fixText, airspaceText, msaText }
 * @return {object} { data, resolved, scope, airport }
 */
export function importDatAirport({
    datText,
    filename = 'CUSTOM.dat',
    fixText = '',
    airspaceText = null,
    msaText = null
}) {
    if (fixText) {
        navData.records.set('fixes', {
            key: 'fixes',
            name: 'earth_fix.dat',
            cycle: '',
            text: fixText
        });
    }

    if (airspaceText) {
        navData.records.set('au-airspace', {
            key: 'au-airspace',
            name: 'airspace.txt',
            cycle: '',
            regions: parseAustralianAirspace(airspaceText)
        });
    }

    if (msaText) {
        navData.records.set('msa', {
            key: 'msa',
            name: 'earth_msa.dat',
            cycle: '',
            airports: parseMsaDat(msaText)
        });
    }

    navData.ready = Promise.resolve();

    const data = parseAirportDat(datText, filename);
    const resolved = resolveWaypoints(data, fixText);
    const scope = buildDatScope(data, resolved);

    if (data.icao) {
        navData.records.set(`airport/${data.icao}`, {
            key: `airport/${data.icao}`,
            name: filename,
            cycle: '',
            text: datText
        });
    }

    AirportController.openImportedAirport(scope);

    return {
        data,
        resolved,
        scope,
        airport: AirportController.current
    };
}
