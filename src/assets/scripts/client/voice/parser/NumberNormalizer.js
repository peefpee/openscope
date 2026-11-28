const WORD_DIGITS = {
    zero: '0',
    oh: '0',
    one: '1',
    wun: '1',
    two: '2',
    too: '2',
    three: '3',
    tree: '3',
    four: '4',
    fower: '4',
    five: '5',
    fife: '5',
    six: '6',
    seven: '7',
    eight: '8',
    ait: '8',
    nine: '9',
    niner: '9'
};

const TENS_WORDS = {
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fourty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90
};

export const PHONETIC_ALPHABET = {
    alpha: 'A',
    alfa: 'A',
    bravo: 'B',
    charlie: 'C',
    delta: 'D',
    echo: 'E',
    foxtrot: 'F',
    golf: 'G',
    hotel: 'H',
    india: 'I',
    juliet: 'J',
    juliett: 'J',
    kilo: 'K',
    lima: 'L',
    mike: 'M',
    november: 'N',
    oscar: 'O',
    papa: 'P',
    quebec: 'Q',
    romeo: 'R',
    sierra: 'S',
    tango: 'T',
    uniform: 'U',
    victor: 'V',
    whiskey: 'W',
    xray: 'X',
    'x-ray': 'X',
    yankee: 'Y',
    zulu: 'Z'
};

const RUNWAY_SIDE_WORDS = {
    left: 'L',
    right: 'R',
    center: 'C',
    centre: 'C'
};

/**
 * Normalize raw transcript text for deterministic ATC parsing without corrupting
 * embedded callsigns or waypoint names.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeTranscript(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
        .toLowerCase()
        .replace(/[,;!?]+/g, ' , ')
        .replace(/\bdecimal\b|\bpoint\b/g, '.')
        .replace(/\s*\.\s*/g, '.')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Parse a sequence of spoken number tokens into a numeric value.
 * Supports digit-by-digit ("two seven zero" -> 270), thousands/hundreds
 * ("five thousand five hundred" -> 5500, "one zero thousand" -> 10000),
 * and natural numbers ("twenty four" -> 24).
 *
 * @param {Array<string>} tokens
 * @returns {number|null}
 */
export function parseSpokenNumber(tokens) {
    if (!Array.isArray(tokens) || !tokens.length) return null;

    const joined = tokens.join('').trim();
    if (/^\d+(?:\.\d+)?$/.test(joined)) {
        return Number(joined);
    }

    // Check if it contains 'thousand' or 'hundred'
    let total = 0;
    let current = 0;
    let digitBuf = '';
    let hasValue = false;

    const flushDigits = () => {
        if (digitBuf.length > 0) {
            current += Number(digitBuf);
            digitBuf = '';
            hasValue = true;
        }
    };

    for (let i = 0; i < tokens.length; i += 1) {
        const tok = tokens[i].toLowerCase();
        if (/^\d+$/.test(tok)) {
            digitBuf += tok;
            hasValue = true;
        } else if (tok in WORD_DIGITS) {
            digitBuf += WORD_DIGITS[tok];
            hasValue = true;
        } else if (tok in TENS_WORDS) {
            flushDigits();
            current += TENS_WORDS[tok];
            hasValue = true;
        } else if (tok === 'hundred') {
            flushDigits();
            current = (current || 1) * 100;
            hasValue = true;
        } else if (tok === 'thousand') {
            flushDigits();
            total += (current || 1) * 1000;
            current = 0;
            hasValue = true;
        } else {
            return null;
        }
    }

    flushDigits();
    if (!hasValue) return null;
    return total + current;
}

/**
 * Parse a spoken altitude or flight level phrase.
 * Returns { feet, isFlightLevel, formatted } or null.
 *
 * @param {Array<string>} tokens
 * @returns {{ feet: number, isFlightLevel: boolean, formatted: string }|null}
 */
export function parseSpokenAltitude(tokens) {
    if (!Array.isArray(tokens) || !tokens.length) return null;
    const clean = tokens.filter((t) => t !== 'feet' && t !== 'ft');
    if (!clean.length) return null;

    if (clean.length >= 2 && clean[0] === 'flight' && clean[1] === 'level') {
        const fl = parseSpokenNumber(clean.slice(2));
        if (!Number.isFinite(fl) || fl < 10 || fl > 600) return null;
        return {
            feet: fl * 100,
            isFlightLevel: true,
            formatted: `FL${String(fl).padStart(3, '0')}`
        };
    }

    if (clean.length === 1 && /^fl\d{2,3}$/i.test(clean[0])) {
        const fl = Number(clean[0].slice(2));
        return {
            feet: fl * 100,
            isFlightLevel: true,
            formatted: `FL${String(fl).padStart(3, '0')}`
        };
    }

    const feet = parseSpokenNumber(clean);
    if (!Number.isFinite(feet) || feet <= 0) return null;
    return {
        feet,
        isFlightLevel: false,
        formatted: String(feet)
    };
}

/**
 * Parse a spoken runway identifier (e.g. ["three", "four", "left"] -> "34L", ["09", "right"] -> "09R").
 *
 * @param {Array<string>} tokens
 * @returns {string|null}
 */
export function parseSpokenRunway(tokens) {
    if (!Array.isArray(tokens) || !tokens.length) return null;
    const filtered = tokens.filter((t) => t !== 'runway' && t !== 'rwy');
    if (!filtered.length) return null;

    let suffix = '';
    const last = filtered[filtered.length - 1];
    const numTokens = [...filtered];
    if (last in RUNWAY_SIDE_WORDS) {
        suffix = RUNWAY_SIDE_WORDS[last];
        numTokens.pop();
    } else if (/^\d{1,2}[lrc]$/i.test(last) && numTokens.length === 1) {
        const match = /^(\d{1,2})([lrc])$/i.exec(last);
        return `${match[1].padStart(2, '0')}${match[2].toUpperCase()}`;
    }

    const num = parseSpokenNumber(numTokens);
    if (!Number.isFinite(num) || num < 1 || num > 36) return null;
    return `${String(num).padStart(2, '0')}${suffix}`;
}

/**
 * Parse a spoken VHF frequency (e.g. ["one", "two", "zero", ".", "five"] -> "120.500").
 *
 * @param {Array<string>} tokens
 * @returns {string|null}
 */
export function parseSpokenFrequency(tokens) {
    if (!Array.isArray(tokens) || !tokens.length) return null;
    const joined = tokens
        .join(' ')
        .replace(/\b([a-z]+)\b/gi, (w) => (w.toLowerCase() in WORD_DIGITS ? WORD_DIGITS[w.toLowerCase()] : w))
        .replace(/\s+/g, '');
    const match = /^(1[123]\d(?:\.\d{1,3})?)$/.exec(joined);
    if (!match) return null;
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num < 118 || num > 137) return null;
    return num.toFixed(3);
}

/**
 * Convert a sequence of phonetic / alphanumeric tokens into a compact identifier
 * (e.g. ["victor", "hotel", "alpha", "bravo", "charlie"] -> "VHABC").
 *
 * @param {Array<string>} tokens
 * @returns {string}
 */
export function tokensToIdentifier(tokens) {
    return tokens
        .map((t) => {
            const lower = t.toLowerCase();
            if (lower in PHONETIC_ALPHABET) return PHONETIC_ALPHABET[lower];
            if (lower in WORD_DIGITS) return WORD_DIGITS[lower];
            if (/^[a-z0-9]+$/i.test(lower)) return lower.toUpperCase();
            return '';
        })
        .join('');
}
