import { PERFORMANCE } from '../../constants/aircraftConstants';
import { MCP_MODE } from '../ModeControl/modeControlConstants';

const KM_PER_KNOT_SECOND = 1.852 / 3600;
export function turnRate(aircraft) {
    const speed = Math.max(30, aircraft.trueAirspeed || aircraft.speed);
    const bank = Math.min(40, Math.max(5, aircraft.model.bankAngle || 25)) * Math.PI / 180;
    return Math.min(PERFORMANCE.TURN_RATE, 9.80665 * Math.tan(bank) / (speed * 0.514444));
}

// Integrate in the same relative coordinate system as the scope and conflict engine.
// The simulation computes the crab angle before passing a target heading here.
export function trajectory(aircraft, airport, seconds, targetHeading, targetAltitude) {
    const samples = [];
    let [x, y] = aircraft.relativePosition;
    let { altitude } = aircraft;
    let { heading } = aircraft;
    const speed = Math.max(0, aircraft.trueAirspeed || aircraft.speed);
    const rate = turnRate(aircraft);
    const climb = aircraft.model.rate.climb / 60;
    const descent = aircraft.model.rate.descent / 60;
    const step = 3;
    for (let elapsed = 0; elapsed < seconds; elapsed += step) {
        const dt = Math.min(step, seconds - elapsed);
        const error = Math.atan2(Math.sin(targetHeading - heading), Math.cos(targetHeading - heading));
        heading += Math.sign(error) * Math.min(Math.abs(error), rate * dt);
        altitude += Math.max(-descent * dt, Math.min(climb * dt, targetAltitude - altitude));
        const wind = airport.getWindVectorAtAltitude(altitude);
        x += (Math.sin(heading) * speed + wind[0]) * KM_PER_KNOT_SECOND * dt;
        y += (Math.cos(heading) * speed + wind[1]) * KM_PER_KNOT_SECOND * dt;
        samples.push({ position: [x, y], altitude, seconds: elapsed + dt });
    }
    return samples;
}

export function firstEntry(airport, aircraft, samples, bufferNM = 0) {
    const offset = bufferNM * 1.852;
    for (const sample of samples) {
        const [x, y] = sample.position;
        const positions = offset ? [[x, y], [x + offset, y], [x - offset, y], [x, y + offset], [x, y - offset]] : [[x, y]];
        for (const position of positions) {
            const region = airport.getAirspaceAtPosition(position, sample.altitude)
                .find((area) => !airport.isAirspaceEntryAuthorised(aircraft, area));
            if (region) return { ...sample, region };
        }
    }
    return null;
}

export function enforceOcta(aircraft, airport, now) {
    if (aircraft.projected || !aircraft.octaRequired || aircraft.isOnGround()) return;
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
    const predict = (h, a) => firstEntry(airport, aircraft, trajectory(aircraft, airport, seconds, h, a), buffer);
    const hazard = predict(heading, altitude);
    const previous = aircraft.predictedEntry;
    aircraft.predictedEntry = hazard;
    aircraft.octaGuidance = null;
    const infringement = airport.getAirspaceAtPosition(aircraft.relativePosition, aircraft.altitude)
        .find((area) => !airport.isAirspaceEntryAuthorised(aircraft, area));
    if (infringement && !aircraft.infringing) {
        aircraft.infringements.push({ time: now, region: infringement.name || infringement.type });
        aircraft.radioCall('inside restricted airspace, correcting track', 'app');
    }
    aircraft.infringing = Boolean(infringement);
    if (!hazard) return;
    if (!previous && (aircraft.lastOctaCall == null || now - aircraft.lastOctaCall >= 60)) {
        aircraft.radioCall('unable to maintain present track, remaining OCTA', 'app');
        aircraft.lastOctaCall = now;
    }
    let best = { heading, altitude, seconds: hazard.seconds };
    const offsets = [0, 30, -30, 60, -60, 90, -90, 135, -135, 180];
    const hasAssignedAltitude = aircraft.mcp && aircraft.mcp.altitudeMode === MCP_MODE.ALTITUDE.HOLD;
    const candidateAltitudes = hasAssignedAltitude ? [altitude] : [aircraft.altitude, altitude];

    for (const a of candidateAltitudes) {
        for (const degrees of offsets) {
            const h = aircraft.heading + degrees * Math.PI / 180;
            const entry = predict(h, a);
            if (!entry || entry.seconds > best.seconds) {
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
