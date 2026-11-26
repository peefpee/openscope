# openScope — Project Summary and Local Changes

## Stage 1 implementation log

- 26 November 2026 — Started the Australian airspace importer. The existing parser discards regions containing arcs or circles. The DAT dialog and navigation cache already share the same import path. The baseline AVA run reported the two existing runway-angle failures.
- 26 November 2026 — Integrated OpenAir endpoint arcs, bearing arcs, circles, direction flags, vertical references and special-use classifications with the import dialog and cache. Partial imports show rejection reasons. Fallback CTR and CTA now have separate vertical limits, and the CTA follows the configured sector footprint. The first ten focused importer and VFR tests passed.
- 26 November 2026 — Implemented controller radio names, central Australian pronunciation helpers, simulation-loop handoff wiring, `en-AU` voice selection, the frequency panel, DAT radio-name inputs, and regression tests. Direct AVA now reports only the two pre-existing runway float-equality failures; the dev build succeeds.


- 26 November 2026 — Added self-intersection checks and cached region bounding boxes. Point queries return overlapping controlled shelves and resolve AGL limits against terrain contours, with airport elevation as the fallback. The production build succeeded. All 18 focused importer, airspace model and VFR arrival tests passed. The full AVA run recorded 1,350 passes, the same two baseline runway failures, 17 skipped and 14 todo. Repository-wide lint reported 120 errors and 31 warnings. The new OpenAir parser passed its individual lint check.
- After reconnecting, verified the working tree still contained the spatial index, predictive guidance, CLEARENTRY command and keyboard controls. Recovered the outstanding reporting-point and circuit edits, and connected Australian map-layer filters, hover inspection and predicted entry highlighting to the scope. Integration checks are running.


## Progress as of 26 November 2026

- **Committed on `develop` through `382fb0c87`.** VFR aircraft can accept direct-to instructions for known fixes. An accepted direct-to or heading instruction cancels the VFR orbit, and an altitude instruction updates its target altitude. The commit also expands regression coverage in `test/aircraft/Pilot/VfrArrival.spec.js`.
- **Controller handoffs are wired into the simulation.** The working tree includes airport controller configuration, tower and centre logic, aircraft handoff state, scoring event handlers, and per-frame controller updates. Tower logic includes a missed-transfer go-around. Airport switching resets simulated controller state.
- **Controller radio names are spoken, not written.** `ControllerConfigModel` parses `radioName`, a central resolver supplies verified names for known Australian facilities, and `radioCall()` keeps compact callsigns in the radar log while speaking names such as “Sydney Approach” and “Melbourne Centre”. The frequency panel shows compact IDs, with the spoken name available as a tooltip.
- **Australian phraseology is centralised.** `radioUtilities.js` provides helpers for frequencies, flight levels, squawks, speeds, approaches and procedures; `speech.js` selects an `en-AU` voice via `voice.lang` with English/default fallback.
- **Player-facing checks remain open.** Verify the top-left frequency list, an IFR arrival transferred to tower, a missed transfer triggering a go-around, a VFR arrival remaining outside controlled airspace until authorised, and the spoken output for “Hobart Two Echo Foxtrot”, “Melbourne Two Echo Alpha” and “Walton Approach”.

This checkpoint is based on source inspection and direct AVA runs. The test results in section 7 belong to the earlier audit.

### Historical audit at `fcd2f1767`

The table and sections 1–8 below describe the original comparison with <https://github.com/openscope/openscope> at that revision.

| Item | Value |
| --- | --- |
| Local branch | `develop` |
| Local HEAD | `fcd2f176760362e7fb7c241c40107aa82d79bd8e` — `aus` (Lucius Lam, 2026-11-26) |
| `origin` | `https://github.com/peefpee/openscope.git` (fork; `origin/develop` = local HEAD) |
| Upstream baseline | `https://github.com/openscope/openscope.git`, branch `develop`, commit `485a4c74942ed003ec0ea973e14cbc3cc50bbd2c` ("Merge feature/1922 (#1923)", 2023-01-18) — the direct parent of the local commit |
| Upstream `master` | `6244d0060e31fa09efc49c69822ec5bee2d9e025` (2022-08-20); 83 commits behind upstream `develop` |
| Difference from upstream `develop` | Exactly one local commit: 60 files, **6,249 insertions / 100 deletions** |
| Working tree | Clean before this document was added. `public/` (built output) exists locally but is gitignored, so it is not part of the diff; `summary.md` is the only new untracked file |

