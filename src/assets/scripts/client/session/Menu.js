import $ from 'jquery';
import { controlsSettings } from '../ui/ScopeControls';
import DatImportView from '../ui/DatImportView';
import navData from '../airport/dat/NavDataCache';
import { GAME_OPTION_VALUES } from '../constants/gameOptionConstants';
import {
    airportPreview, controllerDraft, positions, prepareAirport, runwayModes
} from './configuration';
import {
    preferences, resolveOption, savePreferences, finalizeScore
} from './storage';

const byId = (id) => document.getElementById(id);
const actions = {
    home: ['play', 'settings'],
    modes: ['classic', 'custom', 'home'],
    classic: ['configure', 'play'],
    setup: ['start', 'selection'],
    loading: ['cancel'],
    pause: ['resume', 'settings', 'confirm'],
    settings: ['settingsBack', 'fullscreen', 'testVoice', 'reset'],
    reset: ['settings', 'resetYes'],
    confirm: ['pause', 'exit']
};
const backPages = {
    modes: ['home'],
    classic: ['modes'],
    custom: ['modes'],
    setup: ['classic', 'custom'],
    loading: ['setup'],
    settings: ['home', 'pause'],
    reset: ['settings'],
    confirm: ['pause', 'home']
};

async function json(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response.json();
}

