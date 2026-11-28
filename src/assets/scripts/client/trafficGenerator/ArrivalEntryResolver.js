import DynamicPositionModel from '../base/DynamicPositionModel';
import { nm } from '../utilities/unitConverters';
import { distance2d } from '../math/distance';
import { tau } from '../math/circle';
import { controlled, isLocalControlledRegion } from '../airport/AirspaceIndex';

const FALLBACK_CTR_CEILING_FT = 18000;

export const DEFAULT_SPAWN_BUFFER_NM = 5;
export const MIN_INITIAL_SEPARATION_NM = 6;
const MAX_EXTENSION_NM = 140;
const STEP_NM = 1;
const VECTOR_CANDIDATE_COUNT = 36;

function isOverlyingCentreOrSpecial(area) {
    if (!area) return true;
    if (['P', 'R', 'Q'].includes(area.type)) return true;
    if (area.airspace_class === 'A') return true;
    if (area.ceiling >= 45000) return true;
    if (/\b(ENROUTE|CENTRE|CENTER|FIR|UIR)\b/i.test(area.name || '')) return true;
    return false;
}

/**
 * Return the local approach-controlled airspace shelves for an airport.
 * Excludes overlying Class A / Centre sectors and special-use P/R/Q areas.
 *
 * @param {AirportModel} airport
 * @returns {Array<AirspaceModel>}
 */
export function getApproachControlledShelves(airport) {
    if (!airport) return [];
    const shelves = Array.isArray(airport.controlledShelves) && airport.controlledShelves.length ?
        airport.controlledShelves :
        (airport.airspace || []);

    const local = shelves.filter((area) => (
        area &&
        controlled(area) &&
        !isOverlyingCentreOrSpecial(area) &&
        isLocalControlledRegion(area, airport)
    ));

    if (local.length) return local;
    return (airport.airspace || []).filter((area) => area && !['P', 'R', 'Q'].includes(area.type));
}

/**
 * Resolve the upper altitude limit (in feet) of the approach controller's airspace.
 * Hierarchy:
 * 1. Local imported / airport-specific approach shelves
 * 2. Configured airport `ctr_ceiling` / `maxAssignableAltitude`
 * 3. Documented simulator fallback (`DEFAULT_CTR_CEILING_FT`)
 *
 * Preserves non-round altitudes (e.g. 8500, 12500, 24500) and clamps to
 * aircraft performance and terrain clearance when provided.
 *
 * @param {AirportModel} airport
 * @param {Object} [options]
 * @param {Object} [options.aircraftModel]
 * @param {Array<number>} [options.relativePosition]
 * @returns {number}
 */
export function resolveApproachCeiling(airport, options = {}) {
    if (!airport) return FALLBACK_CTR_CEILING_FT;

    const shelves = getApproachControlledShelves(airport);
    const importedApproach = shelves.filter((area) => (
        area.source === 'imported' && Number.isFinite(area.ceiling) && area.ceiling > 0
    ));
    const airportElevation = (airport.positionModel && airport.positionModel.elevation) || 0;

    let ceiling = null;
    if (importedApproach.length) {
        ceiling = Math.max(...importedApproach.map((area) => area.ceiling));
    } else if (Number.isFinite(airport.ctr_ceiling) && airport.ctr_ceiling > airportElevation) {
        ceiling = airport.ctr_ceiling;
    } else if (Number.isFinite(airport.maxAssignableAltitude) && airport.maxAssignableAltitude > airportElevation) {
        ceiling = airport.maxAssignableAltitude;
    } else if (shelves.length) {
        const finiteCeilings = shelves.map((s) => s.ceiling).filter((c) => Number.isFinite(c) && c > airportElevation);
        if (finiteCeilings.length) ceiling = Math.max(...finiteCeilings);
    }

    if (!Number.isFinite(ceiling) || ceiling <= 0) {
        ceiling = FALLBACK_CTR_CEILING_FT;
    }

    const { aircraftModel, relativePosition } = options;
    if (aircraftModel && Number.isFinite(aircraftModel.ceiling) && aircraftModel.ceiling > 0) {
        ceiling = Math.min(ceiling, aircraftModel.ceiling);
    }

    if (relativePosition && typeof airport.terrainElevationAt === 'function') {
        const terrainFt = airport.terrainElevationAt(relativePosition) || 0;
        const safeFloor = Math.max(airportElevation + 1000, terrainFt + 1000);
        if (ceiling < safeFloor) {
            ceiling = safeFloor;
        }
    }

    return Math.round(ceiling);
}