All comparisons below are against `upstream/develop` at `485a4c749`, which is the precise point this checkout forked from.

---

## 1. What openScope is

openScope is a free, browser-based **air traffic control (ATC) simulator**. Players control aircraft at real-world airports using text commands: clearing routes, issuing vectors, clearing approaches, managing departures/arrivals, sequencing traffic and handling handoffs, while the simulation enforces separation, airspace, fuel, scoring and phraseology. The production instance is <http://openscope.io>.

The repository contains the full client application, JSON data covering airports/aircraft/airlines, an Express static server, documentation (including command references and per-airport guides), and an AVA test suite.

At this revision `package.json` declares version **6.29.0-BETA**; the newest changelog entry is 6.29.0 (October 1, 2022).

### Scale of the bundled content

| Content | Count |
| --- | ---: |
| Airport definitions (`assets/airports/*.json`) | ~105 (plus load list and schema) |
| Terrain files (`assets/airports/terrain/*.geojson`) | ~78 |
| Aircraft types (`assets/aircraft/*.json`) | ~170 |
| Airlines/fleets (`assets/airlines/*.json`) | ~607 |
| Airport guides (`documentation/airport-guides/*.md`) | 72 ICAO guides plus directory index |
| Test spec files | 83 |
| Client JavaScript modules | 167 |
| Documentation Markdown files | ~91 |

---

## 2. Technology stack

- **Language/runtime:** ES6+ JavaScript (Babel with preset-env, optional chaining, nullish coalescing, object rest/spread, class properties), Node.js. `package.json`/`.nvmrc` pin Node **11.3.0** and npm 6.4.
- **Front end:** HTML5 `<canvas>` radar rendering, jQuery 3.5, Lodash 4.17, Handlebars templates (`gulp-hb`, layouts), LESS stylesheets, `raf` animation loop.
- **Build:** Gulp 4 (`Gulpfile.js`) + Browserify/Babelify, LESS compilation, JSON minification, HTML template generation, Uglify, source maps; `npm run build` (production) and `npm run build:dev`.
- **Server:** Express 4 static server (`public/assets/scripts/server/index.js`), default port 3003; deployment config in `app.json` / `static.json`.
- **Testing:** AVA 1.4 + Sinon 7 + browser-env with Babel register; coverage via nyc 14 and Coveralls. `npm test` runs `nyc ava --concurrency=5`; ESLint 5 (Airbnb config), plus a JSON schema validator (`@openscope/validator`).
- **License:** MIT. Contributions use GitFlow; see `CONTRIBUTING.md` and `documentation/git-flow-process.md`.

---

## 3. Repository layout and architecture

### Top-level directories

- `src/` — source application, Handlebars templates, LESS styles and the Express server (compiled into `public/`).
- `assets/` — authoritative game data: `airports/` (JSON + `terrain/*.geojson`), `aircraft/`, `airlines/`, `autocomplete/`, `tutorial/`, fonts and images.
- `documentation/` — user/developer docs: `commands.md`, `aircraft-commands.md`, `scope-commands.md`, aircraft/airline/airport formats, scoring, separation, spawn patterns, airport guides, etc.
- `test/` — AVA specs mirroring the client tree, plus `_mocks/`, `fixtures/` and `testHelpers/` (browser env, localStorage stubs).
- `tools/` — Gulp task definitions, path/task configuration and asset guides (`tools/README.md`).
- `public/` — generated deployable app (gitignored): `index.html`, `assets/scripts/client/bundle.min.js`, `assets/style/main.min.css`, assembled JSON, guides/changelog and the server JS.
- `.github/workflows/` — CI (Node 11.3): `lint-diff`, build, test + Coveralls on push and pull request.
- Root config: `Gulpfile.js`, `package.json`, `.babelrc`, `.eslintrc`, `.editorconfig`, `.nvmrc`, `.npmrc`, `app.json`, `static.json`.

### Build pipeline (`Gulpfile.js` → `tools/options.js` → `tools/tasks/*`)

