import _clone from 'lodash/clone';
import _compact from 'lodash/compact';
import _map from 'lodash/map';
import { round } from '../math/core';
import { tau, radians_normalize } from '../math/circle';

/**
 * @property CARDINAL_DIRECTION
 * @type {Array}
 * @final
 */
const CARDINAL_DIRECTION = [
    'N',
    'NE',
    'E',
    'SE',
    'S',
    'SW',
    'W',
    'NW',
    'N'
];

/**
 * @property radio_names
 * @type {Object}
 * @final
 */
export const radio_names = {
    0: 'zero',
    1: 'one',
    2: 'two',
    3: 'three',
    4: 'four',
    5: 'five',
    6: 'six',
    7: 'seven',
    8: 'eight',
    9: 'niner',
    10: 'ten',
    11: 'eleven',
    12: 'twelve',
    13: 'thirteen',
    14: 'fourteen',
    15: 'fifteen',
    16: 'sixteen',
    17: 'seventeen',
    18: 'eighteen',
    19: 'nineteen',
    20: 'twenty',
    30: 'thirty',
    40: 'fourty',
    50: 'fifty',
    60: 'sixty',
    70: 'seventy',
    80: 'eighty',
    90: 'ninety',
    a: 'alpha',
    b: 'bravo',
    c: 'charlie',
    d: 'delta',
    e: 'echo',
    f: 'foxtrot',
    g: 'golf',
    h: 'hotel',
    i: 'india',
    j: 'juliet',
    k: 'kilo',
    l: 'lima',
    m: 'mike',
    n: 'november',
    o: 'oscar',
    p: 'papa',
    q: 'quebec',
    r: 'romeo',
    s: 'sierra',
    t: 'tango',
    u: 'uniform',
    v: 'victor',
    w: 'whiskey',
    x: 'x-ray',
    y: 'yankee',
    z: 'zulu',
    '-': 'dash',
    '.': 'point'
};

// TODO: this and CARDINAL_DIRECTION seem to be duplicating logic. look into smoothing that out by using
// just this enum and `toUpperCase()` where necessary.
/**
 * @property radio_cardinalDir_names
 * @type {Object}
 * @final
 */
export const radio_cardinalDir_names = {
    n: 'north',
    nw: 'northwest',
    w: 'west',
    sw: 'southwest',
    s: 'south',
    se: 'southeast',
    e: 'east',
    ne: 'northeast'
};

// TODO: probably do this with Object.assign
export const radio_runway_names = _clone(radio_names);
radio_runway_names.l = 'left';
radio_runway_names.c = 'center';
radio_runway_names.r = 'right';

// TODO: how is this different from lpad?
// NOT IN USE
/**
 * Force a number to a string with a specific # of digits
 *
 * If the rounded integer has more digits than requested, it will be returned
 * anyway, as chopping them off the end would change the value by orders of
 * magnitude, which is almost definitely going to be undesirable.
 *
 * @param number
 * @param digits
 * @truncate {boolean}
 * @return {string} with leading zeros to reach 'digits' places
 */
export const digits_integer = (number, digits, truncate = false) => {
    if (truncate) {
        number = Math.floor(number).toString();
    } else {
        number = Math.round(number).toString();
    }

    if (number.length > digits) {
        return number;
    }

    // add leading zeros
    while (number.length < digits) {
        number = `0${number}`;
    }

    return number;
};

/**
 * Round a number to a specific # of digits after the decimal
 *
 * Also supports negative digits. Ex: '-2' would do 541.246 --> 500
 *
 * @param {boolean} force - (optional) Forces presence of trailing zeros.
 *                          Must be set to true if you want '3' to be able to go to '3.0', or
 *                          for '32.168420' to not be squished to '32.16842'. If true, fxn will
 *                          return a string, because otherwise, js removes all trailing zeros.
 * @param {boolean} truncate - (optional) Selects shortening method.
 *                          to truncate: 'true', to round: 'false' (default)
 * @return {number}         if !force
 * @return {string}         if force
 */
export const digits_decimal = (number, digits, force, truncate) => {
    const shorten = (truncate) ? Math.floor : Math.round;

    if (!force) {
        return shorten(number * Math.pow(10, digits)) / Math.pow(10, digits);
    }

    // check if needs extra trailing zeros
    if (digits <= 0) {
        return (shorten(number * Math.pow(10, digits)) / Math.pow(10, digits)).toString();
    }

    number = number.toString();

    for (let i = 0; i < number.length; i++) {
        if (number[i] === '.') {
            const trailingDigits = number.length - (i + 1);

            if (trailingDigits === digits) {
                return number.toString();
            } else if (trailingDigits < digits) {
                // add trailing zeros
                return number + Array(digits - trailingDigits + 1).join('0');
            } else if (trailingDigits > digits) {
                if (truncate) {
                    return number.substr(0, number.length - (trailingDigits - digits));
                }

                const len = number.length - (trailingDigits - digits + 1);
                const part1 = number.substr(0, len);
                const part2 = (digits === 0)
                    ? ''
                    : shorten(parseInt(number.substr(len, 2), 10) / 10).toString();

                return part1 + part2;
            }
        }
    }
};

