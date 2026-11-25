// openScope procedures consist of a runway segment, a common body, and an
// en-route transition. CIFP sometimes repeats the boundary fix in both segments.
const fixName = (waypoint) => (Array.isArray(waypoint) ? waypoint[0] : waypoint);

const limitsOf = (point) => (Array.isArray(point) ? point[1].split('|') : []);

function flightLevel(value = '') {
    if (/^FL\d{2,3}$/.test(value)) {
        return Number(value.slice(2));
    }

    return /^\d{3}00$/.test(value) ? Number(value) / 100 : null;
}

function waypoint(leg, fixes, positionFor) {
    const position = positionFor(leg);
    if (!['IF', 'CF', 'DF', 'TF'].includes(leg.path) || !position || fixes[leg.fix] !== position) {
        return null;
    }

    const restrictions = [];
    const altitude = /^([+\-B] )?(\w+)(?: (\w+))?$/.exec(leg.altitude);
    if (leg.altitude) {
        if (!altitude) {
            return null;
        }
        const [, sign = '', first, second] = altitude;
        const level = flightLevel(first);
        if (level === null || (sign === 'B ' ? flightLevel(second) === null : !!second)) {
            return null;
        }
        if (sign === 'B ') {
            restrictions.push(`A${flightLevel(second)}+`, `A${level}-`);
        } else {
            restrictions.push(`A${level}${sign.trim()}`);
        }
    }

    if (leg.speed) {
        const speed = /^([+-] )?([1-9]\d{2})$/.exec(leg.speed);
        if (!speed) {
            return null;
        }
        restrictions.push(`S${speed[2]}${(speed[1] || '').trim()}`);
    }
    return restrictions.length ? [leg.fix, restrictions.join('|')] : leg.fix;
}

function joinSegments(first, second) {
    if (!first.length || !second.length || fixName(first[first.length - 1]) !== fixName(second[0])) {
        return [...first, ...second];
    }

    const a = first[first.length - 1];
    const b = second[0];
    const limits = new Set([...limitsOf(a), ...limitsOf(b)]);
    const joint = limits.size ? [fixName(a), [...limits].join('|')] : fixName(a);
    return [...first.slice(0, -1), joint, ...second.slice(1)];
}

function buildProcedure(procedure, sid, data, runwayIds, fixes, positionFor) {
    const branches = [...procedure.branches.values()];
    const common = branches.find((b) => !b.transition && ['2', '5'].includes(b.type));
    const convert = (branch) => branch.legs.map((leg) => waypoint(leg, fixes, positionFor));
    const body = common ? convert(common) : [];
    if (body.includes(null)) {
        return null;
    }

    const transitions = branches.filter((b) => (sid ? ['3', '6'] : ['1', '4']).includes(b.type) &&
        b.transition && !b.transition.startsWith('RW') && b.transition !== 'ALL');
    const runwayBranches = branches.filter((b) => b.transition.startsWith('RW') || b.transition === 'ALL');
    const rwy = {};
    const points = {};
    const draw = [];
    const boundaryOf = (core) => core[sid ? core.length - 1 : 0];
    let junction;
    for (const runway of runwayIds) {
        const id = `RW${runway}`;
        const branch = runwayBranches.find((b) => b.transition === id) ||
            runwayBranches.find((b) => b.transition === 'ALL' ||
                (/^[0-9]{2}[LR]$/.test(runway) && b.transition === `RW${runway.slice(0, 2)}B`));
        if (!branch && (runwayBranches.length || !common)) {
            continue;
        }
        const segment = branch ? convert(branch) : [];
        if (segment.includes(null)) {
            continue;
        }

        const core = sid ? joinSegments(segment, body) : joinSegments(body, segment);
        if (!core.length) {
            continue;
        }
        const boundary = fixName(boundaryOf(core));
        // The native entry and exit tables allow every combination. Never add
        // a runway with a different join to a procedure already registered.
        if (junction && junction !== boundary) {
            continue;
        }
        junction = boundary;
        rwy[data.icao + runway] = core;
        draw.push(core.map(fixName));
    }

    if (!junction) {
        return null;
    }
    if (!transitions.length) {
        points[junction] = [];
    }
    const boundaries = Object.values(rwy).map(boundaryOf);
    const sharedBoundary = boundaries.every((point) => String(point) === String(boundaries[0]));
    for (const transition of transitions) {
        const path = convert(transition);
        if (path.includes(null) || !path.length) {
            continue;
        }
        const atJoin = sid ? 0 : path.length - 1;
        const endpoint = fixName(path[sid ? path.length - 1 : 0]);
        if (endpoint !== transition.transition) {
            continue;
        }
        const joinsAtSameFix = fixName(path[atJoin]) === junction;
        if (!joinsAtSameFix && (sid ? transition.legs[0].path === 'IF' : common && common.legs[0].path === 'IF')) {
            continue;
        }

        // A shared runway boundary can live on the transition, which lets
        // each transition add its own altitude or speed at that fix.
        if (sharedBoundary) {
            points[endpoint] = sid ? joinSegments([boundaries[0]], path) : joinSegments(path, [boundaries[0]]);
        } else if (joinsAtSameFix) {
            const limits = limitsOf(path[atJoin]);
            if (!boundaries.every((point) => limits.every((limit) => limitsOf(point).includes(limit)))) {
                continue;
            }
            points[endpoint] = sid ? path.slice(1) : path.slice(0, -1);
        } else {
            points[endpoint] = path;
        }
        const line = path.map(fixName);
        if (!joinsAtSameFix) {
            if (sid) line.unshift(junction);
            else line.push(junction);
        }
        draw.push(line);
    }
    if (!Object.keys(points).length) {
        return null;
    }
    if (transitions.length && sharedBoundary) {
        for (const runway of Object.keys(rwy)) {
            rwy[runway] = sid ? rwy[runway].slice(0, -1) : rwy[runway].slice(1);
        }
    }
    return {
        icao: procedure.id,
        name: procedure.id,
        body: [],
        rwy,
        draw,
        [sid ? 'exitPoints' : 'entryPoints']: points
    };
}

export function buildDatProcedures(data, runwayIds, fixes, positionFor) {
    const sids = {};
    const stars = {};
    for (const kind of ['SID', 'STAR']) {
        for (const procedure of data.procedures[kind].values()) {
            // NavigationLibrary uses a single identifier namespace.
            if (sids[procedure.id]) {
                continue;
            }
            const native = buildProcedure(procedure, kind === 'SID', data, runwayIds, fixes, positionFor);
            if (native) {
                (kind === 'SID' ? sids : stars)[procedure.id] = native;
            }
        }
    }
    return { sids, stars };
}
