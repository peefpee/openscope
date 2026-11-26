import AirspaceModel from '../AirspaceModel';
import { nm, parseElevation } from '../../utilities/unitConverters';
import navData from './NavDataCache';
import { readOpenAir } from './parseOpenAir';

export function parseAustralianAirspace(text) {
    return readOpenAir(text).regions;
}

export function australianShelves(airport, data) {
    const center = airport.positionModel;
    const { elevation } = center;
    const top = airport.ctr_ceiling;
    const record = typeof navData.getCompatibleRecord === 'function' ?
        navData.getCompatibleRecord('au-airspace', { icao: airport.icao }) :
        navData.records.get('au-airspace');
    const models = [];
    const groundAt = (position) => airport.terrainElevationAt(position);
    for (const region of (record && record.regions) || []) {
        const feet = (value) => value.feet + (value.agl ? elevation : 0);
        const floor = feet(region.floor);
        const ceiling = feet(region.ceiling);
        if (floor >= ceiling && region.floor.agl === region.ceiling.agl) continue;
        const near = region.poly.some(([lat, lon]) => Math.abs(lat - center.latitude) < 1.5 && Math.abs(lon - center.longitude) < 2);
        const surrounds = !near && region.poly.some(([lat]) => lat < center.latitude) &&
            region.poly.some(([lat]) => lat > center.latitude) && region.poly.some(([, lon]) => lon < center.longitude) &&
            region.poly.some(([, lon]) => lon > center.longitude);
        if (!near && !surrounds) continue;
        const model = new AirspaceModel({ ...region, floor: 0, ceiling: 0 }, center, airport.magneticNorth);
        if (!model.isPointInside2D([0, 0]) && model.distanceToBoundary([0, 0]) > Math.max(10, nm(airport.ctr_radius)) + 5) continue;
        model.name = region.name;
        model.airspace_class = region.airspace_class || '';
        model.type = region.type === 'AIRSPACE' || !region.type ?
            ((/\b(CTR|CTA)\b/i.exec(region.name) || [])[1] || 'AIRSPACE').toUpperCase() : region.type;
        model.source = 'imported';
        model.controller = region.controller;
        model.frequency = region.frequency;
        model.verticalLimits = {
            lower: region.floor, upper: region.ceiling, sectorTop: Infinity, groundAt
        };
        model.floor = floor;
        model.ceiling = ceiling;
        models.push(model);
    }
    // A successfully parsed file conveys no regional completeness guarantee. Fill gaps
    // unless the airport explicitly declares complete coverage. At a point, an imported
    // class (including G) wins over the underlying manual or simulated shelf.
    const importedCount = models.length;
    if (models.length && data.airspaceCoverage === 'complete' && !record.rejected) {
        airport.airspaceDiagnostics = {
            importedCount,
            rejected: (record && record.rejected) || 0,
            fallbackActive: false,
            coverageStatus: 'complete'
        };
        return models;
    }
    for (const area of data.restricted || []) {
        const zone = new AirspaceModel({ ...area, floor: 0, ceiling: 0 }, center, airport.magneticNorth);
        zone.type = area.type || 'R';
        zone.source = 'manual';
        zone.floor = 0;
        zone.ceiling = parseElevation(area.height);
        models.push(zone);
    }
    if (!data.isDatImport && airport.airspace && airport.airspace.length) {
        const defined = airport.airspace.filter((area) => /^[A-EG]$|^CTR$/.test(area.airspace_class));
        if (defined.length) {
            return [...models, ...defined.map((area) => {
                const capped = Object.create(area);
                capped.ceiling = Math.min(top, area.ceiling);
                return capped;
            })];
        }
    }
    const ring = (radius) => Array.from({ length: 120 }, (_, i) => center.generateCoordinatesFromBearingAndDistance(i * Math.PI / 60, radius));
    const simulated = (poly, type, floor, ceiling) => {
        const model = new AirspaceModel({
            poly, floor: 0, ceiling: 0, airspace_class: 'C'
        }, center, airport.magneticNorth);
        model.floor = floor;
        model.ceiling = ceiling;
        model.type = type;
        model.source = 'simulated';
        const lower = { agl: true, feet: type === 'CTR' ? 0 : 2000 };
        const upper = type === 'CTR' ? { agl: true, feet: 2000 } : { feet: top };
        model.verticalLimits = {
            lower, upper, sectorTop: top, groundAt
        };
        return model;
    };
    const shelfBase = elevation + 2000;
    models.push(simulated(ring(10), 'CTR', elevation, Math.min(top, shelfBase)));
    if (top > shelfBase) {
        const sectors = data.airspace && data.airspace.length ? data.airspace.map((area) => area.poly) :
            [ring(nm(airport.ctr_radius))];
        sectors.forEach((poly) => models.push(simulated(poly, 'CTA', shelfBase, top)));
    }
    airport.airspaceDiagnostics = {
        importedCount,
        rejected: (record && record.rejected) || 0,
        fallbackActive: models.some((m) => m.source === 'simulated'),
        coverageStatus: importedCount > 0 ? 'partial' : 'fallback'
    };
    return models;
}