/**
 * Check whether a 2D relative position [kmNorth, kmEast] lies laterally
 * inside any approach-controlled airspace shelf.
 *
 * @param {AirportModel} airport
 * @param {Array<number>} relativePosition
 * @returns {boolean}
 */
export function isPointInsideApproachAirspace(airport, relativePosition) {
    if (!airport || !relativePosition) return false;
    const shelves = getApproachControlledShelves(airport);
    return shelves.some((area) => typeof area.isPointInside2D === 'function' && area.isPointInside2D(relativePosition));
}

/**
 * Minimum distance in NM from `relativePosition` to any approach-controlled boundary.
 * Returns 0 if inside any shelf, or Infinity if no shelves exist.
 *
 * @param {AirportModel} airport
 * @param {Array<number>} relativePosition
 * @returns {number}
 */
export function minDistanceToApproachBoundaryNm(airport, relativePosition) {
    if (!airport || !relativePosition) return Infinity;
    const shelves = getApproachControlledShelves(airport);
    if (!shelves.length) return Infinity;

    let minDist = Infinity;
    for (let i = 0; i < shelves.length; i += 1) {
        const area = shelves[i];
        if (typeof area.isPointInside2D === 'function' && area.isPointInside2D(relativePosition)) {
            return 0;
        }
        if (typeof area.distanceToBoundary === 'function') {
            minDist = Math.min(minDist, area.distanceToBoundary(relativePosition));
        }
    }
    return minDist;
}

function isInsideRestrictedArea(airport, relativePosition, altitude) {
    if (!airport || !relativePosition) return false;
    const regions = Array.isArray(airport.airspaceRegions) ? airport.airspaceRegions : (airport.airspace || []);
    return regions.some((area) => (
        area &&
        ['P', 'R'].includes(area.type) &&
        typeof area.isPointInside === 'function' &&
        area.isPointInside(relativePosition, altitude)
    ));
}

function hasTerrainClearance(airport, relativePosition, altitude) {
    if (!airport || typeof airport.terrainElevationAt !== 'function') return true;
    const terrainFt = airport.terrainElevationAt(relativePosition) || 0;
    return altitude >= terrainFt + 1000;
}

function isSeparatedFromExisting(relativePosition, existingPositions = [], minSepNm = MIN_INITIAL_SEPARATION_NM) {
    for (let i = 0; i < existingPositions.length; i += 1) {
        const other = existingPositions[i];
        if (!other) continue;
        if (nm(distance2d(relativePosition, other)) < minSepNm) {
            return false;
        }
    }
    return true;
}

function isValidSpawnPoint(airport, positionModel, altitude, bufferNm, existingPositions, minSepNm) {
    const rel = positionModel.relativePosition;
    if (isPointInsideApproachAirspace(airport, rel)) return false;
    if (minDistanceToApproachBoundaryNm(airport, rel) < bufferNm - 0.15) return false;
    if (isInsideRestrictedArea(airport, rel, altitude)) return false;
    if (!hasTerrainClearance(airport, rel, altitude)) return false;
    if (existingPositions && existingPositions.length && !isSeparatedFromExisting(rel, existingPositions, minSepNm)) {
        return false;
    }
    return true;
}

function projectFromPosition(airport, anchorPosition, bearingRad, distanceNm) {
    const [lat, lon] = anchorPosition.generateCoordinatesFromBearingAndDistance(bearingRad, distanceNm);
    return new DynamicPositionModel([lat, lon], airport.positionModel, airport.magneticNorth);
}