`clean` → parallel `build:scripts` + `build:server` + `build:styles` + `markup` → `json:assemble` → `markdown:assemble` → `markdown:changelog` → `copy:dist`:

- **Scripts:** Browserify entry `src/assets/scripts/client/index.js` via babelify → `bundle.js` → optional Uglify (`--prod`) → `bundle.min.js` + source maps.
- **Styles:** `src/assets/style/main.less` → LESS → autoprefixer → clean-css → `main.min.css`.
- **Markup:** Handlebars partials from `src/templates/` (`layout.hbs`, `_footer.hbs`, `_stripView.hbs`, `_airportSwitch.hbs`, `_airportGuide.hbs`, `_datImport.hbs`, `_changelog.hbs`, `_paused.hbs`, `_loadingView.hbs`) → `public/index.html`, injecting version/build date.
- **Data:** all aircraft/airline JSON merged into `aircraft.json` / `airlines.json`; airport guides converted to `guides.json`; latest changelog to `changelog.json`; airport JSON/GeoJSON, autocomplete, tutorial, fonts and images copied (and airport JSON minified, except the load list).

### Client modules (`src/assets/scripts/client/`)

| Area | Responsibility |
| --- | --- |
| `index.js`, `App.js`, `AppController.js` | Browserify entry (raf polyfill), root lifecycle/data fetch, child-controller wiring and animation loop |
| `engine/TimeKeeper.js`, `game/` | Simulation clock, frame delta, pause/timewarp; `GameController`, `GameOptions`, `ScoreController` (penalties/rewards) |
| `airport/` | `AirportController` (registry/switching), `AirportModel`, `AirspaceModel`, `MapCollection`/`MapModel`, `runway/` (runway/relationship models), `dat/` (new DAT import pipeline), `airportGuide/` (guide view) |
| `aircraft/` | `AircraftModel` (physics/flight phases/radio), `AircraftController`, `AircraftCommander`, aircraft type definitions, conflicts, `StripView/`, `Pilot/` (`Pilot`, `ApproachGuidance`, `VfrArrival`), `FlightManagementSystem/` (`Fms`, `RouteModel`, `LegModel`, `WaypointModel`), `ModeControl/ModeController` (autopilot modes) |
| `airline/` | `AirlineController`/`Collection`/`Model`, fleet weights, callsign formats, unique flight numbers |
| `navigationLibrary/` | Fixes, airways, holds, SIDs/STARs, procedure lines, visibility/spoken-name rules |
| `trafficGenerator/` | Spawn patterns, `SpawnScheduler`, pre-spawn construction, JSON validator |
| `canvas/` | `CanvasController` (~2,800 lines): scope, runways, fixes, procedures, radar targets/data blocks, terrain, airspace, maps, range rings, measure tool, themes, dirty/shallow/deep redraw; `CanvasStageModel` (zoom/pan/transforms) |
| `commands/` | `CommandParser`, argument parsers/validators, aircraft/scope command maps and definitions |
| `ui/` | `UiController`, settings/traffic-rate/video-map controllers, tutorial, autocomplete, and (new) DAT import + MSA views |
| `scope/` | `ScopeModel` (handoffs, scratchpad, halos, PTL, data-block moves), `RadarTargetCollection` |
| `InputController.js`, `speech.js` | Mouse/keyboard/command input; Web Speech API readbacks |
| `base/`, `lib/`, `math/`, `utilities/`, `measurement/`, `constants/` | Model base classes and object pool, `EventBus`, flight math, radio/unit helpers, measure tool, shared constants/themes |
| `contentQueue/`, `EventTracker.js` | Prioritised async JSON loading (`zlsa.atc.loadAsset`) and Google Analytics events |
| `info/`, `changelog/` | Airport info readout, sim clock, in-game changelog dialog |

Most shared services are singletons: `EventBus`, `GameController`, `AirportController`, `UiController`, `NavigationLibrary`, `TimeKeeper`, `SpawnScheduler`, `CanvasStageModel`, `NavDataCache`, etc.

### Startup and runtime flow (abridged)

