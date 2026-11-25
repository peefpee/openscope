import sample from 'lodash/sample';
import StaticPositionModel from '../../base/StaticPositionModel';
import { degreesToRadians } from '../../utilities/unitConverters';
import { parseAltitudeRestriction } from '../../utilities/navigationUtilities';

function entryAltitude(waypoint, defaultAltitude) {
    if (!Array.isArray(waypoint)) {
        return defaultAltitude;
    }
    let altitude = defaultAltitude;
    for (const token of waypoint[1].split('|')) {
        const [feet, limit] = parseAltitudeRestriction(token);
        if (feet == null) {
            continue;
        }
        if (limit === '+') {
            altitude = Math.max(feet, altitude);
        } else if (limit === '-') {
            altitude = Math.min(feet, altitude);
        } else {
            altitude = feet;
        }
    }
    return altitude;
}

// The FMS needs two distinct starting positions to compute a spawn heading.
function canSpawnOn(path, positions) {
    if (path.length < 2) {
        return false;
    }
    const [first, second] = path.slice(0, 2).map((point) => positions[Array.isArray(point) ? point[0] : point]);
    return first[0] !== second[0] || first[1] !== second[1];
}

function arrivalRoutes(stars, airportRunway, defaultAltitude, positions) {
    const byEntry = new Map();
    for (const star of Object.values(stars)) {
        const runway = star.rwy[airportRunway];
        if (!runway) {
            continue;
        }
        for (const [entry, transition] of Object.entries(star.entryPoints)) {
            const path = [...transition, ...runway];
            if (!canSpawnOn(path, positions)) {
                continue;
            }
            const altitude = entryAltitude(path[0], defaultAltitude);
            if (!byEntry.has(entry)) {
                byEntry.set(entry, []);
            }
            byEntry.get(entry).push({ route: `${entry}.${star.icao}.${airportRunway}`, altitude });
        }
    }
    // One stream per entry fix prevents several STAR variants spawning aircraft
    // on top of each other. All variants are still available for clearance.
    return [...byEntry.values()].map((routes) => sample(routes));
}

