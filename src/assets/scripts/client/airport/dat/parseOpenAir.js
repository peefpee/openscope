import StaticPositionModel from '../../base/StaticPositionModel';

const RAD = Math.PI / 180;

function limit(value) {
    const label = value.toUpperCase();
    if (/^(GND|SFC)$/.test(label)) return { feet: 0, agl: true, label };
    if (/^(UNL|UNLIMITED)$/.test(label)) return { feet: Infinity, label };
    const fl = /^FL\s*(\d+)$/.exec(label);
    if (fl) return { feet: Number(fl[1]) * 100, label };
    const match = /^(\d+)\s*(?:FT\s*)?(MSL|AMSL|AGL)?$/.exec(label);
    if (!match) throw new Error(`Invalid altitude ${value}`);
    return { feet: Number(match[1]), agl: match[2] === 'AGL', label };
}

function angle(value, max) {
    const [degrees, minutes = 0, seconds = 0] = value.split(':').map(Number);
    const total = degrees + minutes / 60 + seconds / 3600;
    if (minutes >= 60 || seconds >= 60 || total > max) throw new Error(`Invalid coordinate ${value}`);
    return total;
}

function position(value) {
    const match = /^(\d+(?::\d+){0,2}(?:\.\d+)?)\s*([NS])\s+(\d+(?::\d+){0,2}(?:\.\d+)?)\s*([EW])$/i.exec(value);
    if (!match) throw new Error(`Invalid coordinate ${value}`);
    return [angle(match[1], 90) * (/S/i.test(match[2]) ? -1 : 1),
        angle(match[3], 180) * (/W/i.test(match[4]) ? -1 : 1)];
}

function curve(center, direction, type, value) {
    if (!center) throw new Error('Missing arc centre');
    const parts = value.split(',').map((part) => part.trim());
    let radius;
    let start;
    let end;
    let endpoints;
    if (type === 'DB' && parts.length === 2) {
        endpoints = parts.map(position);
        const points = endpoints.map((pair) => new StaticPositionModel(pair, null, 0));
        radius = center.distanceToPosition(points[0]);
        if (Math.abs(radius - center.distanceToPosition(points[1])) > Math.max(0.15, radius * 0.03)) {
            throw new Error('Arc endpoints have different radii');
        }
        [start, end] = points.map((p) => center.bearingToPosition(p) / RAD);
    } else if (type === 'DA' && parts.length === 3 && parts.every((part) => part.length)) {
        [radius, start, end] = parts.map(Number);
    } else if (type === 'DC' && parts.length === 1) {
        radius = Number(value);
        start = 0;
        end = 360;
    } else {
        throw new Error(`Invalid ${type} arc`);
    }
    if (!(radius > 0 && radius <= 10800) || ![start, end].every((v) => Number.isFinite(v) && v >= 0 && v <= 360)) {
        throw new Error('Invalid arc radius or bearing');
    }
    const sweep = ((end - start) * direction + 360) % 360 || 360;
    // Bound chord deviation to 0.02 NM and angular spacing to five degrees.
    const step = Math.min(5, 2 * Math.acos(Math.max(-1, 1 - 0.02 / radius)) / RAD);
    const count = Math.ceil(sweep / step);
    const poly = Array.from({ length: type === 'DC' ? count : count + 1 }, (_, i) => {
        const bearing = (start + direction * sweep * i / count) * RAD;
        return center.generateCoordinatesFromBearingAndDistance(bearing, radius);
    });
    if (endpoints) {
        [poly[0], poly[count]] = endpoints;
    }
    return poly;
}

