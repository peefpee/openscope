import { round } from '../../math/core';

const METRES_PER_FOOT = 0.3048;

/**
 * Perpendicular distance from point p to segment a-b.
 * @param {Array<number>} p
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @return {number}
 */
function perpendicularDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    const projX = a[0] + t * dx;
    const projY = a[1] + t * dy;
    return Math.hypot(p[0] - projX, p[1] - projY);
}

/**
 * Simplify a closed polygon ring using Ramer-Douglas-Peucker.
 * @param {Array<Array<number>>} points
 * @param {number} epsilon
 * @return {Array<Array<number>>}
 */
export function simplifyRing(points, epsilon = 0.0015) {
    if (!Array.isArray(points) || points.length <= 4) return points;
    const open = points[0][0] === points[points.length - 1][0] &&
        points[0][1] === points[points.length - 1][1] ? points.slice(0, -1) : points.slice();
    if (open.length <= 3) return points;

    function rdp(pts) {
        if (pts.length <= 2) return pts;
        let maxDist = 0;
        let index = 0;
        const end = pts.length - 1;
        for (let i = 1; i < end; i++) {
            const d = perpendicularDistance(pts[i], pts[0], pts[end]);
            if (d > maxDist) {
                maxDist = d;
                index = i;
            }
        }
        if (maxDist > epsilon) {
            const left = rdp(pts.slice(0, index + 1));
            const right = rdp(pts.slice(index));
            return left.slice(0, -1).concat(right);
        }
        return [pts[0], pts[end]];
    }

    const simplified = rdp(open);
    if (simplified.length < 3) return points;
    simplified.push([...simplified[0]]);
    return simplified;
}

/**
 * Compute bounding box { minLat, maxLat, minLon, maxLon } around (lat, lon) for coverageNM.
 * @param {number} lat
 * @param {number} lon
 * @param {number} coverageNM
 * @return {Object}
 */
export function computeTerrainBounds(lat, lon, coverageNM = 60) {
    const dLat = coverageNM / 60;
    const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
    const dLon = coverageNM / (60 * cosLat);
    return {
        minLat: lat - dLat,
        maxLat: lat + dLat,
        minLon: lon - dLon,
        maxLon: lon + dLon
    };
}

/**
 * Extract contour rings at `thresholdM` from a 2D elevation grid (rows = lat, cols = lon)
 * using Marching Squares and segment chaining.
 *
 * @param {Array<Array<number>>} grid - grid[row][col] in metres (row 0 = minLat, row R-1 = maxLat)
 * @param {Object} bounds - { minLat, maxLat, minLon, maxLon }
 * @param {number} thresholdM - elevation threshold in metres
 * @return {Array<Array<Array<number>>>} array of closed [lon, lat] rings
 */
