import $ from 'jquery';
import AirportController from '../airport/AirportController';
import EventBus from '../lib/EventBus';
import EventTracker from '../EventTracker';
import GameController from '../game/GameController';
import MsaView from './MsaView';
import SettingsController from './SettingsController';
import TrafficRateController from './TrafficRateController';
import VideoMapController from './VideoMapController';
import TutorialView from './TutorialView';
import { speech_toggle } from '../speech';
import { EVENT } from '../constants/eventNames';
import { SELECTORS } from '../constants/selectors';
import { TRACKABLE_EVENT } from '../constants/trackableEvents';

/**
 * Listens for events that occur in the UI and delegates work to the correct place
 *
 * @class UiController
 */
class UiController {
    /**
     * @constructor
     */
    constructor() {
        /**
         * Local reference to `EventBus` singleton
         *
         * @for UiController
         * @property _eventBus
         * @type {EventBus}
         * @default null
         */
        this._eventBus = null;

        /**
         * @for UiController
         * @property tutorialView
         * @type {TutorialView}
         * @default null
         */
        this.tutorialView = null;

        /**
         * @for UiController
         * @property settingsController
         * @type {SettingsController}
         * @default null
         */
        this.settingsController = null;

        /**
         * @for UiController
         * @property trafficRateController
         * @type {TrafficRateController}
         * @default null
         */
        this.trafficRateController = null;

        /**
         * @for UiController
         * @property videoMapController
         * @type {VideoMapController}
         * @default null
         */
        this.videoMapController = null;

        /**
         * Root element used to find all other DOM elements needed by this class
         *
         * @for UiController
         * @property $element
         * @type {Jquery|Element}
         * @default null
         */
        this.$element = null;

        /**
         * Element of the airport guide dialog
         *
         * @for UiController
         * @property $airportGuideDialog
         * @type {Jquery|Element}
         * @default null
         */
        this.$airportGuideDialog = null;

        /**
         * Element of the changelog dialog
         *
         * @for UiController
         * @property $changelogDialog
         * @type {Jquery|Element}
         * @default null
         */
        this.$changelogDialog = null;

        /**
         * Footer button element used to toggle fast-forward mode on/off
         *
         * @for UiController
         * @property $fastForwards
         * @type {Jquery|Element}
         * @default null
         */
        this.$fastForwards = null;

        /**
         * Footer button element which opens the openScope github page in a new tab
         *
         * @for UiController
         * @property $githubLinkElement
         * @type {Jquery|Element}
         * @default null
         */
        this.$githubLinkElement = null;

        /**
         * Element displaying log of readbacks and other messages
         *
         * @for UiController
         * @property $log
         * @type {Jquery|Element}
         * @default null
         */
        this.$log = null;

        /**
         * Element listing adjacent controller frequencies
         *
         * @for UiController
         * @property $frequencyPanel
         * @type {Jquery|Element}
         * @default null
         */
        this.$frequencyPanel = null;

        /**
         * Duration for chat log transmissions to remain visible in seconds
         *
         * @for UiController
         * @property chatLogDuration
         * @type number
         * @default null
         */
        this.chatLogDuration = null;

        /**
         * Element in center of screen to unpause when paused
         *
         * @for UiController
         * @property $pausedImg
         * @type {Jquery|Element}
         * @default null
         */
        this.$pausedImg = null;

        /**
         * Footer button element used to toggle the airport guide on/off
         *
         * @for UiController
         * @property $toggleAirportGuide
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleAirportGuide = null;

        /**
         * Footer button element used to toggle airspace on/off
         *
         * @for UiController
         * @property $toggleAirspace
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleAirspace = null;

        /**
         * Footer button element used to toggle the changelog on/off
         *
         * @for UiController
         * @property $toggleChangelog
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleChangelog = null;

        /**
         * Footer button element used to toggle fix and runway labels on/off
         *
         * @for UiController
         * @property $toggleLabels
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleLabels = null;

        /**
         * Footer button element used to toggle the options menu on/off
         *
         * @for UiController
         * @property $toggleOptions
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleOptions = null;

        /**
         * Footer button element used to pause when the sim is running
         *
         * @for UiController
         * @property $togglePause
         * @type {Jquery|Element}
         * @default null
         */
        this.$togglePause = null;

        /**
         * Footer button element used to toggle restricted areas on/off
         *
         * @for UiController
         * @property $toggleRestrictedAreas
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleRestrictedAreas = null;

        /**
         * Footer button element used to toggle SIDs on/off
         *
         * @for UiController
         * @property $toggleSids
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleSids = null;

        /**
         * Footer button element used to toggle speech synthesis on/off
         *
         * @for UiController
         * @property $toggleSpeech
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleSpeech = null;

        /**
         * Footer button element used to toggle STARs on/off
         *
         * @for UiController
         * @property $toggleStars
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleStars = null;

        /**
         * Footer button element used to toggle terrain on/off
         *
         * @for UiController
         * @property $toggleTerrain
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleTerrain = null;

        /**
         * Footer button element used to toggle the traffic rate menu on/off
         *
         * @for UiController
         * @property $toggleTraffic
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleTraffic = null;

        /**
         * Footer button element used to toggle the tutorial on/off
         *
         * @for UiController
         * @property $toggleTutorial
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleTutorial = null;

        /**
         * Footer button element used to toggle the video map on/off
         *
         * @for UiController
         * @property $toggleVideoMap
         * @type {Jquery|Element}
         * @default null
         */
        this.$toggleVideoMap = null;

        /**
         * Element of the tutorial dialog
         *
         * @for UiController
         * @property $tutorialDialog
         * @type {Jquery|Element}
         * @default null
         */
        this.$tutorialDialog = null;
    }

