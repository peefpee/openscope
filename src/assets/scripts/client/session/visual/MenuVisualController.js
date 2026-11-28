import RadarBackdrop from './RadarBackdrop';
import AirportGlobe from './AirportGlobe';

const PAGE_DEPTH = {
    home: 0,
    modes: 1,
    classic: 2,
    custom: 2,
    setup: 3,
    loading: 4
};

/**
 * Presentation-layer enhancer for #session-menu.
 * Observes DOM state managed by Menu.js without mutating session/runtime logic.
 */
export default class MenuVisualController {
    /**
     * @param {HTMLDialogElement} menuEl
     */
    constructor(menuEl) {
        this.menu = menuEl;
        this.lastPage = this._activePage();
        this.backdrop = null;
        this.globe = null;
        this.observers = [];

        if (!this.menu) return;

        const canvas = this.menu.querySelector('#session-menu-radar-canvas');
        if (canvas) {
            this.backdrop = new RadarBackdrop(canvas);
        }

        this._onInput = (event) => this._handleInput(event);
        this._onCardClick = (event) => this._handleCardClick(event);
        this._onCatalogueRendered = (event) => this._handleCatalogueRendered(event);
        this._onGlobeReset = () => {
            if (this.globe) this.globe.resetView();
        };
        this.menu.addEventListener('input', this._onInput);
        this.menu.addEventListener('change', this._onInput);
        this.menu.addEventListener('click', this._onCardClick);
        this.menu.addEventListener('catalogue-rendered', this._onCatalogueRendered);
        this.menu.addEventListener('globe-reset', this._onGlobeReset);

        this._onPreview = () => this._syncClassicPreview();
        this.menu.addEventListener('airport-preview', this._onPreview);
        this._setupObservers();
        this.syncAll();
    }

    /**
     * Synchronize all visual enhancements with current DOM state.
     */
    syncAll() {
        this._syncBackdrop();
        this._syncDirection();
        this._syncAirportCards();
        this._syncClassicPreview();
        this._syncSetupSummary();
        this._syncRangeOutputs();
    }

    /**
     * Clean up observers, listeners, and canvas animation.
     */
    destroy() {
        if (this.backdrop) {
            this.backdrop.destroy();
            this.backdrop = null;
        }
        if (this.globe) {
            this.globe.destroy();
            this.globe = null;
        }
        if (this.menu) {
            this.menu.removeEventListener('airport-preview', this._onPreview);
            this.menu.removeEventListener('catalogue-rendered', this._onCatalogueRendered);
            this.menu.removeEventListener('globe-reset', this._onGlobeReset);
            this.menu.removeEventListener('input', this._onInput);
            this.menu.removeEventListener('change', this._onInput);
            this.menu.removeEventListener('click', this._onCardClick);
        }
        this.observers.forEach((observer) => observer.disconnect());
        this.observers = [];
    }

    _activePage() {
        if (!this.menu) return 'home';
        const visible = this.menu.querySelector('section[data-page]:not([hidden])');
        return visible ? visible.dataset.page : 'home';
    }

    _setupObservers() {
        const menuObserver = new MutationObserver(() => {
            this._syncBackdrop();
            this._syncDirection();
            this._syncSetupSummary();
            this._syncRangeOutputs();
        });
        menuObserver.observe(this.menu, {
            attributes: true,
            attributeFilter: ['open', 'class'],
            subtree: true
        });
        this.observers.push(menuObserver);

        const airportSelect = this.menu.querySelector('#session-airport');
        if (airportSelect) {
            const selectObserver = new MutationObserver(() => this._syncAirportCards());
            selectObserver.observe(airportSelect, { childList: true });
            this.observers.push(selectObserver);
        }

        const airportMeta = this.menu.querySelector('#session-airport-meta');
        if (airportMeta) {
            const metaObserver = new MutationObserver(() => this._syncClassicPreview());
            metaObserver.observe(airportMeta, { childList: true, characterData: true, subtree: true });
            this.observers.push(metaObserver);
        }

        const runwaySelect = this.menu.querySelector('#session-runways');
        if (runwaySelect) {
            const runwayObserver = new MutationObserver(() => this._syncSetupSummary());
            runwayObserver.observe(runwaySelect, { childList: true });
            this.observers.push(runwayObserver);
        }
    }

