import { parseCoordinate } from '../utilities/unitConverters';
import ControllerConfigModel from '../controller/ControllerConfigModel';
import { FREQUENCY_SOURCE, normalizeFrequency } from '../constants/controllerConstants';

function routeRunway(airport, pattern) {
    const parts = pattern.route.split('.');
    const endpoint = pattern.category === 'departure' ? parts[0] : parts[parts.length - 1];
    return endpoint.startsWith(airport.icao.toUpperCase()) ? endpoint.slice(4) : null;
}

// The engine assigns one arrival and one departure runway. Offer parallel flows only
// where the airport has routes for both assignments, keeping imported vector geometry intact.
export function runwayModes(airport) {
    if (airport.isDatImport) return [];
    const used = (category) => [...new Set(airport.spawnPatterns.filter((p) => p.category === category)
        .map((p) => routeRunway(airport, p)).filter(Boolean))];
    const modes = [];
    for (const arrival of used('arrival')) {
        for (const departure of used('departure')) {
            if (arrival.slice(0, 2) === departure.slice(0, 2)) modes.push({ arrival, departure });
        }
    }
    return modes;
}

export function controllerDraft(airport) {
    const model = new ControllerConfigModel(airport.controllers, airport);
    const saved = airport.importControllerSettings || {};
    for (const [prefix, entry] of [['approach', model.approach], ['tower', model.tower[0]]]) {
        if (entry && saved[`${prefix}Frequency`]) {
            entry.frequency = saved[`${prefix}Frequency`];
            entry.source = FREQUENCY_SOURCE.USER;
        }
        if (entry && saved[`${prefix}Callsign`]) entry.callsign = saved[`${prefix}Callsign`];
    }
    const centre = model.centre[0];
    if (centre && airport.centreSector && airport.centreSector !== centre.sectorId) {
        const brisbane = airport.centreSector === 'YBBB';
        Object.assign(centre, {
            sectorId: airport.centreSector,
            callsign: airport.centreSector,
            radioName: brisbane ? 'Brisbane Centre' : 'Melbourne Centre',
            frequency: brisbane ? '125.100' : '125.000',
            source: FREQUENCY_SOURCE.SIMULATED
        });
    }
    if (centre && saved.centreFrequency && saved.centreSector === centre.sectorId) {
        centre.frequency = saved.centreFrequency;
        centre.source = FREQUENCY_SOURCE.USER;
    }
    return {
        ...airport.controllers,
        approach: model.approach,
        departure: model.departure,
        tower: model.tower,
        centre: model.centre.slice(0, 1)
    };
}

export function positions(controllers) {
    return [
        ['Approach', controllers.approach], ['Departure', controllers.departure],
        ...controllers.tower.map((entry) => ['Tower', entry]),
        ...controllers.centre.map((entry) => ['Centre', entry])
    ].filter(([, entry]) => entry);
}

