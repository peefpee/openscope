import $ from 'jquery';
import sinon from 'sinon';
import AircraftModel from '../../../src/assets/scripts/client/aircraft/AircraftModel';
import EventBus from '../../../src/assets/scripts/client/lib/EventBus';
import GameController from '../../../src/assets/scripts/client/game/GameController';
import TimeKeeper from '../../../src/assets/scripts/client/engine/TimeKeeper';
import UiController from '../../../src/assets/scripts/client/ui/UiController';
import { AIRCRAFT_EVENT } from '../../../src/assets/scripts/client/constants/eventNames';
import { SELECTORS } from '../../../src/assets/scripts/client/constants/selectors';

class MockSpeechSynthesisUtterance {
    constructor(text = '') {
        this.text = text;
        this.lang = '';
        this.voice = null;
        this.rate = 1;
        this.pitch = 1;
    }
}

function rectsOverlap(a, b) {
    if (!a || !b) {
        return false;
    }

    if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
        return false;
    }

    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Install speech, UI log, radioCall, EventBus, and scoring observers.
 *
 * @function installObservers
 * @param options {object}
 * @return {object}
 */
export function installObservers(options = {}) {
    const prevSpeechSynthesis = window.speechSynthesis;
    const prevUtterance = global.SpeechSynthesisUtterance;
    const logs = [];
    const speech = [];
    const radioCalls = [];
    const scoreEvents = [];
    const aircraftEvents = [];
    let speechCancelledCount = 0;

    global.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
    window.speechSynthesis = {
        getVoices: () => [],
        speak: (utterance) => {
            speech.push({
                text: utterance.text,
                lang: utterance.lang,
                voice: utterance.voice || null,
                rate: utterance.rate,
                pitch: utterance.pitch,
                simTime: TimeKeeper.accumulatedDeltaTime
            });
        },
        cancel: () => {
            speechCancelledCount += 1;
        }
    };

    if (global.prop && global.prop.speech) {
        global.prop.speech.synthesis = window.speechSynthesis;
        global.prop.speech.enabled = Boolean(options.enableSpeech);
    }

    const uiLogStub = sinon.stub(UiController, 'ui_log').callsFake((message, warn = false) => {
        const entry = {
            message: String(message),
            warn: Boolean(warn),
            simTime: TimeKeeper.accumulatedDeltaTime
        };

        logs.push(entry);

        if (UiController.$log && UiController.$log.length > 0) {
            const $item = $(`<span class="item"><span class="message">${entry.message}</span></span>`);

            if (entry.warn) {
                $item.addClass(SELECTORS.CLASSNAMES.WARN);
            }

            UiController.$log.append($item);
        }
    });

    const originalRadioCall = AircraftModel.prototype.radioCall;
    const radioCallStub = sinon.stub(AircraftModel.prototype, 'radioCall').callsFake(function wrappedRadioCall(msg, sectorType, alert) {
        if (!this.projected) {
            radioCalls.push({
                callsign: this.callsign,
                readbackCallsign: this.readbackCallsign,
                msg,
                sectorType,
                alert: Boolean(alert),
                simTime: TimeKeeper.accumulatedDeltaTime
            });
        }

        return originalRadioCall.call(this, msg, sectorType, alert);
    });

    const originalEventsRecordNew = GameController.events_recordNew.bind(GameController);
    const eventsRecordStub = sinon.stub(GameController, 'events_recordNew').callsFake((gameEvent) => {
        const scoreBefore = GameController.game.score;
        originalEventsRecordNew(gameEvent);
        const scoreAfter = GameController.game.score;
        scoreEvents.push({
            event: gameEvent,
            points: scoreAfter - scoreBefore,
            scoreAfter,
            simTime: TimeKeeper.accumulatedDeltaTime
        });
    });

    const eventHandlers = [];
    const watchedEvents = new Set(Object.values(AIRCRAFT_EVENT));

    watchedEvents.forEach((eventName) => {
        const handler = (...args) => {
            aircraftEvents.push({
                type: eventName,
                args,
                simTime: TimeKeeper.accumulatedDeltaTime
            });
        };

        EventBus.on(eventName, handler);
        eventHandlers.push([eventName, handler]);
    });

    let uninstalled = false;

    const uninstall = () => {
        if (uninstalled) {
            return;
        }

        uninstalled = true;
        eventHandlers.forEach(([eventName, handler]) => {
            EventBus.off(eventName, handler);
        });
        eventsRecordStub.restore();
        radioCallStub.restore();
        uiLogStub.restore();

        window.speechSynthesis = prevSpeechSynthesis;

        if (prevUtterance === undefined) {
            delete global.SpeechSynthesisUtterance;
        } else {
            global.SpeechSynthesisUtterance = prevUtterance;
        }
    };

    return {
        logs,
        speech,
        radioCalls,
        scoreEvents,
        aircraftEvents,
        getSpeechCancelledCount: () => speechCancelledCount,
        uninstall
    };
}

/**
 * Inspect flight strips from `StripViewController` and `#sidebar` DOM.
 *
 * @function getStrips
 * @param aircraftController {AircraftController}
 * @return {array<object>}
 */