    /**
     * Initialization method
     *
     * Called from the `AppController` after instantiation of the `AircraftController`
     *
     * @for UiController
     * @method init
     * @param $element {jQuery Element}
     */
    init($element) {
        this._eventBus = EventBus;
        this.tutorialView = new TutorialView($element);
        this.settingsController = new SettingsController($element);
        this.trafficRateController = new TrafficRateController($element);
        this.videoMapController = new VideoMapController($element);

        this.$element = $element;
        this.$airportGuideDialog = this.$element.find(SELECTORS.DOM_SELECTORS.AIRPORT_GUIDE_CONTAINER);
        this.$changelogDialog = this.$element.find(SELECTORS.DOM_SELECTORS.CHANGELOG_CONTAINER);
        this.$fastForwards = this.$element.find(SELECTORS.DOM_SELECTORS.FAST_FORWARDS);
        this.$githubLinkElement = this.$element.find(SELECTORS.DOM_SELECTORS.GITHUB_EXTERNAL_LINK);
        this.$log = this.$element.find(SELECTORS.DOM_SELECTORS.LOG);
        this.$frequencyPanel = this.$element.find('#frequency-panel');
        this.$pausedImg = this.$element.find(`${SELECTORS.DOM_SELECTORS.PAUSED} img`);
        this.$toggleAirportGuide = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_AIRPORT_GUIDE);
        this.$toggleAirspace = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_AIRSPACE);
        this.$toggleChangelog = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_CHANGELOG);
        this.$toggleLabels = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_LABELS);
        this.$toggleOptions = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_OPTIONS);
        this.$togglePause = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_PAUSE);
        this.$toggleRestrictedAreas = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_RESTRICTED_AREAS);
        this.$toggleSids = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_SIDS);
        this.$toggleSpeech = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_SPEECH);
        this.$toggleStars = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_STARS);
        this.$toggleTerrain = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_TERRAIN);
        this.$toggleTraffic = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_TRAFFIC);
        this.$toggleTutorial = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_TUTORIAL);
        this.$toggleVideoMap = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_VIDEO_MAP);
        this.$tutorialDialog = this.$element.find(SELECTORS.DOM_SELECTORS.TUTORIAL);
        this.chatLogDuration = GameController.game.option.getOptionByName('chatLogDuration');

        this.setupHandlers().enable();
        this._updateFrequencyPanel();

        return this;
    }

    /**
     * @for UiController
     * @method setupHandlers
     * @chainable
     */
    setupHandlers() {
        this.onAirportChangeHandler = this.onAirportChange.bind(this);
        this.onChatLogDurationChangeHandler = this.onChatLogDurationChange.bind(this);

        return this;
    }

    /**
     * Enable event handlers
     *
     * @for UiController
     * @method enable
     * @chainable
     */
    enable() {
        this._eventBus.on(EVENT.AIRPORT_CHANGE, this.onAirportChangeHandler);
        this._eventBus.on(EVENT.CHAT_LOG_DURATION_CHANGE, this.onChatLogDurationChangeHandler);

        // TODO: move these to properly bound handler methods

        this.$fastForwards.on('click', (event) => GameController.game_timewarp_toggle(event));
        this.$githubLinkElement.on('click', (event) => this.onClickGithubLink(event));
        this.$pausedImg.on('click', (event) => GameController.game_unpause(event));
        this.$toggleAirportGuide.on('click', (event) => this.onToggleAirportGuide(event));
        this.$toggleAirspace.on('click', (event) => this.onToggleAirspace(event));
        this.$toggleChangelog.on('click', (event) => this.onToggleChangelog(event));
        this.$toggleLabels.on('click.radarLayers', (event) => this.onToggleLabels(event));
        this.$toggleOptions.on('click', (event) => this.onToggleOptions(event));
        this.$togglePause.on('click', (event) => GameController.game_pause_toggle(event));
        this.$toggleRestrictedAreas.on('click', (event) => this.onToggleRestrictedAreas(event));
        this.$toggleSids.on('click', (event) => this.onToggleSids(event));
        this.$toggleSpeech.on('click', (event) => speech_toggle(event));
        this.$toggleStars.on('click', (event) => this.onToggleStars(event));
        this.$toggleTerrain.on('click', (event) => this.onToggleTerrain(event));
        this.$toggleTraffic.on('click', (event) => this.onToggleTraffic(event));
        this.$toggleTutorial.on('click', (event) => this.onToggleTutorial(event));
        this.$toggleVideoMap.on('click', (event) => this.onToggleVideoMap(event));

        this._setupControlMenus();
        this.msaView = new MsaView(this.$element);

        return this;
    }

    /**
     * Keep a control-bar dropdown visible while the pointer is over its icon
     * or the menu itself. A short grace period on leave prevents the menu from
     * flashing away when the pointer briefly crosses a boundary.
     *
     * @for UiController
     * @method _setupControlMenus
     * @private
     */
    _positionControlPopup(item) {
        if (!item) return;
        const popup = item.querySelector('.control-item-content');
        if (!popup) return;

        popup.style.left = 'auto';
        popup.style.right = '0';
        popup.style.transform = '';

        const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
        const vh = window.innerHeight || document.documentElement.clientHeight || 720;
        const itemRect = item.getBoundingClientRect();
        const availHeight = Math.max(120, Math.floor(itemRect.top - 8));
        popup.style.maxHeight = `${availHeight}px`;

        const rect = popup.getBoundingClientRect();
        if (rect.width > vw - 16) {
            popup.style.maxWidth = `${Math.max(160, vw - 16)}px`;
        }
        const updatedRect = popup.getBoundingClientRect();
        let shiftX = 0;
        if (updatedRect.left < 8) {
            shiftX = Math.ceil(8 - updatedRect.left);
        } else if (updatedRect.right > vw - 8) {
            shiftX = Math.floor((vw - 8) - updatedRect.right);
        }
        if (shiftX !== 0) {
            popup.style.transform = `translateX(${shiftX}px)`;
        }
    }

    _setupControlMenus() {
        const $menuItems = this.$element
            .find('.control-item')
            .filter((index, element) => element.querySelector('.control-item-content') !== null);

        $menuItems.on('mouseenter focusin', (event) => {
            clearTimeout(this._controlMenuCloseTimeout);
            const item = event.currentTarget;
            $(item).addClass('is-open');
            this._positionControlPopup(item);
        });

        $menuItems.on('mouseleave', (event) => {
            const $item = $(event.currentTarget);

            clearTimeout(this._controlMenuCloseTimeout);
            this._controlMenuCloseTimeout = setTimeout(() => $item.removeClass('is-open'), 150);
        });

        this._onControlMenuResize = () => {
            this.$element.find('.control-item.is-open').each((_, item) => this._positionControlPopup(item));
        };
        window.addEventListener('resize', this._onControlMenuResize);
        document.addEventListener('fullscreenchange', this._onControlMenuResize);
    }

    /**
     * Disable event handlers
     *
     * @for UiController
     * @method disable
     * @chainable
     */
    disable() {
        this._eventBus.off(EVENT.AIRPORT_CHANGE, this.onAirportChangeHandler);
        this._eventBus.off(EVENT.CHAT_LOG_DURATION_CHANGE, this.onChatLogDurationChangeHandler);
        this.$fastForwards.off('click', (event) => GameController.game_timewarp_toggle(event));
        this.$githubLinkElement.off('click', (event) => this.onClickGithubLink(event));
        this.$pausedImg.off('click', (event) => GameController.game_unpause(event));
        this.$toggleAirportGuide.off('click', (event) => this.onToggleAirportGuide(event));
        this.$toggleAirspace.off('click', (event) => this.onToggleAirspace(event));
        this.$toggleChangelog.off('click', (event) => this.onToggleChangelog(event));
        this.$toggleLabels.off('.radarLayers');
        this.$toggleOptions.off('click', (event) => this.onToggleOptions(event));
        this.$togglePause.off('click', (event) => GameController.game_pause_toggle(event));
        this.$toggleRestrictedAreas.off('click', (event) => this.onToggleRestrictedAreas(event));
        this.$toggleSids.off('click', (event) => this.onToggleSids(event));
        this.$toggleSpeech.off('click', (event) => speech_toggle(event));
        this.$toggleStars.off('click', (event) => this.onToggleStars(event));
        this.$toggleTerrain.off('click', (event) => this.onToggleTerrain(event));
        this.$toggleTraffic.off('click', (event) => this.onToggleTraffic(event));
        this.$toggleTutorial.off('click', (event) => this.onToggleTutorial(event));
        this.$toggleVideoMap.off('click', (event) => this.onToggleVideoMap(event));

        this.msaView.destroy();
        clearTimeout(this._controlMenuCloseTimeout);
        if (this._onControlMenuResize) {
            window.removeEventListener('resize', this._onControlMenuResize);
            document.removeEventListener('fullscreenchange', this._onControlMenuResize);
            this._onControlMenuResize = null;
        }
        this.$element
            .find('.control-item')
            .filter((index, element) => element.querySelector('.control-item-content') !== null)
            .off('mouseenter focusin mouseleave')
            .removeClass('is-open');

        return this();
    }

    /**
     * Reset the instance
     *
     * @for UiController
     * @method reset
     */
    reset() {
        this.disable();

        this._eventBus = null;
        this.tutorialView = null;
        this.settingsController = null;
        this.trafficRateController = null;

        this.$element = null;
        this.$airportGuideDialog = null;
        this.$changelogDialog = null;
        this.$fastForwards = null;
        this.$githubLinkElement = null;
        this.$log = null;
        this.$frequencyPanel = null;
        this.chatLogDuration = null;
        this.$pausedImg = null;
        this.$toggleAirportGuide = null;
        this.$toggleAirspace = null;
        this.$toggleChangelog = null;
        this.$toggleLabels = null;
        this.$toggleOptions = null;
        this.$togglePause = null;
        this.$toggleRestrictedAreas = null;
        this.$toggleSids = null;
        this.$toggleSpeech = null;
        this.$toggleStars = null;
        this.$toggleTerrain = null;
        this.$toggleTraffic = null;
        this.$toggleTutorial = null;
        this.$toggleVideoMap = null;
        this.$tutorialDialog = null;

        return this;
    }

    /**
     * @for uiController
     * @method ui_init
     */
    ui_init() {
        this.tutorialView.tutorial_init_pre();
        this.$fastForwards.prop('title', 'Set time warp to 2');
    }

    /**
     * @for UiController
     * @method ui_complete
     */
    ui_complete() {}

    /**
     * @for UiController
     * @method ui_log
     */
    ui_log(message, warn = false) {
        const html = $(`<span class="item"><span class="message">${message}</span></span>`);

        if (warn) {
            html.addClass(SELECTORS.CLASSNAMES.WARN);
            EventTracker.recordEvent(TRACKABLE_EVENT.UI_LOG, 'error', message);
        }

        this.$log.append(html);
        this.$log.scrollTop(this.$log.get(0).scrollHeight);

        GameController.game_timeout((uiLogView) => {
            uiLogView.addClass(SELECTORS.CLASSNAMES.HIDDEN);

            setTimeout(() => {
                uiLogView.remove();
            }, 10000);
        }, this.chatLogDuration, window, html);
    }

    /**
     * @for UiController
     * @method onAirportChange
     */
    onAirportChange() {
        this.$log.empty();
        if (this.msaView) {
            this.msaView.setOpen(false);
        }
        this._updateFrequencyPanel();
    }

    /**
     * Render adjacent controller callsigns and frequencies in the overlay panel
     *
     * @for UiController
     * @method _updateFrequencyPanel
     * @private
     */
    _updateFrequencyPanel() {
        const { controllerConfig } = AirportController.current;
        const $list = $('<ul></ul>');

        this.$frequencyPanel.empty();

        // the panel stays hidden until the airport config can supply frequencies
        if (typeof controllerConfig.getAdjacentFrequencyList !== 'function') {
            this.$frequencyPanel.hide();

            return;
        }

        const activeRunways = [
            AirportController.current.arrivalRunwayModel && AirportController.current.arrivalRunwayModel.name,
            AirportController.current.departureRunwayModel && AirportController.current.departureRunwayModel.name
        ].filter(Boolean);
        const adjacentFrequencies = controllerConfig.getAdjacentFrequencyList({ activeRunways });

        if (controllerConfig.approach && controllerConfig.approach.frequency) {
            const $active = $('<div class="frequency-panel-active"></div>');
            const simTag = controllerConfig.approach.isSimulated ? ' (sim)' : '';
            $active.text(`Active: ${controllerConfig.approach.callsign} ${controllerConfig.approach.frequency}${simTag}`);
            if (controllerConfig.approach.radioName) {
                $active.prop('title', `${controllerConfig.approach.radioName} (Active)`);
            }
            this.$frequencyPanel.append($active);
        }

        adjacentFrequencies.forEach(({
            callsign,
            frequency,
            radioName,
            type,
            isSimulated
        }) => {
            const $row = $('<li class="frequency-panel-row"></li>');
            const simTag = isSimulated ? ' (sim)' : '';

            $row.text(`${callsign} ${frequency}${simTag}`);

            if (radioName) {
                $row.prop('title', isSimulated ? `${radioName} (Simulated)` : radioName);
            }

            $row.on('click', () => {
                const targetType = type === 'CTR' || type === 'ctr' || /CTR|YMMM|YBBB/i.test(callsign) ? 'ctr' : 'twr';
                const $cmd = $('#command');
                if (!$cmd.length) return;
                const current = String($cmd.val() || '').trim();
                const prefix = current ? `${current.split(/\s+/)[0]} ` : '';
                $cmd.val(`${prefix}contact ${targetType} ${frequency}`).trigger('focus');
            });

            $list.append($row);
        });

        if (adjacentFrequencies.length === 0) {
            this.$frequencyPanel.hide();

            return;
        }

        this.$frequencyPanel.append($list).show();
    }

    /**
     * @for UiController
     * @method onAirportChange
     */
    onChatLogDurationChange() {
        this.chatLogDuration = GameController.game.option.getOptionByName('chatLogDuration');
    }

    /**
     * Close all open dialogs and return focus to the command bar
     *
     * @for UiController
     * @method closeAllDialogs
     */
    closeAllDialogs() {
        if (this.msaView && this.msaView.isOpen()) {
            this.msaView.setOpen(false);
        }

        if (this.isAirportGuideDialogOpen()) {
            this.onToggleAirportGuide();
        }

        if (this.isChangelogDialogOpen()) {
            this.onToggleChangelog();
        }

        if (this.settingsController.isDialogOpen()) {
            this.onToggleOptions();
        }

        if (this.trafficRateController.isDialogOpen()) {
            this.onToggleTraffic();
        }

        if (this.isTutorialDialogOpen()) {
            this.onToggleTutorial();
        }

        if (this.videoMapController.isDialogOpen()) {
            this.onToggleVideoMap();
        }
    }

    /**
     * Returns whether the airport guide dialog is open
     *
     * @for UiController
     * @method isAirportGuideDialogOpen
     * @return {boolean}
     */
    isAirportGuideDialogOpen() {
        return this.$airportGuideDialog.hasClass(SELECTORS.CLASSNAMES.OPEN);
    }

    /**
     * Returns whether the changelog dialog is open
     *
     * @for UiController
     * @method isChangelogDialogOpen
     * @return {boolean}
     */
    isChangelogDialogOpen() {
        return this.$changelogDialog.hasClass(SELECTORS.CLASSNAMES.OPEN);
    }

    /**
     * Returns whether the tutorial dialog is open
     *
     * @for UiController
     * @method isTutorialDialogOpen
     * @return {boolean}
     */
    isTutorialDialogOpen() {
        return this.$tutorialDialog.hasClass(SELECTORS.CLASSNAMES.OPEN);
    }

    /**
     * @for UiController
     * @method onToggleAirportGuide
     */
    onToggleAirportGuide() {
        this.$toggleAirportGuide.toggleClass(SELECTORS.CLASSNAMES.ACTIVE);
        EventTracker.recordEvent(
            TRACKABLE_EVENT.OPTIONS,
            'airport-guide',
            `airport-guide:${this.$toggleAirportGuide.hasClass(SELECTORS.CLASSNAMES.ACTIVE)}`
        );
        this._eventBus.trigger(EVENT.TOGGLE_AIRPORT_GUIDE);
    }

    /**
     * @for UiController
     * @method onToggleAirspace
     * @param event {jquery event}
     */
    onToggleAirspace(event) {
        this.$toggleAirspace.toggleClass(SELECTORS.CLASSNAMES.ACTIVE);
        EventTracker.recordEvent(
            TRACKABLE_EVENT.OPTIONS,
            'airspace',
            `${this.$toggleAirspace.hasClass(SELECTORS.CLASSNAMES.ACTIVE)}`
        );
        this._eventBus.trigger(EVENT.TOGGLE_AIRSPACE);
    }

    /**
     * @for UiController
     * @method onToggleChangelog
     */
    onToggleChangelog() {
        this._eventBus.trigger(EVENT.TOGGLE_CHANGELOG);
    }

    /**
     * @for UiController
     * @method onToggleLabels
     * @param {jquery event}
     */
    onToggleLabels(event) {
        event.preventDefault();
        const button = $(event.currentTarget);
        const layer = button.data('layer');
        const visible = !button.hasClass(SELECTORS.CLASSNAMES.ACTIVE);
        button.toggleClass(SELECTORS.CLASSNAMES.ACTIVE, visible).attr('aria-pressed', String(visible));
        EventTracker.recordEvent(TRACKABLE_EVENT.OPTIONS, layer, String(visible));
        this._eventBus.trigger(EVENT.TOGGLE_LABELS, layer, visible);
    }

    /**
    * @for UiController
    * @method onToggleOptions
    */
    onToggleOptions() {
        this.$toggleOptions.toggleClass(SELECTORS.CLASSNAMES.ACTIVE);
        EventTracker.recordEvent(
            TRACKABLE_EVENT.SETTINGS,
            'toggle-dialog',
            `${this.$toggleOptions.hasClass(SELECTORS.CLASSNAMES.ACTIVE)}`
        );
        this.settingsController.toggleDialog();
    }

    /**
     * @for UiController
     * @method onToggleRestrictedAreas
     */
    onToggleRestrictedAreas(event) {
        this.$toggleRestrictedAreas.toggleClass(`${SELECTORS.DOM_SELECTORS.WARNING_BUTTON} ${SELECTORS.CLASSNAMES.ACTIVE}`);
        EventTracker.recordEvent(
            TRACKABLE_EVENT.OPTIONS,
            'restricted',
            `${this.$toggleRestrictedAreas.hasClass(SELECTORS.CLASSNAMES.ACTIVE)}`
        );
        this._eventBus.trigger(EVENT.TOGGLE_RESTRICTED_AREAS);
    }

    /**
     * @for UiController
     * @method onToggleSids
     * @param event {jquery event}
     */
    onToggleSids(event) {
        this.$toggleSids.toggleClass(SELECTORS.CLASSNAMES.ACTIVE);
        EventTracker.recordEvent(
            TRACKABLE_EVENT.OPTIONS,
            'sids',
            `${this.$toggleSids.hasClass(SELECTORS.CLASSNAMES.ACTIVE)}`
        );
        this._eventBus.trigger(EVENT.TOGGLE_SID_MAP);
    }

    /**
     * @for UiController
     * @method onToggleStars
     * @param event {jquery event}
     */
    onToggleStars(event) {
        this.$toggleStars.toggleClass(SELECTORS.CLASSNAMES.ACTIVE);
        EventTracker.recordEvent(
            TRACKABLE_EVENT.OPTIONS,
            'stars',
            `${this.$toggleStars.hasClass(SELECTORS.CLASSNAMES.ACTIVE)}`
        );
        this._eventBus.trigger(EVENT.TOGGLE_STAR_MAP);
    }

    /**
     * @for UiController
     * @method onToggleTerrain
     * @param event {jquery event}
     */
    onToggleTerrain(event) {
        this.$toggleTerrain.toggleClass(SELECTORS.CLASSNAMES.ACTIVE);
        EventTracker.recordEvent(
            TRACKABLE_EVENT.OPTIONS,
            'terrain',
            `${this.$toggleTerrain.hasClass(SELECTORS.CLASSNAMES.ACTIVE)}`
        );
        this._eventBus.trigger(EVENT.TOGGLE_TERRAIN);
    }

    /**
     * Handler for toggling the traffic volume view
     *
     * @for UiController
     * @method onToggleTraffic
     * @param event {jquery event}
     */
    onToggleTraffic(event) {
        this.$toggleTraffic.toggleClass(SELECTORS.CLASSNAMES.ACTIVE);
        EventTracker.recordEvent(
            TRACKABLE_EVENT.OPTIONS,
            'traffic',
            `${this.$toggleTraffic.hasClass(SELECTORS.CLASSNAMES.ACTIVE)}`
        );
        this.trafficRateController.toggleDialog();
    }

    /**
    * @for UiController
    * @method onToggleTutorial
    * @param event {jquery event}
    */
    onToggleTutorial(event) {
        this._eventBus.trigger(EVENT.TOGGLE_TUTORIAL);
        EventTracker.recordEvent(
            TRACKABLE_EVENT.OPTIONS,
            'tutorial',
            `${this.$toggleTutorial.hasClass(SELECTORS.CLASSNAMES.ACTIVE)}`
        );
    }

    /**
     * Handler for selecting the current Video Maps
     *
     * @for UiController
     * @method onToggleVideoMap
     * @param event {jquery event}
     */
    onToggleVideoMap(event) {
        this.$toggleVideoMap.toggleClass(SELECTORS.CLASSNAMES.ACTIVE);
        EventTracker.recordEvent(
            TRACKABLE_EVENT.OPTIONS,
            'video-map',
            `${this.$toggleVideoMap.hasClass(SELECTORS.CLASSNAMES.ACTIVE)}`
        );
        this.videoMapController.toggleDialog();
    }

    /**
     * Provides a hook to track a click event for ga
     *
     * @for UiController
     * @method onClickGithubLink
     * @param event {jquery event}
     */
    onClickGithubLink(event) {
        EventTracker.recordClickOnOutboundLink(event.target.href);
    }
}

export default new UiController();
