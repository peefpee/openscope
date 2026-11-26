import $ from 'jquery';
import navData from '../airport/dat/NavDataCache';
import AirportController from '../airport/AirportController';

function bearingLabel(bearing) {
    return `${String(bearing).padStart(3, '0')}°`;
}

// The file gives bearings TO the centre. Draw their reciprocals on the compass.
function angle(inbound) {
    return (inbound + 90) * Math.PI / 180;
}

function drawDiagram(canvas, sectors) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const maxRadius = Math.max(1, ...sectors.map(({ radius }) => Number(radius) || 1));
    const scale = 102 / maxRadius;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2 + 5);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#83b0b5';
    ctx.fillStyle = '#d5e9ea';
    ctx.font = '20px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -123);
    sectors.forEach(({ bearing, altitude, radius }, i) => {
        const end = sectors[(i + 1) % sectors.length].bearing;
        const sweep = sectors.length === 1 ? 360 : (end - bearing + 360) % 360;
        const from = angle(bearing);
        const to = angle(bearing + sweep);
        const r = radius * scale;
        ctx.beginPath();
        if (sweep < 360) ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, from, to);
        ctx.closePath();
        ctx.stroke();
        if (sweep >= 42) {
            const d = sweep === 360 ? 0 : r * 0.62;
            ctx.fillText(String(altitude), Math.cos((from + to) / 2) * d, Math.sin((from + to) / 2) * d);
        }
    });
    ctx.restore();
}

export default class MsaView {
    constructor($root) {
        this.$root = $root;
        this.$panel = $root.find('#msa-panel');
        this.$toggle = $root.find('.toggle-msa');
        this.$select = this.$panel.find('select');
        this._isOpen = false;
        this._loadToken = 0;
        this._previousFocus = null;
        this.entries = [];

        this.$toggle.off('.msa').on('click.msa', (event) => {
            event.preventDefault();
            this.setOpen(!this._isOpen);
        });
        this.$panel.find('header button, .msa-close').off('.msa').on('click.msa', (event) => {
            event.preventDefault();
            this.setOpen(false);
        });
        this.$panel.find('.msa-open-import').off('.msa').on('click.msa', (event) => {
            event.preventDefault();
            this.setOpen(false);
            this.$root.find('.toggle-dat-import').trigger('click');
        });
        this.$select.off('.msa').on('change.msa', () => this.renderCentre());
        this.$panel.off('.msa').on('keydown.msa keyup.msa', (event) => {
            if (event.key === 'Escape' && this._isOpen) {
                event.preventDefault();
                this.setOpen(false);
            }
            event.stopPropagation();
        });
        $(document).off('.msa').on('keydown.msa', (event) => {
            if (event.key === 'Escape' && this._isOpen) {
                event.preventDefault();
                this.setOpen(false);
            }
        });
    }

    isOpen() {
        return this._isOpen;
    }

    setOpen(open) {
        const nextOpen = Boolean(open);
        this._loadToken += 1;
        const token = this._loadToken;

        if (nextOpen && !this._isOpen) {
            this._previousFocus = document.activeElement;
        }

        this._isOpen = nextOpen;
        this.$toggle.toggleClass('active', nextOpen).attr('aria-pressed', String(nextOpen));
        this.$panel.prop('hidden', !nextOpen).attr('aria-hidden', String(!nextOpen));

        if (nextOpen) {
            this.refresh();
            navData.load().then(() => {
                if (token !== this._loadToken || !this._isOpen) return;
                this.refresh();
            }).catch(() => {
                if (token !== this._loadToken || !this._isOpen) return;
                this.refresh();
            });
            const closeBtn = this.$panel.find('header button')[0];
            if (closeBtn && typeof closeBtn.focus === 'function') {
                closeBtn.focus();
            }
        } else if (this._previousFocus && typeof this._previousFocus.focus === 'function' &&
            document.contains(this._previousFocus)) {
            this._previousFocus.focus();
            this._previousFocus = null;
        }
    }

    refresh() {
        if (!this._isOpen || this.$panel.prop('hidden')) return;
        const airport = AirportController.current;
        const icao = airport && airport.icao ? airport.icao.toUpperCase() : '';
        const record = navData.records.get('msa');
        const rawEntries = record && record.airports && icao ? record.airports[icao] : null;
        this.entries = Array.isArray(rawEntries) ? rawEntries.filter((e) => e && Array.isArray(e.sectors) && e.sectors.length) : [];
        this.$panel.find('strong').text(`${icao || ''} MSA`.trim());
        this.$select.empty().prop('hidden', !this.entries.length);
        this.entries.forEach((entry, i) => {
            this.$select.append($('<option>').val(i).text(`${entry.id} · ${entry.type}`));
        });
        this.$panel.find('canvas').prop('hidden', !this.entries.length);
        this.$panel.find('ul').empty();
        if (!this.entries.length) {
            this.$panel.find('.msa-reference').text('No MSA data available for this airport.');
            this.$panel.find('.msa-empty')
                .text(record ?
                    `No MSA record found for ${icao || 'this airport'} in the imported earth_msa.dat.` :
                    'Import earth_msa.dat using the + button to display MSA sectors.')
                .prop('hidden', false);
            this.$panel.find('.msa-open-import').prop('hidden', Boolean(record));
            return;
        }
        this.$panel.find('.msa-empty').prop('hidden', true).text('');
        this.$panel.find('.msa-open-import').prop('hidden', true);
        this.renderCentre();
    }

    renderCentre() {
        if (!this.entries || !this.entries.length) return;
        const index = Number(this.$select.val());
        const entry = this.entries[Number.isInteger(index) && index >= 0 && index < this.entries.length ? index : 0];
        if (!entry || !Array.isArray(entry.sectors) || !entry.sectors.length) return;
        const { reference, sectors } = entry;
        const $list = this.$panel.find('ul').empty();
        this.$panel.find('.msa-reference').text(`Inbound bearings · ${reference === 'M' ? 'magnetic' : 'true'}`);
        const ambiguous = new Set(sectors.map((s) => s.bearing)).size !== sectors.length;
        const canvas = this.$panel.find('canvas').prop('hidden', ambiguous)[0];
        if (!ambiguous) drawDiagram(canvas, sectors);
        sectors.forEach(({ bearing, altitude, radius }, i) => {
            const end = sectors[(i + 1) % sectors.length].bearing;
            const range = sectors.length === 1 ? 'All bearings' : (ambiguous ? bearingLabel(bearing) :
                `${bearingLabel(bearing)}–${bearingLabel(end)}`);
            $list.append($('<li>').text(`${range} · ${Number(altitude).toLocaleString('en-US')} ft · ${radius} NM`));
        });
    }

    destroy() {
        this.setOpen(false);
        this.$toggle.off('.msa');
        $(document).off('.msa');
        this.$panel.off('.msa').find('button, select').off('.msa');
    }
}
