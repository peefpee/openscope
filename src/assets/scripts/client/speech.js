/* eslint-disable no-underscore-dangle, no-unused-vars, no-undef, global-require */
import $ from 'jquery';
import _get from 'lodash/get';
import _has from 'lodash/has';
import EventTracker from './EventTracker';
import { radio_heading, radio_altitude, radio_spokenText } from './utilities/radioUtilities';
import { STORAGE_KEY } from './constants/storageKeys';
import { SELECTORS } from './constants/selectors';
import {
    VOICES,
    LOWER_PITCH,
    HIGHER_PITCH,
    NORMAL_SPEED,
    FASTER_SPEED
} from './constants/speechConstants';
import { TRACKABLE_EVENT } from './constants/trackableEvents';

/**
 *
 * @function speech_init
 */
export const speech_init = () => {
    prop.speech = {};
    prop.speech.synthesis = window.speechSynthesis;
    prop.speech.enabled = false;

    if (_get(localStorage, STORAGE_KEY.ATC_SPEECH_ENABLED, false) === true) {
        prop.speech.enabled = true;
        $(SELECTORS.DOM_SELECTORS.TOGGLE_SPEECH).addClass(SELECTORS.CLASSNAMES.ACTIVE);
    }
};

/**
 *
 * @function randomizePilotVoice
 */
export const randomizePilotVoice = () => {
    const voice = VOICES[Math.floor(Math.random() * VOICES.length)];
    const pitch = (Math.random() * (LOWER_PITCH - HIGHER_PITCH) + HIGHER_PITCH).toFixed(1);
    const rate = (Math.random() * (NORMAL_SPEED - FASTER_SPEED) + FASTER_SPEED).toFixed(3);

    return {
        voice,
        pitch,
        rate
    };
};

/**
 * Select a browser voice. A named pilot voice is honoured when installed;
 * otherwise an Australian English voice is preferred, with graceful fallback
 * to any English voice and then the browser default.
 *
 * @function _selectVoice
 * @param {Object} pilotVoice
 * @param {Array} voices
 * @return {Object|null}
 * @private
 */
export const _selectVoice = (pilotVoice, voices) => {
    if (!Array.isArray(voices) || voices.length === 0) {
        return null;
    }

    const requestedName = pilotVoice && pilotVoice.voice;
    let voice = typeof requestedName === 'string' ?
        voices.find((candidate) => candidate.name === requestedName || candidate.lang === requestedName) :
        null;

    if (!voice) {
        voice = voices.find((candidate) => /^en[-_]?au$/i.test(candidate.lang || ''));
    }

    if (!voice) {
        voice = voices.find((candidate) => /^en\b/i.test(candidate.lang || ''));
    }

    if (!voice) {
        voice = voices.find((candidate) => candidate.default === true);
    }

    return voice || voices[0];
};

/**
 *
 * @function speech_say
 * @param sentence
 */
export const speech_say = (sentence, pilotVoice) => {
    if (prop.speech && prop.speech.synthesis != null && prop.speech.enabled) {
        let textToSay = '';

        for (let i = 0; i < sentence.length; i++) {
            const singleSentence = sentence[i];

            switch (singleSentence.type) {
                case 'callsign':
                    textToSay += ` ${singleSentence.content.getRadioCallsign()} `;
                    break;
                case 'altitude':
                    textToSay += ` ${radio_altitude(singleSentence.content)} `;
                    break;
                case 'speed': case 'heading':
                    textToSay += ` ${radio_heading(singleSentence.content)} `;
                    break;
                case 'text':
                    textToSay += ` ${singleSentence.content} `;
                    break;
                default:
                    break;
            }
        }

        const spokenText = radio_spokenText(textToSay);
        const utterance = new SpeechSynthesisUtterance(spokenText);
        const selectedVoice = _selectVoice(pilotVoice, prop.speech.synthesis.getVoices());

        utterance.lang = (selectedVoice && selectedVoice.lang) || 'en-AU';
        utterance.voice = selectedVoice;
        utterance.rate = (pilotVoice && pilotVoice.rate) || 1.0;
        utterance.pitch = (pilotVoice && pilotVoice.pitch) || 1.0;

        // say the words
        prop.speech.synthesis.speak(utterance);
    }
};

/**
 *
 * @function speech_toggle
 */
export const speech_toggle = () => {
    const $speechToggleElement = $(SELECTORS.DOM_SELECTORS.TOGGLE_SPEECH);
    prop.speech.enabled = !prop.speech.enabled;

    if (!prop.speech.enabled) {
        prop.speech.synthesis.cancel();
    }

    $speechToggleElement.toggleClass(SELECTORS.CLASSNAMES.ACTIVE);

    localStorage[STORAGE_KEY.ATC_SPEECH_ENABLED] = prop.speech.enabled;
    const hasClass = $speechToggleElement.hasClass(SELECTORS.CLASSNAMES.ACTIVE);

    EventTracker.recordEvent(TRACKABLE_EVENT.OPTIONS, 'speech', `${hasClass}`);
};