1. `index.js` installs the `raf` polyfill and constructs `App`; `App.js` creates `AppController`/`EventBus` and asynchronously fetches `airportLoadList.json`, the initial airport JSON, then assembled airlines/aircraft, guides and changelog. The initial ICAO comes from `localStorage[ATC_LAST_AIRPORT]` or `DEFAULT_AIRPORT_ICAO`.
2. `AppController.setupChildren()` instantiates, in dependency order: `LoadingView`/`ContentQueue`, `AirportController`, `NavigationLibrary`, `SpawnPatternCollection`, `AirlineController`, `ScopeModel`, `AircraftController`, `ScoreController`, `SpawnScheduler`, `UiController`, `CanvasController`, `InputController`, airport-info/guide and changelog controllers; lifecycle methods fan out to all children and the `requestAnimationFrame` loop drives `updatePre()`/`updatePost()`/`TimeKeeper.update()`.
3. Airports use a flyweight registry: load-list entries are lightweight `AirportModel`s; the selected airport lazily loads its JSON (`assets/airports/<icao>.json`) via `ContentQueue`, then `AirportModel.init()` and `NavigationLibrary.init()` build runways, airspace, maps, fixes and procedures; `EVENT.AIRPORT_CHANGE` resets aircraft/scope/traffic state. Terrain loads only when `has_terrain` is true.
4. `SpawnScheduler` generates aircraft from airport `spawnPatterns` and airline fleets; each `AircraftModel` uses its `Pilot`, FMS and `ModeController` to fly routes, procedures, vectors and clearances.
5. Commands flow through DOM → `InputController` → `CommandParser`/command maps → `AircraftCommander` or `ScopeModel` → `Pilot` → FMS/MCP → aircraft update, with `speech.js` readbacks, strip/radar updates via `RadarTargetCollection`/`StripViewController`/`CanvasController`, and scoring via `ScoreController`.

---

## 4. Gameplay features represented in the code

- Radar scope with maps, runway/fix labels, range rings, terrain polygons and airspace shelves, plus configurable video maps and label layers.
- Text command system with tab autocomplete, aliases and validation (see `documentation/commands.md` and `documentation/aircraft-commands.md`).
- SID/STAR/approach procedures, ILS/RNAV/visual approaches, holds, vectoring, direct-to, speed/altitude restrictions, descent via STAR.
- Departure/arrival coordination, runway assignment, handoffs and scoring, traffic density/rates and time warp.
- VFR traffic and circuit operations (expanded substantially by the local commit — see below).
- Multi-airport data set with per-airport guides, airlines/fleets and aircraft performance models.

---

## 5. Build, run and test commands

```bash
npm install         # install dependencies (pinned for old Node/npm)
npm run build       # gulp build --prod → minified production build in public/
npm run build:dev   # gulp build (development bundle)
npm run start       # node public/assets/scripts/server/index.js (port 3003)
npm run lint        # ESLint over src/assets/scripts/client/**
npm run lint-diff   # lint only changed lines (used by CI)
npm test            # nyc ava --concurrency=5, then coverage reports
npm run report      # cobertura + lcov coverage reports
npm run coveralls   # upload lcov to Coveralls
npm run validator   # JSON schema validation of assets
```

Tests are AVA 1.4 specs (`test/**/*.spec.js`) with Babel register, `browser-env`, in-memory `localStorage` and global-property stubs from `test/testHelpers/`. Mocks/fixtures mirror the client tree; `test/assets/airports.spec.js` validates every bundled airport JSON. nyc instruments `src/assets/scripts/**/*.js` (excluding constants, mocks, fixtures, helpers and `public/`). The GitHub Actions workflows run lint-diff, build, test and Coveralls on Node 11.3.

---

## 6. Changes made relative to upstream `develop`

The entire delta is the single local commit `fcd2f1767` ("aus"). It adds **Australian DAT-import support, VFR/GA circuit flying, a new Sydney airport, new commands and associated tests/docs**. Six areas were changed:

### 6.1 New airport: YSSY — Sydney Kingsford Smith (~3,300 lines)

