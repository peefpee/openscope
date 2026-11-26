import $ from 'jquery';
import EventBus from '../lib/EventBus';
import { EVENT } from '../constants/eventNames';

const types = {
    R: 'Restricted', P: 'Prohibited', Q: 'Danger', CTR: 'CTR', CTA: 'CTA'
};
const classes = ['A', 'B', 'C', 'D', 'E', 'G'];
export const layerState = { disabled: new Set(), lower: -Infinity, upper: Infinity };

export function layerVisible(area) {
    return !layerState.disabled.has(area.airspace_class) && !layerState.disabled.has(area.type) &&
        area.floor <= layerState.upper && area.ceiling >= layerState.lower;
}

export function airspaceLabel(area) {
    const limits = area.verticalLimits;
    const format = (limit, fallback) => limit && (limit.label || (limit.agl && (limit.feet ? `${limit.feet} AGL` : 'SFC'))) ||
        String(Math.round(fallback));
    return [area.airspace_class, types[area.type], `${format(limits && limits.lower, area.floor)}–${
        format(limits && limits.upper, area.ceiling)}`, area.source === 'simulated' ? 'SIM' : ''].filter(Boolean).join(' ');
}

export function buildLayerControls() {
    const group = $('<details>').append($('<summary>').text('Australian airspace layers'));
    const redraw = () => EventBus.trigger(EVENT.AIRSPACE_LAYERS_CHANGE);
    for (const id of [...classes, ...Object.keys(types), 'VFR']) {
        const name = types[id] || (id === 'VFR' ? 'VFR reporting points' : `Class ${id}`);
        const field = $('<input type="checkbox">').prop('checked', !layerState.disabled.has(id)).on('change', () => {
            if (field.prop('checked')) layerState.disabled.delete(id);
            else layerState.disabled.add(id);
            redraw();
        });
        group.append($('<label class="form-element">').append(field, document.createTextNode(` ${name}`)));
    }
    for (const side of ['lower', 'upper']) {
        const field = $('<input type="number" step="100" placeholder="Unfiltered">');
        if (Number.isFinite(layerState[side])) field.val(layerState[side]);
        field.on('input', () => {
            const unbounded = side === 'lower' ? -Infinity : Infinity;
            const value = field.val() === '' ? unbounded : Number(field.val());
            const valid = side === 'lower' ? value <= layerState.upper : value >= layerState.lower;
            field[0].setCustomValidity(valid ? '' : 'Lower altitude must be at or below upper altitude.');
            if (valid) { layerState[side] = value; redraw(); }
        });
        group.append($('<label class="form-element">').text(`${side} altitude (ft) `).append(field));
    }
    group.append($('<button type="button">').text('Minimum sector altitudes').on('click', () => $('.toggle-msa').trigger('click')));
    return group;
}
