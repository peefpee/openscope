// Coordinates and grid cells use OpenScope's airport-relative kilometres.
const CELL = 20;
const key = (x, y) => x + '/' + y;
export const controlled = (area) => /^[A-E]$|^CTR$/.test(area.airspace_class) || area.type === 'CTR';
const special = (area) => ['P', 'R', 'Q'].includes(area.type);

export default class AirspaceIndex {
    constructor(regions) {
        this.cells = new Map();
        this.large = [];
        this.regions = regions;
        for (const region of regions) {
            const [left, bottom, right, top] = region.bounds.map((v) => Math.floor(v / CELL));
            if ((right - left + 1) * (top - bottom + 1) > 400) { this.large.push(region); continue; }
            for (let x = left; x <= right; x += 1) {
                for (let y = bottom; y <= top; y += 1) {
                    const id = key(x, y);
                    if (!this.cells.has(id)) this.cells.set(id, []);
                    this.cells.get(id).push(region);
                }
            }
        }
    }

    at(point, altitude) {
        const local = this.cells.get(key(Math.floor(point[0] / CELL), Math.floor(point[1] / CELL))) || [];
        const hits = local.concat(this.large).filter((area) => area.isPointInside(point, altitude));
        const published = hits.some((area) => area.source === 'imported' && !special(area));
        return published ? hits.filter((area) => area.source === 'imported' || special(area)) : hits;
    }

    nearest(point, altitude) {
        let nearest = null;
        for (const region of this.regions) {
            const [lower, upper] = region.altitudeLimitsAt(point);
            if (altitude < lower || altitude > upper) continue;
            const distanceNM = region.distanceToBoundary(point);
            if (!nearest || distanceNM < nearest.distanceNM) nearest = { region, distanceNM };
        }
        return nearest;
    }

    along(route, altitudeProfile) {
        const hits = new Set();
        for (let i = 0; i < route.length; i += 1) {
            const first = route[Math.max(0, i - 1)];
            const next = route[i];
            const dx = next[0] - first[0];
            const dy = next[1] - first[1];
            const divisions = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.25));
            for (let j = 0; j <= divisions; j += 1) {
                const fraction = j / divisions;
                const lower = Array.isArray(altitudeProfile) ? altitudeProfile[Math.max(0, i - 1)] : altitudeProfile;
                const upper = Array.isArray(altitudeProfile) ? altitudeProfile[i] : altitudeProfile;
                this.at([first[0] + dx * fraction, first[1] + dy * fraction], lower + (upper - lower) * fraction)
                    .forEach((region) => hits.add(region));
            }
        }
        return [...hits];
    }
}

export function authorised(aircraft, area, airport) {
    if (area.type === 'P' || area.type === 'R') return false;
    if (!controlled(area)) return true;
    if (aircraft.rules !== 'vfr') return true;
    if (area.airspace_class === 'A') return false;
    if (area.airspace_class === 'E' && !aircraft.octaRequired) return true;
    const clearance = aircraft.entryClearance;
    return Boolean(clearance && clearance.airport === airport.icao && !aircraft.octaRequired);
}
