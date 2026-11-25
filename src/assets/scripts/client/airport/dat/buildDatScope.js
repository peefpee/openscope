import { FLIGHT_RULES } from '../../constants/aircraftConstants';
import StaticPositionModel from '../../base/StaticPositionModel';
import { buildDatApproaches } from './buildDatApproaches';
import { buildDatProcedures } from './buildDatProcedures';
import buildDatTraffic from './buildDatTraffic';

// An airport CIFP file references fixes by name. Only draw segments for which
// both endpoints are known. Vectors, holds, and arcs break the plotted track.
function waypointKey(leg, icao) {
    // earth_fix.dat distinguishes en-route and airport-owned fixes. Navaids
    // live in a different database, even if the identifier happens to match.
    let owner = leg.section;
    if (leg.section === 'E' && leg.subsection === 'A') {
        owner = 'ENRT';
    } else if (leg.section === 'P' && leg.subsection === 'C') {
        owner = icao;
    }
    return `${owner}/${leg.region}/${leg.fix}`;
}

// XP FIX1101/1200 packs ARINC 424 field 5.42 into a little-endian integer.
// The first character is the waypoint type. The other two describe its use.
function waypointFlightRules(packedType) {
    if (!/^\d+$/.test(packedType) || Number(packedType) > 0xffffff) return null;
    const type = String.fromCharCode(Number(packedType) % 256);
    if (type === 'V') return FLIGHT_RULES.VFR;
    return 'ACIMNORUW'.includes(type) ? FLIGHT_RULES.IFR : null;
}

export function resolveWaypoints(data, fixFile = '') {
    const wanted = new Set();
    for (const group of Object.values(data.procedures)) {
        for (const procedure of group.values()) {
            for (const branch of procedure.branches.values()) {
                for (const leg of branch.legs) {
                    if (leg.fix && !data.runways.has(leg.fix)) wanted.add(waypointKey(leg, data.icao));
                    if (leg.center) wanted.add(waypointKey(leg.center, data.icao));
                }
            }
        }
    }

    const positions = new Map();
    const otherFixes = new Map();
    const enrouteNames = new Set();
    const vfrWaypoints = [];
    const referencedNames = new Set([...wanted].map((key) => key.split('/')[2]));
    const threshold = [...data.runways.values()][0];
    const center = threshold && new StaticPositionModel(threshold.position);
    for (const line of fixFile.split(/\r?\n/)) {
        const [lat, lon, fix, airport, region, packedType] = line.trim().split(/\s+/, 6);
        const key = `${airport}/${region}/${fix}`;
        if (airport !== 'ENRT' && airport !== data.icao) {
            continue;
        }
        const position = [Number(lat), Number(lon)];
        if (!position.every(Number.isFinite) || Math.abs(position[0]) > 90 || Math.abs(position[1]) > 180) {
            continue;
        }

        const referenced = wanted.has(key);
        const rules = waypointFlightRules(packedType);
        // Older five-column files have no type. A matching instrument procedure
        // can establish an IFR use, but an unreferenced record cannot.
        if (!rules && (packedType !== undefined || !referenced)) continue;

        if (referenced && rules !== FLIGHT_RULES.VFR) {
            // An ambiguous identifier must not be resolved to an arbitrary location.
            const unique = !positions.has(key) || String(positions.get(key)) === String(position);
            positions.set(key, unique ? position : null);
            if (airport === 'ENRT') enrouteNames.add(fix);
            continue;
        }

        const range = airport === 'ENRT' ? 80 : 40;
        if (!center || !/^[A-Z0-9]+$/.test(fix) || Math.abs(position[0] - center.latitude) > range / 59 ||
            center.distanceToPosition(new StaticPositionModel(position)) > range) {
            continue;
        }
        if (rules === FLIGHT_RULES.VFR) {
            const name = line.trim().split(/\s+/).slice(6).join(' ') || fix;
            vfrWaypoints.push({ id: fix, name, airport, region, position });
        } else if (!referencedNames.has(fix)) {
            const unique = !otherFixes.has(fix) || String(otherFixes.get(fix)) === String(position);
            otherFixes.set(fix, unique ? position : null);
            if (airport === 'ENRT') enrouteNames.add(fix);
        }
    }

    const nearby = {};
    for (const [name, point] of otherFixes) {
        if (point) nearby[name] = point;
    }
    return {
        positions, nearby, enrouteNames, vfrWaypoints,
        missing: [...wanted].filter((key) => !positions.get(key)).length,
        total: wanted.size
    };
}

