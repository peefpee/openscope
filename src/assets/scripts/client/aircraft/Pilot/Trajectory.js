import { PERFORMANCE } from '../../constants/aircraftConstants';

const KM_PER_KNOT_SECOND = 1.852 / 3600;
export function turnRate(aircraft) {
    const speed = Math.max(30, aircraft.trueAirspeed || aircraft.speed);
    const bank = Math.min(40, Math.max(5, aircraft.model.bankAngle || 25)) * Math.PI / 180;
    return Math.min(PERFORMANCE.TURN_RATE, 9.80665 * Math.tan(bank) / (speed * 0.514444));
}

// Integrate in the same relative coordinate system as the scope and conflict engine.
// The simulation computes the crab angle before passing a target heading here.
export function trajectory(aircraft, airport, seconds, targetHeading, targetAltitude, followRoute = false) {
    const samples = [];
    let [x, y] = aircraft.relativePosition;
    let { altitude } = aircraft;
    let { heading } = aircraft;
    const speed = Math.max(0, aircraft.trueAirspeed || aircraft.speed);
    const rate = turnRate(aircraft);
    const climb = aircraft.model.rate.climb / 60;
    const descent = aircraft.model.rate.descent / 60;
    const route = followRoute && aircraft.pilot && aircraft.pilot.approachGuidance;
    let leg = route ? route.index : 0;
    let desiredHeading = targetHeading;
    let desiredAltitude = targetAltitude;
    const step = 3;
    for (let elapsed = 0; elapsed < seconds; elapsed += step) {
        const dt = Math.min(step, seconds - elapsed);
        const wind = airport.getWindVectorAtAltitude(altitude);
        if (route && leg < route.points.length) {
            let waypoint = route.points[leg];
            const [wx, wy] = waypoint.position.relativePosition;
            if (Math.hypot(wx - x, wy - y) < 1.48) {
                leg += 1;
                waypoint = route.points[leg];
            }
            const destination = waypoint ? waypoint.position : route.runway.positionModel;
            const [tx, ty] = destination.relativePosition;
            const track = Math.atan2(tx - x, ty - y);
            const crosswind = wind[0] * Math.cos(track) - wind[1] * Math.sin(track);
            desiredHeading = track - Math.asin(Math.max(-1, Math.min(1, crosswind / Math.max(1, speed))));
            if (waypoint && Number.isFinite(waypoint.altitude)) desiredAltitude = waypoint.altitude;
        }
        const error = Math.atan2(Math.sin(desiredHeading - heading), Math.cos(desiredHeading - heading));
        heading += Math.sign(error) * Math.min(Math.abs(error), rate * dt);
        altitude += Math.max(-descent * dt, Math.min(climb * dt, desiredAltitude - altitude));
        x += (Math.sin(heading) * speed + wind[0]) * KM_PER_KNOT_SECOND * dt;
        y += (Math.cos(heading) * speed + wind[1]) * KM_PER_KNOT_SECOND * dt;
        samples.push({ position: [x, y], altitude, seconds: elapsed + dt });
    }
    return samples;
}

export function firstEntry(airport, aircraft, samples, bufferNM = 0) {
    const offset = bufferNM * 1.852;
    const offsets = offset ? [[0, 0], [offset, 0], [-offset, 0], [0, offset], [0, -offset]] : [[0, 0]];
    let previous = { position: aircraft.relativePosition, seconds: 0, altitude: aircraft.altitude };
    for (const sample of samples) {
        const startSeconds = previous.seconds;
        const entries = [];
        for (const [ox, oy] of offsets) {
            const start = [previous.position[0] + ox, previous.position[1] + oy];
            const end = [sample.position[0] + ox, sample.position[1] + oy];
            airport.airspaceIndex.segment(start, end, previous.altitude, sample.altitude, (areas, position, altitude, t) => {
                const region = areas.find((area) => !airport.isAirspaceEntryAuthorised(aircraft, area, altitude));
                if (!region) return false;
                const seconds = startSeconds + (sample.seconds - startSeconds) * t;
                entries.push({
                    position, altitude, seconds, region
                });
                return true;
            });
        }
        if (entries.length) return entries.reduce((a, b) => (a.seconds <= b.seconds ? a : b));
        previous = sample;
    }
    return null;
}