export function extractContourRings(grid, bounds, thresholdM) {
    const rows = grid.length;
    if (rows < 2) return [];
    const cols = grid[0].length;
    if (cols < 2) return [];

    const latStep = (bounds.maxLat - bounds.minLat) / (rows - 1);
    const lonStep = (bounds.maxLon - bounds.minLon) / (cols - 1);
    const segments = [];

    const interp = (v1, v2) => {
        if (Math.abs(v2 - v1) < 1e-6) return 0.5;
        return Math.max(0, Math.min(1, (thresholdM - v1) / (v2 - v1)));
    };

    const keyFor = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

    for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
            const bl = grid[r][c];
            const br = grid[r][c + 1];
            const tr = grid[r + 1][c + 1];
            const tl = grid[r + 1][c];
            if (![bl, br, tr, tl].every(Number.isFinite)) continue;

            const mask = (bl >= thresholdM ? 1 : 0) |
                (br >= thresholdM ? 2 : 0) |
                (tr >= thresholdM ? 4 : 0) |
                (tl >= thresholdM ? 8 : 0);

            if (mask === 0 || mask === 15) continue;

            const lon0 = bounds.minLon + c * lonStep;
            const lon1 = lon0 + lonStep;
            const lat0 = bounds.minLat + r * latStep;
            const lat1 = lat0 + latStep;

            const bottom = [lon0 + interp(bl, br) * lonStep, lat0];
            const right = [lon1, lat0 + interp(br, tr) * latStep];
            const top = [lon0 + interp(tl, tr) * lonStep, lat1];
            const left = [lon0, lat0 + interp(bl, tl) * latStep];

            switch (mask) {
                case 1: case 14: segments.push([left, bottom]); break;
                case 2: case 13: segments.push([bottom, right]); break;
                case 3: case 12: segments.push([left, right]); break;
                case 4: case 11: segments.push([right, top]); break;
                case 5:
                    segments.push([left, top], [bottom, right]);
                    break;
                case 6: case 9: segments.push([bottom, top]); break;
                case 7: case 8: segments.push([left, top]); break;
                case 10:
                    segments.push([left, bottom], [right, top]);
                    break;
                default: break;
            }
        }
    }

    // Chain segments into rings
    const adjacency = new Map();
    const addEdge = (a, b) => {
        const ka = keyFor(a);
        if (!adjacency.has(ka)) adjacency.set(ka, []);
        adjacency.get(ka).push({ from: a, to: b, used: false });
    };
    segments.forEach(([a, b]) => {
        addEdge(a, b);
        addEdge(b, a);
    });

    const rings = [];
    const visitedEdges = new Set();

    for (const [startSegA, startSegB] of segments) {
        const edgeId = `${keyFor(startSegA)}->${keyFor(startSegB)}`;
        const revId = `${keyFor(startSegB)}->${keyFor(startSegA)}`;
        if (visitedEdges.has(edgeId) || visitedEdges.has(revId)) continue;

        const ring = [startSegA, startSegB];
        visitedEdges.add(edgeId);
        visitedEdges.add(revId);

        let current = startSegB;
        let guard = 0;
        while (guard < segments.length + 2) {
            guard += 1;
            const kc = keyFor(current);
            const candidates = adjacency.get(kc) || [];
            const nextEdge = candidates.find((e) => {
                const eid = `${keyFor(e.from)}->${keyFor(e.to)}`;
                return !visitedEdges.has(eid);
            });
            if (!nextEdge) break;
            const eid = `${keyFor(nextEdge.from)}->${keyFor(nextEdge.to)}`;
            const reid = `${keyFor(nextEdge.to)}->${keyFor(nextEdge.from)}`;
            visitedEdges.add(eid);
            visitedEdges.add(reid);
            current = nextEdge.to;
            ring.push(current);
            if (keyFor(current) === keyFor(ring[0])) break;
        }

        if (ring.length >= 4) {
            if (keyFor(ring[0]) !== keyFor(ring[ring.length - 1])) {
                ring.push([...ring[0]]);
            }
            const simplified = simplifyRing(ring);
            if (simplified.length >= 4) {
                rings.push(simplified);
            }
        }
    }

    return rings;
}

/**
 * Generate an OpenScope-compatible GeoJSON FeatureCollection from a 2D elevation grid (metres).
 * Note: AirportModel.parseTerrain() expects `properties.elevation` in metres and WGS84 [lon, lat] rings.
 *
 * @param {Array<Array<number>>} grid
 * @param {Object} bounds - { minLat, maxLat, minLon, maxLon }
 * @param {Object} [options={}]
 * @return {Object} GeoJSON FeatureCollection
 */
export function generateTerrainGeoJson(grid, bounds, options = {}) {
    const icao = (options.icao || 'IMPORT').toUpperCase();
    const intervalFt = options.contourIntervalFt || 1000;
    const attribution = options.attribution || 'Elevation data';

    let minM = Infinity;
    let maxM = -Infinity;
    for (const row of grid) {
        for (const val of row) {
            if (!Number.isFinite(val)) continue;
            if (val < minM) minM = val;
            if (val > maxM) maxM = val;
        }
    }

    const features = [];
    if (!Number.isFinite(maxM)) {
        return {
            type: 'FeatureCollection',
            name: icao.toLowerCase(),
            properties: { attribution, generated: true },
            features
        };
    }

    // Coastline / land boundary at 1 m when ocean/water (<= 0 m) is present alongside land
    if (minM <= 0 && maxM > 1) {
        const coastRings = extractContourRings(grid, bounds, 1);
        if (coastRings.length) {
            features.push({
                type: 'Feature',
                properties: { elevation: 0.0, layer: 'coastline' },
                geometry: coastRings.length === 1 ?
                    { type: 'Polygon', coordinates: [coastRings[0]] } :
                    { type: 'MultiPolygon', coordinates: coastRings.map((r) => [r]) }
            });
        }
    }

    const maxFt = Math.floor((maxM / METRES_PER_FOOT) / intervalFt) * intervalFt;
    for (let elevFt = intervalFt; elevFt <= maxFt; elevFt += intervalFt) {
        const thresholdM = round(elevFt * METRES_PER_FOOT, 1);
        const rings = extractContourRings(grid, bounds, thresholdM);
        if (!rings.length) continue;
        features.push({
            type: 'Feature',
            properties: { elevation: thresholdM, layer: 'contour' },
            geometry: rings.length === 1 ?
                { type: 'Polygon', coordinates: [rings[0]] } :
                { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) }
        });
    }

    return {
        type: 'FeatureCollection',
        name: icao.toLowerCase(),
        properties: {
            attribution,
            generated: true,
            contourIntervalFt: intervalFt
        },
        features
    };
}