// CIFP has no sector boundary or traffic schedule. Build a practice sector relative
// to the active runway so traffic also works without an earth_fix.dat file.
export default function buildDatTraffic(icao, runwayName, runwayEnds, { sids, stars }, positions, enrouteNames = [],
    reservedNames = new Set()) {
    const threshold = new StaticPositionModel(runwayEnds[0]);
    const opposite = new StaticPositionModel(runwayEnds[1]);
    const outbound = threshold.bearingToPosition(opposite);
    const inboundSide = outbound + Math.PI;
    const baseAltitude = Math.ceil(threshold.elevation / 1000) * 1000;
    const ceiling = baseAltitude + 18000;
    const poly = Array.from({ length: 36 }, (_, i) => {
        return threshold.generateCoordinatesFromBearingAndDistance(degreesToRadians(i * 10), 40);
    });
    const airlinesFor = (lightGA) => icao.startsWith('Y') ?
        [['voz/short', 4], ['jst/domestic', 2], [lightGA ? 'vh/lightGA' : 'vh/fastGA', 1]] :
        [['dlh/short', 1], ['ual', 1]];
    const airportRunway = icao + runwayName;
    const arrivals = arrivalRoutes(stars, airportRunway, baseAltitude + 7000, positions);
    const departures = [];
    const enroute = [...enrouteNames].filter((name) => positions[name]).map((name) => {
        const position = new StaticPositionModel(positions[name]);
        return { name, position, distance: threshold.distanceToPosition(position) };
    });
    // Extend a departure beyond the sector on the outbound side of the SID.
    // A separate choice is made for each aircraft using that spawn pattern.
    const onwardFixes = (exit) => {
        const exitDistance = threshold.distanceToPosition(exit);
        if (exitDistance >= 40) return [];
        const bearing = threshold.bearingToPosition(exit);
        const onward = enroute.filter((fix) => fix.distance > exitDistance + 5 &&
            Math.cos(exit.bearingToPosition(fix.position) - bearing) >= 0.5);
        const outside = onward.filter((fix) => fix.distance > 40);
        const candidates = outside.length ? outside : onward;
        const named = candidates.filter((fix) => /^[A-Z]{5}$/.test(fix.name));
        return (named.length ? named : candidates).map((fix) => fix.name);
    };
    for (const sid of Object.values(sids)) {
        const runway = sid.rwy[airportRunway];
        if (!runway) {
            continue;
        }
        for (const [exit, transition] of Object.entries(sid.exitPoints)) {
            if (canSpawnOn([...runway, ...transition], positions)) {
                const route = `${airportRunway}.${sid.icao}.${exit}`;
                const onward = onwardFixes(new StaticPositionModel(positions[exit]));
                departures.push({ route, outboundRoutes: onward.map((name) => `${route}..${name}`) });
            }
        }
    }

    const fixes = {};
    const routeLabels = {};
    if (!arrivals.length) {
        fixes._SIMIN = threshold.generateCoordinatesFromBearingAndDistance(inboundSide + degreesToRadians(20), 28);
        fixes._SIMFINAL = threshold.generateCoordinatesFromBearingAndDistance(inboundSide, 9);
        arrivals.push({ route: '_SIMIN.._SIMFINAL', altitude: baseAltitude + 7000, vectors: true });
        routeLabels['_SIMIN _SIMFINAL'] = 'Arrival vectors';
    }
    if (!departures.length) {
        fixes._SIMOUT = threshold.generateCoordinatesFromBearingAndDistance(outbound, 12);
        // Vectors can take a departure to any side of the sector after takeoff.
        const nearby = enroute.filter((fix) => fix.distance > 15 && fix.distance <= 80);
        const outside = nearby.filter((fix) => fix.distance > 40);
        const exits = (outside.length >= 2 ? outside : nearby).map((fix) => fix.name);
        if (exits.length < 2) {
            const directions = ['N', 'E', 'S', 'W'];
            // Keep a lone real fix and add an alternative on the opposite side.
            const firstBearing = exits.length ? threshold.bearingToPosition(new StaticPositionModel(positions[exits[0]])) : 0;
            const oppositeCardinal = (Math.round(firstBearing / (Math.PI / 2)) + 2) % 4;
            const synthetic = exits.length ? [oppositeCardinal] : [0, 1, 2, 3];
            for (const index of synthetic) {
                let name = `EXIT${directions[index]}`;
                while (positions[name] || reservedNames.has(name)) name += 'X';
                fixes[name] = threshold.generateCoordinatesFromBearingAndDistance(index * Math.PI / 2, 52);
                exits.push(name);
            }
        }
        const outboundRoutes = exits.map((exit) => `_SIMOUT..${exit}`);
        departures.push({ route: outboundRoutes[0], outboundRoutes, vectors: true });
        exits.forEach((exit) => { routeLabels[`_SIMOUT ${exit}`] = 'Departure vectors'; });
    }

    return {
        fixes,
        routeLabels,
        airspace: [{
            floor: Math.min(0, Math.floor(Math.min(...runwayEnds.map((end) => end[2])) / 100)),
            ceiling: ceiling / 100,
            airspace_class: 'C',
            poly
        }],
        ctr_ceiling: ceiling,
        initial_alt: baseAltitude + 5000,
        radio: { app: `${icao} Approach`, twr: `${icao} Tower`, dep: `${icao} Departure` },
        spawnPatterns: [
            ...arrivals.map((arrival) => ({
                method: 'random',
                airlines: airlinesFor(arrival.altitude <= 10000),
                ...arrival,
                origin: '',
                destination: icao,
                category: 'arrival',
                rate: 8 / arrivals.length,
                speed: 230
            })),
            ...departures.map((departure) => ({
                method: 'random',
                airlines: airlinesFor(departure.vectors && baseAltitude < 10000),
                ...departure,
                origin: icao,
                destination: '',
                category: 'departure',
                rate: 8 / departures.length,
                altitude: '',
                speed: ''
            }))
        ]
    };
}