export function enforceOcta(aircraft, airport, now) {
    if (aircraft.projected || aircraft.rules !== 'vfr' || !airport || !/^Y/i.test(airport.icao) || aircraft.isOnGround()) return;
    const config = airport.data.vfrOptions || {};
    if (aircraft.nextOctaCheck > now && aircraft.octaGuidance) {
        aircraft.targetHeading = aircraft.octaGuidance.heading;
        aircraft.target.altitude = aircraft.octaGuidance.altitude;
        return;
    }
    if (aircraft.nextOctaCheck > now) return;
    aircraft.nextOctaCheck = now + Math.max(0.5, Math.min(5, config.checkSeconds || 2));
    const seconds = Math.min(180, Math.max(30, config.lookaheadSeconds || 90));
    const buffer = config.bufferNM == null ? 0.25 : Math.max(0, config.bufferNM);
    const heading = aircraft.targetHeading;
    const { altitude } = aircraft.target;
    const predict = (h, a, follow = false) => firstEntry(airport, aircraft, trajectory(aircraft, airport, seconds, h, a, follow), buffer);
    const hazard = predict(heading, altitude, true);
    const previous = aircraft.predictedEntry;
    aircraft.predictedEntry = hazard;
    aircraft.octaGuidance = null;
    const infringement = airport.getAirspaceAtPosition(aircraft.relativePosition, aircraft.altitude)
        .find((area) => !airport.isAirspaceEntryAuthorised(aircraft, area));
    if (infringement && !aircraft.infringing) {
        aircraft.infringements.push({ time: now, region: infringement.name || infringement.type });
        aircraft.radioCall('airspace infringement, correcting track', 'app');
    }
    aircraft.infringing = Boolean(infringement);
    if (!hazard) return;
    if (!previous && (aircraft.lastOctaCall == null || now - aircraft.lastOctaCall >= 60)) {
        aircraft.radioCall('unable to maintain present track, remaining OCTA', 'app');
        aircraft.lastOctaCall = now;
    }
    let best = { heading, altitude, seconds: hazard.seconds };
    const offsets = [0, 30, -30, 60, -60, 90, -90, 135, -135, 180];
    // Preserve the assignment in the MCP. Temporarily level off if following it
    // would enter an unauthorised shelf, then resume once a safe track exists.
    const candidateAltitudes = [...new Set([altitude, aircraft.altitude])];
    let recoveryCost = Infinity;
    for (const a of candidateAltitudes) {
        for (const degrees of offsets) {
            const h = aircraft.heading + degrees * Math.PI / 180;
            const entry = predict(h, a);
            let cost = Infinity;
            if (infringement && entry && entry.seconds === best.seconds) {
                const path = trajectory(aircraft, airport, seconds, h, a);
                const blocked = path.filter((sample) => airport.getAirspaceAtPosition(sample.position, sample.altitude)
                    .some((area) => !airport.isAirspaceEntryAuthorised(aircraft, area, sample.altitude)));
                const end = path[path.length - 1];
                cost = blocked.length * 1000 + (blocked.includes(end) ? infringement.distanceToBoundary(end.position) : 0);
            }
            if (!entry || entry.seconds > best.seconds || cost < recoveryCost) {
                recoveryCost = cost;
                best = { heading: h, altitude: a, seconds: entry ? entry.seconds : Infinity };
            }
            if (!entry) break;
        }
        if (best.seconds === Infinity) break;
    }
    aircraft.octaGuidance = best;
    aircraft.targetHeading = best.heading;
    aircraft.target.altitude = best.altitude;
    aircraft.target.turn = null;
}
