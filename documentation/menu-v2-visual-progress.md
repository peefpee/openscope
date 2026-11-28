# openScope Main Menu V2 — Visual Overhaul Progress

**Branch:** `feature/menu-v2-visual`
**Baseline commit:** `f084a0a1a8fe3b817c892a2e24bf91d7fd46509f`
**Owner:** Agent 1 (Presentation Layer)

## 1. Owned Files Delivered

- `src/templates/_sessionMenu.hbs` — Full-viewport `<dialog id="session-menu">` shell with distinct layouts for `home`, `modes`, `classic`, `setup`, `loading`, `pause`, `confirm`, `settings`, and `reset`, preserving all functional IDs, `data-page` attributes, `data-action` attributes, and form controls.
- `src/assets/style/module/_sessionMenu.less` — Entry stylesheet importing modular Menu V2 LESS partials:
  - `src/assets/style/module/sessionMenu/_tokens.less` — Deep navy/charcoal palette (`#071216`, `#102329`), muted radar-green (`#91E8BC`), secondary cyan (`#8FC6D3`), typography, spacing, and shadow tokens.
  - `src/assets/style/module/sessionMenu/_controls.less` — Primary, secondary, ghost, and danger button variants; custom checkboxes, range sliders, selects, and search inputs.
  - `src/assets/style/module/sessionMenu/_pages.less` — Full-viewport shell, top bar, asymmetric hero landing page, mode selection cards with SVG illustrations, two-column Classic airport browser + radar preview, structured Setup workspace + sticky session summary rail, Settings layout, Loading/Pause/Confirm/Reset cards, responsive breakpoints, and `#session-menu section[hidden] { display: none !important; }`.
  - `src/assets/style/module/sessionMenu/_transitions.less` — Directional `data-page-direction` (`forward`, `backward`, `none`) transitions, overlay fade-and-scale animations, and `prefers-reduced-motion: reduce` support.
  - `src/assets/style/module/sessionMenu/_datImport.less` — Cohesive V2 styling for `#dat-import` (Custom Australian CIFP import dialog) without modifying Codex-owned `_datImport.hbs` or `DatImportView.js`.
- `src/assets/scripts/client/session/visual/`:
  - `RadarBackdrop.js` — Standalone HTML5 Canvas decorative radar background (DPR-aware, responsive resize, range rings, rotating sweep, moving Australian aircraft targets `QFA`/`JST`/`VOZ`/`RXA` with fading trails, airspace boundaries, runway outlines, and coastline contours). Pauses on `document.hidden`, stops on `stop()`, honours `prefers-reduced-motion`, and cleans up all RAF/event listeners on `destroy()`.
  - `MenuVisualController.js` — Non-invasive `MutationObserver` & event enhancer for `#session-menu` that manages `RadarBackdrop` lifecycle, infers `data-page-direction` when absent, syncs interactive `#session-airport-cards` and runway preview SVG with `#session-airport`, updates `#session-setup-summary` and `#session-setup-runway-diagram`, and formats Settings slider readouts.
  - `index.js` — Exports `mountMenuVisuals(menuEl)`, `RadarBackdrop`, and `MenuVisualController`.

## 2. Codex Coordination & Integration Contract

No Codex-owned files were modified. To activate the JS visual enhancements (`RadarBackdrop` and `MenuVisualController`) in the browser bundle, Codex can wire `mountMenuVisuals` in `src/assets/scripts/client/session/Menu.js` (or `src/assets/scripts/client/index.js`):

```js
import { mountMenuVisuals } from './visual';

// In Menu constructor (after this.menu is resolved):
this.visuals = mountMenuVisuals(this.menu);

// Optional on pagehide / teardown:
this.visuals?.destroy();
```

### Optional Presentation Attribute

`Menu.js` may set `this.menu.dataset.pageDirection = 'forward' | 'backward' | 'none'` before toggling `section.hidden` in `show(page)`. When absent, `MenuVisualController` infers direction from page depth (`home -> modes -> classic/custom -> setup -> loading`) and CSS falls back to a clean fade-and-scale transition.

### Preserved Functional Contracts

- Only top-level page containers use `<section data-page="...">` so `Menu.js`'s `querySelectorAll('section')` continues to toggle pages cleanly.
- All existing IDs (`#session-menu`, `#session-title`, `#session-error`, `#session-airport-search`, `#session-airport`, `#session-airport-meta`, `#session-setup-traffic`, `#session-arrivals`, `#session-departures`, `#session-vfr`, `#session-rate`, `#session-mix`, `#session-runways`, `#session-frequencies`, `#voice-enabled`, `#voice-choice`, `#voice-volume`, `#voice-rate`, `#radar-preferences`, `#dat-import`) and `data-action` attributes are preserved.