/**
 *
 * @function getGrouping
 * @param groupable {array}
 * @return {string}
 */
export const getGrouping = (groupable) => {
    const digit1 = groupable[0];
    const digit2 = groupable[1];

    if (digit1 === '0') {
        if (digit2 === '0') {
            return 'hundred';
        }
        // just digits (eg 'zero seven')
        return `${radio_names[digit1]} ${radio_names[digit2]}`;
    } else if (digit1 === '1') {
        // exact number (eg 'seventeen')
        return radio_names[groupable];
    } else if (digit1 >= 2) {
        const firstDigit = `${digit1}0`;

        if (digit2 === '0') {
            // to avoid 'five twenty zero'
            return radio_names[firstDigit];
        }
        // combo number (eg 'fifty one')
        return `${radio_names[firstDigit]} ${radio_names[digit2]}`;
    }

    return `${radio_names[digit1]} ${radio_names[digit2]}`;
};

// TODO: this needs to be simplified
/**
 *
 * @function groupNumbers
 * @param callsign {string}
 * @param airline {string} (optional)
 * @return
 */
export const groupNumbers = (callsign, airline) => {
    if (!/^\d+$/.test(callsign)) {
        // GA, eg '117KS' = 'one-one-seven-kilo-sierra')
        if (airline === 'November') {
            // callsign "November"
            const s = [];

            for (const k in callsign) {
                // one after another (eg 'one one seven kilo sierra')
                s.push(radio_names[callsign[k]]);
            }

            return s.join(' ');
        }

        // airline grouped, eg '3110A' = 'thirty-one-ten-alpha'
        // divide callsign into alpha/numeric sections
        const sections = [];
        let cs = callsign;
        let thisIsDigit;
        let index = cs.length - 1;
        let lastWasDigit = !isNaN(parseInt(cs[index], 10));
        index--;

        while (index >= 0) {
            thisIsDigit = !isNaN(parseInt(cs[index], 10));

            while (thisIsDigit === lastWasDigit) {
                index--;
                thisIsDigit = !isNaN(parseInt(cs[index], 10));

                if (index < 0) {
                    break;
                }
            }
            sections.unshift(cs.substr(index + 1));
            cs = cs.substr(0, index + 1);
            lastWasDigit = thisIsDigit;
        }

        // build words, section by section
        const s = [];

        for (const i in sections) {
            if (isNaN(parseInt(sections[i], 10))) {
                // alpha section
                s.push(radio_spellOut(sections[i]));
            } else {
                // numeric section
                switch (sections[i].length) {
                    case 0:
                        s.push(sections[i]);
                        break;
                    case 1:
                        s.push(radio_names[sections[i]]);
                        break;
                    case 2:
                        s.push(getGrouping(sections[i]));
                        break;
                    case 3:
                        s.push(`${radio_names[sections[i][0]]} ${getGrouping(sections[i].substr(1))}`);
                        break;
                    case 4:
                        s.push(`${getGrouping(sections[i].substr(0, 2))} ${getGrouping(sections[i].substr(2))}`);
                        break;
                    default:
                        s.push(radio_spellOut(sections[i]));
                        break;
                }
            }
        }

        return s.join(' ');
    } else {
        // TODO: this block is unreachable
        switch (callsign.length) {
            case 0:
                return callsign; break;
            case 1:
                return radio_names[callsign]; break;
            case 2:
                return getGrouping(callsign); break;
            case 3:
                return `${radio_names[callsign[0]]} ${getGrouping(callsign.substr(1))}`;
                break;
            case 4:
                if (callsign[1] === '0' && callsign[2] === '0' && callsign[3] === '0') {
                    return `${radio_names[callsign[0]]} thousand`;
                }

                return `${getGrouping(callsign.substr(0, 2))} ${getGrouping(callsign.substr(2))}`;
                break;
            default:
                return callsign;
        }
    }
};

/**
 *
 * @funtion radio_runway
 * @param input {string}
 * @return
 */
export const radio_runway = (input) => {
    input = `${input} `;
    input = input.toLowerCase();

    return _compact(_map(input, (letterOrNumber, i) => radio_runway_names[input[i]])).join(' ');
};

