import navData from '../../airport/dat/NavDataCache';
import { resolveWaypoints } from '../../airport/dat/buildDatScope';
import shuffle from 'lodash/shuffle';
import StaticPositionModel from '../../base/StaticPositionModel';

const TAU = 2 * Math.PI;
const point = (origin, bearing, nm) => origin.generateDynamicPositionFromBearingAndDistance(bearing, nm);

export function clearOrbit(airport, position, altitude) {
    for (let i = 0; i < 8; i++) {
        const center = point(position, i * TAU / 8, 1);
        const blocked = airport.controlledShelves.some((area) => altitude >= area.floor && altitude <= area.ceiling &&
            (area.isPointInside2D(center.relativePosition) || area.distanceToBoundary(center.relativePosition) < 1.5));
        if (!blocked) return { center, altitude };
    }
    return null;
}

export function vfrEntry(airport) {
    const origin = airport.positionModel;
    const altitude = origin.elevation + 1500;
    const fixFile = navData.records.get('fixes');
    if (!airport.data.vfrWaypoints && fixFile && airport._vfrFixFile !== fixFile) {
        const runways = new Map([['origin', { position: origin.gps }]]);
        airport._vfrReports = resolveWaypoints({ runways, procedures: {}, icao: airport.icao.toUpperCase() }, fixFile.text).vfrWaypoints;
        airport._vfrFixFile = fixFile;
    }
    const reports = shuffle(airport.data.vfrWaypoints || airport._vfrReports || []);
    for (const report of reports) {
        const fix = new StaticPositionModel(report.position, origin, airport.magneticNorth);
        if (origin.distanceToPosition(fix) > 40) continue;
        const position = point(fix, 0, 0);
        const orbit = clearOrbit(airport, position, altitude);
        if (orbit) {
            const inbound = point(orbit.center, position.bearingToPosition(orbit.center), 1);
            orbit.reportingPoint = { position, name: report.name || report.id };
            return { position: inbound, orbit, report: `inbound to ${orbit.reportingPoint.name}` };
        }
    }
    const start = Math.random() * TAU;
    for (let i = 0; i < 96; i++) {
        const bearing = start + i * TAU / 24;
        const distance = [18, 35, 65, 90][Math.floor(i / 24)];
        const gps = origin.generateCoordinatesFromBearingAndDistance(bearing, distance);
        const position = point(new StaticPositionModel(gps, origin, airport.magneticNorth), 0, 0);
        const orbit = clearOrbit(airport, position, altitude);
        const compass = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
        if (orbit) return { position, orbit, report: `${distance} miles ${compass[Math.round(bearing * 8 / TAU) % 8]} of the field` };
    }
    return null;
}

export function orbitTrack(orbit, position) {
    return orbit.center.bearingToPosition(position) + Math.PI / 2 +
        Math.atan2(orbit.center.distanceToPosition(position) - 1, 0.4);
}

export function circuitPoints(runway, leg, right, speed) {
    const origin = runway.positionModel;
    const side = runway.angle + (right ? 1 : -1) * Math.PI / 2;
    const upwind = point(origin, runway.angle, 2);
    const baseTurn = point(origin, runway.oppositeAngle, 5);
    const final = point(origin, runway.oppositeAngle, 3);
    const start = { xw: 0, dw: 1, base: 2, final: 3 }[leg];
    return [upwind, point(upwind, side, 1.7), point(baseTurn, side, 1.7), baseTurn, final].slice(start)
        .map((position) => ({ position, altitude: runway.elevation + 1000, speed }));
}