    _handleInput(event) {
        const { target } = event;
        if (!target) return;

        if (target.id === 'session-airport') {
            this._syncAirportCards();
            this._syncClassicPreview();
            if (this.globe && target.value) {
                this.globe.setSelected(target.value.toUpperCase(), false);
            }
        } else if (
            target.closest('#session-setup-traffic') ||
            target.id === 'session-runways'
        ) {
            this._syncSetupSummary();
        } else if (target.type === 'range') {
            this._syncRangeOutputs();
        }
    }

    _handleCardClick(event) {
        const card = event.target.closest('button.menu-airport-card[data-icao]');
        if (!card || !this.menu) return;
        const select = this.menu.querySelector('#session-airport');
        if (!select) return;
        select.value = card.dataset.icao;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        this._syncAirportCards();
    }

    _syncBackdrop() {
        if (!this.menu) return;
        const isOpen = Boolean(this.menu.open);
        const inSession = this.menu.classList.contains('in-session');
        const activePage = this._activePage();

        if (this.backdrop) {
            const shouldRun = isOpen && !inSession;
            if (shouldRun && !this.backdrop.running) {
                this.backdrop.start();
            } else if (!shouldRun && this.backdrop.running) {
                this.backdrop.stop();
            }
        }

        const shouldRunGlobe = isOpen && !inSession && activePage === 'classic';
        if (shouldRunGlobe && !this.globe) {
            const container = this.menu.querySelector('#session-airport-globe');
            if (container) {
                this.globe = new AirportGlobe(container, {
                    onSelect: (icao) => this._selectAirport(icao, true)
                });
                if (this._lastCatalogueDetail) {
                    this.globe.setAirports(this._lastCatalogueDetail.entries, this._lastCatalogueDetail.selectedIcao);
                }
            }
        }
        if (this.globe) {
            this.globe.setActive(shouldRunGlobe);
        }
    }

    _selectAirport(icao, animate = false) {
        const select = this.menu.querySelector('#session-airport');
        if (!select) return;
        const target = String(icao || '').toLowerCase();
        if (Array.from(select.options).some((opt) => opt.value.toLowerCase() === target)) {
            select.value = target;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            this._syncAirportCards();
            if (this.globe) this.globe.setSelected(target.toUpperCase(), animate);
        }
    }

    _handleCatalogueRendered(event) {
        const detail = event && event.detail;
        if (!detail) return;
        this._lastCatalogueDetail = detail;
        if (this.globe) {
            this.globe.setAirports(detail.entries, detail.selectedIcao);
            if (detail.query && detail.entries.length === 1 && Array.isArray(detail.entries[0].coordinates)) {
                this.globe.focusCoordinates(detail.entries[0].coordinates[0], detail.entries[0].coordinates[1]);
            }
        }
        this._syncAirportCards();
    }

    _syncDirection() {
        const current = this._activePage();
        if (current === this.lastPage) return;

        if (!this.menu.dataset.pageDirection) {
            const prevDepth = PAGE_DEPTH[this.lastPage];
            const nextDepth = PAGE_DEPTH[current];
            if (typeof prevDepth === 'number' && typeof nextDepth === 'number') {
                this.menu.dataset.pageDirection = nextDepth >= prevDepth ? 'forward' : 'backward';
            } else {
                this.menu.dataset.pageDirection = 'none';
            }
        }
        this.lastPage = current;
    }

