import StaticPositionModel from '../../base/StaticPositionModel';
import NavigationLibrary from '../../navigationLibrary/NavigationLibrary';
import { getOffset } from '../../math/flightMath';
import { km, nm } from '../../utilities/unitConverters';

function finalJoin(runway, position, altitude, alreadyEstablished) {
    if (alreadyEstablished) return [];
    const threshold = runway.positionModel;
    const risePerMile = runway.getGlideslopeAltitude(km(1)) - runway.elevation;
    const distance = Math.max(9, (altitude - runway.elevation) / risePerMile);
    const join = threshold.generateDynamicPositionFromBearingAndDistance(runway.oppositeAngle, distance);
    const [lateral, along] = getOffset({ relativePosition: position.relativePosition, heading: runway.angle },
        runway.relativePosition, runway.angle);
    const points = [];
    if (nm(along) < distance + 1) {
        const side = lateral >= 0 ? 1 : -1;
        const base = join.generateDynamicPositionFromBearingAndDistance(runway.angle + side * Math.PI / 2, 5);
        points.push({ position: base });
    }
    points.push({ position: join });
    return points;
}

// Lateral and vertical guidance up to final capture. The existing landing
// phase handles the threshold crossing, touchdown and rollout.
export class ApproachGuidance {
    constructor(runway, points, name) {
        this.name = name;
        this.runway = runway;
        this.points = points;
        this.index = 0;
        let next = runway.positionModel;
        let altitude = runway.elevation;
        for (let i = points.length - 1; i >= 0; i--) {
            const point = points[i];
            if (point.altitude == null) {
                const distance = point.position.distanceToPosition(next);
                point.altitude = altitude + runway.getGlideslopeAltitude(km(distance)) - runway.elevation;
            }
            next = point.position;
            ({ altitude } = point);
        }
    }

    get onFinal() {
        return this.index === this.points.length;
    }

    targets(aircraft) {
        const position = aircraft.positionModel;
        while (!this.onFinal) {
            const point = this.points[this.index];
            if (point.phase) aircraft.circuitPhase = aircraft.octaRequired ? 'AWAITING ENTRY' : point.phase;
            const distance = position.distanceToPosition(point.position);
            const next = this.points[this.index + 1];
            const capture = next ? Math.min(0.8, point.position.distanceToPosition(next.position) / 2) : 0.8;
            if (distance > capture) {
                const glide = this.runway.getGlideslopeAltitude(km(distance)) - this.runway.elevation;
                return {
                    track: position.bearingToPosition(point.position),
                    altitude: Math.max(point.altitude, Math.min(aircraft.altitude, point.altitude + glide)),
                    speed: point.speed
                };
            }
            this.index += 1;
        }
        const [lateral, along] = getOffset(aircraft, this.runway.relativePosition, this.runway.angle);
        return {
            track: this.runway.angle - Math.atan2(nm(lateral), 1.5),
            altitude: this.runway.getGlideslopeAltitude(along)
        };
    }
}

export function planApproach(aircraft, airport, runway, entry) {
    if (!runway) return [false, 'the specified runway does not exist'];
    if (!aircraft.isArrival() || aircraft.isOnGround()) return [false, 'approach clearance requires an airborne arrival'];

    let points;
    let name = 'visual';
    if (!entry) {
        const established = runway.isOnApproachCourse(aircraft) && runway.isOnCorrectApproachGroundTrack(aircraft.groundTrack);
        points = finalJoin(runway, aircraft.positionModel, aircraft.altitude, established);
    } else if (airport.data.rnavApproaches) {
        const matches = new Map();
        for (const route of airport.data.rnavApproaches.filter((item) => item.runway === runway.name)) {
            const index = route.points.findIndex((point) => point.name === entry);
            if (index >= 0 && index < route.points.length - 1) matches.set(route.id, route.points.slice(index, -1));
        }
        if (!matches.size) return [false, `no flyable RNAV approach via ${entry} for runway ${runway.name}`];
        if (matches.size > 1) return [false, `multiple RNAV approaches via ${entry}; specify a fix unique to the approach`];
        const [id, legs] = [...matches.entries()][0];
        name = `RNAV ${id}`;
        points = legs.map((leg) => ({
            position: new StaticPositionModel(leg.coordinates, airport.positionModel, airport.magneticNorth),
            altitude: leg.altitude,
            speed: leg.speed
        }));
    } else {
        const fix = NavigationLibrary.findFixByName(entry);
        if (!fix) return [false, `unknown waypoint ${entry}`];
        name = 'simulated RNAV';
        points = [{ position: fix.positionModel }, ...finalJoin(runway, fix.positionModel, aircraft.altitude, false)];
    }
    return [true, new ApproachGuidance(runway, points, name)];
}
