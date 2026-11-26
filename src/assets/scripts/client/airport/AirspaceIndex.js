// Coordinates and grid cells use OpenScope's airport-relative kilometres.
const CELL = 20;
const key = (x, y) => `${x}/${y}`;
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

    column(point) {
        const local = this.cells.get(key(Math.floor(point[0] / CELL), Math.floor(point[1] / CELL))) || [];
        return local.concat(this.large);
    }

    at(point, altitude) {
        const hits = this.column(point).filter((area) => area.isPointInside(point, altitude));
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

    // Split tracks at polygon edges and vertical limits so even narrow areas
    // between trajectory samples are tested. Subdivide AGL spans for terrain.
    segment(start, end, lower, upper, visit) {
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const dz = upper - lower;
        const ticks = new Set([0, 1]);
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / CELL));
        const candidates = new Set(this.large);
        for (let i = 0; i < steps; i++) {
            const x = Math.floor((start[0] + dx * i / steps) / CELL);
            const y = Math.floor((start[1] + dy * i / steps) / CELL);
            for (const col of [x, x + Math.sign(dx)]) {
                for (const row of [y, y + Math.sign(dy)]) {
                    (this.cells.get(key(col, row)) || []).forEach((region) => candidates.add(region));
                }
            }
        }
        const mark = (t) => { if (t > 0 && t < 1) ticks.add(t); };
        for (const region of candidates) {
            const [left, bottom, right, top] = region.bounds;
            if (Math.max(start[0], end[0]) < left || Math.min(start[0], end[0]) > right ||
                Math.max(start[1], end[1]) < bottom || Math.min(start[1], end[1]) > top) continue;
            if (dz) region.altitudeLimitsAt(start).forEach((limit) => mark((limit - lower) / dz));
            const limits = region.verticalLimits;
            if (limits && (limits.lower.agl || limits.upper.agl)) {
                const count = Math.ceil(Math.hypot(dx, dy) / 0.25);
                for (let j = 1; j < count; j++) mark(j / count);
            }
            const poly = region.relativePoly;
            let prev = poly[poly.length - 1];
            for (const next of poly) {
                const ex = next[0] - prev[0];
                const ey = next[1] - prev[1];
                const cross = dx * ey - dy * ex;
                if (cross) {
                    const px = prev[0] - start[0];
                    const py = prev[1] - start[1];
                    const edge = (px * dy - py * dx) / cross;
                    if (edge >= 0 && edge <= 1) mark((px * ey - py * ex) / cross);
                }
                prev = next;
            }
        }
        const ordered = [...ticks].sort((a, b) => a - b);
        const inspect = (t) => {
            const point = [start[0] + dx * t, start[1] + dy * t];
            const altitude = lower + dz * t;
            return visit(this.at(point, altitude), point, altitude, t);
        };
        for (let i = 0; i < ordered.length; i++) {
            if (i && inspect((ordered[i - 1] + ordered[i]) / 2)) return true;
            if (inspect(ordered[i])) return true;
        }
        return false;
    }

    along(route, altitudeProfile) {
        const hits = new Set();
        const level = (i) => (Array.isArray(altitudeProfile) ? altitudeProfile[i] : altitudeProfile);
        for (let i = route.length > 1 ? 1 : 0; i < route.length; i++) {
            const previous = Math.max(0, i - 1);
            this.segment(route[previous], route[i], level(previous), level(i), (areas) => {
                areas.forEach((area) => hits.add(area));
            });
        }
        return [...hits];
    }
}

export function classifyAirspaceCategory(area) {
    if (!area) return 'G';
    if (area.type === 'P') return 'PROHIBITED';
    if (area.type === 'R') return 'RESTRICTED';
    if (area.type === 'Q') return 'DANGER';
    if (area.type === 'CTR' || /\bCTR\b/i.test(area.name || '')) return 'CTR';
    if (area.type === 'TMA' || /\bTMA\b/i.test(area.name || '')) return 'TMA';
    if (area.type === 'CTA' || /\bCTA\b/i.test(area.name || '')) return 'CTA';
    if (controlled(area)) return 'CTA';
    return 'G';
}

export function isLocalControlledRegion(area, airport) {
    if (!area || !airport) return false;
    if (area.source === 'simulated') return true;
    if (typeof area.isPointInside2D === 'function' && area.isPointInside2D([0, 0])) return true;
    if (typeof area.distanceToBoundary === 'function') {
        const radiusNM = Math.max(15, (airport.ctr_radius || 0) / 1.852);
        return area.distanceToBoundary([0, 0]) <= radiusNM + 10;
    }
    return true;
}

export function authorised(aircraft, area, airport, altitude = aircraft.altitude) {
    if (area.type === 'P' || area.type === 'R') return false;
    if (!controlled(area)) return true;
    if (aircraft.rules !== 'vfr') return true;
    if (area.airspace_class === 'A') return false;
    if (area.airspace_class === 'E' && !aircraft.octaRequired) return true;
    const clearance = aircraft.entryClearance;
    if (!clearance || clearance.valid === false || (clearance.status && clearance.status !== 'active')) return false;
    if (aircraft.octaRequired || clearance.airport !== airport.icao) return false;
    if (Array.isArray(clearance.airspaceClasses) && area.airspace_class &&
        !clearance.airspaceClasses.includes(area.airspace_class)) {
        return false;
    }
    if (Array.isArray(clearance.regions) && clearance.regions.length > 0) {
        const regionName = (area.name || '').toUpperCase();
        const regionType = (area.type || '').toUpperCase();
        const matchesRegion = clearance.regions.some((r) => {
            const token = String(r).toUpperCase();
            return regionName.includes(token) || regionType === token;
        });
        if (!matchesRegion) return false;
    } else if (clearance.sector) {
        const sectorToken = String(clearance.sector).toUpperCase();
        const regionName = (area.name || '').toUpperCase();
        if (!regionName.includes(sectorToken)) return false;
    } else if (!isLocalControlledRegion(area, airport)) {
        return false;
    }
    const maxAlt = clearance.maxAltitude != null ? clearance.maxAltitude : clearance.ceiling;
    const minAlt = clearance.minAltitude != null ? clearance.minAltitude : -Infinity;
    if (altitude != null && (altitude > maxAlt || altitude < minAlt)) return false;
    return true;
}
