import { PERFORMANCE } from '../../constants/aircraftConstants';
import { heading_to_string } from '../../utilities/unitConverters';
import { radio_heading } from '../../utilities/radioUtilities';

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

export function firstEntry(airport, aircraft, samples, bufferNM = 0, verticalBufferFt = 0) {
    const offset = bufferNM * 1.852;
    const offsets = offset ? [[0, 0], [offset, 0], [-offset, 0], [0, offset], [0, -offset]] : [[0, 0]];
    const altOffsets = verticalBufferFt > 0 ? [0, verticalBufferFt, -verticalBufferFt] : [0];
    let previous = { position: aircraft.relativePosition, seconds: 0, altitude: aircraft.altitude };
    for (const sample of samples) {
        const startSeconds = previous.seconds;
        const entries = [];
        for (const [ox, oy] of offsets) {
            const start = [previous.position[0] + ox, previous.position[1] + oy];
            const end = [sample.position[0] + ox, sample.position[1] + oy];
            for (const dz of altOffsets) {
                const lower = Math.max(0, previous.altitude + dz);
                const upper = Math.max(0, sample.altitude + dz);
                airport.airspaceIndex.segment(start, end, lower, upper, (areas, position, altitude, t) => {
                    const region = areas.find((area) => !airport.isAirspaceEntryAuthorised(aircraft, area, altitude));
                    if (!region) return false;
                    const seconds = startSeconds + (sample.seconds - startSeconds) * t;
                    entries.push({
                        position, altitude, seconds, region
                    });
                    return true;
                });
            }
        }
        if (entries.length) return entries.reduce((a, b) => (a.seconds <= b.seconds ? a : b));
        previous = sample;
    }
    return null;
}

/**
 * Evaluate a controller-assigned heading or altitude before executing it for an OCTA aircraft.
 *
 * @param {AircraftModel} aircraft
 * @param {AirportModel} airport
 * @param {Object} options - { heading, altitude }
 * @return {Object} { allowed, hazard, reason }
 */
export function evaluateOctaCommand(aircraft, airport, { heading } = {}) {
    if (!aircraft || !airport || !aircraft.octaRequired || aircraft.projected || aircraft.isOnGround()) {
        return { allowed: true };
    }

    const config = airport.data.vfrOptions || {};
    const buffer = config.bufferNM == null ? 0.25 : Math.max(0, config.bufferNM);
    const verticalBuffer = config.verticalBufferFt == null ? 100 : Math.max(0, config.verticalBufferFt);

    if (heading != null) {
        const headingSamples = trajectory(aircraft, airport, 30, heading, aircraft.altitude, false);
        const headingHazard = firstEntry(airport, aircraft, headingSamples, buffer, verticalBuffer);
        if (headingHazard && headingHazard.seconds <= 20) {
            const hdgStr = heading_to_string(heading);
            return {
                allowed: false,
                hazard: headingHazard,
                reason: {
                    log: `unable heading ${hdgStr}, remaining outside controlled airspace`,
                    say: `unable heading ${radio_heading(hdgStr)}, remaining outside controlled airspace`
                }
            };
        }
    }

    return { allowed: true };
}

