import StaticPositionModel from '../../base/StaticPositionModel';

function altitudeFeet(text) {
    if (!text) return null;
    const value = text.split(' ').pop();
    if (/^FL\d+$/.test(value)) return Number(value.slice(2)) * 100;
    return /^\d+$/.test(value) ? Number(value) : null;
}

// Approximate a constant-radius RF leg with closely spaced points on its coded arc.
function arcPoints(start, end, center, turn) {
    if (!start || !center || !['L', 'R'].includes(turn)) return null;
    const origin = new StaticPositionModel(center);
    const from = new StaticPositionModel(start);
    const to = new StaticPositionModel(end);
    const radius = origin.distanceToPosition(from);
    if (!radius || Math.abs(origin.distanceToPosition(to) - radius) > 0.25) return null;
    const bearing = origin.bearingToPosition(from);
    const direction = turn === 'R' ? 1 : -1;
    const circle = 2 * Math.PI;
    const sweep = ((origin.bearingToPosition(to) - bearing) * direction + circle) % circle;
    const steps = Math.ceil(sweep / (Math.PI / 18));
    return Array.from({ length: Math.max(0, steps - 1) }, (_, i) => ({
        coordinates: origin.generateCoordinatesFromBearingAndDistance(bearing + direction * sweep * (i + 1) / steps, radius)
    }));
}

export function buildDatApproaches(data, positionFor) {
    const routes = [];
    for (const procedure of data.procedures.APPCH.values()) {
        const branches = [...procedure.branches.values()];
        const final = branches.find((branch) => branch.type === 'R' && !branch.transition);
        const match = /^R(\d\d[LCR]?)(?:-|$)/.exec(procedure.id);
        if (!final || !match || !data.runways.has(`RW${match[1]}`)) continue;
        // The fourth character identifies the missed approach point, including
        // approaches whose MAP is a named fix before the runway threshold.
        const end = final.legs.findIndex((leg) => leg.fix === `RW${match[1]}` || leg.description[3] === 'M');
        if (end < 1) continue;
        const main = final.legs.slice(0, end + 1);
        const paths = [main];
        for (const transition of branches.filter((branch) => branch.type === 'A')) {
            const last = transition.legs[transition.legs.length - 1];
            const join = main.findIndex((leg) => leg.fix === last.fix);
            if (join >= 0) {
                const joint = { ...main[join], path: last.path, altitude: main[join].altitude || last.altitude };
                paths.push([...transition.legs.slice(0, -1), joint, ...main.slice(join + 1)]);
            }
        }
        for (const path of paths) {
            let points = [];
            let previous;
            for (const leg of path) {
                const threshold = data.runways.get(leg.fix);
                const coordinates = threshold ? threshold.position : positionFor(leg);
                if (!coordinates || !['IF', 'TF', 'DF', 'CF', 'RF'].includes(leg.path)) {
                    points = [];
                    previous = null;
                    continue;
                }
                if (leg.path === 'IF') points = [];
                if (leg.path === 'RF') {
                    const arc = arcPoints(previous, coordinates, leg.center && positionFor(leg.center), leg.turn);
                    if (arc) points.push(...arc);
                    else points = [];
                }
                points.push({
                    name: leg.fix,
                    coordinates,
                    altitude: altitudeFeet(leg.altitude),
                    speed: /^-?\s*\d{3}$/.test(leg.speed) ? Number(leg.speed.replace(/[-\s]/g, '')) : null
                });
                previous = coordinates;
            }
            if (points.length > 1 && points[points.length - 1].name === main[main.length - 1].fix) {
                routes.push({ id: procedure.id, runway: match[1], points });
            }
        }
    }
    return routes;
}
