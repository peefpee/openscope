import test from 'ava';
import { setupSimulation, teardownSimulation } from './helpers/e2eHarness';
import { ScopeControls } from '../../src/assets/scripts/client/ui/ScopeControls';
import CanvasStageModel from '../../src/assets/scripts/client/canvas/CanvasStageModel';

test.serial('arrow panning uses elapsed time, normalises diagonals and yields to command editing and dialogs', (t) => {
    const sim = setupSimulation({ icao: 'yssy' });
    const input = document.createElement('input');
    const scope = document.createElement('button');
    const modal = document.createElement('div');
    const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    const request = window.requestAnimationFrame;
    const cancel = window.cancelAnimationFrame;
    const [oldX, oldY] = [CanvasStageModel._panX, CanvasStageModel._panY];
    const controls = new ScopeControls(scope, input, () => null, () => ({ data: {} }));
    const right = { code: 'ArrowRight', key: 'ArrowRight', shiftKey: true };
    const up = { code: 'ArrowUp', key: 'ArrowUp', shiftKey: true };
    try {
        document.body.appendChild(scope);
        document.body.appendChild(input);
        document.body.appendChild(modal);
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        window.requestAnimationFrame = () => 1;
        window.cancelAnimationFrame = () => {};
        CanvasStageModel.updatePan(0, 0);
        scope.focus();
        t.true(controls.down(right));
        t.true(controls.down(up));
        controls.tick(0);
        controls.tick(100);
        t.true(Math.abs(Math.hypot(CanvasStageModel._panX, CanvasStageModel._panY) - 87.5) < 0.001);
        controls.up(up);
        controls.up(right);
        t.is(controls.frame, null);
        input.focus();
        t.false(controls.down(right));
        scope.focus();
        modal.className = 'dialog open';
        t.false(controls.down(up));
    } finally {
        controls.stop();
        if (hidden) Object.defineProperty(document, 'hidden', hidden);
        else delete document.hidden;
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
        CanvasStageModel.updatePan(oldX, oldY);
        [input, scope, modal].forEach((node) => node.remove());
        teardownSimulation(sim);
    }
});