- `assets/airports/yssy.json` (2,742 lines): AIRAC 2609; ICAO `YSSY` / IATA `SYD`; field elevation 21 ft at S33°56'45.95" / E151°10'37.21"; magnetic variation 13°; 60 NM / FL280 Class C CTR, initial altitude 11,000 ft; default flow 16R departures / 34L arrivals; Sydney Tower/Approach/Control positions.
- Three runway pairs (`07/25`, `16L/34R`, `16R/34L`) with ILS/3° glideslopes, ~62 fixes (including synthetic `SY###` and runway placeholders), 5 SIDs (`AVMOV1`, `OLSEM1`, `KEVIN7`, `TONTO1`, `BOREE5`), 4 STARs (`MARLN6`, `MEPIL4`, `NASHO1`, `RIVET3`), 9 spawn patterns (5 departure/4 arrival, 15,000 ft / 300 kt arrivals), two maps ("Base Map", "Shoreline"), range rings and airline weights dominated by QFA/VOZ/JST.
- `assets/airports/terrain/yssy.geojson` (549 lines): Sydney/Botany Bay terrain polygon (`has_terrain: true`).
- `assets/airports/airportLoadList.json`: registered as `"level": "hard"`, name "Sydney Kingsford Smith International Airport".
- `assets/airlines/jst.json`: Jetstar `default` fleet reorganised (DH8C×2 removed) and a new `domestic` fleet (A320×53 / A321×8).
- `documentation/airport-guides/yssy.md` + directory entry: airport description, airspace, procedures, flow table and positions.

### 6.2 DAT import subsystem (new `src/assets/scripts/client/airport/dat/`, ~924 lines)

The core new feature lets a player import X-Plane CIFP `.dat` files (and related data) at runtime and turn them into a playable scope without editing JSON by hand.

| Module | Lines | Function |
| --- | ---: | --- |
| `parseAirportDat.js` | 125 | Parse `RWY`, `SID`, `STAR`, `APPCH` records; validate DMS coordinates/elevations; build ordered legs/branches with type, course, altitude/speed restrictions and turn/RF data; warn on malformed rows; infer ICAO from filename |
| `parseMsaDat.js` | 25 | Parse `MSA1150` sectors (centre type, clockwise bearings, altitudes, radii) |
| `NavDataCache.js` | 50 | IndexedDB cache (`openscope-navdata` v1) with in-memory fallback when storage fails; global keys `fixes`, `msa`, `au-airspace` and per-airport `airport/<ICAO>` |
| `australianAirspace.js` | 84 | Parse OpenAir `AC/AN/AL/AH/DP` blocks into airspace polygons; convert AGL limits; synthesise 10 NM surface + 40 NM Class C shelves when no definition exists |
| `buildDatApproaches.js` | 80 | Convert `APPCH` branches into flyable routes with IF/TF/DF/CF/RF legs, RF arc approximation, transitions and runway/MAP matching |
| `buildDatProcedures.js` | 183 | Convert SID/STAR branches into openScope procedures with restriction merging, shared-exit deduplication and draw paths |
| `buildDatScope.js` | 199 | Resolve fix ownership/positions, pair reciprocal runways, collect VFR reporting points, and assemble a complete playable scope (maps, fixes, procedures, traffic, spoken names) |
| `buildDatTraffic.js` | 178 | Generate a practice sector (40 NM, 36-point Class C, +18,000 ft ceiling), arrival/departure spawn patterns (8 + 8), vector-entry fallbacks and airline sets |

UI and integration:

- New `ui/DatImportView.js` (199 lines) and `templates/_datImport.hbs` (31 lines): modal with cached-airport picker and four file inputs (airport `.dat`, earth fixes, MSA, airspace), AIRAC parsing, serialised/versioned imports, status/results with warnings and fix-resolution counts, spoken-name field for `Y*` ICAOs, and "Open imported scope".
- New `ui/MsaView.js` (107 lines) plus `#msa-panel` in `src/index.hbs`: MSA centre selector, compass diagram on canvas, inbound-bearing/altitude/radius list and magnetic/true reference.
- `UiController.js`: instantiates/wires both views, four fix-label layer toggles (previously one boolean), hover control menus, and identity-based airport-dialog handling for imported scopes.
- `src/templates/_footer.hbs` and `style/module/controls/_controls.less` (+94/−5): new footer buttons/dialog and panel styling; `MapCollection` gains map exclusion; `_controls.less` adds hover bridges/dropdown repositioning.

### 6.3 VFR/GA arrivals, circuit flying and approach guidance