    _syncAirportCards() {
        const select = this.menu.querySelector('#session-airport');
        const container = this.menu.querySelector('#session-airport-cards');
        const wrap = this.menu.querySelector('.menu-classic-select-wrap');
        if (!select || !container) return;

        const options = Array.from(select.options);
        container.replaceChildren();

        if (wrap) {
            wrap.classList.toggle('is-enhanced', options.length > 0);
        }

        options.forEach((option) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'menu-airport-card';
            if (option.value === select.value) btn.classList.add('is-selected');
            btn.dataset.icao = option.value;
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', option.value === select.value ? 'true' : 'false');

            const [icaoPart, ...rest] = option.textContent.split('·');
            const icao = document.createElement('span');
            icao.className = 'menu-airport-card__icao';
            icao.textContent = (icaoPart || option.value).trim();

            const name = document.createElement('span');
            name.className = 'menu-airport-card__name';
            name.textContent = rest.join('·').trim() || option.textContent;

            const tag = document.createElement('span');
            tag.className = 'menu-airport-card__tag';
            tag.textContent = option.value === select.value ? 'Selected' : 'Sector';

            btn.append(icao, name, tag);
            container.append(btn);
        });
    }

    _syncClassicPreview() {
        const svg = this.menu.querySelector('#session-classic-preview-svg');
        if (!svg) return;
        svg.querySelectorAll('.menu-preview-runway').forEach((el) => el.remove());
        const preview = this.menu.airportPreview;
        if (!preview || !preview.runways.length || !preview.coordinates) return;
        const [lat, lon] = preview.coordinates;
        const longitudeScale = Math.cos(lat * Math.PI / 180);
        const project = (point) => [(point[1] - lon) * longitudeScale, lat - point[0]];
        const pairs = preview.runways.map((runway) => runway.thresholds.map(project));
        const extent = Math.max(...[].concat(...pairs).map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
        if (!Number.isFinite(extent) || !extent) return;
        const scale = 62 / extent;
        pairs.forEach(([start, end], index) => {
            const runway = preview.runways[index];
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('class', 'menu-preview-runway');
            line.setAttribute('data-runway', runway.identifiers.join('/'));
            line.setAttribute('x1', 130 + scale * start[0]);
            line.setAttribute('y1', 80 + scale * start[1]);
            line.setAttribute('x2', 130 + scale * end[0]);
            line.setAttribute('y2', 80 + scale * end[1]);
            line.setAttribute('stroke', runway.arrivalThreshold >= 0 ? '#91E8BC' : '#8FC6D3');
            line.setAttribute('stroke-width', '2.5');
            svg.append(line);
        });
    }

    _syncSetupSummary() {
        const summary = this.menu.querySelector('#session-setup-summary');
        if (!summary) return;

        const title = this.menu.querySelector('#session-title');
        const arrivals = this.menu.querySelector('#session-arrivals');
        const departures = this.menu.querySelector('#session-departures');
        const vfr = this.menu.querySelector('#session-vfr');
        const rate = this.menu.querySelector('#session-rate');
        const runways = this.menu.querySelector('#session-runways');

        const trafficParts = [];
        if (arrivals && arrivals.checked) trafficParts.push('IFR Arrivals');
        if (departures && departures.checked) trafficParts.push('IFR Departures');
        if (vfr && vfr.checked) trafficParts.push('VFR');

        const setField = (key, value) => {
            const el = summary.querySelector(`[data-summary="${key}"]`);
            if (el) el.textContent = value;
        };

        if (title) setField('airport', title.textContent.replace(/\s+session$/i, '') || 'Selected airport');
        setField('traffic', trafficParts.length ? trafficParts.join(' · ') : 'None selected');
        if (rate && rate.selectedOptions[0]) setField('rate', rate.selectedOptions[0].textContent);

        const runwayText = runways && runways.selectedOptions[0] ?
            runways.selectedOptions[0].textContent :
            'Airport default';
        setField('runway', runwayText);

        const diagram = this.menu.querySelector('#session-setup-runway-diagram');
        if (diagram) {
            diagram.textContent = runways && runways.options.length ? `Active flow: ${runwayText}` : '';
        }
    }

    _syncRangeOutputs() {
        const outputs = this.menu.querySelectorAll('.menu-range-value[data-for]');
        outputs.forEach((output) => {
            const input = this.menu.querySelector(`#${output.dataset.for}`);
            if (!input) return;
            output.textContent = output.dataset.for === 'voice-volume' ?
                `${Math.round(Number(input.value) * 100)}%` :
                `${Number(input.value).toFixed(1)}×`;
        });
    }
}
