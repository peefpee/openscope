/**
 * Enumeration for controller types in the handoff system
 *
 * @property CONTROLLER_TYPE
 * @type {Object}
 * @final
 */
export const CONTROLLER_TYPE = {
    /** Tower — manages runway operations, landing clearance, takeoff */
    TWR: 'TWR',
    /** Approach — the player-controlled position for arrivals */
    APP: 'APP',
    /** Departures — the player-controlled position for departures */
    DEP: 'DEP',
    /** Centre / En-route — manages aircraft outside approach airspace */
    CTR: 'CTR',
    /** Uncontrolled operations */
    UNICOM: 'UNICOM',
    /** Released from all frequencies */
    NONE: 'NONE'
};

/**
 * Controller types that the player controls.
 * Approach and Departures are combined for now but structured for future split.
 *
 * @property PLAYER_CONTROLLED_TYPES
 * @type {Set<string>}
 * @final
 */
export const PLAYER_CONTROLLED_TYPES = new Set([
    CONTROLLER_TYPE.APP,
    CONTROLLER_TYPE.DEP
]);

/**
 * Enumeration for handoff states
 *
 * @property HANDOFF_STATE
 * @type {Object}
 * @final
 */
export const HANDOFF_STATE = {
    /** No handoff in progress */
    NONE: 'NONE',
    /** Handoff is required but player has not initiated it */
    REQUIRED: 'REQUIRED',
    /** Handoff has been initiated by the player */
    INITIATED: 'INITIATED',
    /** Handoff has been completed successfully */
    COMPLETED: 'COMPLETED',
    /** Handoff deadline has passed without completion */
    OVERDUE: 'OVERDUE',
    /** Aircraft has been released from the player's frequency */
    RELEASED: 'RELEASED'
};

/**
 * Default handoff distance thresholds (NM from runway threshold)
 * These are simulation gameplay defaults, not real-world requirements.
 *
 * @property HANDOFF_THRESHOLDS_NM
 * @type {Object}
 * @final
 */
export const HANDOFF_THRESHOLDS_NM = {
    /** Recommended handoff distance — first notification to player */
    RECOMMENDED: 12,
    /** Urgent handoff distance — amber warning */
    URGENT: 6,
    /** Mandatory handoff distance — go-around triggered if not transferred */
    MANDATORY: 2
};

/**
 * Default altitude AGL at which departures contact the player
 *
 * @property DEPARTURE_CONTACT_ALTITUDE_AGL
 * @type {number}
 * @final
 */
export const DEPARTURE_CONTACT_ALTITUDE_AGL = 1500;

/**
 * Minimum altitude AGL before departure can contact player
 *
 * @property DEPARTURE_CONTACT_MIN_AGL
 * @type {number}
 * @final
 */
export const DEPARTURE_CONTACT_MIN_AGL = 500;

/**
 * Radio reminder cooldown in simulation seconds
 *
 * @property HANDOFF_REMINDER_COOLDOWN_S
 * @type {number}
 * @final
 */
export const HANDOFF_REMINDER_COOLDOWN_S = 30;

/**
 * Enumeration for frequency data provenance
 *
 * @property FREQUENCY_SOURCE
 * @type {Object}
 * @final
 */
export const FREQUENCY_SOURCE = {
    PUBLISHED: 'published',
    SIMULATED: 'simulated',
    USER: 'user'
};

/**
 * Minimum valid VHF COM frequency in kHz (118.000 MHz)
 *
 * @property VHF_COM_MIN_KHZ
 * @type {number}
 * @final
 */
export const VHF_COM_MIN_KHZ = 118000;

/**
 * Maximum valid VHF COM frequency in kHz (136.975 MHz)
 *
 * @property VHF_COM_MAX_KHZ
 * @type {number}
 * @final
 */
export const VHF_COM_MAX_KHZ = 136975;

/**
 * Convert a frequency value to integer kHz for safe comparison.
 * Validates strict VHF COM band (118.000-136.975 MHz) and up to 3 decimal places.
 * e.g. '120.5' -> 120500, 124.4 -> 124400, '120.5abc' -> null
 *
 * @function frequencyToKhz
 * @param {string|number} freq
 * @return {number|null} frequency in kHz, or null if invalid/out-of-band
 */
