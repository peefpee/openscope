// X-Plane CIFP records keep empty, position-dependent fields between commas.
const fields = (record) => record.split(',').map((field) => field.trim().toUpperCase());
const runwayId = /^RW(0[1-9]|[12]\d|3[0-6])([LCR]?)$/;
const procedureKinds = ['SID', 'STAR', 'APPCH'];

function coordinate(value, latitude) {
    const pattern = latitude ? /^([NS])(\d{2})(\d{2})(\d{2})(\d{2})$/ : /^([EW])(\d{3})(\d{2})(\d{2})(\d{2})$/;
    const match = pattern.exec(value);

    if (!match) {
        throw new Error('Invalid runway threshold coordinate.');
    }

    const [, hemisphere, degrees, minutes, seconds, hundredths] = match;
    const decimal = Number(degrees) + Number(minutes) / 60 + (Number(seconds) + Number(hundredths) / 100) / 3600;

    if (Number(minutes) >= 60 || Number(seconds) >= 60 || decimal > (latitude ? 90 : 180)) {
        throw new Error('Runway threshold coordinate is out of range.');
    }

    return /[SW]/.test(hemisphere) ? -decimal : decimal;
}

function parseRunway(record) {
    const [header, threshold = ''] = record.split(';');
    const [id, , , elevation, , localizer] = fields(header);
    const [lat, lon] = fields(threshold);

    if (!runwayId.test(id) || !/^[+-]?\d+$/.test(elevation)) {
        throw new Error('Invalid runway identifier or elevation.');
    }

    return { id, position: [coordinate(lat, true), coordinate(lon, false), Number(elevation)], localizer };
}

function addLeg(procedures, record) {
    const f = fields(record.replace(/;$/, ''));
    const [sequence, type, id, transition, fix, region] = f;

    if (!/^\d{1,3}$/.test(sequence) || !type || !/^[A-Z0-9-]+$/.test(id) || !/^[A-Z]{2}$/.test(f[11])) {
        throw new Error('Invalid procedure sequence, identifier or leg type.');
    }

    if (!procedures.has(id)) {
        procedures.set(id, { id, branches: new Map() });
    }

    const procedure = procedures.get(id);
    const key = `${type}/${transition}`;

    if (!procedure.branches.has(key)) {
        procedure.branches.set(key, { type, transition, legs: [] });
    }

    procedure.branches.get(key).legs.push({
        sequence: Number(sequence),
        fix,
        region,
        description: record.split(',')[8].toUpperCase(),
        turn: f[9],
        center: f[11] === 'RF' && f[30] ? { fix: f[30], region: f[31], section: f[32], subsection: f[33] } : null,
        section: f[6],
        subsection: f[7],
        course: /^\d{4}$/.test(f[20]) ? Number(f[20]) / 10 : null,
        path: f[11],
        altitude: [f[22], f[23], f[24]].filter(Boolean).join(' '),
        speed: [f[26], f[27]].filter(Boolean).join(' ')
    });
}

export function parseAirportDat(text, filename) {
    const procedures = { SID: new Map(), STAR: new Map(), APPCH: new Map() };
    const runways = new Map();
    const warnings = [];
    let ignored = 0;

    text.split(/\r\n?|\n/).forEach((raw, index) => {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) {
            return;
        }

        const separator = line.indexOf(':');
        const kind = separator < 0 ? '' : line.slice(0, separator).toUpperCase();
        const record = line.slice(separator + 1).trim();
        try {
            if (kind === 'RWY') {
                const runway = parseRunway(record);
                if (runways.has(runway.id)) {
                    throw new Error('Duplicate runway threshold.');
                }
                runways.set(runway.id, runway);
            } else if (procedureKinds.includes(kind)) {
                addLeg(procedures[kind], record);
            } else if (kind !== 'PRDAT') {
                ignored += 1;
            }
        } catch (error) {
            warnings.push(`Line ${index + 1}: ${error.message}`);
        }
    });

    if (!runways.size && procedureKinds.every((kind) => !procedures[kind].size)) {
        throw new Error(warnings[0] || 'No airport records found. Choose an X-Plane CIFP airport .dat file.');
    }

    for (const kind of procedureKinds) {
        for (const procedure of procedures[kind].values()) {
            for (const branch of procedure.branches.values()) {
                branch.legs.sort((a, b) => a.sequence - b.sequence);
            }
        }
    }

    if (ignored) {
        warnings.push(`Skipped ${ignored} unrecognised records.`);
    }

    // Allow browser duplicate-download names, e.g. YMML (2).dat.
    const name = /^([A-Z][A-Z0-9]{3})(?:\s*\(\d+\))?\.dat$/i.exec(filename);

    return {
        icao: name ? name[1].toUpperCase() : '', procedures, runways, warnings
    };
}
