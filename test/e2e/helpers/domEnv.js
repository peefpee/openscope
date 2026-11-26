import fs from 'fs';
import path from 'path';
import $ from 'jquery';
import EventTracker from '../../../src/assets/scripts/client/EventTracker';

const REPO_ROOT = path.resolve(__dirname, '../../..');

const E2E_DOM_TEMPLATE = `
<div id="e2e-sim-root">
    <div id="canvases"></div>
    <div id="log"></div>
    <div id="paused">
        <img src="assets/images/paused-overlay.png" title="Resume simulation" />
    </div>
    <aside id="msa-panel" hidden aria-label="Minimum sector altitudes">
        <header><strong></strong><button type="button" aria-label="Close MSA display">&times;</button></header>
        <select aria-label="MSA centre"></select>
        <p class="msa-reference"></p>
        <canvas width="400" height="280" aria-hidden="true"></canvas>
        <ul></ul>
    </aside>
    <aside id="frequency-panel" class="frequency-panel notSelectable" aria-label="Adjacent controller frequencies"></aside>
    <div id="sidebar" class="stripView js-stripView mix-stripView_isHidden">
        <div class="stripView-trigger js-stripView-trigger"></div>
        <div class="stripTitle">Arrivals / Overflights</div>
        <ul class="stripView-list nice-scrollbar js-stripViewArrivals-list"></ul>
        <div class="stripTitle">Departures</div>
        <ul class="stripView-list nice-scrollbar js-stripViewDepartures-list"></ul>
    </div>
    <dialog id="dat-import" aria-labelledby="dat-import-title">
        <header>
            <h2 id="dat-import-title">Import airport data</h2>
            <form method="dialog"><button type="submit" aria-label="Close import dialog">&times;</button></form>
        </header>
        <div class="dat-cached" hidden>
            <label for="dat-cached-airport">Saved airport</label>
            <select id="dat-cached-airport"></select>
        </div>
        <input id="dat-airport-file" type="file" accept=".dat" />
        <input id="dat-waypoint-file" type="file" accept=".dat" />
        <small class="dat-fix-source"></small>
        <input id="dat-msa-file" type="file" accept=".dat" />
        <small class="dat-msa-source"></small>
        <input id="dat-airspace-file" type="file" accept=".txt" />
        <small class="dat-airspace-source"></small>
        <p class="dat-cache-status" role="status"></p>
        <p class="dat-status" role="status" aria-live="polite"></p>
        <div class="dat-results nice-scrollbar"></div>
        <footer hidden>
            <div class="dat-spoken-name" hidden>
                <input id="dat-spoken-name" type="text" maxlength="80" />
            </div>
            <div class="dat-controller-names" hidden>
                <label for="dat-approach-radio-name">Approach radio name</label>
                <input id="dat-approach-radio-name" type="text" maxlength="80" placeholder="e.g. Melbourne Approach" />
                <label for="dat-departure-radio-name">Departure radio name</label>
                <input id="dat-departure-radio-name" type="text" maxlength="80" placeholder="e.g. Melbourne Control" />
                <label for="dat-tower-radio-name">Tower radio name</label>
                <input id="dat-tower-radio-name" type="text" maxlength="80" placeholder="e.g. Sydney Tower" />
                <label for="dat-centre-radio-name">Centre radio name</label>
                <input id="dat-centre-radio-name" type="text" maxlength="80" placeholder="e.g. Brisbane Centre" />
            </div>
            <button type="button" class="dat-open">Open imported scope</button>
        </footer>
    </dialog>
    <div class="footer">
        <div id="autocomplete">
            <div id="autocomplete-spacer"></div>
            <div id="autocomplete-ui">
                <div id="autocomplete-popup" class="notSelectable">
                    <div id="autocomplete-suggests"></div>
                </div>
                <div id="autocomplete-footer">
                    <input id="autocomplete-output" size="1" disabled="disabled" />
                    <input id="autocomplete-input" size="15" />
                </div>
            </div>
        </div>
        <input id="command" placeholder="enter aircraft command" />
        <ul class="controls-menu">
            <li class="control-item"><a class="control-icon fast-forwards"></a></li>
            <li class="control-item"><a class="control-icon toggle-pause"></a></li>
            <li class="control-item"><a class="control-icon switch-airport"></a></li>
            <li class="control-item">
                <a class="control-icon"></a>
                <div class="control-item-content">
                    <a class="control toggle-labels active" data-layer="runways"></a>
                    <a class="control toggle-labels" data-layer="procedure"></a>
                    <a class="control toggle-labels" data-layer="approach"></a>
                    <a class="control toggle-labels" data-layer="other"></a>
                    <a class="control toggle-sids"></a>
                    <a class="control toggle-stars"></a>
                    <a class="control toggle-msa"></a>
                    <a class="control toggle-airspace"></a>
                    <a class="control toggle-restricted-areas"></a>
                    <a class="control toggle-terrain active"></a>
                    <a class="control toggle-video-map"></a>
                </div>
            </li>
            <li class="control-item">
                <button type="button" class="control-icon toggle-dat-import">+</button>
            </li>
            <li class="control-item">
                <a class="control-icon"></a>
                <div class="control-item-content">
                    <a class="control" id="toggle-options"></a>
                    <a class="control toggle-speech"></a>
                    <a class="control toggle-traffic"></a>
                </div>
            </li>
            <li class="control-item">
                <a class="control-icon"></a>
                <div class="control-item-content">
                    <a class="control toggle-airport-guide"></a>
                    <a class="control toggle-tutorial"></a>
                    <a class="control js-changelogToggle"></a>
                    <a class="control" id="js-github-external-link"></a>
                </div>
            </li>
            <li class="control-item">
                <a class="control-icon"><div id="score" class="notSelectable">-</div></a>
                <div class="control-item-content wide">
                    <ul id="score-log" class="nice-scrollbar"></ul>
                </div>
            </li>
        </ul>
    </div>
    <div id="airport-switch" class="dialog notSelectable">
        <p class="dialog-title">Select Airport</p>
        <div><input class="search" placeholder="search airports" /></div>
        <div class="dialog-body nice-scrollbar"></div>
    </div>
    <div id="airportGuide-container" class="nice-scrollbar notSelectable">
        <div id="airportGuide-bd" class="js-airportGuide-view"></div>
    </div>
    <div class="changelog-container js-changelogContainer nice-scrollbar notSelectable">
        <h2 class="changelog-version"></h2>
        <p class="js-changelog blackBox"></p>
    </div>
    <div class="js-loadingView"></div>
</div>
`;

