import { parseCoordinate } from '../utilities/unitConverters';
import { parseAirportDat } from '../airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../airport/dat/buildDatScope';

const UNSAVED_KEY = 'openscope.unsavedAirports.v1';

function readStorage(storage) {
    if (storage) return storage;
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
        return null;
    }
}

/**
 * Read the set of explicitly unsaved imported airport ICAOs from localStorage.
 * @param {Storage} [storage]
 * @returns {Set<string>}
 */
export function getUnsavedAirports(storage) {
    const store = readStorage(storage);
    if (!store) return new Set();
    try {
        const raw = typeof store.getItem === 'function' ? store.getItem(UNSAVED_KEY) : store[UNSAVED_KEY];
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map((c) => String(c).trim().toUpperCase()).filter(Boolean));
    } catch (e) {
        return new Set();
    }
}

function writeUnsavedAirports(set, storage) {
    const store = readStorage(storage);
    if (!store) return false;
    try {
        const serialized = JSON.stringify([...set].sort());
        if (typeof store.setItem === 'function') store.setItem(UNSAVED_KEY, serialized);
        else store[UNSAVED_KEY] = serialized;
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Mark an imported airport ICAO as unsaved (removed from Classic catalogue)
 * without deleting shared navigation, MSA, or terrain cache records.
 *
 * @param {string} icao
 * @param {Storage} [storage]
 * @returns {Set<string>}
 */
export function unsaveImportedAirport(icao, storage) {
    const code = String(icao || '').trim().toUpperCase();
    const set = getUnsavedAirports(storage);
    if (code) {
        set.add(code);
        writeUnsavedAirports(set, storage);
    }
    return set;
}

/**
 * Clear an ICAO from the unsaved registry when re-imported and saved.
 *
 * @param {string} icao
 * @param {Storage} [storage]
 * @returns {Set<string>}
 */
export function markImportedAirportSaved(icao, storage) {
    const code = String(icao || '').trim().toUpperCase();
    const set = getUnsavedAirports(storage);
    if (code && set.delete(code)) {
        writeUnsavedAirports(set, storage);
    }
    return set;
}

function parseCoords(pos) {
    if (!Array.isArray(pos) || pos.length < 2) return null;
    try {
        const lat = typeof pos[0] === 'number' ? pos[0] : parseCoordinate(pos[0]);
        const lon = typeof pos[1] === 'number' ? pos[1] : parseCoordinate(pos[1]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    } catch (e) { /* ignore invalid coordinate */ }
    return null;
}

function parseElevationFt(pos) {
    if (!Array.isArray(pos) || pos.length < 3) return null;
    if (typeof pos[2] === 'number' && Number.isFinite(pos[2])) return pos[2];
    const match = /([+-]?\d+(?:\.\d+)?)/.exec(String(pos[2] || ''));
    return match ? Number(match[1]) : null;
}

/**
 * Build a unified Australian airport catalogue combining enabled bundled airports
 * and durably saved imported airports from NavDataCache.
 *
 * @param {Array<Object>} bundledList
 * @param {Map<string, Object>} bundledDetailsMap
 * @param {Object} navDataCache
 * @param {Storage} [storage]
 * @returns {Array<Object>}
 */
export function buildAirportCatalogue(bundledList = [], bundledDetailsMap = new Map(), navDataCache = null, storage = null) {
    const unsaved = getUnsavedAirports(storage);
    const byIcao = new Map();

    bundledList.forEach((summary) => {
        if (!summary || !summary.icao || summary.disabled || !/^y/i.test(summary.icao)) return;
        const icao = summary.icao.toUpperCase();
        const details = bundledDetailsMap.get(summary.icao.toLowerCase()) || bundledDetailsMap.get(icao) || null;
        const coordinates = details && details.position
            ? parseCoords(details.position)
            : (parseCoords(summary.coordinates) || null);
        const elevation = details && details.position ? parseElevationFt(details.position) : null;
        const runways = details && Array.isArray(details.runways) ?
            details.runways.map((r) => (Array.isArray(r.name) ? r.name.join('/') : String(r.name || ''))) :
            [];

        byIcao.set(icao, {
            icao,
            name: (details && details.name) || summary.name || icao,
            coordinates,
            elevation,
            sources: ['bundled'],
            sourceType: 'bundled',
            hasBundled: true,
            hasImported: false,
            saved: false,
            persistenceStatus: 'bundled',
            runways,
            hasAirspace: Boolean(details && details.airspace && details.airspace.length),
            hasTerrain: Boolean(details && details.has_terrain),
            importedAt: null,
            airac: details && details.airac ? String(details.airac) : null,
            bundledSummary: summary,
            importedRecord: null
        });
    });

    if (navDataCache && navDataCache.records instanceof Map) {
        const fixes = navDataCache.records.get('fixes');
        const auAirspace = navDataCache.records.get('au-airspace');
        const isMemoryOnly = (key) => !navDataCache.db || (navDataCache.memoryOnly && navDataCache.memoryOnly.has(key));

        for (const [key, record] of navDataCache.records.entries()) {
            if (!key.startsWith('airport/') || !record || !record.text) continue;
            const icao = key.slice(8).trim().toUpperCase();
            if (!/^Y[A-Z0-9]{3}$/.test(icao)) continue;
            if (unsaved.has(icao)) continue;
            if (isMemoryOnly(key)) continue;

            let scope = null;
            try {
                const parsed = parseAirportDat(record.text, record.name);
                const waypoints = resolveWaypoints(parsed, fixes && fixes.text);
                scope = buildDatScope(parsed, waypoints, record.selectedRunway || null);
            } catch (e) {
                scope = null;
            }
            if (!scope) continue;

            const coordinates = parseCoords(scope.position);
            const elevation = parseElevationFt(scope.position);
            const runways = Array.isArray(scope.runways) ?
                scope.runways.map((r) => (Array.isArray(r.name) ? r.name.join('/') : String(r.name || ''))) :
                [];
            const terrain = typeof navDataCache.getTerrain === 'function' ? navDataCache.getTerrain(icao) : null;
            const existing = byIcao.get(icao);

            if (existing) {
                existing.sources = ['bundled', 'imported'];
                existing.sourceType = 'both';
                existing.hasImported = true;
                existing.saved = true;
                existing.persistenceStatus = 'saved';
                existing.importedRecord = record;
                existing.importedAt = record.importedAt || null;
                if (!existing.coordinates && coordinates) existing.coordinates = coordinates;
                if (existing.elevation == null && elevation != null) existing.elevation = elevation;
                if (!existing.airac && record.cycle) existing.airac = String(record.cycle);
                if (terrain && terrain.geojson) existing.hasTerrain = true;
                if (auAirspace) existing.hasAirspace = true;
            } else {
                byIcao.set(icao, {
                    icao,
                    name: record.spokenAirportName || scope.name || icao,
                    coordinates,
                    elevation,
                    sources: ['imported'],
                    sourceType: 'imported',
                    hasBundled: false,
                    hasImported: true,
                    saved: true,
                    persistenceStatus: 'saved',
                    runways,
                    hasAirspace: Boolean(auAirspace || (scope.airspace && scope.airspace.length)),
                    hasTerrain: Boolean(terrain && terrain.geojson),
                    importedAt: record.importedAt || null,
                    airac: record.cycle ? String(record.cycle) : null,
                    bundledSummary: null,
                    importedRecord: record
                });
            }
        }
    }

    return [...byIcao.values()].sort((a, b) => {
        if (a.hasBundled !== b.hasBundled) return a.hasBundled ? -1 : 1;
        return a.icao.localeCompare(b.icao);
    });
}

/**
 * Reconstruct a full playable airport configuration from a saved NavDataCache
 * imported airport record, preserving runways, procedures, fixes, terrain, and settings.
 *
 * @param {Object} record
 * @param {Object} navDataCache
 * @returns {Object|null}
 */
export function buildAirportFromImportedRecord(record, navDataCache) {
    if (!record || !record.text) return null;
    const data = parseAirportDat(record.text, record.name);
    const fixes = navDataCache && navDataCache.records ? navDataCache.records.get('fixes') : null;
    const waypoints = resolveWaypoints(data, fixes && fixes.text);
    const scope = buildDatScope(data, waypoints, record.selectedRunway || null);
    if (!scope) return null;

    if (record.spokenAirportName) scope.spokenAirportName = record.spokenAirportName;
    if (record.controllerRadioNames) scope.controllerRadioNames = record.controllerRadioNames;
    if (record.controllerSettings) scope.importControllerSettings = record.controllerSettings;
    if (record.controllerSettings && record.controllerSettings.centreSector) {
        scope.centreSector = record.controllerSettings.centreSector;
    }

    const terrain = navDataCache && typeof navDataCache.getTerrain === 'function' ?
        navDataCache.getTerrain(scope.icao) :
        null;
    if (terrain && terrain.geojson) {
        scope.terrainGeoJson = terrain.geojson;
        scope.has_terrain = terrain.geojson.features.length > 0;
    }

    return scope;
}