- New `Pilot/VfrArrival.js` (67 lines): 1 NM orbit clearance outside controlled shelves, VFR reporting-point entry from imported `vfrWaypoints` or cached fixes (radio "N miles <compass> of the field"), orbit tracking, and left/right upwind/crosswind/downwind/base/final circuit points at field + 1,000 ft.
- New `Pilot/ApproachGuidance.js` (105 lines): joins RNAV/visual approaches, synthesises a missing base leg for close-in finals, back-fills glidepath altitudes, captures at 0.8 NM and switches to ILS final-course guidance; requires a unique matching RNAV approach or a named-fix fallback.
- `Pilot/Pilot.js`: `joinApproach()` for `vis`, `rnav` and circuit legs with readbacks; cancels holds/guidance appropriately; `conductInstrumentApproach()` refuses VFR aircraft.
- `AircraftModel.js`: VFR/OUT strip labels, registration-style callsigns for `vh` aircraft, orbit and approach-guidance target modes, `isTrackingOutbound()`/`transferToCentre()` with `AIRSPACE_EXIT`, automatic Centre handoff when outbound, and GA speed/ceiling clamping.
- `AircraftCommander.js`: new `outbound`, `centre` (`center`), `rnav`, `vis`, `octa`, `dw`, `xw`, `base`, `final` handlers; guidance cancellation on heading/direct/hold/reroute commands.
- `AircraftController.js`: `createVfrArrival()` (Australian airports, max 4 VFR aircraft, `vh/lightGA`), registration-aware lookup, airline override in `_buildAircraftProps()`.
- `Fms.js` / `RouteModel.js`: assigned outbound fix, outbound refresh, and ground/airborne route handling for `outbound` clearances.
- `SpawnPatternModel.js`, `SpawnScheduler.js`, `buildPreSpawnAircraft.js`, `spawnPatternModelJsonValidator.js`: `outboundRoutes`/`vectors` pattern keys, non-repeating shuffled route rotation, random vector arrivals, VFR arrival timer (300 s, immediate first spawn), and guards for too-short/invalid routes.

### 6.4 New commands, autocomplete and documentation

Nine new aircraft command definitions (test expectation rises from 32 to 41 map entries):

| Command | Aliases | Effect |
| --- | --- | --- |
| `outbound <fix>` | `outbound` | Set/change a departure's outbound fix; direct-on-course once airborne |
| `centre` | `centre`, `center` | Manual transfer to Centre after outbound tracking |
| `rnav <fix> <rwy>` | `rnav` | Clear a flyable RNAV approach via a unique fix |
| `vis <rwy>` | `vis` | Visual approach / final join |
| `octa` | `octa` | VFR aircraft remain outside controlled airspace |
| `dw <rwy> [l/r]` | `dw` | Join downwind (side remembered) |
| `xw <rwy>` / `base <rwy>` / `final <rwy>` | same | Join crosswind/base/final legs |

Changed files: `commands/aircraftCommandDefinitions.js`, `commands/aircraftCommandMap.js`, `assets/autocomplete/commandAutocompleteConfig.json` (adds `outbound`, `centre`, `rnav`, `vis`), `documentation/aircraft-commands.md` (+40 lines: VH registration addressing, Centre transfers, RNAV/visual/VFR circuit phraseology, airspace import), `documentation/airport-format.md` (`vfrWaypoints` array).

### 6.5 Changes to existing behaviour

- `AirportController.js` / `AirportModel.js`: `openImportedAirport()` bypasses the load list and persistence; wind-listener cleanup on replacement; `controlledShelves` from imported/cached Australian airspace used by `isPointWithinAirspace()`.
- `CanvasController.js`: four radar-label layers instead of one boolean, `NavigationLibrary.isFixVisible()` filtering, airspace class labels and shelf-based drawing, imported "Runways" map tied to the runway layer, corrected unbind handler name.
- `NavigationLibrary.js`: fix groups for procedures/approaches, spoken airport names, phonetic spelling of Australian 5-character approach fixes ("Hobart two echo foxtrot").
- `ScoreController.js`: no airspace-exit penalty after Centre transfer; handoff readbacks name the outbound fix.
- `RadarTargetCollection.js` / `StripViewModel.js`: registration-based lookup and `V`/`I` flight-rule markers.
- `speech.js` / `radioUtilities.js`: "RNAV" spoken as "ar nav"; lower-cased spell-out.
- `math/flightMath.js`: `getOffset()` uses aircraft heading only when explicitly `null`, preserving a 0 rad heading.
- `constants/aircraftConstants.js`: `FLIGHT_RULES` moved here from `AircraftModel` for reuse.
- `TrafficRateController.js`: "VFR arrivals" checkbox only at Australian airports, wired to the scheduler.

