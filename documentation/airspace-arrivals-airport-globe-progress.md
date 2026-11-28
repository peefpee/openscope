# openScope — Airspace-Aware Arrival Spawning & Interactive Airport Globe Progress

**Branch:** `feature/airspace-arrivals-airport-globe`
**Base:** `origin/develop` (`e40f9b6db`)

## 1. Initial Repository Audit

- **Arrival spawning (`SpawnPatternModel.js`, `buildPreSpawnAircraft.js`, `AircraftController.js`)**:
  - `SpawnPatternModel.get altitude()` rounded `_random(min, max)` to the nearest 1,000 ft (`_round(altitude, -3)`), ignoring airport approach airspace ceilings and destroying non-round limits like `8,500 ft` or `FL125`.
  - `SpawnPatternModel._initializePositionAndHeadingForAirborneAircraft` placed arrivals at `waypoints[0]` even when `waypoints[0]` was inside approach-controlled airspace.
  - `SpawnPatternModel.createVectorArrivalEntry()` picked a random bearing at a fixed radius without checking `airport.controlledShelves` or terrain/airspace polygons.
  - `buildPreSpawnAircraft.js` checked `airport.airspace` instead of `airport.controlledShelves` and capped pre-spawn altitude at `18000`.
- **Controller ownership (`AircraftModel.js`)**:
  - Australian IFR arrivals initialized with `CONTROLLER_TYPE.NONE` instead of the airport-specific Centre sector (`YMMM`/`YBBB`).
  - `CONTROLLER_TYPE.CTR` in `_updateAircraftControllability()` was treated identically to transferred departures, which prevented Centre->Approach handoff and marked inbound Centre arrivals removable.
- **Airport catalogue & Classic UI (`Menu.js`, `NavDataCache.js`, `DatImportView.js`, `_sessionMenu.hbs`, `MenuVisualController.js`)**:
  - Classic mode loaded only `assets/airports/airportLoadList.json` (`/^y/i && !disabled`), excluding saved imported airports in `NavDataCache` (`openscope-navdata`).
  - Classic selection used a dropdown / flat card list rather than an interactive 3D globe.

## 2. Modified & Added Files

### Task A — Airspace-Aware Arrival Spawning
- `src/assets/scripts/client/trafficGenerator/ArrivalEntryResolver.js` — Reusable resolver for approach ceiling hierarchy, 2D lateral boundary + 5 NM spawn buffer, inward STAR extension, bounded vector candidate generation, terrain/restricted-area checks, and initial arrival separation.
- `src/assets/scripts/client/trafficGenerator/SpawnPatternModel.js` — Uses `ArrivalEntryResolver` for Australian arrival altitudes, STAR entry placement, vector arrival entries, and pre-spawn entries.
- `src/assets/scripts/client/aircraft/AircraftController.js` — Enforces `ArrivalEntryResolver` on scheduled and pre-spawned Australian IFR arrivals, defers/skips invalid vector spawns rather than spawning inside airspace, preserves non-round altitudes, and initializes outside arrivals under airport-specific Centre control (`CONTROLLER_TYPE.CTR`).
- `src/assets/scripts/client/aircraft/AircraftModel.js` — Supports `CTR -> APP` arrival handoff upon entering approach airspace without duplicate handoffs or premature removal, and uses Australian `"maintaining ..."` initial contact phraseology.

### Task B — Unified Classic Airport Catalogue
- `src/assets/scripts/client/session/airportCatalogue.js` — Merges enabled bundled Australian airports and durably saved `NavDataCache` imports, handles duplicate ICAOs with selectable source (`bundled` / `imported`), excludes memory-only imports, persists `unsaveImportedAirport` in `localStorage` (`openscope.unsavedAirports.v1`) without deleting shared `fixes`/`msa`/`terrain` records, and reconstructs full playable scopes via `buildAirportFromImportedRecord`.
- `src/assets/scripts/client/ui/DatImportView.js` — Marks saved imports in the catalogue, persists `importedAt`/`selectedRunway`/`spokenAirportName`/`controllerSettings`, and emits `catalogue-updated`.
- `src/assets/scripts/client/session/Menu.js` — Loads unified catalogue in Classic mode, supports source filtering (`all`, `bundled`, `saved`), source switching for duplicate ICAOs, and Unsave confirmation workflow.

### Task C — Interactive 3D Airport Globe
- `src/assets/scripts/client/session/visual/worldCoastlines.js` — Simplified public-domain (Natural Earth-derived) world & Australian coastline polylines for offline rendering.
- `src/assets/scripts/client/session/visual/AirportGlobe.js` — Zero-dependency custom WebGL 3D globe focused on Australia (`-25.5, 134.5`) with smooth drag/wheel/touch/pinch controls, Fresnel atmosphere, back-face-culled accessible markers, label deconfliction, WebGL context-loss handling, reduced-motion support, and automatic fallback to an accessible airport list.
- `src/assets/scripts/client/session/visual/MenuVisualController.js` & `index.js` — Manages `AirportGlobe` lifecycle (active only when Classic is visible, paused when hidden/in-session), search focus, and marker selection.
- `src/templates/_sessionMenu.hbs` & `src/assets/style/module/sessionMenu/_pages.less` — Classic toolbar (search, source filters, Reset to Australia), 3D globe stage + legend + fallback list, Selected Airport panel with source switcher, runway preview, metadata, and Unsave confirmation.

### Tests
- `test/trafficGenerator/ArrivalEntryResolver.spec.js` — Regression coverage for approach ceiling hierarchy (`8500`, `10000`, `FL125`, `FL245`), overlying Class A exclusion, aircraft/terrain clamping, irregular STAR extension, bounded vector rejection, initial separation, and Centre->Approach handoff.
- `test/session/AirportCatalogue.spec.js` — Regression coverage for catalogue merging, cache migration, memory-only exclusion, duplicate ICAO handling, unsave persistence, re-import restoration, and scope reconstruction.
- `test/e2e/globeBrowser.cjs` — Playwright Chromium/WebKit test script + 7-screenshot capture flow.
- `test/airport/DatImport.spec.js` & `test/e2e/sessionBundle.cjs` — Updated assertions for airspace-aware outside arrival spawning.

## 3. Verification & Known Limitations

- `npx eslint` on all new modules: 0 errors, 0 warnings.
- `npm run build` (`gulp build --prod`): passed.
- `npm test` (`ava --concurrency=5`): 1454 passed, 17 skipped, 14 todo.
- `npm run test:session`: 2 passed, 0 failed.
- `npm run validator:yssy`: passed.
- **Known limitation (Playwright / native browser tests)**: `playwright` is not installed in this environment (`Cannot find module 'playwright'`), so `test/e2e/sessionBrowser.cjs` and `test/e2e/globeBrowser.cjs` (and the 7 browser screenshots) could not be executed in this environment.
