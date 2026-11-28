# Main Menu V2 engineering

## Baseline at f084a0a1a

Production build, 2 bundle scenarios, Sydney validator passed. AVA reported 1442 passed, 17 skipped, 14 todo. ESLint reported 108 errors and 41 warnings. The global reset sets section display to block even when hidden. The existing visible-panel grid selector does not counter that rule on inactive panels. Chromium startup was denied by macOS sandbox Mach port permissions.

The session commit introduced shell-owned preferences, a disposable same-origin radar iframe, and a local score sink (version 1, rulesVersion 1, up to 100 records, no remote service). The prior airspace change falls back to drawing a colliding label. Earlier imported terrain work evicts only in memory. Current work covers navigation isolation, airport previews, import recovery, terrain persistence and regression coverage.

## Menu and import integration

The menu root exposes data-current-page and data-page-direction. Only the active panel can receive focus and dispatch actions. Custom opens the existing separate DAT dialog. The menu root publishes airport-preview and session-summary events with detail, and retains the latest values in airportPreview and sessionSummary. Null means unavailable. Runway thresholds are ordered decimal latitude/longitude pairs. Arrival and departure threshold indices identify the approach end. Bundled terrain is available by terrainUrl and prepared custom geometry by terrain. Listen on the root for these events. The summary contains airport, flow, traffic and the editable controller entries. Real loading stages populate data-loading-stage and the visible status element.

The import dialog emits import-status with state and message and mirrors state on data-import-status. Dropping one file on the dialog targets the airport input. Add data-import-target matching the relevant file input ID for auxiliary drop zones. Terrain generation is optional. Failed DAT validation leaves the previous cache entry intact. The shell recovers from failed and cancelled launches. Both bundle regressions passed after these changes.

Crowded labels now skip an occupied label position after exhausting offsets. Terrain writes prune persistent records in the same IndexedDB transaction. Loading a legacy oversized cache also prunes it. A generated record must match the requested coordinates, coverage, provider, interval, resolution and dataset version.

## Verification and delivery

AVA passed 1444 tests (17 skipped, 14 todo), including the preview and persistent cache regressions. Production build, both built-bundle integration cases and Sydney validator passed. Lint recorded 108 errors and 40 warnings versus 108 and 41 at baseline. The browser test uses real browser contexts, routed local production assets and two desktop viewports. Run npm install --no-save --package-lock=false playwright, npx playwright install chromium webkit, npm run build and npm run test:browser. Set BROWSERS=chromium or BROWSERS=webkit to select one. Chromium failed to launch under macOS sandbox permissions, Playwright WebKit is absent, and a native Safari driver session could not be reached. Native layout, focus and Safari compatibility remain unverified.

Terrain grid options are 11, 21 (default), and 25 samples per side. A 25×25 request takes seven upstream batches versus five at default resolution. The optional #dat-terrain-grid select controls the resolution and participates in cache matching.

An integration checkout combines the engineering work with visual commit e2a520ff7, mounts its enhancements, and consumes the actual threshold geometry. Publishing the engineering changes was blocked by automatic approval review. The local Git bundle contains engineering and integrated branches based on f084a0a1a.

## Combined build

The integrated entry point mounts the visual controller and handles pagehide and back-forward cache restoration. The airport diagram projects airport-relative runway endpoints at a common scale. The import panel exposes the capped sampling options. Bundle regressions specifically assert the decorative backdrop activates and the diagram receives runway geometry. The combined production build, both bundle scenarios and Sydney validator passed. Lint returned the same 108 errors and 40 warnings as the engineering branch.