export function frequencyToKhz(freq) {
    let khz = null;

    if (typeof freq === 'number') {
        if (!Number.isFinite(freq)) {
            return null;
        }

        const scaled = freq * 1000;
        const rounded = Math.round(scaled);

        if (Number.isNaN(rounded) || Math.abs(scaled - rounded) > 1e-6) {
            return null;
        }

        khz = rounded;
    } else if (typeof freq === 'string') {
        const match = /^(\d{3})(?:\.(\d{1,3}))?$/.exec(freq.trim());

        if (!match) {
            return null;
        }

        const mhz = Number(match[1]);
        const fracKhz = Number((match[2] || '').padEnd(3, '0'));
        khz = (mhz * 1000) + fracKhz;
    } else {
        return null;
    }

    if (khz < VHF_COM_MIN_KHZ || khz > VHF_COM_MAX_KHZ) {
        return null;
    }

    return khz;
}

/**
 * Normalize a frequency value to a consistent 3-decimal MHz string.
 * e.g. '120.5' -> '120.500', 124.4 -> '124.400', invalid -> null
 *
 * @function normalizeFrequency
 * @param {string|number} freq
 * @return {string|null} normalized frequency string with 3 decimal places, or null if invalid
 */
export function normalizeFrequency(freq) {
    const khz = frequencyToKhz(freq);

    if (khz === null) {
        return null;
    }

    const whole = Math.floor(khz / 1000);
    const frac = String(khz % 1000).padStart(3, '0');

    return `${whole}.${frac}`;
}

/**
 * Check whether a frequency value is valid in the VHF COM band.
 *
 * @function isValidFrequency
 * @param {string|number} freq
 * @return {boolean}
 */
export function isValidFrequency(freq) {
    return frequencyToKhz(freq) !== null;
}

/**
 * Check if two frequency values are equal, using integer kHz comparison
 * to avoid floating-point errors. Returns false if either input is invalid.
 *
 * @function frequenciesEqual
 * @param {string|number} freqA
 * @param {string|number} freqB
 * @return {boolean}
 */
export function frequenciesEqual(freqA, freqB) {
    const khzA = frequencyToKhz(freqA);
    const khzB = frequencyToKhz(freqB);

    return khzA !== null && khzA === khzB;
}

/**
 * Check whether the given ICAO code belongs to an Australian airport
 *
 * @function isAustralianAirport
 * @param {string} icao
 * @return {boolean}
 */
export function isAustralianAirport(icao) {
    return typeof icao === 'string' && /^Y/i.test(icao.trim());
}

/**
 * Spoken airport names used when Australian coded waypoints or controller
 * positions are read out on the radio. Keyed by ICAO.
 *
 * @property AUSTRALIAN_AIRPORT_SPOKEN_NAMES
 * @type {Object}
 * @final
 */
export const AUSTRALIAN_AIRPORT_SPOKEN_NAMES = Object.freeze({
    YSWS: 'Walton',
    YMML: 'Melbourne',
    YSSY: 'Sydney',
    YMHB: 'Hobart',
    YWLM: 'Williamtown',
    YMMM: 'Melbourne',
    YBBB: 'Brisbane'
});

/**
 * Australian terminal position prefixes. These are the identifiers used in
 * radar sector callsigns (for example `ML_APP`), not the airport ICAO code.
 *
 * @property AUSTRALIAN_CONTROLLER_POSITION_PREFIXES
 * @type {Object}
 * @final
 */
export const AUSTRALIAN_CONTROLLER_POSITION_PREFIXES = Object.freeze({
    YSWS: 'WS',
    YMML: 'ML',
    YSSY: 'SY',
    YMHB: 'HB',
    YWLM: 'WLM'
});

/**
 * Verified spoken radio names for known radar sector callsigns.
 *
 * @property CONTROLLER_RADIO_NAMES_BY_CALLSIGN
 * @type {Object}
 * @final
 */
export const CONTROLLER_RADIO_NAMES_BY_CALLSIGN = Object.freeze({
    WS_APP: 'Walton Approach',
    WS_TWR: 'Walton Tower',
    WS_DEP: 'Walton Departures',
    ML_APP: 'Melbourne Approach',
    ML_TWR: 'Melbourne Tower',
    ML_DEP: 'Melbourne Departures',
    SY_APP: 'Sydney Approach',
    SY_TWR: 'Sydney Tower',
    SY_TWR_E: 'Sydney Tower East',
    SY_DEP: 'Sydney Control',
    HB_APP: 'Hobart Approach',
    HB_TWR: 'Hobart Tower',
    HB_DEP: 'Hobart Departures',
    WLM_APP: 'Williamtown Approach',
    WLM_TWR: 'Williamtown Tower',
    WLM_DEP: 'Williamtown Departures',
    YMMM: 'Melbourne Centre',
    YBBB: 'Brisbane Centre'
});