export function prepareAirport(source, traffic, mode, edits) {
    if (!traffic.arrivals && !traffic.departures && !traffic.vfr) throw new Error('Enable at least one traffic category.');
    if (![0.5, 1, 1.5, 2].includes(traffic.rate)) throw new Error('Choose a supported IFR traffic rate.');
    const airport = JSON.parse(JSON.stringify(source));
    airport.sessionTraffic = { ...traffic };
    if (mode) {
        const valid = runwayModes(airport).find((m) => m.arrival === mode.arrival && m.departure === mode.departure);
        if (!valid) throw new Error('Choose a runway flow with compatible routes.');
        airport.arrivalRunway = mode.arrival;
        airport.departureRunway = mode.departure;
        airport.spawnPatterns = airport.spawnPatterns.filter((p) => {
            const runway = routeRunway(airport, p);
            return !runway || runway === mode[p.category];
        });
    }
    const totals = { arrival: 0, departure: 0 };
    for (const pattern of airport.spawnPatterns) {
        if (pattern.category === 'arrival' || pattern.category === 'departure') {
            totals[pattern.category] += pattern.rate;
        }
    }
    for (const pattern of airport.spawnPatterns) {
        if (traffic.arrivals && traffic.departures && traffic.arrivalShare != null &&
            (pattern.category === 'arrival' || pattern.category === 'departure')) {
            if (![0.25, 0.5, 0.75].includes(traffic.arrivalShare)) throw new Error('Choose a supported arrival share.');
            const share = pattern.category === 'arrival' ? traffic.arrivalShare : 1 - traffic.arrivalShare;
            if (totals[pattern.category]) pattern.rate *= share * (totals.arrival + totals.departure) / totals[pattern.category];
        }
        pattern.rate *= traffic.rate;
    }
    airport.controllers = controllerDraft(airport);
    const frequencies = new Map();
    const callsigns = new Set();
    positions(airport.controllers).forEach(([role, entry], i) => {
        const edit = edits[i];
        const frequency = normalizeFrequency(edit.frequency);
        const callsign = edit.callsign.trim().toUpperCase();
        if (callsigns.has(callsign)) throw new Error('Each controller needs a distinct callsign.');
        callsigns.add(callsign);
        if (!frequency || !/^[A-Z0-9_-]{2,20}$/i.test(edit.callsign.trim()) || !/^[^<>]{1,80}$/.test(edit.radioName.trim())) {
            throw new Error(`Check the ${role} callsign, radio name and VHF frequency.`);
        }
        if ([frequency, callsign, edit.radioName.trim()].join('|') !==
            [entry.frequency, entry.callsign, entry.radioName].join('|')) entry.source = FREQUENCY_SOURCE.USER;
        const shared = frequencies.get(frequency);
        if (shared && !(shared === 'Approach' && role === 'Departure')) {
            throw new Error(`Assign distinct frequencies to ${shared} and ${role}.`);
        }
        frequencies.set(frequency, role);
        Object.assign(entry, { frequency, callsign: edit.callsign.trim().toUpperCase(), radioName: edit.radioName.trim() });
    });
    const { approach, departure, tower } = airport.controllers;
    airport.radio = { ...airport.radio };
    if (approach) airport.radio.app = approach.radioName;
    if (departure) airport.radio.dep = departure.radioName;
    if (tower.length) airport.radio.twr = tower[0].radioName;
    return airport;
}

// Copy before freezing so presentation consumers cannot mutate a prepared airport.
function freezeTree(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freezeTree);
        Object.freeze(value);
    }
    return value;
}

export function airportPreview(airport, flow, importedAirspace) {
    let airspace = airport.airspace || null;
    if (airport.isDatImport && importedAirspace && airport.position) {
        const [lat, lon] = airport.position;
        const radius = (airport.ctr_radius || 74) / 111;
        const width = radius / Math.cos(lat * Math.PI / 180);
        // Clip candidate regions by their geographic extent without starting the radar model.
        airspace = importedAirspace.regions.filter(({ poly }) => poly &&
            poly.some(([y]) => y >= lat - radius) && poly.some(([y]) => y <= lat + radius) &&
            poly.some(([, x]) => x >= lon - width) && poly.some(([, x]) => x <= lon + width));
    }
    const activeFlow = flow || { arrival: airport.arrivalRunway, departure: airport.departureRunway };
    const runways = (airport.runways || []).map(({ name, end }) => ({
        identifiers: name,
        thresholds: end.map((point) => point.slice(0, 2).map(parseCoordinate)),
        arrivalThreshold: name.indexOf(activeFlow.arrival),
        departureThreshold: name.indexOf(activeFlow.departure)
    }));
    return freezeTree(JSON.parse(JSON.stringify({
        icao: airport.icao.toUpperCase(),
        name: airport.name || null,
        coordinates: airport.position ? airport.position.slice(0, 2).map(parseCoordinate) : null,
        runways,
        activeFlow,
        flows: runwayModes(airport),
        airspace,
        terrain: airport.terrainGeoJson || null,
        terrainUrl: airport.has_terrain && !airport.isDatImport ?
            `assets/airports/terrain/${airport.icao.toLowerCase()}.geojson` : null,
        traffic: (airport.spawnPatterns || []).map(({ category, rate }) => ({ category, rate })),
        controllers: controllerDraft(airport)
    })));
}