/**
 *
 * @function radio_heading
 * @param heading {string}
 * @return {string}
 */
export const radio_heading = (heading) => {
    const str = heading.toString();

    switch (str.length) {
        case 1:
            return `zero zero ${radio_names[str]}`;
        case 2:
            return `zero ${radio_names[str[0]]} ${radio_names[str[1]]}`;
        default:
            return `${radio_names[str[0]]} ${radio_names[str[1]]} ${radio_names[str[2]]}`;
    }

    return heading;
};

/**
 *
 * @function radio_spellOut
 * @param alphanumeric
 * @return
 */
export const radio_spellOut = (alphanumeric) => {
    const str = alphanumeric.toString().toLowerCase();
    const arr = [];

    if (!str) {
        return;
    }

    // TODO: change to _map()
    for (let i = 0; i < str.length; i++) {
        arr.push(radio_names[str[i]]);
    }

    return arr.join(' ');
};

/**
 *
 * @function radio_altitude
 * @param altitude
 * @return
 */
export const radio_altitude = (altitude) => {
    const alt_s = altitude.toString();
    const s = [];

    // TODO can this block be simplified?
    if (altitude >= 18000) {
        s.push('flight level', radio_names[alt_s[0]], radio_names[alt_s[1]], radio_names[alt_s[2]]);
    } else if (altitude >= 10000) {
        s.push(radio_names[alt_s[0]], radio_names[alt_s[1]], 'thousand');

        if (!(altitude % (Math.floor(altitude / 1000) * 1000) === 0)) {
            s.push(radio_names[alt_s[2]], 'hundred');
        }
    } else if (altitude >= 1000) {
        s.push(radio_names[alt_s[0]], 'thousand');

        if (!(altitude % (Math.floor(altitude / 1000) * 1000) === 0)) {
            s.push(radio_names[alt_s[1]], 'hundred');
        }
    } else if (altitude >= 100) {
        s.push(radio_names[alt_s[0]], 'hundred');
    } else {
        return altitude;
    }

    return s.join(' ');
};

/**
 * Return a portion of a control instruction (as a string) indicating the correct
 * direction of a change in assigned altitude or speed.
 *
 * @function radio_trend
 * @param category {string} either 'altitude' or 'speed'
 * @param currentValue {number} current altitude/speed of the aircraft
 * @param nextValue {number} the altitude/speed being assigned to the aircraft
 * @return {string}
 */
export const radio_trend = (category, currentValue, nextValue) => {
    const CATEGORIES = {
        altitude: ['descend and maintain', 'climb and maintain', 'maintain'],
        speed: ['reduce speed to', 'increase speed to', 'maintain present speed of']
    };

    if (currentValue > nextValue) {
        return CATEGORIES[category][0];
    }

    if (currentValue < nextValue) {
        return CATEGORIES[category][1];
    }

    return CATEGORIES[category][2];
};

/**
 *
 * @function getCardinalDirection
 * @param angle
 * @return {string}
 */
export const getCardinalDirection = (angle) => {
    return CARDINAL_DIRECTION[round(angle / tau() * 8)];
};

/**
 * Return a cardinalDirection when provided a heading
 *
 * @function getRadioCardinalDirectionNameForHeading
 * @param  heading {number}
 * @return {string}
 */
export const getRadioCardinalDirectionNameForHeading = (heading) => {
    const cardinalDirection = getCardinalDirection(radians_normalize(heading + Math.PI)).toLowerCase();

    return radio_cardinalDir_names[cardinalDirection];
};

/**
 * Speak a string of digits one at a time using the radiotelephony names.
 *
 * @param {string|number} value
 * @return {string}
 */
const _spokenDigits = (value) => value.toString().split('').map((digit) => radio_names[digit]).join(' ');

/**
 * Speak a frequency, preserving the digits actually printed after the decimal point.
 *
 * @param {string|number} freq
 * @return {string}
 */
export const radio_frequencySpoken = (freq) => {
    if (freq === null || typeof freq === 'undefined') {
        return '';
    }

    const parts = freq.toString().trim().split('.');
    const whole = _spokenDigits(parts[0]);

    if (parts.length === 1 || parts[1] === '') {
        return whole;
    }

    return `${whole} decimal ${_spokenDigits(parts[1])}`;
};

/**
 * Speak a flight level supplied as FL230, 230 or the equivalent altitude 23000.
 *
 * @param {string|number} level
 * @return {string}
 */