// Adjacent OpenAir records often repeat their shared endpoint.
function validatePolygon(vertices) {
    const equal = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    const poly = vertices.filter((point, index) => !index || !equal(point, vertices[index - 1]));
    if (poly.length > 1 && equal(poly[0], poly[poly.length - 1])) poly.pop();
    if (poly.length < 3) throw new Error('Incomplete polygon');

    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const edges = poly.map((a, index) => {
        const b = poly[(index + 1) % poly.length];
        return {
            a,
            b,
            index,
            left: Math.min(a[1], b[1]),
            right: Math.max(a[1], b[1]),
            low: Math.min(a[0], b[0]),
            high: Math.max(a[0], b[0])
        };
    }).sort((a, b) => a.left - b.left);
    for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        for (let j = i + 1; j < edges.length && edges[j].left <= edge.right; j++) {
            const other = edges[j];
            const gap = Math.abs(edge.index - other.index);
            if (gap === 1 || gap === edges.length - 1 || other.low > edge.high || edge.low > other.high) continue;
            if (cross(edge.a, edge.b, other.a) * cross(edge.a, edge.b, other.b) <= 0 &&
                cross(other.a, other.b, edge.a) * cross(other.a, other.b, edge.b) <= 0) {
                throw new Error('Self-intersecting polygon');
            }
        }
    }
    if (poly.every((p) => cross(poly[0], poly[1], p) === 0)) throw new Error('Degenerate polygon');
    return poly;
}

function parseBlock(lines, warnings) {
    const kind = lines[0].slice(2).trim().toUpperCase();
    if (!/^([ABCDEGRPQ]|CTR)$/.test(kind)) throw new Error(`Unsupported classification ${kind}`);
    const region = {
        name: '',
        airspace_class: /^[A-EG]$/.test(kind) ? kind : null,
        type: /^[RPQ]$|^CTR$/.test(kind) ? kind : 'AIRSPACE',
        poly: []
    };
    // OpenAir uses Q for danger areas and D for Class D.
    let center;
    let direction = 1;
    for (const line of lines.slice(1)) {
        const split = /^(\S+)\s*(.*)$/.exec(line);
        const type = split[1].toUpperCase();
        const value = split[2].trim();
        if (type === 'AN') region.name = value;
        else if (type === 'AL') region.floor = limit(value);
        else if (type === 'AH') region.ceiling = limit(value);
        else if (type === 'DP') region.poly.push(position(value));
        else if (type === 'V' && /^X\s*=/i.test(value)) {
            center = new StaticPositionModel(position(value.slice(value.indexOf('=') + 1).trim()), null, 0);
        } else if (type === 'V' && /^D\s*=\s*[+-]$/i.test(value)) direction = value.endsWith('-') ? -1 : 1;
        else if (['DC', 'DA', 'DB'].includes(type)) {
            region.poly.push(...curve(center, direction, type, value));
            region.approximated = true;
        } else warnings.add(`Unsupported record ${line}`);
    }
    if (!region.floor || !region.ceiling) throw new Error('Missing altitude boundary');
    if (Boolean(region.floor.agl) === Boolean(region.ceiling.agl) && region.floor.feet >= region.ceiling.feet) {
        throw new Error('Invalid altitude range');
    }
    region.poly = validatePolygon(region.poly);
    if (!region.poly.some(([lat, lon]) => lat >= -56 && lat <= -8 && lon >= 90 && lon <= 170)) return null;
    return region;
}

export function readOpenAir(text) {
    const regions = [];
    const warnings = new Set();
    const seen = new Set();
    let rejected = 0;
    const lines = text.split(/\r?\n/).map((line) => line.split('*')[0].trim()).filter(Boolean);
    const blocks = [];
    for (const line of lines) {
        if (/^AC\s/i.test(line)) blocks.push([]);
        if (blocks.length) blocks[blocks.length - 1].push(line);
    }
    for (const block of blocks) {
        try {
            const region = parseBlock(block, warnings);
            if (!region) continue;
            const key = JSON.stringify(region);
            if (seen.has(key)) throw new Error('Duplicate region');
            seen.add(key);
            regions.push(region);
        } catch (error) {
            rejected += 1;
            warnings.add(`${block.find((line) => /^AN\s/i.test(line)) || block[0]} — ${error.message}`);
        }
    }
    if (!regions.length) throw new Error(['No valid Australian airspace regions.', ...warnings].join(' '));
    return {
        regions, rejected, warnings: [...warnings], approximated: regions.filter((region) => region.approximated).length
    };
}