export default class Menu {
    constructor() {
        this.menu = byId('session-menu');
        this.settings = preferences();
        this.generation = 0;
        this.scopeOptions = null;
        this.classicAirports = [];
        this.classicAirportDetails = new Map();
        this.importer = new DatImportView($('body'), null, (airport) => this.configure(airport, 'custom'));
        const importer = byId('dat-import');
        importer.addEventListener('close', () => {
            if (importer.open) return;
            this.importer.cancel();
            if (this.page === 'custom') this.show('modes', 'custom');
        });
        this.menu.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-action]');
            if (button && !button.disabled && button.closest('[data-page]') === this.panel) {
                this.act(button.dataset.action).catch((error) => this.error(error));
            }
        });
        this.menu.addEventListener('cancel', (event) => {
            event.preventDefault();
            const back = {
                settings: 'settingsBack',
                reset: 'settings',
                confirm: 'pause',
                pause: 'resume',
                setup: 'selection',
                classic: 'play',
                loading: 'cancel',
                modes: 'home'
            };
            if (back[this.page]) this.act(back[this.page]).catch((error) => this.error(error));
        });
        this.menu.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && event.repeat) event.preventDefault();
        });
        byId('session-setup-traffic').onchange = () => this.updateMix();
        if (byId('session-airport-search')) byId('session-airport-search').oninput = () => this.renderClassicAirports();
        byId('session-airport').onchange = () => this.updateClassicMeta().catch((error) => this.error(error));
        this.menu.addEventListener('input', () => this.publishSetup());
        this.menu.addEventListener('change', () => this.publishSetup());
        this.buildSettings();
        this.show('home');
    }

    show(page, focusAction) {
        const previous = this.page;
        this.navigationId = (this.navigationId || 0) + 1;
        this.page = page;
        this.menu.dataset.currentPage = page;
        this.menu.dataset.pageDirection = 'none';
        if (previous && previous !== page) {
            this.menu.dataset.pageDirection = (backPages[previous] || []).includes(page) ? 'backward' : 'forward';
        }
        const titles = {
            home: 'openScope',
            modes: 'Play',
            classic: 'Classic airports',
            custom: 'Import airport',
            setup: this.airport && `${this.airport.icao.toUpperCase()} session`,
            pause: 'Paused',
            confirm: 'Exit session?',
            settings: 'Client settings',
            loading: 'Loading session',
            reset: 'Reset settings?'
        };
        byId('session-title').textContent = titles[page];
        byId('session-error').textContent = '';
        this.menu.querySelectorAll('[data-page]').forEach((el) => {
            el.hidden = el.dataset.page !== page;
            if (el.hidden) el.setAttribute('inert', '');
            else el.removeAttribute('inert');
            if (el.hidden) el.style.setProperty('display', 'none', 'important');
            else el.style.removeProperty('display');
        });
        if (!this.menu.open) this.menu.showModal();
        const panel = this.menu.querySelector(`[data-page="${page}"]`);
        this.panel = panel;
        if (!panel) return;
        const focus = focusAction && panel.querySelector(`[data-action="${focusAction}"]`);
        const target = focus || panel.querySelector('button:not(:disabled), select:not(:disabled)');
        if (target) target.focus();
    }

    error(error) {
        byId('session-error').textContent = error.message || String(error);
    }

    async act(action) {
        if (!(actions[this.page] || []).includes(action)) return;
        switch (action) {
            case 'home': this.airport = null; this.show('home', 'play'); break;
            case 'play': this.show('modes', this.mode); break;
            case 'classic':
            case 'custom': return this.openSelection(action);
            case 'configure': {
                const icao = byId('session-airport').value;
                if (!icao) throw new Error('Choose a bundled airport.');
                const token = this.navigationId;
                const data = await json(`assets/airports/${icao}.json`);
                this.classicAirportDetails.set(icao, data);
                if (token === this.navigationId && byId('session-airport').value === icao) this.configure(data, 'classic');
                break;
            }
            case 'selection': return this.openSelection();
            case 'start': if (this.page === 'setup') this.start(); break;
            case 'cancel': this.dispose(); this.show('setup', 'start'); break;
            case 'resume':
                if (this.page !== 'pause' || !this.frame) break;
                this.menu.dataset.currentPage = 'playing';
                this.page = 'playing';
                this.menu.close();
                this.frame.contentWindow.focus();
                this.frame.session.runtime.resume();
                break;
            case 'pause': this.show('pause', 'confirm'); break;
            case 'confirm': this.show('confirm'); break;
            case 'exit': {
                if (this.page !== 'confirm' || !this.frame) break;
                this.page = 'exiting';
                const { session } = this.frame;
                finalizeScore({ ...session.record, ...session.runtime.snapshot(), endedAt: new Date().toISOString() });
                this.dispose();
                this.airport = null;
                this.show('home');
                break;
            }
            case 'settings':
                if (this.page !== 'reset') this.settingsReturn = this.frame ? 'pause' : 'home';
                this.renderSettings();
                this.show('settings');
                break;
            case 'settingsBack': this.show(this.settingsReturn, 'settings'); break;
            case 'reset': this.show('reset'); break;
            case 'resetYes':
                this.settings = preferences(true);
                this.keyboardPanel.find('button').trigger('click');
                this.applySettings();
                return this.act('settings');
            case 'fullscreen':
                if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
                    await document.exitFullscreen();
                } else if (document.documentElement && typeof document.documentElement.requestFullscreen === 'function') {
                    await document.documentElement.requestFullscreen();
                }
                break;
            case 'testVoice': {
                if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') break;
                const sample = new SpeechSynthesisUtterance('OpenScope radio check.');
                Object.assign(sample, { lang: 'en-AU', volume: this.settings.volume, rate: this.settings.rate });
                const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === this.settings.voiceURI);
                if (voice) sample.voice = voice;
                speechSynthesis.cancel();
                speechSynthesis.speak(sample);
                break;
            }
            default: break;
        }
    }

    async openSelection(mode = this.mode) {
        this.mode = mode;
        this.show(mode);
        if (mode === 'custom') {
            byId('dat-import').showModal();
            this.importer.update();
            return;
        }
        const token = this.navigationId;
        if (!this.classicAirports.length) {
            const list = await json('assets/airports/airportLoadList.json');
            this.classicAirports = list.filter((a) => /^y/i.test(a.icao) && !a.disabled);
        }
        if (token === this.navigationId) this.renderClassicAirports();
    }

    configure(airport, mode) {
        const changedImport = mode === 'custom' && (this.importRevision !== this.importer.revision ||
            (this.airport && this.airport.centreSector !== airport.centreSector));
        if (!this.airport || this.modeOfDraft !== mode || this.airport.icao !== airport.icao || changedImport) {
            const runways = byId('session-runways');
            const defaultFlow = `${airport.arrivalRunway} arrivals / ${airport.departureRunway} departures`;
            runways.replaceChildren(new Option(`Airport default · ${defaultFlow}`, ''));
            this.runways = runwayModes(airport);
            this.runways.forEach((m, i) => {
                runways.add(new Option(`${m.arrival} arrivals / ${m.departure} departures`, String(i)));
            });
            const container = byId('session-frequencies');
            container.replaceChildren();
            this.fields = positions(controllerDraft(airport)).map(([role, entry]) => {
                const group = document.createElement('fieldset');
                const legend = document.createElement('legend');
                legend.textContent = `${role} · ${entry.source}`;
                group.append(legend);
                const fields = {};
                for (const [key, title] of [['callsign', 'Callsign'], ['radioName', 'Spoken name'], ['frequency', 'MHz']]) {
                    const label = document.createElement('label');
                    label.textContent = title;
                    const input = document.createElement('input');
                    input.value = entry[key] || '';
                    label.append(input);
                    group.append(label);
                    fields[key] = input;
                    input.oninput = () => { legend.textContent = `${role} · session override`; };
                }
                container.append(group);
                return fields;
            });
            byId('session-arrivals').checked = true;
            byId('session-departures').checked = false;
            byId('session-vfr').checked = false;
            byId('session-rate').value = '1';
            byId('session-mix').value = '';
            this.updateMix();
        }
        this.importRevision = this.importer.revision;
        this.modeOfDraft = mode;
        this.mode = mode;
        this.airport = airport;
        this.previewSource = null;
        this.show('setup');
        this.publishSetup();
    }

    updateMix() {
        byId('session-mix').disabled = !byId('session-arrivals').checked || !byId('session-departures').checked;
    }

    readControllers() {
        return this.fields.map((row) => ({
            callsign: row.callsign.value, frequency: row.frequency.value, radioName: row.radioName.value
        }));
    }

    readTraffic() {
        return {
            arrivals: byId('session-arrivals').checked,
            departures: byId('session-departures').checked,
            vfr: byId('session-vfr').checked,
            rate: Number(byId('session-rate').value),
            arrivalShare: byId('session-mix').disabled || !byId('session-mix').value ? null : Number(byId('session-mix').value)
        };
    }

    publishSetup() {
        if (this.page !== 'setup') return;
        const flow = this.runways[byId('session-runways').value];
        if (this.previewSource !== this.airport || this.previewFlow !== flow || !this.menu.airportPreview) {
            this.previewSource = this.airport;
            this.previewFlow = flow;
            const regions = navData.getCompatibleRecord('au-airspace', { icao: this.airport.icao });
            this.publishPreview(airportPreview(this.airport, flow, regions));
        }
        const preview = this.menu.airportPreview;
        const controllers = this.readControllers();
        this.menu.sessionSummary = {
            airport: preview.icao, flow: preview.activeFlow, controllers, traffic: this.readTraffic()
        };
        this.menu.dispatchEvent(new CustomEvent('session-summary', { detail: this.menu.sessionSummary }));
    }

    publishPreview(preview) {
        this.menu.airportPreview = preview;
        this.menu.dispatchEvent(new CustomEvent('airport-preview', { detail: preview }));
    }

    start() {
        const traffic = this.readTraffic();
        const fields = this.readControllers();
        const airport = prepareAirport(this.airport, traffic, this.runways[byId('session-runways').value], fields);
        const frame = document.createElement('iframe');
        this.generation += 1;
        const token = this.generation;
        this.frame = frame;
        const fail = (error) => {
            if (token !== this.generation || this.page !== 'loading') return;
            this.dispose();
            this.show('setup', 'start');
            this.error(error);
        };
        frame.id = 'session-radar';
        frame.title = 'Air traffic control radar';
        frame.session = {
            airport,
            settings: this.settings,
            navRecords: navData.records,
            scopeOptions: this.scopeOptions,
            fail,
            stage: (label) => {
                if (token !== this.generation || this.page !== 'loading') return;
                this.menu.dataset.loadingStage = label;
                const status = this.panel.querySelector('[role=status]');
                if (status) status.textContent = label;
            },
            record: {
                id: `${Date.now()}-${Array.from(crypto.getRandomValues(new Uint32Array(3))).join('-')}`,
                icao: airport.icao.toUpperCase(),
                mode: this.mode,
                traffic
            },
            ready: () => {
                if (token !== this.generation || this.page !== 'loading') return;
                clearTimeout(this.timeout);
                frame.session.record.startedAt = new Date().toISOString();
                this.menu.dataset.currentPage = 'playing';
                this.page = 'playing';
                this.menu.close();
                frame.contentWindow.focus();
            },
            pause: () => {
                if (token !== this.generation || this.page !== 'playing') return;
                frame.session.runtime.pause();
                this.menu.classList.add('in-session');
                this.show('pause');
            }
        };
        this.show('loading');
        frame.session.stage('Preparing airport');
        this.timeout = setTimeout(() => fail(new Error('Radar startup timed out. Retry the session.')), 45000);
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'radar');
        frame.src = url.href;
        document.body.append(frame);
    }

    dispose() {
        this.generation += 1;
        clearTimeout(this.timeout);
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (this.frame) {
            if (this.frame.session.runtime) this.frame.session.runtime.stop();
            this.frame.remove();
            this.frame = null;
        }
        this.menu.classList.remove('in-session');
    }

    renderClassicAirports(preferredIcao = '') {
        const select = byId('session-airport');
        const searchInput = byId('session-airport-search');
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const current = preferredIcao || select.value;
        const matches = this.classicAirports.filter((a) => !query ||
            a.icao.toLowerCase().includes(query) ||
            String(a.name || '').toLowerCase().includes(query));
        select.replaceChildren();
        matches.forEach((a) => select.add(new Option(`${a.icao.toUpperCase()} · ${a.name}`, a.icao)));
        if (current && matches.some((a) => a.icao === current)) select.value = current;
        this.updateClassicMeta().catch((error) => this.error(error));
    }

    async updateClassicMeta() {
        const meta = byId('session-airport-meta');
        if (!meta) return;
        const select = byId('session-airport');
        const icao = select.value;
        if (!icao) {
            this.publishPreview(null);
            meta.textContent = this.classicAirports.length ? 'No matching airports.' : '';
            return;
        }
        this.publishPreview(null);
        const summary = this.classicAirports.find((a) => a.icao === icao);
        const label = summary ? `${summary.icao.toUpperCase()} · ${summary.name}` : icao.toUpperCase();
        meta.textContent = label;
        let data = this.classicAirportDetails.get(icao);
        if (!data) {
            data = await json(`assets/airports/${icao}.json`);
            this.classicAirportDetails.set(icao, data);
        }
        if (this.page !== 'classic' || select.value !== icao) return;
        this.publishPreview(airportPreview(data));
        const runways = Array.isArray(data.runways) ? data.runways.map((r) => r.name.join('/')).join(', ') : '';
        const flow = data.arrivalRunway && data.departureRunway ?
            `${data.arrivalRunway} arr / ${data.departureRunway} dep` :
            '';
        meta.textContent = [label, runways && `Runways: ${runways}`, flow && `Default: ${flow}`].filter(Boolean).join(' · ');
    }

    buildSettings() {
        this.keyboardPanel = controlsSettings((values) => {
            this.scopeOptions = values;
            if (this.frame) this.frame.session.runtime.setControls(values);
        });
        $('#radar-preferences').after(this.keyboardPanel);
        this.radarFields = {};
        GAME_OPTION_VALUES.forEach((option) => {
            const label = document.createElement('label');
            label.textContent = option.description;
            const input = document.createElement(option.optionList ? 'select' : 'input');
            if (option.optionList) option.optionList.forEach((o) => input.add(new Option(o.displayLabel, o.value)));
            else { input.type = 'number'; input.min = '0.1'; input.step = 'any'; }
            input.onchange = () => {
                if ((typeof input.reportValidity === 'function' && !input.reportValidity()) || !input.value) return;
                this.settings.radar[option.name] = resolveOption(option, input.value);
                this.applySettings();
            };
            label.append(input);
            byId('radar-preferences').append(label);
            this.radarFields[option.name] = input;
        });
        for (const [id, field] of [['enabled', 'enabled'], ['choice', 'voiceURI'], ['volume', 'volume'], ['rate', 'rate']]) {
            const input = byId(`voice-${id}`);
            input.onchange = () => {
                this.settings[field] = id === 'enabled' ? input.checked : input.value;
                if (id === 'volume' || id === 'rate') this.settings[field] = Number(input.value);
                this.applySettings();
            };
        }
        if (window.speechSynthesis) {
            if (typeof speechSynthesis.addEventListener === 'function') {
                speechSynthesis.addEventListener('voiceschanged', () => this.populateVoices());
            } else {
                speechSynthesis.onvoiceschanged = () => this.populateVoices();
            }
        } else {
            this.menu.querySelector('[data-action=testVoice]').disabled = true;
        }
    }

    applySettings() {
        savePreferences(this.settings);
        if (this.frame) this.frame.session.runtime.apply(this.settings);
    }

    populateVoices() {
        const select = byId('voice-choice');
        select.replaceChildren(new Option('System default', ''));
        if (window.speechSynthesis) speechSynthesis.getVoices().forEach((v) => select.add(new Option(v.name, v.voiceURI)));
        select.value = this.settings.voiceURI;
        if (select.selectedIndex === -1) select.selectedIndex = 0;
    }

    renderSettings() {
        this.populateVoices();
        byId('voice-enabled').checked = this.settings.enabled;
        byId('voice-rate').value = this.settings.rate;
        byId('voice-volume').value = this.settings.volume;
        Object.entries(this.radarFields).forEach(([key, input]) => { input.value = this.settings.radar[key]; });
    }
}
