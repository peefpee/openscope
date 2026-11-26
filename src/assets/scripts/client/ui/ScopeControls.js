import $ from 'jquery';
import CanvasStageModel from '../canvas/CanvasStageModel';

const storageKey = 'openscope-scope-controls-v1';
const bindings = {
    north: 'ArrowUp', south: 'ArrowDown', west: 'ArrowLeft', east: 'ArrowRight',
    zoomIn: 'Equal', zoomOut: 'Minus', centre: 'Home', reset: 'Shift+Home',
    centreAircraft: 'Primary+Shift+KeyF'
};
const defaults = { ...bindings, fast: 'Shift', precise: 'Alt', editing: 'Off',
    speed: 350, fastFactor: 2.5, preciseFactor: 0.25, minZoom: 1, maxZoom: 100 };
const labels = { north: 'Pan north', south: 'Pan south', west: 'Pan west', east: 'Pan east',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', centre: 'Centre airport', reset: 'Restore airport view',
    centreAircraft: 'Centre selected aircraft', fast: 'Fast pan modifier', precise: 'Precise pan modifier',
    editing: 'Pan while editing commands', speed: 'Pan speed (pixels/s)', fastFactor: 'Fast speed multiplier',
    preciseFactor: 'Precise speed multiplier', minZoom: 'Minimum zoom', maxZoom: 'Maximum zoom' };

function read() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey)) }; }
    catch (error) { return { ...defaults }; }
}
const options = read();
function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(options)); } catch (error) { /* Session settings still work. */ }
}
function chord(event) {
    return [event.ctrlKey || event.metaKey ? 'Primary' : '', event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '', event.code].filter(Boolean).join('+');
}
function modifier(event, key) {
    return key === 'Shift' ? event.shiftKey : key === 'Alt' ? event.altKey : key === 'Primary' && (event.ctrlKey || event.metaKey);
}

export function controlsSettings() {
    const group = $('<details>').append($('<summary>').text('Radar keyboard controls'));
    const message = $('<p role="status">');
    const fields = {};
    function refresh() { Object.keys(fields).forEach((key) => fields[key].val(options[key])); }
    Object.keys(defaults).forEach((key) => {
        let field;
        if (key in bindings) {
            field = $('<input readonly>').on('keydown', (event) => {
                if (event.key === 'Tab') return;
                event.preventDefault();
                event.stopPropagation();
                if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
                const value = chord(event.originalEvent);
                if (Object.keys(bindings).some((id) => id !== key && options[id] === value)) {
                    message.text('This shortcut is already assigned.');
                    return;
                }
                options[key] = value;
                save();
                refresh();
                message.empty();
            });
        } else if (typeof defaults[key] === 'number') {
            field = $('<input type="number" min="0.01" step="any">').on('change', () => {
                const value = Number(field.val());
                if (Number.isFinite(value) && value > 0 && !(key === 'maxZoom' && value < options.minZoom) &&
                    !(key === 'minZoom' && value > options.maxZoom)) options[key] = value;
                save();
                refresh();
            });
        } else {
            field = $('<select>');
            (key === 'editing' ? ['Off', 'Primary', 'Alt', 'Shift'] : ['Shift', 'Alt', 'Primary']).forEach((name) =>
                field.append($('<option>').text(name)));
            field.on('change', () => {
                const value = field.val();
                if ((key === 'fast' && value === options.precise) || (key === 'precise' && value === options.fast)) {
                    message.text('Choose different fast and precise modifiers.');
                } else { options[key] = value; save(); message.empty(); }
                refresh();
            });
        }
        fields[key] = field;
        group.append($('<label class="form-element">').append($('<span class="form-label">').text(labels[key]), field));
    });
    refresh();
    return group.append(message, $('<button type="button">').text('Reset radar controls').on('click', () => {
        Object.assign(options, defaults);
        save();
        refresh();
        message.empty();
    }));
}

export class ScopeControls {
    constructor(element, command, selected, airport) {
        this.element = element;
        this.command = command;
        this.selected = selected;
        this.airport = airport;
        this.held = new Map();
        this.frame = null;
        this.stop = this.stop.bind(this);
        this.tick = this.tick.bind(this);
    }

    stop() {
        this.held.clear();
        if (this.frame !== null) window.cancelAnimationFrame(this.frame);
        this.frame = null;
        this.last = null;
    }

    eligible() {
        const focused = document.activeElement;
        return !document.hidden && !document.querySelector('dialog[open], .dialog.open') &&
            (focused === this.element || focused === document.body ||
                (focused === this.command && this.editingPan));
    }

    down(event) {
        const code = event.code;
        const exact = chord(event);
        this.editingPan = modifier(event, options.editing);
        if (!this.eligible()) return false;
        const panKey = ['north', 'south', 'west', 'east'].find((key) => options[key] === exact ||
            (options[key] === code && (!event.ctrlKey && !event.metaKey || this.editingPan || options.fast === 'Primary' || options.precise === 'Primary')));
        this.factor = modifier(event, options.precise) ? options.preciseFactor :
            modifier(event, options.fast) ? options.fastFactor : 1;
        if (panKey) {
            this.held.set(code, panKey);
            if (this.frame === null) this.frame = window.requestAnimationFrame(this.tick);
            return true;
        }
        if (document.activeElement === this.command) return false;
        if (['Shift', 'Alt', 'Control', 'Meta'].includes(event.key)) return event.key !== 'Control';
        const action = Object.keys(bindings).find((key) => options[key] === exact);
        const zoomIn = action === 'zoomIn' || options.zoomIn === 'Equal' && ['+', '='].includes(event.key) && !event.metaKey && !event.ctrlKey;
        if (zoomIn || action === 'zoomOut') {
            CanvasStageModel.zoomWithin(zoomIn, options.minZoom, options.maxZoom);
        } else if (action === 'centre' || action === 'reset') {
            if (action === 'reset') CanvasStageModel.zoomReset(this.airport().data.defaultZoom);
            CanvasStageModel.updatePan(0, 0);
        } else if (action === 'centreAircraft') {
            const aircraft = this.selected();
            if (aircraft) {
                const [x, y] = aircraft.relativePosition;
                CanvasStageModel.updatePan(-x * CanvasStageModel.scale, y * CanvasStageModel.scale);
            }
        } else return false;
        return true;
    }

    up(event) {
        this.held.delete(event.code);
        this.editingPan = modifier(event, options.editing);
        this.factor = modifier(event, options.precise) ? options.preciseFactor :
            modifier(event, options.fast) ? options.fastFactor : 1;
        if (!this.held.size) this.stop();
    }

    tick(now) {
        if (!this.eligible() || !this.held.size) { this.stop(); return; }
        const keys = [...this.held.values()];
        const x = Number(keys.includes('west')) - Number(keys.includes('east'));
        const y = Number(keys.includes('north')) - Number(keys.includes('south'));
        const dt = this.last == null ? 0 : Math.min(now - this.last, 100) / 1000;
        const distance = dt * options.speed * this.factor / (Math.hypot(x, y) || 1);
        this.last = now;
        if (distance && (x || y)) CanvasStageModel.updatePan(CanvasStageModel._panX + x * distance, CanvasStageModel._panY + y * distance);
        this.frame = window.requestAnimationFrame(this.tick);
    }
}
