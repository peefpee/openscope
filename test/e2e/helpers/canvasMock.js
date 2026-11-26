const STYLE_KEYS = [
    'fillStyle',
    'strokeStyle',
    'font',
    'lineWidth',
    'lineJoin',
    'lineCap',
    'textAlign',
    'textBaseline',
    'globalCompositeOperation',
    'globalAlpha',
    'shadowColor',
    'shadowBlur',
    'shadowOffsetX',
    'shadowOffsetY'
];

class RecordingCanvasContext2D {
    constructor(canvas) {
        this.canvas = canvas;
        this.fillStyle = '#000000';
        this.strokeStyle = '#000000';
        this.font = '10px sans-serif';
        this.lineWidth = 1;
        this.lineJoin = 'miter';
        this.lineCap = 'butt';
        this.textAlign = 'start';
        this.textBaseline = 'alphabetic';
        this.globalCompositeOperation = 'source-over';
        this.globalAlpha = 1;
        this.shadowColor = 'rgba(0, 0, 0, 0)';
        this.shadowBlur = 0;
        this.shadowOffsetX = 0;
        this.shadowOffsetY = 0;

        this._stateStack = [];
        this._calls = [];
    }

    _snapshotStyle() {
        const snapshot = {};

        for (let i = 0; i < STYLE_KEYS.length; i++) {
            const key = STYLE_KEYS[i];
            snapshot[key] = this[key];
        }

        return snapshot;
    }

    _record(op, extra = {}) {
        this._calls.push({
            op,
            fillStyle: this.fillStyle,
            strokeStyle: this.strokeStyle,
            font: this.font,
            lineWidth: this.lineWidth,
            globalAlpha: this.globalAlpha,
            ...extra
        });
    }

    clearCalls() {
        this._calls = [];
    }

    getCalls() {
        return this._calls.slice();
    }

    save() {
        this._stateStack.push(this._snapshotStyle());
    }

    restore() {
        const prev = this._stateStack.pop();

        if (!prev) {
            return;
        }

        for (let i = 0; i < STYLE_KEYS.length; i++) {
            const key = STYLE_KEYS[i];
            this[key] = prev[key];
        }
    }

    scale() {}

    translate() {}

    rotate() {}

    clearRect(x, y, width, height) {
        this._calls = [];
        this._record('clearRect', {
            x,
            y,
            width,
            height
        });
    }

    beginPath() {}

    closePath() {}

    moveTo() {}

    lineTo() {}

    rect(x, y, width, height) {
        this._record('rect', {
            x,
            y,
            width,
            height
        });
    }

    arc(x, y, radius, startAngle, endAngle, anticlockwise = false) {
        this._record('arc', {
            x,
            y,
            radius,
            startAngle,
            endAngle,
            anticlockwise
        });
    }

    arcTo() {}

    clip() {}

    fill() {
        this._record('fill');
    }

    stroke() {
        this._record('stroke');
    }

    fillRect(x, y, width, height) {
        this._record('fillRect', {
            x,
            y,
            width,
            height
        });
    }

    strokeRect(x, y, width, height) {
        this._record('strokeRect', {
            x,
            y,
            width,
            height
        });
    }

    fillText(text, x, y) {
        this._record('fillText', {
            text: String(text),
            x,
            y
        });
    }

    strokeText(text, x, y) {
        this._record('strokeText', {
            text: String(text),
            x,
            y
        });
    }

    measureText(text) {
        return {
            width: String(text || '').length * 7
        };
    }

    setLineDash() {}

    getLineDash() {
        return [];
    }
}

/**
 * Install a recording CanvasRenderingContext2D mock on `HTMLCanvasElement.prototype.getContext`.
 *
 * @function installCanvasMock
 * @return {object} { restore, getContextForElement }
 */
export function installCanvasMock() {
    const canvasProto = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
    const prevGetContext = canvasProto ? canvasProto.getContext : undefined;
    const contextMap = new WeakMap();

    if (canvasProto) {
        canvasProto.getContext = function getContext(contextId) {
            if (contextId !== '2d') {
                return null;
            }

            if (!contextMap.has(this)) {
                contextMap.set(this, new RecordingCanvasContext2D(this));
            }

            return contextMap.get(this);
        };
    }

    let restored = false;

    return {
        getContextForElement: (el) => (el ? contextMap.get(el) || null : null),
        restore: () => {
            if (restored) {
                return;
            }

            restored = true;

            if (canvasProto) {
                if (prevGetContext === undefined) {
                    delete canvasProto.getContext;
                } else {
                    canvasProto.getContext = prevGetContext;
                }
            }
        }
    };
}

/**
 * Trigger a shallow render on `canvasController` and return recorded dynamic-canvas draws.
 *
 * @function getRenderedDataBlocks
 * @param canvasController {CanvasController}
 * @return {object} { calls, fillTexts, arcs, rects, strokes }
 */
export function getRenderedDataBlocks(canvasController) {
    if (!canvasController) {
        return {
            calls: [],
            fillTexts: [],
            arcs: [],
            rects: [],
            strokes: []
        };
    }

    const dynamicCtx = canvasController._context && canvasController._context.dynamic;

    if (dynamicCtx && typeof dynamicCtx.clearCalls === 'function') {
        dynamicCtx.clearCalls();
    }

    canvasController._markShallowRender();
    canvasController.canvasUpdatePost();

    const calls = dynamicCtx && typeof dynamicCtx.getCalls === 'function' ?
        dynamicCtx.getCalls() :
        [];

    return {
        calls,
        fillTexts: calls.filter((c) => c.op === 'fillText'),
        arcs: calls.filter((c) => c.op === 'arc'),
        rects: calls.filter((c) => c.op === 'fillRect'),
        strokes: calls.filter((c) => c.op === 'stroke')
    };
}

/**
 * Extract view models and visibility/controllability state for all radar targets.
 *
 * @function getRadarTargetViewModels
 * @param scopeModel {ScopeModel}
 * @return {array<object>}
 */
export function getRadarTargetViewModels(scopeModel) {
    if (!scopeModel || !scopeModel.radarTargetCollection) {
        return [];
    }

    return scopeModel.radarTargetCollection.items.map((radarTargetModel) => {
        const { aircraftModel } = radarTargetModel;

        return {
            callsign: aircraftModel.callsign,
            aircraftId: aircraftModel.id,
            isVisible: aircraftModel.isVisible(),
            isControllable: aircraftModel.isControllable,
            controllerState: aircraftModel.controllerState ? { ...aircraftModel.controllerState } : null,
            row1: radarTargetModel.buildDataBlockRowOne(),
            row2Primary: radarTargetModel.buildDataBlockRowTwoPrimaryInfo(),
            row2Secondary: radarTargetModel.buildDataBlockRowTwoSecondaryInfo(),
            scratchpadText: radarTargetModel.scratchpadText,
            haloRadius: radarTargetModel.haloRadius
        };
    });
}