/**
 * Fetch elevation grid from Open-Meteo Elevation API (Copernicus DEM GLO-90, CC BY 4.0)
 * or server-side /api/terrain endpoint, with timeout and abort support.
 */
export function fetchAndGenerateTerrain({
    icao,
    lat,
    lon,
    coverageNm = 60,
    contourIntervalFt = 1000,
    provider = 'auto',
    gridSize = 21,
    signal = null,
    onProgress = () => {}
}) {
    const bounds = computeTerrainBounds(lat, lon, coverageNm);
    if (![11, 21, 25].includes(gridSize)) return Promise.reject(new Error('Unsupported terrain grid size.'));

    onProgress('Downloading elevation data...');

    const params = `icao=${encodeURIComponent(icao)}&lat=${lat}&lon=${lon}&coverageNm=${coverageNm}` +
        `&intervalFt=${contourIntervalFt}&gridSize=${gridSize}&provider=${encodeURIComponent(provider)}`;
    const tryServer = (typeof window !== 'undefined' && window.location && window.location.protocol !== 'file:') ?
        fetch(`/api/terrain?${params}`, { signal })
            .then((resp) => (resp.ok ? resp.json() : null))
            .then((payload) => {
                if (payload && Array.isArray(payload.elevations) && payload.gridSize === gridSize &&
                    payload.elevations.length === gridSize * gridSize && payload.bounds) {
                    const serverGrid = [];
                    for (let r = 0; r < payload.gridSize; r++) {
                        serverGrid.push(payload.elevations.slice(r * payload.gridSize, (r + 1) * payload.gridSize));
                    }
                    const attribution = payload.attribution || 'Copernicus DEM GLO-90 via Open-Meteo (CC BY 4.0)';
                    return {
                        geojson: generateTerrainGeoJson(serverGrid, payload.bounds, { icao, contourIntervalFt, attribution }),
                        provider: payload.provider || provider,
                        attribution,
                        resolution: `${payload.gridSize}x${payload.gridSize}`
                    };
                }
                return null;
            })
            .catch((err) => {
                if (err && err.name === 'AbortError') throw err;
                return null;
            }) :
        Promise.resolve(null);

    return tryServer.then((serverResult) => {
        if (serverResult) return serverResult;

        const lats = [];
        const lons = [];
        for (let r = 0; r < gridSize; r++) {
            const rowLat = bounds.minLat + (bounds.maxLat - bounds.minLat) * r / (gridSize - 1);
            for (let c = 0; c < gridSize; c++) {
                const colLon = bounds.minLon + (bounds.maxLon - bounds.minLon) * c / (gridSize - 1);
                lats.push(rowLat.toFixed(5));
                lons.push(colLon.toFixed(5));
            }
        }

        const batches = [];
        const batchSize = 100;
        for (let i = 0; i < lats.length; i += batchSize) {
            const batchLats = lats.slice(i, i + batchSize).join(',');
            const batchLons = lons.slice(i, i + batchSize).join(',');
            batches.push(`https://api.open-meteo.com/v1/elevation?latitude=${batchLats}&longitude=${batchLons}`);
        }

        const elevations = [];
        return batches.reduce((chain, apiUrl) => chain.then(() => fetch(apiUrl, { signal })
            .then((resp) => {
                if (!resp.ok) throw new Error(`Terrain provider returned HTTP ${resp.status}`);
                return resp.json();
            })
            .then((json) => {
                if (!json || !Array.isArray(json.elevation)) {
                    throw new Error('Malformed elevation response from provider');
                }
                elevations.push(...json.elevation);
            })), Promise.resolve())
            .then(() => {
                onProgress('Generating terrain contours...');
                const grid = [];
                for (let r = 0; r < gridSize; r++) {
                    grid.push(elevations.slice(r * gridSize, (r + 1) * gridSize));
                }

                const attribution = 'Copernicus DEM GLO-90 via Open-Meteo (CC BY 4.0)';
                const geojson = generateTerrainGeoJson(grid, bounds, {
                    icao,
                    contourIntervalFt,
                    attribution
                });

                return {
                    geojson,
                    provider: 'open-meteo',
                    attribution,
                    resolution: `${gridSize}x${gridSize}`
                };
            });
    });
}
