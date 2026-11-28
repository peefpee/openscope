import RadarBackdrop from './RadarBackdrop';

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
        this.observers = [];

        if (!this.menu) return;

        const canvas = this.menu.querySelector('#session-menu-radar-canvas');
        if (canvas) {
            this.backdrop = new RadarBackdrop(canvas);
        }

        this._onInput = (event) => this._handleInput(event);
        this._onCardClick = (event) => this._handleCardClick(event);
        this.menu.addEventListener('input', this._onInput);
        this.menu.addEventListener('change', this._onInput);
        this.menu.addEventListener('click', this._onCardClick);

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
        if (this.menu) {
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
        if (!this.backdrop || !this.menu) return;
        const shouldRun = Boolean(this.menu.open) && !this.menu.classList.contains('in-session');
        if (shouldRun && !this.backdrop.running) {
            this.backdrop.start();
        } else if (!shouldRun && this.backdrop.running) {
            this.backdrop.stop();
        }
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
        const meta = this.menu.querySelector('#session-airport-meta');
        if (!svg || !meta) return;

        svg.querySelectorAll('.menu-preview-runway').forEach((el) => el.remove());
        const text = meta.textContent || '';
        const match = /Runways:\s*([^·]+)/i.exec(text);
        if (!match) return;

        const runways = match[1].split(',').map((s) => s.trim()).filter(Boolean);
        runways.slice(0, 4).forEach((rwy, idx) => {
            const headingNum = parseInt(rwy, 10);
            if (Number.isNaN(headingNum)) return;
            const rad = ((headingNum * 10 - 90) * Math.PI) / 180;
            const offset = (idx - (runways.length - 1) / 2) * 10;
            const perp = rad + Math.PI / 2;
            const ox = Math.cos(perp) * offset;
            const oy = Math.sin(perp) * offset;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('class', 'menu-preview-runway');
            line.setAttribute('x1', String(130 + ox - Math.cos(rad) * 34));
            line.setAttribute('y1', String(80 + oy - Math.sin(rad) * 34));
            line.setAttribute('x2', String(130 + ox + Math.cos(rad) * 34));
            line.setAttribute('y2', String(80 + oy + Math.sin(rad) * 34));
            line.setAttribute('stroke', '#91E8BC');
            line.setAttribute('stroke-width', '2.5');
            line.setAttribute('stroke-linecap', 'round');
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