/**
 * Walk outward from `anchorPosition` along `outwardBearing` until outside all
 * approach-controlled shelves + `bufferNm`.
 */
function findBoundaryExitAlongBearing(airport, anchorPosition, outwardBearing, bufferNm, altitude) {
    let dist = 0;
    let lastValid = null;

    while (dist <= MAX_EXTENSION_NM) {
        const candidate = projectFromPosition(airport, anchorPosition, outwardBearing, dist);
        const rel = candidate.relativePosition;
        const inside = isPointInsideApproachAirspace(airport, rel);
        const boundaryDist = inside ? 0 : minDistanceToApproachBoundaryNm(airport, rel);

        if (!inside && boundaryDist >= bufferNm - 0.15 &&
            !isInsideRestrictedArea(airport, rel, altitude) &&
            hasTerrainClearance(airport, rel, altitude)) {
            lastValid = candidate;
            break;
        }
        dist += STEP_NM;
    }

    return lastValid;
}

/**
 * Resolve an airspace-aware spawn entry for a published STAR or fixed route.
 * Preserves the STAR and all waypoints; if the first fix is inside or too close
 * to approach airspace, extends outward along the reciprocal inbound track.
 *
 * @param {AirportModel} airport
 * @param {RouteModel} routeModel
 * @param {Object} [options]
 * @returns {Object|null}
 */
export function resolveRouteArrivalEntry(airport, routeModel, options = {}) {
    if (!airport || !routeModel || !Array.isArray(routeModel.waypoints) || !routeModel.waypoints.length) {
        return null;
    }

    const bufferNm = options.bufferNm != null ? options.bufferNm : DEFAULT_SPAWN_BUFFER_NM;
    const waypoints = routeModel.waypoints.filter((wp) => wp && !wp.isVectorWaypoint && wp.positionModel);
    if (!waypoints.length) return null;

    const firstWp = waypoints[0];
    const secondWp = waypoints[1];
    const inboundBearing = secondWp &&
        (firstWp.relativePosition[0] !== secondWp.relativePosition[0] ||
            firstWp.relativePosition[1] !== secondWp.relativePosition[1]) ?
        firstWp.positionModel.bearingToPosition(secondWp.positionModel) :
        firstWp.positionModel.bearingToPosition(airport.positionModel);
    const outwardBearing = (inboundBearing + Math.PI) % tau();

    const provisionalAlt = resolveApproachCeiling(airport, options);
    let { positionModel } = firstWp;
    let heading = inboundBearing;

    if (!isValidSpawnPoint(airport, positionModel, provisionalAlt, bufferNm, options.existingPositions, options.minSepNm)) {
        const extended = findBoundaryExitAlongBearing(airport, firstWp.positionModel, outwardBearing, bufferNm, provisionalAlt);
        if (!extended) return null;
        positionModel = extended;
        heading = extended.bearingToPosition(firstWp.positionModel);

        const minSep = options.minSepNm || MIN_INITIAL_SEPARATION_NM;
        if (options.existingPositions && options.existingPositions.length &&
            !isSeparatedFromExisting(positionModel.relativePosition, options.existingPositions, minSep)) {
            for (let extra = 6; extra <= 48; extra += 6) {
                const staggered = projectFromPosition(airport, extended, outwardBearing, extra);
                if (isValidSpawnPoint(
                    airport,
                    staggered,
                    provisionalAlt,
                    bufferNm,
                    options.existingPositions,
                    options.minSepNm
                )) {
                    positionModel = staggered;
                    heading = staggered.bearingToPosition(firstWp.positionModel);
                    break;
                }
            }
        }
    }

    const altitude = resolveApproachCeiling(airport, {
        ...options,
        relativePosition: positionModel.relativePosition
    });

    return {
        positionModel,
        heading,
        altitude,
        nextFix: firstWp.name
    };
}

