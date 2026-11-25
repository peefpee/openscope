import AirspaceModel from '../AirspaceModel';
import navData from './NavDataCache';

function limit(text) {
    if (/^(GND|SFC)$/.test(text)) return { feet: 0, agl: true };
    const fl = /^FL\s*(\d+)$/.exec(text);
    if (fl) return { feet: Number(fl[1]) * 100 };
    const match = /^(\d+)\s*(?:FT\s*)?(MSL|AMSL|AGL)?$/.exec(text);
    return match && { feet: Number(match[1]), agl: match[2] === 'AGL' };
}

// X-Plane's OpenAir export describes boundaries as DP vertices.
export function parseAustralianAirspace(text) {
    const regions = [];
    for (const block of text.split(/^AC\s+/m).slice(1)) {
        const [kind, ...lines] = block.trim().split(/\r?\n/);
        if (!/^(?:[A-E]|CTR)$/.test(kind.trim())) continue;
        let name = '';
        let floor, ceiling;
        const poly = [];
        for (const line of lines) {
            if (line.startsWith('AN ')) name = line.slice(3).trim();
            if (line.startsWith('AL ')) floor = limit(line.slice(3).trim());
            if (line.startsWith('AH ')) ceiling = limit(line.slice(3).trim());
            if (/^(DB|DA|DC) /.test(line)) break;
            if (!line.startsWith('DP ')) continue;
            const m = /^DP\s+(\d+):(\d+):([\d.]+) S\s+(\d+):(\d+):([\d.]+) E\s*$/.exec(line);
            if (!m) { poly.length = 0; break; }
            const lat = -(+m[1] + m[2] / 60 + m[3] / 3600);
            const lon = +m[4] + m[5] / 60 + m[6] / 3600;
            if (lat < -56 || lat > -8 || lon < 90 || lon > 170) { poly.length = 0; break; }
            poly.push([lat, lon]);
        }
        if (floor && ceiling && poly.length >= 3 && !/^(DB|DA|DC) /m.test(block)) {
            regions.push({ name, airspace_class: kind.trim(), floor, ceiling, poly });
        }
    }
    if (!regions.length) throw new Error('No Australian controlled-airspace polygons found in airspace.txt.');
    return regions;
}

export function australianShelves(airport, data) {
    const center = airport.positionModel;
    const elevation = center.elevation;
    const top = airport.ctr_ceiling;
    const record = navData.records.get('au-airspace');
    const models = [];
    for (const region of (record && record.regions) || []) {
        const feet = (value) => value.feet + (value.agl ? elevation : 0);
        const floor = feet(region.floor);
        const ceiling = Math.min(top, feet(region.ceiling));
        if (floor >= ceiling) continue;
        const near = region.poly.some(([lat, lon]) => Math.abs(lat - center.latitude) < 1.5 && Math.abs(lon - center.longitude) < 2);
        const surrounds = !near && region.poly.some(([lat]) => lat < center.latitude) &&
            region.poly.some(([lat]) => lat > center.latitude) && region.poly.some(([,lon]) => lon < center.longitude) &&
            region.poly.some(([,lon]) => lon > center.longitude);
        if (!near && !surrounds) continue;
        const model = new AirspaceModel({ ...region, floor: 0, ceiling: 0 }, center, airport.magneticNorth);
        if (!model.isPointInside2D([0, 0]) && model.distanceToBoundary([0, 0]) > 45) continue;
        model.name = region.name;
        model.floor = floor;
        model.ceiling = ceiling;
        models.push(model);
    }
    const hasLocalDefinition = models.some((area) => area.isPointInside2D([0, 0]) &&
        (area.floor <= elevation + 2000 || (area.airspace_class !== 'A' && /\b(?:CTA|CTR)\b/i.test(area.name))));
    if (hasLocalDefinition) return models;
    if (!data.isDatImport && airport.airspace && airport.airspace.length) {
        const defined = airport.airspace.filter((area) => /^[A-E]$|^CTR$/.test(area.airspace_class));
        if (defined.length) return [...models, ...defined.map((area) => {
            const capped = Object.create(area);
            capped.ceiling = Math.min(top, area.ceiling);
            return capped;
        })];
    }
    const ring = (radius, floor) => {
        const poly = Array.from({ length: 120 }, (_, i) => center.generateCoordinatesFromBearingAndDistance(i * Math.PI / 60, radius));
        const model = new AirspaceModel({ poly, floor: 0, ceiling: 0, airspace_class: 'C' }, center, airport.magneticNorth);
        model.floor = floor;
        model.ceiling = top;
        return model;
    };
    return [...models, ring(10, elevation), ring(40, elevation + 2000)];
}
