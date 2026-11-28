import { parseSpokenNumber, tokensToIdentifier } from './NumberNormalizer';

const DEFAULT_AIRLINE_TELEPHONY = {
    qantas: 'QFA',
    jetstar: 'JST',
    virgin: 'VOZ',
    velocity: 'VOZ',
    rex: 'RXA',
    regional: 'RXA',
    aussie: 'ASY',
    airnz: 'ANZ',
    newzealand: 'ANZ',
    singapore: 'SIA',
    cathay: 'CPA',
    emirates: 'UAE',
    speedbird: 'BAW',
    united: 'UAL',
    delta: 'DAL',
    american: 'AAL',
    lufthansa: 'DLH',
    airasia: 'AXM',
    pelican: 'PE',
    lifesaver: 'RESQ'
};

function buildTelephonyMap(airlines = []) {
    const map = { ...DEFAULT_AIRLINE_TELEPHONY };
    airlines.forEach((airline) => {
        if (!airline || !airline.icao) return;
        const icao = String(airline.icao).trim().toUpperCase();
        if (airline.radioName) {
            const key = String(airline.radioName).toLowerCase().replace(/[^a-z0-9]+/g, '');
            if (key) map[key] = icao;
        }
        if (airline.name) {
            const key = String(airline.name).toLowerCase().replace(/[^a-z0-9]+/g, '');
            if (key) map[key] = icao;
        }
    });
    return map;
}

function matchAircraftFromTokens(tokens, activeAircraft, telephonyMap) {
    if (!tokens.length) return [];

    const first = tokens[0].toLowerCase();
    const matches = new Map();

    // 1. Direct exact ICAO/callsign match (e.g. "qfa412", "vhabc")
    const compact = tokensToIdentifier(tokens);
    activeAircraft.forEach((ac) => {
        const cs = String(ac.callsign || '').toUpperCase();
        if (!cs) return;
        if (cs === compact) {
            matches.set(cs, ac);
        }
    });

    // 2. Airline telephony + flight number (e.g. "qantas four one two")
    if (first in telephonyMap) {
        const prefix = telephonyMap[first];
        const num = parseSpokenNumber(tokens.slice(1));
        if (num !== null) {
            const candidate = `${prefix}${num}`;
            activeAircraft.forEach((ac) => {
                const cs = String(ac.callsign || '').toUpperCase();
                if (cs === candidate) matches.set(cs, ac);
            });
        }
        // Also check abbreviated suffix if unique
        const suffixTokens = tokens.slice(1);
        const suffixId = tokensToIdentifier(suffixTokens);
        if (suffixId && matches.size === 0) {
            activeAircraft.forEach((ac) => {
                const cs = String(ac.callsign || '').toUpperCase();
                if (cs.startsWith(prefix) && cs.endsWith(suffixId)) {
                    matches.set(cs, ac);
                }
            });
        }
    }

    // 3. Two-word telephony (e.g. "air new zealand", "hobart two echo foxtrot")
    if (tokens.length >= 2) {
        const twoWord = `${tokens[0]}${tokens[1]}`.toLowerCase();
        if (twoWord in telephonyMap) {
            const prefix = telephonyMap[twoWord];
            const num = parseSpokenNumber(tokens.slice(2));
            if (num !== null) {
                const candidate = `${prefix}${num}`;
                activeAircraft.forEach((ac) => {
                    const cs = String(ac.callsign || '').toUpperCase();
                    if (cs === candidate) matches.set(cs, ac);
                });
            }
        }
    }

    // 4. Abbreviated GA registration suffix (last 3 chars, e.g. "alpha bravo charlie" -> "VHABC")
    if (matches.size === 0 && compact.length >= 3 && compact.length <= 6) {
        activeAircraft.forEach((ac) => {
            const cs = String(ac.callsign || '').toUpperCase();
            if (cs.startsWith('VH') && cs.endsWith(compact)) {
                matches.set(cs, ac);
            }
        });
    }

    return [...matches.values()];
}

/**
 * Resolve spoken callsign at the beginning or end of a normalized transmission
 * against currently active aircraft. Never invents an aircraft.
 *
 * @param {string} normalizedText
 * @param {Array<Object>} activeAircraft
 * @param {Array<Object>} [airlines]
 * @returns {{ status: string, callsign: string|null, aircraft: Object|null, candidates: Array<string>, remainder: string }}
 */
export function resolveCallsign(normalizedText, activeAircraft = [], airlines = []) {
    if (!normalizedText) {
        return { status: 'missing', callsign: null, aircraft: null, candidates: [], remainder: '' };
    }

    const telephonyMap = buildTelephonyMap(airlines);
    const words = normalizedText.split(/\s+/).filter(Boolean);

    // Try prefix callsign spans (1..6 tokens)
    for (let len = Math.min(6, words.length); len >= 1; len -= 1) {
        const slice = words.slice(0, len).filter((w) => w !== ',');
        const hits = matchAircraftFromTokens(slice, activeAircraft, telephonyMap);
        if (hits.length === 1) {
            const remainder = words.slice(len).join(' ').replace(/^,\s*/, '').trim();
            return {
                status: 'resolved',
                callsign: hits[0].callsign.toUpperCase(),
                aircraft: hits[0],
                candidates: [hits[0].callsign.toUpperCase()],
                remainder
            };
        }
        if (hits.length > 1) {
            return {
                status: 'ambiguous',
                callsign: null,
                aircraft: null,
                candidates: hits.map((a) => a.callsign.toUpperCase()),
                remainder: normalizedText
            };
        }
    }

    // Try suffix callsign spans (callsign at end of transmission)
    for (let len = Math.min(6, words.length - 1); len >= 1; len -= 1) {
        const start = words.length - len;
        const slice = words.slice(start).filter((w) => w !== ',');
        const hits = matchAircraftFromTokens(slice, activeAircraft, telephonyMap);
        if (hits.length === 1) {
            const remainder = words.slice(0, start).join(' ').replace(/,\s*$/, '').trim();
            return {
                status: 'resolved',
                callsign: hits[0].callsign.toUpperCase(),
                aircraft: hits[0],
                candidates: [hits[0].callsign.toUpperCase()],
                remainder
            };
        }
        if (hits.length > 1) {
            return {
                status: 'ambiguous',
                callsign: null,
                aircraft: null,
                candidates: hits.map((a) => a.callsign.toUpperCase()),
                remainder: normalizedText
            };
        }
    }

    // Check if speaker named an airline + number that does not exist in activeAircraft
    const firstWord = words[0] && words[0].replace(/,/g, '');
    if (firstWord && firstWord in telephonyMap) {
        return { status: 'not_found', callsign: null, aircraft: null, candidates: [], remainder: normalizedText };
    }

    return { status: 'missing', callsign: null, aircraft: null, candidates: [], remainder: normalizedText };
}