function createSyncAssetPromise(assetUrl) {
    const cleanPath = String(assetUrl || '').split('?')[0].replace(/^\/+/, '');
    const fullPath = path.resolve(REPO_ROOT, cleanPath);
    let ok = false;
    let parsedData = null;
    let loadError = null;

    if (cleanPath && fullPath.startsWith(REPO_ROOT) && fs.existsSync(fullPath)) {
        try {
            const raw = fs.readFileSync(fullPath, 'utf8');
            parsedData = JSON.parse(raw);
            ok = true;
        } catch (error) {
            loadError = error;
        }
    } else {
        loadError = new Error(`Asset not found: ${cleanPath}`);
    }

    const deferred = {
        done(cb) {
            if (ok && typeof cb === 'function') {
                cb(parsedData);
            }

            return deferred;
        },
        fail(cb) {
            if (!ok && typeof cb === 'function') {
                cb({}, 'error', loadError ? loadError.message : 'Asset load error');
            }

            return deferred;
        },
        always(cb) {
            if (typeof cb === 'function') {
                cb();
            }

            return deferred;
        },
        then(onFulfilled, onRejected) {
            if (ok) {
                return Promise.resolve(parsedData).then(onFulfilled, onRejected);
            }

            return Promise.reject(loadError).then(onFulfilled, onRejected);
        }
    };

    return deferred;
}

function createStorageMock() {
    const storage = {};

    Object.defineProperties(storage, {
        getItem: {
            enumerable: false,
            configurable: true,
            value: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null)
        },
        setItem: {
            enumerable: false,
            configurable: true,
            value: (key, value) => {
                storage[key] = value;
            }
        },
        removeItem: {
            enumerable: false,
            configurable: true,
            value: (key) => {
                delete storage[key];
            }
        },
        clear: {
            enumerable: false,
            configurable: true,
            value: () => {
                Object.keys(storage).forEach((key) => {
                    delete storage[key];
                });
            }
        }
    });

    return storage;
}

