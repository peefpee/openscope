const centres = { 1: 'Airport', 2: 'NDB', 3: 'VHF navaid', 10: 'Runway', 11: 'Fix' };

// XP MSA1150. Each triplet starts a clockwise sector, measured inbound to the centre.
export default function parseMsaDat(text) {
    const airports = {};
    for (const line of text.split(/\r\n?|\n/)) {
        const [type, id, region, airport, reference, ...values] = line.trim().split(/\s+/);
        if (!Object.prototype.hasOwnProperty.call(centres, type) || !/^[A-Z0-9]{4}$/.test(airport) ||
            !['T', 'M'].includes(reference) || values.length < 6 || values.length > 24 ||
            values.length % 3 || !values.every((value) => /^\d+$/.test(value))) continue;
        const numbers = values.map(Number);
        if (numbers.splice(-3).some((value) => value !== 0)) continue;
        const sectors = [];
        for (let i = 0; i < numbers.length; i += 3) {
            const [bearing, hundreds, radius] = numbers.slice(i, i + 3);
            if (bearing > 360 || hundreds > 999 || radius <= 0) break;
            sectors.push({ bearing: bearing % 360, altitude: hundreds * 100, radius });
        }
        if (sectors.length * 3 !== numbers.length) continue;
        if (!airports[airport]) airports[airport] = [];
        airports[airport].push({ id, type: centres[type], region, reference, sectors });
    }
    if (!Object.keys(airports).length) throw new Error('No valid sectors found. Choose an X-Plane earth_msa.dat file.');
    return airports;
}
