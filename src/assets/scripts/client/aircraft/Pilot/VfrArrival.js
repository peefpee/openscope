import navData from '../../airport/dat/NavDataCache';
import { resolveWaypoints } from '../../airport/dat/buildDatScope';
import { calcTurnRadiusByBankAngle } from '../../math/flightMath';
import { nm } from '../../utilities/unitConverters';
import shuffle from 'lodash/shuffle';
import StaticPositionModel from '../../base/StaticPositionModel';

const TAU = 2 * Math.PI;
const point = (origin, bearing, nm) => origin.generateDynamicPositionFromBearingAndDistance(bearing, nm);

const compass = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const outsideOnly = { rules: 'vfr', octaRequired: true };

function safeRoute(airport, points, altitude) {
    return airport.getAirspaceAlongRoute(points, altitude).every((area) =>
        airport.isAirspaceEntryAuthorised(outsideOnly, area));
}

export function clearOrbit(airport, position, altitude, speed = 105) {
    const wind = airport.getWindAtAltitude(altitude).speed || 0;
    const radius = Math.max(0.45, calcTurnRadiusByBankAngle(speed + wind, Math.PI / 9), (speed + wind) / 188.5);
    const buffer = (airport.data.vfrOptions || {}).bufferNM;
    for (let i = 0; i < 8; i++) {
        const center = point(position, i * TAU / 8, radius);
        const ring = Array.from({ length: 25 }, (_, j) => point(center, TAU * j / 24, radius).relativePosition);
        const margin = Array.from({ length: 25 }, (_, j) => point(center, TAU * j / 24, radius + (buffer == null ? 0.25 : buffer)).relativePosition);
        if (safeRoute(airport, [position.relativePosition, ...ring, ...margin], altitude)) return { center, altitude, radius };
    }
    return null;
}

export function vfrEntry(airport, speed = 105) {
    const origin = airport.positionModel;
    const extent = Math.max(12, nm(airport.ctr_radius));
    const altitude = origin.elevation + 1500;
    const fixFile = navData.records.get('fixes');
    if (!airport.data.vfrWaypoints && fixFile && airport._vfrFixFile !== fixFile) {
        const runways = new Map([['origin', { position: origin.gps }]]);
        airport._vfrReports = resolveWaypoints({ runways, procedures: {}, icao: airport.icao.toUpperCase() }, fixFile.text).vfrWaypoints;
        airport._vfrFixFile = fixFile;
    }
    const reports = shuffle(airport.data.vfrWaypoints || airport._vfrReports || []);
    for (const report of reports) {
        if (!Array.isArray(report.position) || !report.position.slice(0, 2).every(Number.isFinite)) continue;
        const fix = new StaticPositionModel(report.position, origin, airport.magneticNorth);
        if (origin.distanceToPosition(fix) > extent + 5) continue;
        const outward = origin.bearingToPosition(fix);
        const bearings = (report.arrivalDirections || []).map((dir) => directions.indexOf(dir))
            .filter((index) => index >= 0).map((index) => index * TAU / 8);
        if (!bearings.length) bearings.push(outward, outward + TAU / 8, outward - TAU / 8);
        for (const height of [altitude, altitude - 500, altitude + 500]) {
            if ((report.minimumAltitude != null && height < report.minimumAltitude) ||
                (report.maximumAltitude != null && height > report.maximumAltitude)) continue;
            for (const bearing of bearings) {
                const inbound = point(fix, bearing, 2);
                const destination = fix.relativePosition;
                if (!safeRoute(airport, [inbound.relativePosition], height)) continue;
                const clearToPoint = safeRoute(airport, [inbound.relativePosition, destination], height);
                const orbit = clearOrbit(airport, clearToPoint ? fix : inbound, height, speed);
                if (!orbit) continue;
                const name = report.radioName || report.name || report.id;
                if (clearToPoint) orbit.reportingPoint = { position: fix, name };
                const direction = compass[Math.round((bearing + TAU) * 8 / TAU) % 8];
                return { position: inbound, orbit, report: `two miles ${direction} of ${name}, inbound` };
            }
        }
    }
    if (reports.length) return null;
    const start = Math.random() * TAU;
    for (let i = 0; i < 96; i++) {
        const bearing = start + i * TAU / 24;
        const distance = Math.round(Math.max(11, extent * [0.45, 0.65, 0.85, 1][Math.floor(i / 24)]));
        const gps = origin.generateCoordinatesFromBearingAndDistance(bearing, distance);
        const position = point(new StaticPositionModel(gps, origin, airport.magneticNorth), 0, 0);
        const orbit = clearOrbit(airport, position, altitude, speed);
        if (orbit) return { position, orbit, report: `${distance} miles ${compass[Math.round(bearing * 8 / TAU) % 8]} of the field` };
    }
    return null;
}

export function orbitTrack(orbit, position) {
    return orbit.center.bearingToPosition(position) + Math.PI / 2 +
        Math.atan2(orbit.center.distanceToPosition(position) - (orbit.radius || 1), 0.4);
}

export function circuitPoints(runway, leg, right, speed, aircraft, airport) {
    const origin = runway.positionModel;
    const side = runway.angle + (right ? 1 : -1) * Math.PI / 2;
    const config = { ...runway.circuit, ...((runway.circuit || {}).categories || {})[aircraft && aircraft.model.weightClass] };
    const wind = airport ? airport.getWindAtAltitude(runway.elevation + 1000).speed : 0;
    const radius = calcTurnRadiusByBankAngle(speed + wind, Math.PI / 9);
    const offset = config.downwindOffsetNM || Math.max(0.8, radius * 2.5);
    const finalDistance = config.finalDistanceNM || Math.max(1.5, speed * 3 / 85);
    const upwind = point(origin, runway.angle, Math.max(1, nm(runway.length) + radius));
    const baseTurn = point(origin, runway.oppositeAngle, config.baseDistanceNM || finalDistance + Math.max(0.8, radius * 2));
    const final = point(origin, runway.oppositeAngle, finalDistance);
    const start = { xw: 0, dw: 1, base: 2, final: 3 }[leg];
    return [upwind, point(upwind, side, offset), point(baseTurn, side, offset), baseTurn, final].map((position, index) => ({
        position, phase: ['JOINING CROSSWIND', 'CROSSWIND', 'DOWNWIND', 'BASE', 'FINAL'][index], speed,
        altitude: Math.max(runway.elevation + (config.altitudeAGL || 1000),
            airport ? airport.terrainElevationAt(position.relativePosition) + 500 : runway.elevation)
    })).slice(start);
}