/**
 * Install canonical OpenScope DOM skeleton, JSDOM polyfills, and disk-backed asset loaders.
 *
 * @function installDomAndGlobals
 * @return {object} { $root, rootElement, restore }
 */
export function installDomAndGlobals() {
    const hasOwnDocument = Object.prototype.hasOwnProperty.call(global, 'document');
    const prevDocument = global.document;
    const prevProp = global.prop;
    const prevLocalStorage = global.localStorage;
    const prevZlsa = global.zlsa;
    const hasOwnGtag = Object.prototype.hasOwnProperty.call(window, 'gtag');
    const prevGtag = window.gtag;
    const hasOwnTrackerGtag = Object.prototype.hasOwnProperty.call(EventTracker, '_gtag');
    const prevTrackerGtag = EventTracker._gtag;
    const prevGlobal = window.GLOBAL;
    const prevAircraftController = window.aircraftController;
    const prevGetJSON = $.getJSON;

    const dialogProto = window.HTMLDialogElement && window.HTMLDialogElement.prototype;
    const prevShowModal = dialogProto ? dialogProto.showModal : undefined;
    const prevClose = dialogProto ? dialogProto.close : undefined;
    const elementProto = window.Element && window.Element.prototype;
    const prevScrollIntoView = elementProto ? elementProto.scrollIntoView : undefined;

    global.document = window.document;
    global.prop = {
        canvas: {
            draw_labels: true,
            dirty: true
        }
    };
    global.localStorage = createStorageMock();
    const noopGtag = () => {};
    window.gtag = noopGtag;
    EventTracker._gtag = noopGtag;
    window.GLOBAL = { VERSION: '6.29.0-BETA' };

    if (dialogProto) {
        if (typeof dialogProto.showModal !== 'function') {
            dialogProto.showModal = function showModal() {
                this.setAttribute('open', '');
            };
        }

        if (typeof dialogProto.close !== 'function') {
            dialogProto.close = function close() {
                this.removeAttribute('open');
            };
        }
    }

    if (elementProto && typeof elementProto.scrollIntoView !== 'function') {
        elementProto.scrollIntoView = () => {};
    }

    const existingRoot = window.document.getElementById('e2e-sim-root');

    if (existingRoot && existingRoot.parentNode) {
        existingRoot.parentNode.removeChild(existingRoot);
    }

    const $root = $(E2E_DOM_TEMPLATE.trim());
    $(window.document.body).append($root);

    global.zlsa = {
        atc: {
            loadAsset: ({ url }) => createSyncAssetPromise(url)
        }
    };
    $.getJSON = (url) => createSyncAssetPromise(url);

    let restored = false;

    const restore = () => {
        if (restored) {
            return;
        }

        restored = true;
        $root.remove();
        $('html').removeClass('paused');

        if (dialogProto) {
            if (prevShowModal === undefined) {
                delete dialogProto.showModal;
            } else {
                dialogProto.showModal = prevShowModal;
            }

            if (prevClose === undefined) {
                delete dialogProto.close;
            } else {
                dialogProto.close = prevClose;
            }
        }

        if (elementProto) {
            if (prevScrollIntoView === undefined) {
                delete elementProto.scrollIntoView;
            } else {
                elementProto.scrollIntoView = prevScrollIntoView;
            }
        }

        $.getJSON = prevGetJSON;
        global.zlsa = prevZlsa;

        if (!hasOwnGtag) {
            delete window.gtag;
        } else {
            window.gtag = prevGtag;
        }

        if (!hasOwnTrackerGtag) {
            delete EventTracker._gtag;
        } else {
            EventTracker._gtag = prevTrackerGtag;
        }

        window.GLOBAL = prevGlobal;
        window.aircraftController = prevAircraftController;
        global.localStorage = prevLocalStorage;
        global.prop = prevProp;

        if (!hasOwnDocument) {
            delete global.document;
        } else {
            global.document = prevDocument;
        }
    };

    return {
        $root,
        rootElement: $root.get(0),
        restore
    };
}