export function getStrips(aircraftController) {
    const stripController = aircraftController && aircraftController._stripViewController;
    const collection = stripController && stripController._collection;
    const collectionItems = collection ?
        (collection._items || collection.items || []) :
        [];

    const arrivalsList = $(SELECTORS.DOM_SELECTORS.STRIP_VIEW_ARRIVALS_LIST);
    const departuresList = $(SELECTORS.DOM_SELECTORS.STRIP_VIEW_DEPARTURES_LIST);
    const transferredList = $('.js-stripViewTransferred-list, [data-strip-list="transferred"]');

    return collectionItems.map((stripModel) => {
        const $el = stripModel.$element ? $(stripModel.$element) : $();
        let listType = 'unknown';

        if (arrivalsList.has($el).length > 0) {
            listType = 'arrivals';
        } else if (departuresList.has($el).length > 0) {
            listType = 'departures';
        } else if (transferredList.length > 0 && transferredList.has($el).length > 0) {
            listType = 'transferred';
        }

        const callsign = $el.find(SELECTORS.CLASSNAMES.STRIP_VIEW_CALLSIGN).text().trim() ||
            stripModel.callsign ||
            '';

        return {
            callsign,
            aircraftId: stripModel.aircraftId || stripModel._aircraftId || null,
            listType,
            text: $el.text().replace(/\s+/g, ' ').trim(),
            runway: $el.find(SELECTORS.CLASSNAMES.STRIP_VIEW_RUNWAY).text().trim(),
            remarks: $el.find(SELECTORS.CLASSNAMES.STRIP_VIEW_REMARKS).text().trim(),
            assignedAltitude: $el.find(SELECTORS.CLASSNAMES.STRIP_VIEW_ASSIGNED_ALTITUDE).text().trim(),
            flightPlanAltitude: $el.find(SELECTORS.CLASSNAMES.STRIP_VIEW_FLIGHT_PLAN_ALTITUDE).text().trim(),
            controllerText: $el.find('.js-stripView-controller, [data-field="controller"]').text().trim(),
            frequencyText: $el.find('.js-stripView-frequency, [data-field="frequency"]').text().trim(),
            handoffStatusText: $el.find('.js-stripView-handoffStatus, [data-field="handoff-status"]').text().trim(),
            classes: $el.attr('class') || ''
        };
    });
}

/**
 * Inspect the top-left frequency panel DOM and overlap state.
 *
 * @function getFrequencyPanelState
 * @param $root {jQuery}
 * @return {object}
 */
export function getFrequencyPanelState($root = $(window.document)) {
    const $scope = $root && $root.length > 0 ? $root : $(window.document);
    let $panel = $scope.find('#frequency-panel, [data-testid="frequency-panel"], .frequency-panel').first();

    if ($panel.length === 0) {
        $panel = $('#frequency-panel, [data-testid="frequency-panel"], .frequency-panel').first();
    }

    if ($panel.length === 0) {
        return {
            exists: false,
            visible: false,
            text: '',
            items: [],
            rect: null,
            overlapsAirportInfo: false,
            overlapsMsaPanel: false
        };
    }

    const panelEl = $panel.get(0);
    const panelRect = typeof panelEl.getBoundingClientRect === 'function' ?
        panelEl.getBoundingClientRect() :
        null;
    const isHidden = $panel.prop('hidden') || $panel.hasClass('hidden') || $panel.css('display') === 'none';

    const items = $panel.find('li, tr, .frequency-panel-item, [data-frequency-item]').map((_, el) => {
        const $item = $(el);

        return {
            text: $item.text().replace(/\s+/g, ' ').trim(),
            role: $item.attr('data-role') || '',
            callsign: $item.attr('data-callsign') || '',
            frequency: $item.attr('data-frequency') || '',
            source: $item.attr('data-source') || ''
        };
    }).get();

    const $airportInfo = $scope.find('#airportInfo, .airportInfo, .js-airportInfo').first();
    const airportInfoEl = $airportInfo.get(0);
    const airportInfoRect = airportInfoEl && typeof airportInfoEl.getBoundingClientRect === 'function' ?
        airportInfoEl.getBoundingClientRect() :
        null;

    const $msaPanel = $scope.find('#msa-panel').first();
    const msaVisible = $msaPanel.length > 0 && !$msaPanel.prop('hidden') && $msaPanel.css('display') !== 'none';
    const msaEl = $msaPanel.get(0);
    const msaRect = msaVisible && msaEl && typeof msaEl.getBoundingClientRect === 'function' ?
        msaEl.getBoundingClientRect() :
        null;

    return {
        exists: true,
        visible: !isHidden,
        text: $panel.text().replace(/\s+/g, ' ').trim(),
        items,
        rect: panelRect,
        overlapsAirportInfo: rectsOverlap(panelRect, airportInfoRect),
        overlapsMsaPanel: rectsOverlap(panelRect, msaRect)
    };
}

/**
 * Inspect `GameController` score, event counts, and `#score` / `#score-log` DOM state.
 *
 * @function getScoreState
 * @return {object}
 */
export function getScoreState() {
    return {
        score: GameController.game.score,
        lastScore: GameController.game.last_score,
        events: { ...GameController.game.events },
        domScoreText: $(SELECTORS.DOM_SELECTORS.SCORE).text().trim(),
        domLogItems: $(SELECTORS.DOM_SELECTORS.SCORE_LOG).find('li').map((_, el) => $(el).text().trim()).get()
    };
}