export const radio_flightLevelSpoken = (level) => {
    if (level === null || typeof level === 'undefined') {
        return '';
    }

    const digits = level.toString().trim().replace(/^FL/i, '');
    const levelDigits = digits.length === 5 ?
        Math.round(Number(digits) / 100).toString() :
        digits;

    return `flight level ${_spokenDigits(levelDigits)}`;
};

/**
 * Speak a four-digit transponder code one digit at a time.
 *
 * @param {string|number} code
 * @return {string}
 */
export const radio_squawkSpoken = (code) => {
    if (code === null || typeof code === 'undefined') {
        return '';
    }

    const digits = code.toString().trim();
    const codeDigits = digits.length < 4 ?
        digits_integer(Number(digits), 4) :
        digits;

    return _spokenDigits(codeDigits);
};

/**
 * Speak an indicated airspeed one digit at a time.
 *
 * @param {string|number} speed
 * @return {string}
 */
export const radio_speedSpoken = (speed) => {
    if (speed === null || typeof speed === 'undefined') {
        return '';
    }

    return _spokenDigits(speed.toString().trim());
};

/**
 * Speak an approach name, eg ILS34L, RNAV12 or VIS 34. Words that have already
 * been spoken are left as-is.
 *
 * @param {string} name
 * @return {string}
 */
export const radio_approachSpoken = (name) => {
    if (name === null || typeof name === 'undefined') {
        return '';
    }

    const input = name.toString().trim();

    if (input === '') {
        return '';
    }

    const upper = input.toUpperCase().replace(/\s+/g, ' ');
    const PREFIX_NAMES = {
        ILS: 'ILS',
        RNAV: 'ar nav',
        VIS: 'visual',
        VISUAL: 'visual'
    };
    const prefixMatch = upper.match(/^(ILS|RNAV|VISUAL|VIS)(?=\d|\s|$)\s*/);

    if (prefixMatch) {
        const designator = upper.slice(prefixMatch[0].length).replace(/\s+/g, '').match(/^(\d+)([LRC])?$/);

        if (designator) {
            const side = designator[2] ? ` ${radio_runway_names[designator[2].toLowerCase()]}` : '';

            return `${PREFIX_NAMES[prefixMatch[1]]} ${_spokenDigits(designator[1])}${side}`;
        }
    }

    const spokenWords = input.split(/\s+/).map((word) => {
        if (/^[a-z]+$/.test(word)) {
            return word;
        }

        return word.toUpperCase()
            .replace(/(\d+)([LRC])$/, (match, digits, suffix) => {
                return ` ${_spokenDigits(digits)} ${radio_runway_names[suffix.toLowerCase()]}`;
            })
            .replace(/\d/g, (digit) => ` ${radio_names[digit]}`);
    });

    return spokenWords.join(' ')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Speak a procedure name, eg KEVIN7 -> kevin seven. Words that have already
 * been spoken are left as-is.
 *
 * @param {string} id
 * @return {string}
 */
export const radio_procedureSpoken = (id) => {
    if (id === null || typeof id === 'undefined') {
        return '';
    }

    const input = id.toString().trim();
    const match = input.match(/^([A-Za-z]+)(\d+)$/);

    if (match) {
        return `${match[1].toUpperCase()} ${_spokenDigits(match[2]).toUpperCase()}`;
    }

    return input.replace(/\d/g, (digit) => ` ${radio_names[digit]}`)
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Post-process a complete spoken string, replacing only the numeric patterns
 * that have a defined radiotelephony form. Other words, including callsigns
 * and already-spoken phrases, are left untouched.
 *
 * @param {string} text
 * @return {string}
 */
export const radio_spokenText = (text) => {
    if (text === null || typeof text === 'undefined') {
        return '';
    }

    return text.toString()
        .replace(/\bflight level (\d{2,3})\b/gi, (match, level) => radio_flightLevelSpoken(level))
        .replace(/\bFL(\d{2,3})\b/g, (match, level) => radio_flightLevelSpoken(level))
        .replace(/\b(\d{3}\.\d{1,3})\b/g, (match, freq) => radio_frequencySpoken(freq))
        .replace(/\b(\d{4,5})\s*(?:ft|feet)\b/gi, (match, altitude) => radio_altitude(altitude))
        .replace(/\b(\d{2}[LRC])\b/gi, (match, runway) => radio_runway(runway))
        .replace(/\b(squawk\s+)(\d{4})\b/gi, (match, lead, code) => `${lead}${radio_squawkSpoken(code)}`)
        .replace(/\b(heading\s+)(\d{3})\b/gi, (match, lead, heading) => `${lead}${radio_heading(heading)}`)
        .replace(/\bRNAV\b/g, 'ar nav');
};