/**
 * Spoken radio names by airport ICAO and control position. Used when a
 * position has no explicit sector callsign mapping.
 *
 * @property CONTROLLER_RADIO_NAMES_BY_AIRPORT
 * @type {Object}
 * @final
 */
export const CONTROLLER_RADIO_NAMES_BY_AIRPORT = Object.freeze({
    YSWS: {
        APP: 'Walton Approach',
        TWR: 'Walton Tower',
        DEP: 'Walton Departures',
        CTR: 'Melbourne Centre'
    },
    YMML: {
        APP: 'Melbourne Approach',
        TWR: 'Melbourne Tower',
        DEP: 'Melbourne Departures',
        CTR: 'Melbourne Centre'
    },
    YSSY: {
        APP: 'Sydney Approach',
        TWR: 'Sydney Tower',
        DEP: 'Sydney Control',
        CTR: 'Melbourne Centre'
    },
    YMHB: {
        APP: 'Hobart Approach',
        TWR: 'Hobart Tower',
        DEP: 'Hobart Departures',
        CTR: 'Melbourne Centre'
    },
    YWLM: {
        APP: 'Williamtown Approach',
        TWR: 'Williamtown Tower',
        DEP: 'Williamtown Departures',
        CTR: 'Brisbane Centre'
    }
});

const GENERIC_CONTROLLER_RADIO_NAMES = Object.freeze({
    APP: 'Approach',
    DEP: 'Departures',
    TWR: 'Tower',
    CTR: 'Centre',
    UNICOM: 'Unicom',
    NONE: ''
});

/**
 * Build a terminal sector callsign from an airport ICAO code.
 *
 * @function deriveAustralianControllerCallsign
 * @param {string} icao
 * @param {string} type one of the CONTROLLER_TYPE values
 * @return {string}
 */
export function deriveAustralianControllerCallsign(icao, type) {
    const code = String(icao || '').trim().toUpperCase();
    const prefix = AUSTRALIAN_CONTROLLER_POSITION_PREFIXES[code] || code.slice(1) || 'Y';
    const suffix = {
        APP: 'APP',
        DEP: 'DEP',
        TWR: 'TWR',
        CTR: '',
        UNICOM: 'UNICOM',
        NONE: ''
    }[type];

    if (!suffix) {
        return prefix;
    }

    return `${prefix}_${suffix}`;
}

/**
 * Resolve the spoken radio name for a controller from all available metadata.
 * Explicit configuration wins, followed by known sector callsigns, known
 * airport/position pairs, an optional legacy `radio` value, and finally a
 * generic position name.
 *
 * @function resolveControllerRadioName
 * @param {Object} [options={}]
 * @param {string} [options.icao]
 * @param {string} [options.callsign]
 * @param {string} [options.sectorId]
 * @param {string} [options.type] one of the CONTROLLER_TYPE values
 * @param {string} [options.radioName] explicit radio name from configuration
 * @param {string} [options.fallback] legacy airport `radio` value
 * @return {string}
 */
export function resolveControllerRadioName(options = {}) {
    const {
        icao,
        callsign,
        sectorId,
        type,
        radioName,
        fallback
    } = options;
    const explicit = typeof radioName === 'string' ? radioName.trim() : '';

    // An identifier supplied as `radioName` is treated as a callsign, not as
    // something a controller would actually say on the radio.
    if (explicit && !/^[A-Z0-9_]+$/i.test(explicit)) {
        return explicit;
    }

    const stationId = String(explicit || callsign || sectorId || '').trim().toUpperCase();

    if (CONTROLLER_RADIO_NAMES_BY_CALLSIGN[stationId]) {
        return CONTROLLER_RADIO_NAMES_BY_CALLSIGN[stationId];
    }

    const airportCode = String(icao || '').trim().toUpperCase();

    if (CONTROLLER_RADIO_NAMES_BY_AIRPORT[airportCode] &&
        CONTROLLER_RADIO_NAMES_BY_AIRPORT[airportCode][type]) {
        return CONTROLLER_RADIO_NAMES_BY_AIRPORT[airportCode][type];
    }

    if (typeof fallback === 'string' && fallback.trim() && !/^[A-Z0-9_]+$/i.test(fallback.trim())) {
        return fallback.trim();
    }

    return GENERIC_CONTROLLER_RADIO_NAMES[type] || stationId || '';
}
