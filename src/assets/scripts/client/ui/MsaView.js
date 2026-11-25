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
    const ctx = canvas.getContext('2d');
    const scale = 102 / Math.max(...sectors.map(({ radius }) => radius));
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
        this.$panel = $root.find('#msa-panel');
        this.$toggle = $root.find('.toggle-msa');
        this.$select = this.$panel.find('select');
        this.$toggle.on('click.msa', (event) => {
            event.preventDefault();
            this.setOpen(this.$panel.prop('hidden'));
        });
        this.$panel.find('button').on('click.msa', () => this.setOpen(false));
        this.$select.on('change.msa', () => this.renderCentre());
        this.$panel.on('keydown.msa keyup.msa', (event) => event.stopPropagation());
    }

    setOpen(open) {
        this.$toggle.toggleClass('active', open).attr('aria-pressed', String(open));
        this.$panel.prop('hidden', !open);
        if (open) navData.load().then(() => this.refresh());
    }

    refresh() {
        if (this.$panel.prop('hidden')) return;
        const airport = AirportController.current;
        const icao = airport && airport.icao.toUpperCase();
        const record = navData.records.get('msa');
        this.entries = (record && record.airports[icao]) || [];
        this.$panel.find('strong').text(`${icao || ''} MSA`.trim());
        this.$select.empty().prop('hidden', !this.entries.length);
        this.entries.forEach((entry, i) => {
            this.$select.append($('<option>').val(i).text(`${entry.id} · ${entry.type}`));
        });
        this.$panel.find('canvas').prop('hidden', !this.entries.length);
        this.$panel.find('ul').empty();
        if (!this.entries.length) {
            this.$panel.find('.msa-reference').text(record ? 'No MSA in this file for this airport.' :
                'Add earth_msa.dat using the + import button.');
            return;
        }
        this.renderCentre();
    }

    renderCentre() {
        const { reference, sectors } = this.entries[Number(this.$select.val())];
        const $list = this.$panel.find('ul').empty();
        this.$panel.find('.msa-reference').text(`Inbound bearings · ${reference === 'M' ? 'magnetic' : 'true'}`);
        const ambiguous = new Set(sectors.map((s) => s.bearing)).size !== sectors.length;
        const canvas = this.$panel.find('canvas').prop('hidden', ambiguous)[0];
        if (!ambiguous) drawDiagram(canvas, sectors);
        sectors.forEach(({ bearing, altitude, radius }, i) => {
            const end = sectors[(i + 1) % sectors.length].bearing;
            const range = sectors.length === 1 ? 'All bearings' : (ambiguous ? bearingLabel(bearing) :
                `${bearingLabel(bearing)}–${bearingLabel(end)}`);
            $list.append($('<li>').text(`${range} · ${altitude.toLocaleString('en-US')} ft · ${radius} NM`));
        });
    }

    destroy() {
        this.setOpen(false);
        this.$toggle.off('.msa');
        this.$panel.off('.msa').find('button, select').off('.msa');
    }
}
