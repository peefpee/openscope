require('regenerator-runtime/runtime');
require('raf').polyfill();

// Some older radar modules access Storage during module initialization. Supply
// the same per-document interface when the browser disallows persistent writes.
try {
    localStorage.setItem('openscope.storageProbe', '1');
    localStorage.removeItem('openscope.storageProbe');
} catch (error) {
    const memory = Object.create(null);
    Object.defineProperties(memory, {
        getItem: { value(key) { return this[key] == null ? null : this[key]; } },
        setItem: { value(key, value) { this[key] = String(value); } },
        removeItem: { value(key) { delete this[key]; } },
        clear: { value() { Object.keys(this).forEach((key) => delete this[key]); } }
    });
    Object.defineProperty(window, 'localStorage', { value: memory, configurable: true });
}

// Load simulator modules only inside a game or their singleton constructors run in the menu.
/* eslint-disable global-require */
const session = window.frameElement && window.frameElement.session;
if (session) {
    window.addEventListener('error', (event) => session.fail(new Error(event.message)));
    window.addEventListener('unhandledrejection', (event) => session.fail(event.reason));
    require('./session/runtime').default(session);
} else {
    require('./util');
    const Menu = require('./session/Menu').default;
    document.getElementById('radar-workspace').remove();
    const menu = new Menu();
    window.addEventListener('pagehide', () => menu.dispose());
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) menu.show('home');
    });
}