### 6.6 Tests added or updated

| File | Coverage |
| --- | --- |
| `test/airport/DatImport.spec.js` (234 lines) | Leg ordering/branches/restrictions, DMS thresholds and reciprocal runways, malformed rows, runway-only Hobart pre-spawn scenario, flyable SID/STAR transitions, RNAV MAP transitions, VFR point reservation |
| `test/airport/MsaDat.spec.js` (24) | Clockwise sectors, radii, malformed-row rejection |
| `test/airport/NavDataCache.spec.js` (30) | Failed IndexedDB writes remain session-usable; retry clears `memoryOnly` |
| `test/aircraft/Pilot/ApproachGuidance.spec.js` (93) | RNAV/visual clearances, heading cancellation, non-ILS landing, "ar nav"/phonetic speech |
| `test/aircraft/Pilot/VfrArrival.spec.js` (39) | AGL-relative fallback shelves, OCTA entry, circuit geometry, parser limits |
| `test/aircraft/AustralianGa.spec.js` (81) | GA fleet selection, registration/suffix addressing, readbacks, phonetic calls |
| `test/aircraft/DepartureHandoff.spec.js` (99) | Outbound validation, auto/manual handoff, vector heading retention, one-shot `AIRSPACE_EXIT` |
| `test/commands/definitions/aircraftCommandMap.spec.js` | New validators/aliases and 41-command count |
| `test/navigationLibrary/NavigationLibrary.spec.js` | Coded-approach fix speech |

---

## 7. Verification performed

- `git diff upstream/develop..HEAD` confirms the single-commit delta above (60 files, +6,249/−100); `git status` was clean before `summary.md` was created.
- Direct AVA run (`./node_modules/.bin/ava --concurrency=5`) under Node 24.12.0: **1,341 passed, 2 failed, 17 skipped, 14 todo**. The two failures are floating-point equality assertions in `test/airport/runway/RunwayModel.spec.js` (`#oppositeAngle` and `.calculateCrosswindAngleForRunway()`); I reproduced them on the untouched upstream parent in a temporary worktree, so they are **pre-existing and unrelated to this commit**.
- `npm test` itself aborts before running tests: `nyc` 14 / `append-transform` is incompatible with Node 24 (`ERR_INVALID_ARG_TYPE`), consistent with the project's Node 11.3.0 pin. Use a Node 11-era toolchain (e.g. via nvm) to run the coverage-wrapped suite.
- No `console.log`/debugger/TODO leftovers were introduced by the commit.

## 8. Known limitations / caveats of the local changes

- Australian behaviour is gated by ICAO prefix checks (`/^Y/i` or `startsWith('Y')`) in six client modules rather than a configurable country flag; VFR arrival limits (4 aircraft), orbit radius (1 NM), 300 s timer, and fallback shelf altitudes are hardcoded.
- `buildDatScope.js` has a hardcoded spoken-airport-name table and default 10/40 NM Class C shelves with zero magnetic variation/wind; `buildDatTraffic.js` hardcodes airline sets by ICAO prefix.
- The five circuit commands (`octa`, `dw`, `xw`, `base`, `final`) are documented/validated but **missing from the autocomplete config**, which only adds the other four new commands.
- `documentation/airport-format.md` still describes DAT `vfrWaypoints` as "for future VFR traffic" although the commit uses them live.
- Imported DAT scopes are not registered in `AirportController.airports`; switching away and back requires re-import, and the airport-list highlight is suppressed for them.
- `NavDataCache.load()` silently ignores IndexedDB failures (falls back to memory), and global fix/MSA/airspace keys are shared across airports, so stale global files can affect all imported scopes.
- YSSY SID `suffix` values are all `"1"` even for `KEVIN7`/`BOREE5` (spawn routes use full procedure IDs, so this is cosmetic).
- No `CHANGELOG.md` entry was added for this large feature set.
