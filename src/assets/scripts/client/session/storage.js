import { GAME_OPTION_VALUES } from '../constants/gameOptionConstants';

const KEY = 'openscope.clientSettings.v1';
const SCORE_PREFIX = 'openscope.sessionScore.v1.';
const voiceControlDefaults = {
    enabled: false,
    provider: 'browser',
    pttKey: 'ControlLeft',
    gamepadButton: null,
    deviceId: '',
    lang: 'en-AU',
    whisperModel: 'base.en',
    whisperServerUrl: 'http://localhost:8080/v1/audio/transcriptions',
    whisperServerModel: 'whisper-1',
    llmFallbackEnabled: false,
    confirmationMode: 'local-auto'
};
const defaults = {
    language: 'en-AU', enabled: true, rate: 1, volume: 0.8, voiceURI: '', voiceControl: { ...voiceControlDefaults }
};

export function resolveOption(option, value) {
    if (option.optionList) {
        const match = option.optionList.find((item) => item.value === value ||
            (value != null && String(item.value) === String(value)));
        return match ? match.value : option.defaultValue;
    }
    if (value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) && option.validationHandler(value)) {
        return option.type === 'number' ? Number(value) : value;
    }
    return option.defaultValue;
}

export function preferences(reset = false) {
    const result = { ...defaults, voiceControl: { ...voiceControlDefaults }, radar: {} };
    let stored = {};
    if (!reset) {
        try {
            const legacy = localStorage.getItem('atc-speech-enabled');
            if (legacy !== null) result.enabled = legacy === 'true';
            stored = JSON.parse(localStorage.getItem(KEY)) || {};
        } catch (e) { /* Use available defaults. */ }
    }
    for (const field of ['enabled', 'voiceURI']) {
        if (typeof stored[field] === typeof defaults[field]) result[field] = stored[field];
    }
    if (Number.isFinite(stored.rate) && stored.rate >= 0.5 && stored.rate <= 2) result.rate = stored.rate;
    if (Number.isFinite(stored.volume) && stored.volume >= 0 && stored.volume <= 1) result.volume = stored.volume;
    if (!reset && stored.voiceControl && typeof stored.voiceControl === 'object') {
        Object.assign(result.voiceControl, stored.voiceControl);
    }
    for (const option of GAME_OPTION_VALUES) {
        let value = stored.radar && stored.radar[option.name];
        try {
            if (!reset && value == null) value = localStorage.getItem(`zlsa.atc.option.${option.name}`);
        } catch (e) { /* Storage can be disabled. */ }
        result.radar[option.name] = reset ? option.defaultValue : resolveOption(option, value);
    }
    return result;
}

export function savePreferences(settings) {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* Active shell keeps its copy. */ }
}

export function finalizeScore(record, storage) {
    try {
        const key = SCORE_PREFIX + record.id;
        const db = storage || window.localStorage;
        if (db.getItem(key)) return;
        const keys = Object.keys(db).filter((k) => k.startsWith(SCORE_PREFIX)).sort();
        // IDs start with the creation timestamp. Each game writes its own key, including across tabs.
        while (keys.length >= 100) db.removeItem(keys.shift());
        db.setItem(key, JSON.stringify({ ...record, version: 1, rulesVersion: 1 }));
    } catch (e) { /* Exiting remains possible when storage is unavailable. */ }
}