export function enforceOcta(aircraft, airport, now) {
    if (aircraft.projected || aircraft.rules !== 'vfr' || !airport || !/^Y/i.test(airport.icao) || aircraft.isOnGround()) return;
    if (!aircraft.octaRequired) {
        aircraft.predictedEntry = null;
        aircraft.octaGuidance = null;
        aircraft.octaStatus = 'normal';
        return;
    }

    const config = airport.data.vfrOptions || {};
    if (aircraft.nextOctaCheck > now && aircraft.octaGuidance) {
        aircraft.targetHeading = aircraft.octaGuidance.heading;
        aircraft.target.altitude = aircraft.octaGuidance.altitude;
        aircraft.target.turn = null;
        return;
    }
    if (aircraft.nextOctaCheck > now) return;

    aircraft.nextOctaCheck = now + Math.max(0.5, Math.min(5, config.checkSeconds || 2));
    const seconds = Math.min(180, Math.max(30, config.lookaheadSeconds || 90));
    const buffer = config.bufferNM == null ? 0.25 : Math.max(0, config.bufferNM);
    const verticalBuffer = config.verticalBufferFt == null ? 100 : Math.max(0, config.verticalBufferFt);
    const heading = aircraft.targetHeading;
    const { altitude } = aircraft.target;
    const predict = (h, a, follow = false) => firstEntry(
        airport,
        aircraft,
        trajectory(aircraft, airport, seconds, h, a, follow),
        buffer,
        verticalBuffer
    );

    const hazard = predict(heading, altitude, true);
    const previous = aircraft.predictedEntry;
    const prevGuidance = aircraft.octaGuidance;
    aircraft.predictedEntry = hazard;
    aircraft.octaGuidance = null;

    const infringement = airport.getAirspaceAtPosition(aircraft.relativePosition, aircraft.altitude)
        .find((area) => !airport.isAirspaceEntryAuthorised(aircraft, area));

    if (infringement && !aircraft.infringing) {
        aircraft.infringements.push({ time: now, region: infringement.name || infringement.type });
        aircraft.radioCall('airspace infringement, correcting track', 'app');
    }
    aircraft.infringing = Boolean(infringement);

    if (!hazard && !infringement) {
        aircraft.octaStatus = 'normal';
        return;
    }

    if (!hazard && infringement) {
        aircraft.octaStatus = 'actual_infringement';
        return;
    }

    if (!previous && (aircraft.lastOctaCall == null || now - aircraft.lastOctaCall >= 60)) {
        aircraft.radioCall('unable to maintain present track, remaining OCTA', 'app');
        aircraft.lastOctaCall = now;
    }

    // Hysteresis: if the previous avoidance guidance is still completely safe, keep it to prevent heading oscillation.
    if (prevGuidance && !infringement) {
        const prevEntry = predict(prevGuidance.heading, prevGuidance.altitude, false);
        if (!prevEntry) {
            aircraft.octaGuidance = prevGuidance;
            aircraft.octaStatus = 'avoidance';
            aircraft.targetHeading = prevGuidance.heading;
            aircraft.target.altitude = prevGuidance.altitude;
            aircraft.target.turn = null;
            return;
        }
    }

    let best = { heading, altitude, seconds: hazard.seconds };
    const offsets = [0, 15, -15, 30, -30, 45, -45, 60, -60, 90, -90, 120, -120, 150, -150, 180];
    const minSafeAlt = airport.elevation + 500;
    const maxSafeAlt = aircraft.model && aircraft.model.ceiling ? aircraft.model.ceiling : 12500;
    const extraAlts = [];
    if (hazard && hazard.region && typeof hazard.region.altitudeLimitsAt === 'function') {
        const [lower, upper] = hazard.region.altitudeLimitsAt(hazard.position || aircraft.relativePosition);
        if (Number.isFinite(lower) && lower - verticalBuffer >= minSafeAlt) {
            extraAlts.push(Math.floor((lower - verticalBuffer) / 100) * 100);
        }
        if (Number.isFinite(upper) && upper + verticalBuffer <= maxSafeAlt) {
            extraAlts.push(Math.ceil((upper + verticalBuffer) / 100) * 100);
        }
    }
    const candidateAltitudes = [...new Set([altitude, aircraft.altitude, ...extraAlts])]
        .filter((a) => Number.isFinite(a) && a >= minSafeAlt && a <= maxSafeAlt);

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
    if (infringement) {
        aircraft.octaStatus = 'actual_infringement';
    } else if (best.seconds === Infinity) {
        aircraft.octaStatus = 'avoidance';
    } else {
        aircraft.octaStatus = 'unavoidable_infringement';
        if (aircraft.lastUnavoidableCall == null || now - aircraft.lastUnavoidableCall >= 60) {
            aircraft.radioCall('unable to remain OCTA, unavoidable airspace infringement', 'app');
            aircraft.lastUnavoidableCall = now;
        }
    }

    aircraft.targetHeading = best.heading;
    aircraft.target.altitude = best.altitude;
    aircraft.target.turn = null;
}
