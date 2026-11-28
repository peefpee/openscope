import test from 'ava';
import $ from 'jquery';
import AirportGlobe from '../../src/assets/scripts/client/session/visual/AirportGlobe';
import MenuVisualController from '../../src/assets/scripts/client/session/visual/MenuVisualController';
import UiController from '../../src/assets/scripts/client/ui/UiController';

test.serial('Part A: UiController._positionControlPopup keeps bottom-right popups inside viewport across sizes', (t) => {
    const hasOwnDoc = Object.prototype.hasOwnProperty.call(global, 'document');
    const prevDoc = global.document;
    global.document = window.document;
    const prevInnerWidth = window.innerWidth;
    const prevInnerHeight = window.innerHeight;
    const $root = $(`
        <div class="footer">
            <ul class="controls-menu">
                <li class="control-item">
                    <a class="control-icon">Scope</a>
                    <div class="control-item-content">
                        <a class="control">Runways</a>
                        <a class="control">SID &amp; STAR fixes</a>
                        <a class="control">Airspace Depiction</a>
                    </div>
                </li>
            </ul>
        </div>
    `).appendTo(document.body);

    const item = $root.find('.control-item')[0];
    const popup = $root.find('.control-item-content')[0];

    for (const [vw, vh] of [[1280, 720], [1440, 900], [1920, 1080], [2560, 1440], [3440, 1440], [480, 400]]) {
        window.innerWidth = vw;
        window.innerHeight = vh;
        item.getBoundingClientRect = () => ({ left: vw - 44, right: vw - 8, top: vh - 36, bottom: vh, width: 36, height: 36 });
        popup.getBoundingClientRect = () => {
            const match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(popup.style.transform || '');
            const tx = match ? Number(match[1]) : 0;
            return { left: vw - 240 + tx, right: vw - 8 + tx, top: vh - 320, bottom: vh - 36, width: 232, height: 284 };
        };

        UiController._positionControlPopup(item);
        t.is(popup.style.right, '0px');
        t.true(popup.style.left === 'auto' || popup.style.left === '');
        t.true(Number.parseInt(popup.style.maxHeight, 10) <= vh - 44);
        const rect = popup.getBoundingClientRect();
        t.true(rect.left >= 8);
        t.true(rect.right <= vw - 8);
    }

    $root.remove();
    window.innerWidth = prevInnerWidth;
    window.innerHeight = prevInnerHeight;
    if (hasOwnDoc) global.document = prevDoc;
    else delete global.document;
});

test.serial('Part A: AirportGlobe supports repeated airport switching even after dragging and during animations', (t) => {
    const hasOwnDoc = Object.prototype.hasOwnProperty.call(global, 'document');
    const prevDoc = global.document;
    global.document = window.document;
    const prevRaf = window.requestAnimationFrame;
    const prevCancelRaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};

    const container = document.createElement('div');
    container.id = 'session-airport-globe';
    const canvas = document.createElement('canvas');
    canvas.className = 'globe-canvas';
    const markers = document.createElement('div');
    markers.className = 'globe-markers';
    container.append(canvas, markers);
    document.body.append(container);

    const selectedHistory = [];
    const globe = new AirportGlobe(container, {
        onSelect: (icao) => {
            selectedHistory.push(icao);
            globe.setSelected(icao, true);
        }
    });
    globe.setActive(true);
    globe.setAirports([
        { icao: 'YSSY', name: 'Sydney', sourceType: 'bundled', coordinates: [-33.946, 151.177] },
        { icao: 'YMHB', name: 'Hobart', sourceType: 'imported', coordinates: [-42.836, 147.51] },
        { icao: 'YBNA', name: 'Ballina', sourceType: 'bundled', coordinates: [-28.833, 153.562] }
    ], 'YSSY');

    // Simulate dragging the globe first (previously left dragMoved=true permanently!)
    globe._onPointerDown({ clientX: 100, clientY: 100, target: canvas });
    globe._onPointerMove({ clientX: 130, clientY: 115 });
    globe._onPointerUp();

    // Repeatedly click Airport B -> Airport C -> Airport A -> Airport B
    markers.querySelector('[data-icao="YMHB"]').click();
    markers.querySelector('[data-icao="YBNA"]').click();
    markers.querySelector('[data-icao="YSSY"]').click();
    markers.querySelector('[data-icao="YMHB"]').click();

    t.deepEqual(selectedHistory, ['YMHB', 'YBNA', 'YSSY', 'YMHB']);
    t.is(globe.selectedIcao, 'YMHB');

    globe.destroy();
    container.remove();
    window.requestAnimationFrame = prevRaf;
    window.cancelAnimationFrame = prevCancelRaf;
    if (hasOwnDoc) global.document = prevDoc;
    else delete global.document;
});