/**
 * Resolve an airspace-aware spawn entry for a random vector arrival using
 * bounded candidate generation outside the approach boundary.
 *
 * @param {AirportModel} airport
 * @param {RouteModel} routeModel
 * @param {Object} [options]
 * @returns {Object|null}
 */
export function resolveVectorArrivalEntry(airport, routeModel, options = {}) {
    if (!airport || !airport.positionModel) return null;

    const bufferNm = options.bufferNm != null ? options.bufferNm : DEFAULT_SPAWN_BUFFER_NM;
    const minSepNm = options.minSepNm != null ? options.minSepNm : MIN_INITIAL_SEPARATION_NM;
    const waypoints = (routeModel && Array.isArray(routeModel.waypoints)) ?
        routeModel.waypoints.filter((wp) => wp && !wp.isVectorWaypoint && wp.positionModel) :
        [];
    const inboundTarget = waypoints[1] || waypoints[0] || { positionModel: airport.positionModel, name: '' };
    const altitude = resolveApproachCeiling(airport, options);
    const origin = airport.positionModel;
    const baseOffset = Math.random() * tau();

    for (let i = 0; i < VECTOR_CANDIDATE_COUNT; i += 1) {
        const bearing = (baseOffset + (i * tau()) / VECTOR_CANDIDATE_COUNT) % tau();
        // Start searching outward from airport centre so non-circular / multi-shelf boundaries are crossed cleanly.
        let dist = Math.max(10, nm(airport.ctr_radius || 40) * 0.4);
        let candidate = null;
        while (dist <= MAX_EXTENSION_NM) {
            const probe = projectFromPosition(airport, origin, bearing, dist);
            if (!isPointInsideApproachAirspace(airport, probe.relativePosition) &&
                minDistanceToApproachBoundaryNm(airport, probe.relativePosition) >= bufferNm - 0.15) {
                candidate = probe;
                break;
            }
            dist += 2;
        }

        if (candidate && isValidSpawnPoint(airport, candidate, altitude, bufferNm, options.existingPositions, minSepNm)) {
            return {
                positionModel: candidate,
                heading: candidate.bearingToPosition(inboundTarget.positionModel),
                altitude: resolveApproachCeiling(airport, {
                    ...options,
                    relativePosition: candidate.relativePosition
                }),
                nextFix: inboundTarget.name || undefined
            };
        }
    }

    return null;
}

/**
 * Resolve pre-spawned arrival entries along a route, ensuring all initial aircraft
 * begin outside approach-controlled airspace with separation.
 *
 * @param {AirportModel} airport
 * @param {RouteModel} routeModel
 * @param {number} entrailDistanceNm
 * @param {Object} [options]
 * @returns {Array<Object>}
 */
export function resolvePreSpawnArrivalEntries(airport, routeModel, entrailDistanceNm = 15, options = {}) {
    const firstEntry = resolveRouteArrivalEntry(airport, routeModel, options);
    if (!firstEntry) return [];

    const waypoints = routeModel.waypoints.filter((wp) => wp && !wp.isVectorWaypoint && wp.positionModel);
    const firstWp = waypoints[0];
    const spacing = Math.max(MIN_INITIAL_SEPARATION_NM, entrailDistanceNm || 15);
    const count = Math.min(3, Math.max(1, options.maxCount || 2));
    const entries = [firstEntry];
    const outwardBearing = (firstEntry.heading + Math.PI) % tau();

    for (let i = 1; i < count; i += 1) {
        const candidate = projectFromPosition(airport, firstEntry.positionModel, outwardBearing, spacing * i);
        if (isValidSpawnPoint(
            airport,
            candidate,
            firstEntry.altitude,
            options.bufferNm != null ? options.bufferNm : DEFAULT_SPAWN_BUFFER_NM,
            options.existingPositions,
            options.minSepNm
        )) {
            entries.push({
                positionModel: candidate,
                heading: firstWp ? candidate.bearingToPosition(firstWp.positionModel) : firstEntry.heading,
                altitude: firstEntry.altitude,
                nextFix: firstEntry.nextFix
            });
        }
    }

    return entries;
}