function pairRunways(thresholds) {
    const pairs = [];
    for (const runway of thresholds.values()) {
        const number = Number(runway.id.slice(2, 4));
        if (number > 18) {
            continue;
        }

        const side = { L: 'R', R: 'L', C: 'C' }[runway.id[4]] || '';
        const other = thresholds.get(`RW${number + 18}${side}`);
        if (other) {
            pairs.push({
                name: [runway.id.slice(2), other.id.slice(2)],
                end: [runway.position, other.position],
                ils: [false, false]
            });
        }
    }

    return pairs;
}

export function buildDatScope(data, waypoints) {
    const runways = pairRunways(data.runways);
    if (!data.icao || !runways.length) {
        return null;
    }

    const maps = [{ name: 'Runways', lines: runways.map(({ end }) => [...end[0].slice(0, 2), ...end[1].slice(0, 2)]) }];
    const fixes = {};
    const procedureFixes = new Set();
    const approachFixes = new Set();
    for (const [kind, group] of Object.entries(data.procedures)) {
        for (const procedure of group.values()) {
            const lines = [];
            for (const branch of procedure.branches.values()) {
                const departureEnd = kind === 'SID' && data.runways.get(branch.transition);
                let previous = departureEnd ? departureEnd.position : null;
                for (const leg of branch.legs) {
                    const threshold = data.runways.get(leg.fix);
                    const position = threshold ? threshold.position : waypoints.positions.get(waypointKey(leg, data.icao));
                    if (position && !threshold && /^[A-Z0-9]+$/.test(leg.fix)) {
                        fixes[leg.fix] = position;
                        (kind === 'APPCH' ? approachFixes : procedureFixes).add(leg.fix);
                    }
                    if (position && previous && ['TF', 'CF', 'DF'].includes(leg.path)) {
                        lines.push([...previous.slice(0, 2), ...position.slice(0, 2)]);
                    }
                    previous = position || null;
                }
            }
            if (lines.length) {
                maps.push({ name: `${kind} ${procedure.id}`, lines });
            }
        }
    }

    const runwayIds = [].concat(...runways.map((pair) => pair.name));
    const positionFor = (leg) => waypoints.positions.get(waypointKey(leg, data.icao));
    const procedures = buildDatProcedures(data, runwayIds, fixes, positionFor);
    // Retain the file's preferred order when runways have equal coverage.
    const coverage = (name) => [procedures.sids, procedures.stars].filter((group) => {
        return Object.values(group).some((proc) => proc.rwy[data.icao + name]);
    }).length;
    const active = runwayIds.reduce((best, name) => (coverage(name) > coverage(best) ? name : best));
    const pair = runways.find((p) => p.name.includes(active));
    const end = pair.name[0] === active ? pair.end : [pair.end[1], pair.end[0]];
    const position = end[0];
    const positions = { ...waypoints.nearby, ...fixes };
    const traffic = buildDatTraffic(data.icao, active, end, procedures, positions, waypoints.enrouteNames,
        new Set(waypoints.vfrWaypoints.map((point) => point.id)));

    return {
        icao: data.icao,
        name: `${data.icao} DAT import`,
        isDatImport: true,
        spokenAirportName: ({
            YMHB: 'Hobart', YMML: 'Melbourne', YSSY: 'Sydney', YBBN: 'Brisbane', YPPH: 'Perth',
            YPAD: 'Adelaide', YSCB: 'Canberra', YPDN: 'Darwin', YBCS: 'Cairns', YMLT: 'Launceston',
            YARM: 'Armidale', YBCG: 'Gold Coast', YMAV: 'Avalon'
        })[data.icao],
        // Only scope.fixes enters the IFR navigation library.
        vfrWaypoints: waypoints.vfrWaypoints,
        rnavApproaches: buildDatApproaches(data, positionFor),
        position,
        magnetic_north: 0,
        wind: { speed: 0, angle: 0 },
        rangeRings: { enabled: false, center: position, radius_nm: 5 },
        ...traffic,
        ...procedures,
        runways,
        arrivalRunway: active,
        departureRunway: active,
        maps,
        defaultMaps: ['Runways'],
        fixGroups: { procedure: [...procedureFixes], approach: [...approachFixes] },
        fixes: { ...positions, ...traffic.fixes }
    };
}
