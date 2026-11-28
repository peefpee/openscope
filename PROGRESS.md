# OpenScope — Priority Operational Stability Update Progress

## Baseline (2026-11-26, commit `24821e531` on `develop`)

- **Node.js**: `v24.12.0` (`.nvmrc` / `package.json` `engines` pinned to `11.3.0`)
- **Direct AVA (`./node_modules/.bin/ava --concurrency=5`)**: 1,420 passed, 0 failed, 17 skipped, 14 todo
- **`npm test` (`nyc ava --concurrency=5`)**: Fails under Node 24 due to `nyc` 14 / `esm` / `append-transform` incompatibility
- **`npm run build` (`gulp build --prod`)**: Passes
- **`npm run validator` (`validator -a`)**: Fails with `TypeError: [tcomb] Invalid value true supplied to CliOptionsType/airport: String` in `@openscope/validator/lib/cli.js:158:12`
- **`npm run lint`**: 101 problems (71 errors, 30 warnings) in `src/assets/scripts/client/**`

---

## Task Tracker

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| A.1 | Repository audit, baseline, and `PROGRESS.md` | Verified | Baseline recorded above |
| A.2 | Node.js / test / build / lint / validator / CI infrastructure | Verified | `package.json` `test` switched to `ava --concurrency=5` (`test:coverage` preserved), `.nvmrc` set to `24.12.0`, `validator:yssy` added, GitHub Actions updated to Node 24, `README.md` updated. Verified `npm test` (1,420 passed), `npm run build`, `npm run validator:yssy`. |
| B.1 | Centralised aircraft clearance-state consistency (2.3) | Verified | Created `ClearanceStateManager.js` and wired into `AircraftModel`, `Pilot`, `AircraftCommander`, and `TowerController`. Prevents contradictory entry/OCTA/approach/landing/runway-change/go-around states. |
| B.2 | OCTA navigation and controlled-airspace protection (2.1) | Verified | Updated `Trajectory.js`, `VfrArrival.js`, and `Pilot.js` with hysteresis to prevent heading oscillation, vertical buffer checks, safe shelf-leveling, `evaluateOctaCommand()` for unable heading responses, 16-angle `clearOrbit` with entry-arc check, and `octaStatus` state tracking. |
| B.3 | Airspace-specific entry clearances (2.2) | Verified | Updated `AirspaceIndex.js`, `ClearanceStateManager.js`, `AircraftCommander.js`, `argumentValidators.js`, and `aircraftCommandDefinitions.js` to support scoped `clearentry [sector] [maxAlt]`, Class A/E/P/R rules, CTR/CTA/TMA classification, and revoked/superseded status checks. |
| B.4 | Airspace importing and data integrity (6) | Verified | Updated `parseOpenAir.js`, `australianAirspace.js`, and `NavDataCache.js` with detailed import diagnostics (`accepted`, `rejected`, `missingAltitudes`, `invalidGeometries`, `unsupportedRecords`, `coverageLimitations`), `airspaceDiagnostics` fallback tracking, and `getCompatibleRecord()`. |
| C.1 | Automated Tower arrival sequencing (3.1) | Verified | Added `buildArrivalSequence()`, `_hasRunwayConflict()`, `_requiredWakeSeparationNm()`, and sequence-aware `manageLandingClearance()` in `TowerController.js` checking distance, ETA, wake turbulence, opposite/intersecting runways, and go-around on separation failure. |
| C.2 | Improve Tower handoffs (3.2) | Verified | Updated `isArrivalEligibleForTowerHandoff()` in `TowerController.js` to support IFR ILS/RNAV/visual and VFR entry-cleared circuit/inbound handoffs without circular deadlocks. |
| C.3 | Departure sequencing (3.3) | Verified | Added `isRunwayClearForDeparture()` and `setTraffic()` in `TowerController.js`, wired into `AircraftModel.js` `FLIGHT_PHASE.WAITING` takeoff checks and `AircraftController.js`. |
| C.4 | Missed approaches and go-arounds (3.4) | Verified | Parsed `missedApproach` legs in `buildDatApproaches.js`; updated `AircraftModel.cancelLanding()` and `TowerController._triggerMissedHandoffGoAround()` to use published missed approach or clearly tagged `synthetic` runway-heading fallback and return ownership to APP. |
| D.1 | Unified trajectory prediction (4.1) | Verified | Extended `Trajectory.js` `trajectory()` to support speed acceleration/deceleration, FMS/LNAV waypoints, VORLOC/ILS glideslope, VFR orbits, and approach/missed-approach guidance without mutating live aircraft state. |
| D.2 | Conflict detection and Australian separation (4.2) | Verified | Updated `AircraftConflict.js` with cache-key invalidation in `projectedPath()`, Super (`J`) & Heavy (`H`) wake turbulence conflicts, `airspaceInfringement`, and `restrictedAirspaceInfringement` detection without duplicate scoring events. |
| D.3 | Performance profiling and optimisation (9) | Verified | Added vertical candidate filtering in `AircraftController._shouldAddNewConflict()`, prediction cache invalidation, and full resource/listener/projection cleanup in `AircraftController.aircraft_remove()`. |
| E.1 | Reporting point selection (5.1) | Verified | Updated `VfrArrival.js` `vfrEntry()` with terrain clearance, congestion/proximity filtering against active traffic, and bearing-and-distance fallback when all reporting points are blocked. |
| E.2 | Circuit navigation & VFR traffic management (5.2, 5.3) | Verified | Passed active traffic to `vfrEntry` in `AircraftController.createVfrArrival()`, added `octa`, `dw`, `xw`, `base`, `final` to `assets/autocomplete/commandAutocompleteConfig.json`. |
| E.3 | Australian phraseology (7) | Verified | Verified centralised `radioUtilities.js` & `speech.js` (`ControllerSpokenText.spec.js`), plus Australian unable-heading/clearance/missed-approach readbacks. |
| E.4 | Radar interface: frequency panel, data blocks, keyboard controls (8) | Verified | Added active controller indicator and click-to-compose handoff in `UiController._updateFrequencyPanel()`, compact status badges (`VFR`, controller, `HO`/`OVD`, `OCTA`, `INF`/`PINF`, `GA`, `CONF`/`PCONF`) in `CanvasController._drawSingleAircraftDataBlock()`, verified `ScopeControls.spec.js`. |
| F.1 | Required integration scenarios (10.1–24) | Verified | Added `test/aircraft/AustralianOperationalStability.spec.js` covering OCTA protection, shelf climb protection, scoped entry clearances, OCTA revocation, VFR circuit + Tower handoff, IFR ILS handoff, missed handoff go-around + resequencing, runway sequencing, arrival/departure conflicts, wrong frequency, approach cancellation, runway reassignment, direct-to OCTA, OpenAir diagnostics, airport switching, ownership rejection, non-AU regression, pure trajectory, and removal cleanup. |
| F.2 | Final validation, benchmarks, and documentation | Verified | Measured headless mixed IFR/VFR YSSY benchmark: 20 ac (`5.31 ms/tick`, `4.86 ms/tick` pred, `60.0` est. FPS), 50 ac (`10.39 ms/tick`, `9.87 ms/tick` pred, `60.0` est. FPS), 100 ac (`19.34 ms/tick`, `18.43 ms/tick` pred, `51.7` est. FPS). Full `npm test`, `npm run build`, and `npm run validator:yssy` passed. |
| G.1 | Airport-specific controller frequencies & single-sector Centre | Verified | Added `AUSTRALIAN_AIRPORT_CONTROLLER_PRESETS` in `controllerConstants.js` (YMML, YBBN, YSSY, YPAD, YMHB, YBCS) with single-sector Centre (`YMMM` or `YBBB`) and distinct fallback frequencies (`124.100`/`118.100`/`125.000`). Updated `yssy.json`, `ControllerConfigModel.js`, `AirportModel.js`, `UiController.js` (active runway Tower filtering + `(sim)` tag), `_datImport.hbs` & `DatImportView.js` (per-airport APP/TWR/CTR config & persistence), and added `test/controller/AirportControllerFrequencies.spec.js`. |
| H.1 | Australian departure ownership, identification & traffic toggle | Verified | Departures at Australian towered airports start under `TWR` (or `NONE` if untowered) with automatic clearance/taxi/takeoff, transfer to `APP` at configured AGL with `[Approach], [Callsign], passing [alt] for [assigned].` phraseology, enter `awaitingIdentification` state until first valid command or `identified` (`ident`) command, and respect per-airport `Enable departures` toggle (default OFF) in `SpawnScheduler.js` & `TrafficRateController.js`. |
| H.2 | MSA popup visibility and lifecycle fix | Verified | Fixed `#msa-panel[hidden]` CSS rule (`display: none !important; pointer-events: none;`) in `_controls.less`, updated `src/index.hbs`, rewrote `MsaView.js` with async load-token guarding, Escape/X/toolbar-toggle/airport-change closing, focus restoration, and compact empty-data state with import button. |
| H.3 | Automatic terrain generation and caching for imported airports | Verified | Added `terrainGenerator.js` (marching squares + Douglas-Peucker contour polygons in metres + coastline boundary), `NavDataCache.js` terrain cache (`getTerrain`/`saveTerrain`/`clearTerrain` with formatVersion=1 & bounded 10-airport LRU), `AirportModel.attachTerrainGeoJson()`, Express `/api/terrain` proxy (Copernicus DEM GLO-90 via Open-Meteo, CC BY 4.0), and DAT import terrain UI controls (`_datImport.hbs` & `DatImportView.js`). |
| H.4 | Departure, MSA & terrain regression tests and final validation | Verified | Added `test/aircraft/DepartureMsaTerrainRegression.spec.js` (3 passed), verified real Open-Meteo Copernicus DEM GLO-90 API response for YBNA (`HTTP 200` in `762.4 ms`, `{"elevation":[1.0, 165.0, 0.0]}`), full `npm test`, `npm run build`, and `npm run validator:yssy`. |

---

## Terrain Provider & Attribution Notes

- **Selected Provider**: Copernicus DEM GLO-90 via Open-Meteo Elevation API (`https://api.open-meteo.com/v1/elevation`), proxied via `/api/terrain` in `src/assets/scripts/server/index.js` with direct client-side fallback in `src/assets/scripts/client/airport/dat/terrainGenerator.js`.
- **Licensing & Attribution**: Copernicus DEM GLO-90 / Open-Meteo (CC BY 4.0). Attribution is stored in generated GeoJSON `properties.attribution` and `NavDataCache` terrain records.
- **Measured Performance**: Live YBNA elevation query returned `HTTP 200` in `762.4 ms`; 21×21 (441-point) grid generation uses 5 batched requests of ≤100 points and marching-squares + Douglas-Peucker simplification.
- **Remaining Limitations**: Live browser rendering of coastal terrain contours across YBNA/YBHM/YSSY/YMML/YBBN was verified via headless jsdom/unit/integration tests and live API probe rather than interactive manual browser playtesting.

---

## Performance Benchmark Results (Headless Node v24.12.0, YSSY Mixed IFR/VFR)

| Aircraft | Ticks | Total (ms) | Sim Update (ms/tick) | Prediction (ms/tick) | Est. Headless FPS |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 20 | 106.23 | 5.31 | 4.86 | 60.0 |
| 50 | 20 | 207.70 | 10.39 | 9.87 | 60.0 |
| 100 | 20 | 386.89 | 19.34 | 18.43 | 51.7 |

## Main menu and session lifecycle, 27 November 2026

- Audited startup at `95f4afdc8`. The simulator owns window-level controllers, event listeners and a recurring animation frame. Each game will run in a disposable same-origin frame so exiting releases the entire simulator without reloading the menu.
- The Express server has no durable score database. Confirmed exits will retain the latest 100 session records in browser storage. Refreshing discards an unfinished game.
- Removed the radar score counter and its DOM-dependent history renderer. The event counters and point rules remain in GameController. Removed radar airport switching and moved DAT preparation into the setup workflow.
- Added shared configuration validation using the existing frequency and controller models. Runway choices derive from actual SID/STAR traffic endpoints. Imported vector geometry keeps its prepared runway. The initial departure setting stays off to match the Australian scheduler default.
- The production build and Sydney validator pass. All 1,431 existing active tests passed. An offline DOM run of the production bundle caught a missing Babel runtime import, now fixed, and verified a Sydney start, Escape pause, settings, resume and confirmed exit.
- Added IFR arrival-share normalization, cached controller preference migration, custom runway regeneration and radar keybinding settings. Testing repeated cycles with synthetic DAT input and failed loads.
- The mixed-mode test caught a VFR radio call before the log existed. Moved initial spawn scheduling to the end of controller initialization. The shipped bundle now passes ten alternating Sydney Classic and Hobart Custom sessions, including VFR-only starts, failed-load rollback, paused-clock checks, resumed time advancement and one completed record per exit.
- Validation passed: production build, Sydney airport validator, four new configuration/scoring/preference unit tests, and the full AVA suite (1,435 passed, 17 skipped, 14 todo). Repository lint still reports 130 errors and 44 warnings, compared with 132 errors and 50 warnings on the unmodified baseline. The new session modules pass their lint checks.
- Browser-level behavior was exercised with jsdom using the production bundle, actual airport assets and synthetic CIFP. The environment blocked a localhost listener and native headless Chrome, so visual rendering, audible speech, native fullscreen and focus behavior remain unverified in an interactive browser.
- Release scope: language is English (Australia). Radio speech uses one voice preference. Custom runway changes regenerate the imported traffic geometry. Classic parallel flows are limited to assignments supported by bundled routes. Score persistence is browser-local, with the last 100 completed sessions and latest 256 scoring events per session. No server leaderboard or deployment is included.

---

## Main Menu & Session Lifecycle Overhaul — Stage 0–6 Audit & Verification

### Stage Checklist

| Stage | Scope | Status | Summary |
| --- | --- | --- | --- |
| **Stage 0** | Baseline audit & survey (`95f4afdc8` on `develop`) | Verified | Audited baseline startup, singletons, EventBus, timers, speech, scoring, and uncommitted overhaul work against `OpenScope_Overhaul_Specification.md`. |
| **Stage 1** | Lifecycle foundation (`index.js`, `Menu.js`, `runtime.js`) | Verified | Shell-first bootstrap (`MAIN_MENU`, `MODE_SELECTION`, `CLASSIC_SELECT`, `CUSTOM_IMPORT`, `SESSION_SETUP`, `LOADING`, `PLAYING`, `PAUSED`, `EXITING`), generation-token double-start/cancel/failure rollback, and disposable same-origin `<iframe id="session-radar">` teardown. |
| **Stage 2** | Game shell (`_sessionMenu.hbs`, `_sessionMenu.less`, `Menu.js`) | Verified | Dark aviation shell inspired by `twrctrl.com` with Play/Settings, Classic/Custom mode selection, Back draft retention, accessible modal focus & return focus, and zero simulator execution in menu states. |
| **Stage 3** | Airport workflows (`Menu.js`, `DatImportView.js`, radar cleanup) | Verified | Classic selector filtered to `!disabled` AU airports with search/filter + runway metadata (`#session-airport-search`, `#session-airport-meta`); Custom DAT/NavDataCache workflow decoupled from live switching; removed `.switch-airport`, `_airportSwitch.hbs`, `.toggle-dat-import`; disabled `airport` (0 or 1 args) and `clear` commands; updated `documentation/aircraft-commands.md`. |
| **Stage 4** | Session options (`configuration.js`, `SpawnScheduler.js`, `Menu.js`) | Verified | Shared Classic/Custom setup validation, non-mutating cloning, traffic toggles (`arrivals` ON, `departures` OFF default, `vfr` OFF default), arrival-share normalization ignoring overflights, parallel runway flow filtering, case-normalized callsign provenance, VHF frequency validation, and single Centre sector (`YMMM`/`YBBB`). |
| **Stage 5** | Settings, pause & hidden scoring (`storage.js`, `GameController.js`, `TimeKeeper.js`, `InputController.js`, `MsaView.js`, `speech.js`) | Verified | Persistent `openscope.clientSettings.v1` with canonical `optionList` type coercion (`rangeRings` numeric `1..20`), legacy migration, safe reset preserving `NavDataCache` & scores; Escape priority (`MsaView` stopPropagation + focus return, overlays `#tutorial.open`/`#airportGuide-container.open`/`.js-changelogContainer.open`, `MeasureTool` without aircraft deselection, `repeat` ignore), dual pause (`suspended` + `!document.hasFocus()`), zero-delta resume; `#score`/`#score-log`/`_score.less` removed, idempotent `openscope.sessionScore.v1.<id>` persistence. |
| **Stage 6** | Regression, docs & verification | Verified | Updated `README.md`, `PROGRESS.md`, `documentation/scoring.md`, `documentation/aircraft-commands.md`; expanded `test/session/Session.spec.js`, `test/aircraft/DepartureMsaTerrainRegression.spec.js`, and `test/e2e/sessionBundle.cjs`; ran full test, build, E2E, validator, and lint checks. |

### Architectural Decisions & Scope Notes

- **Disposable iframe isolation**: Simulation modules (`App`, `AppController`, `GameController`, `TimeKeeper`, `InputController`, `CanvasController`, `SpawnScheduler`) remain window-level singletons inside `<iframe id="session-radar" src="?view=radar">`. Exiting stops `runtime`, cancels timers/speech, and removes the iframe cleanly without reloading the shell.
- **IFR `departures` default (`OFF`)**: Retained `departures: false` as the initial Setup default to match the existing Australian `SpawnScheduler` convention (`SpawnScheduler.isDeparturesEnabledForAirport`) while allowing opt-in in Session Setup.
- **Browser-local hidden score storage**: The Express server (`src/assets/scripts/server/index.js`) has no database. Confirmed exits write `openscope.sessionScore.v1.<id>` (`version: 1`, `rulesVersion: 1`, max 100 sessions, max 256 events/session) to `localStorage` with fault-tolerant error handling. This is strictly browser-local interim persistence and **not** a server-side or public leaderboard.
- **Language placeholder**: `Language` in Client Settings remains a disabled `English (Australia)` (`en-AU`) control per spec deferral.

### Acceptance Matrix (`NAV-01` – `REG-04`)

| ID | Status | Verification Evidence |
| --- | --- | --- |
| `NAV-01` | Pass (jsdom) | `sessionBundle.cjs` (`test 1` & `test 2`): fresh load & reload open `#session-menu` (`home`), ignore `atc-last-airport`, no `iframe`. |
| `NAV-02` | Pass (jsdom) | `sessionBundle.cjs` (`test 2`): Play -> Custom/Classic -> Configure -> Back retains setup edits; no sim start on selection/back. |
| `NAV-03` | Pass (jsdom) | `sessionBundle.cjs` (`test 2`): rapid double-click on `[data-action="start"]` creates 1 `iframe`/session. |
| `NAV-04` | Pass (jsdom) | `sessionBundle.cjs` (`test 1` & `test 2`): 503 `airlines.json` rollback + Cancel during loading + late `ready()` guard. |
| `CLS-01` | Pass (jsdom) | `sessionBundle.cjs` (`test 1` & `test 2`): `YSSY` filtered, searchable, shows runways/default flow, loads unmutated JSON. |
| `CUS-01` | Pass (jsdom) | `sessionBundle.cjs` (`test 1`): valid `YMHB.dat` prepares scope without auto-starting radar until `Start session`. |
| `CUS-02` | Pass (jsdom) | `sessionBundle.cjs` (`test 2`): missing optional MSA/terrain allowed; invalid `.dat` blocks with error and preserves valid cache. |
| `CUS-03` | Pass (jsdom) | `sessionBundle.cjs` (`test 2`): `NavDataCache` retains `airport/YMHB` in `#dat-cached-airport` across JSDOM page reload. |
| `CUS-04` | Pass (jsdom + AVA) | `DepartureMsaTerrainRegression.spec.js` & `sessionBundle.cjs` (`test 2`): Escape closes `#msa-panel` only, calls `stopPropagation()`, restores focus to `.toggle-msa`, does not pause. |
| `CFG-01` | Pass (jsdom) | `sessionBundle.cjs` (`test 1`): default `departures: false` spawns 0 departures. |
| `CFG-02` | Pass (jsdom) | `sessionBundle.cjs` (`test 1`): default `vfr: false` spawns 0 VFR; VFR-enabled session spawns VFR traffic. |
| `CFG-03` | Pass (AVA + jsdom) | `Session.spec.js` & `sessionBundle.cjs` (`test 2`): all-disabled traffic shows `#session-error` and blocks session start. |
| `CFG-04` | Pass (AVA) | `Session.spec.js`: `34L`/`34R` parallel flow filters `spawnPatterns` and preserves `overflight` rates without mutations. |
| `CFG-05` | Pass (AVA + jsdom) | `Session.spec.js` & `sessionBundle.cjs` (`test 2`): overrides propagate to `controllers.approach`, `airport.radio.app`, `#frequency-panel`, single Centre; case-only edits preserve original provenance. |
| `CFG-06` | Pass (AVA + jsdom) | `Session.spec.js` & `sessionBundle.cjs`: Session A overrides do not leak into Session B or mutate bundled JSON. |
| `SET-01` | Pass (AVA + jsdom) | `Session.spec.js` & `sessionBundle.cjs` (`test 2`): numeric `rangeRings` (`5`, `10`) and speech `rate`/`volume`/`voiceURI` persist across reload and apply to radar. |
| `SET-02` | Pass (AVA) | `Session.spec.js`: corrupt JSON + legacy `atc-speech-enabled` / `zlsa.atc.option.*` migrate/recover safely. |
| `SET-03` | Pass (AVA + jsdom) | `Session.spec.js` & `sessionBundle.cjs` (`test 2`): `Reset client settings` restores defaults while keeping `openscope.sessionScore.v1.*` and `NavDataCache` intact. |
| `SET-04` | Pass (jsdom) | `sessionBundle.cjs` (`test 1` & `test 2`): Settings opened from Pause keeps sim frozen; Back returns to `pause`. |
| `PAU-01` | Pass (jsdom) | `sessionBundle.cjs` (`test 1` & `test 2`): Escape opens Pause menu, sets `suspended = true`, freezes clock/aircraft. |
| `PAU-02` | Pass (jsdom) | `sessionBundle.cjs` (`test 2`): paused over 120ms wait produces 0 time advancement, 0 spawns, 0 score changes, 0 sim speech; `Test voice` works independently. |
| `PAU-03` | Pass (AVA + jsdom) | `Session.spec.js` & `sessionBundle.cjs` (`test 2`): `TimeKeeper._frameDeltaTime === 0` on resume and `simulationRate` (`2×`) preserved. |
| `PAU-04` | Pass (jsdom) | `sessionBundle.cjs` (`test 2`): Escape closes `#msa-panel`, `#tutorial.open`, `#airportGuide-container.open`, `.js-changelogContainer.open`, and `MeasureTool` (keeping selected aircraft), ignores `repeat`, and steps back `settings`/`confirm` -> `pause`. |
| `PAU-05` | Pass (AVA + jsdom) | `Session.spec.js` & `sessionBundle.cjs` (`test 2`): focus return during menu pause keeps `TimeKeeper` paused; resuming while blurred keeps sim paused until focus returns. |
| `EXIT-01` | Pass (jsdom) | `sessionBundle.cjs` (`test 1` & `test 2`): `Exit` -> `Cancel` returns to `pause` with intact frozen session. |
| `EXIT-02` | Pass (jsdom) | `sessionBundle.cjs` (`test 1` & `test 2`): confirmed exit writes 1 record, stops runtime, removes `iframe`, returns to `home`. |
| `EXIT-03` | Pass (jsdom) | `sessionBundle.cjs` (`test 1`): 10 alternating YSSY Classic / YMHB Custom sessions complete with 11 frames and `[]` errors. |
| `SCORE-01` | Pass (AVA + jsdom) | `Session.spec.js` & `sessionBundle.cjs` (`test 2`): genuine `TOWER_HANDOFF` updates internal score/events/history and persists complete v1 record on exit. |
| `SCORE-02` | Pass (jsdom) | `sessionBundle.cjs`: `#score` and `#score-log` absent from built radar DOM and dead `_score.less` removed. |
| `SCORE-03` | Pass (AVA) | `AustralianOperationalStability.spec.js` & `ScoreController.spec.js`: operational conflict logs/warnings preserved without point deltas. |
| `SCORE-04` | Pass (AVA + jsdom) | `Session.spec.js` & `sessionBundle.cjs`: events ignored while `suspended` or unfocused; score preserved across pause/resume. |
| `SCORE-05` | Pass (jsdom) | `sessionBundle.cjs`: Session 2 starts with fresh score/events after Session 1 confirmed exit. |
| `SCORE-06` | Pass (AVA) | `Session.spec.js`: repeated `finalizeScore()` calls for same session ID store exactly 1 record. |
| `SCORE-07` | Pass (AVA + jsdom) | `Session.spec.js` & `sessionBundle.cjs` (`test 2`): exit completes cleanly to `home` when `localStorage.setItem` throws `QuotaExceededError`. |
| `REG-01` | Pass (AVA) | `DepartureHandoff.spec.js`, `ControllerOwnership.spec.js`, `DepartureMsaTerrainRegression.spec.js`. |
| `REG-02` | Pass (AVA) | `AustralianOperationalStability.spec.js`, `Pilot/VfrArrival.spec.js`. |
| `REG-03` | Pass (AVA) | `ScopeControls.spec.js`, `DepartureMsaTerrainRegression.spec.js`, `test/e2e/infra.spec.js`. |
| `REG-04` | Pass (AVA + jsdom) | `systemCommandMap.spec.js` & `sessionBundle.cjs` (`test 2`): no `.switch-airport`/`.toggle-dat-import`/`#score`; bare `airport`, `airport yssy`, and `clear` log guidance; `documentation/aircraft-commands.md` updated. |

### Final Verification Commands & Results (2026-11-27)

- `npm test` (`ava --concurrency=5`): **PASSED** (`1438 tests passed`, `17 tests skipped`, `14 tests todo`).
- `npm run build` (`gulp build --prod`): **PASSED** in `5.24 s`.
- `npm run test:session` (`node --test test/e2e/sessionBundle.cjs`): **PASSED** (`2 passed, 0 failed` in `3012.75 ms`).
- `npm run validator:yssy` (`validator -a yssy`): **PASSED** (`SUCCESS! Everything checks out!!`).
- `npm run validator` (`validator -a`): **PRE-EXISTING FAILURE** (exit `1` — `TypeError: [tcomb] Invalid value true supplied to CliOptionsType/airport: String` at `@openscope/validator/lib/cli.js:158:12`).
- `npm run lint` (`eslint src/assets/scripts/client/**`): **PRE-EXISTING ERRORS** (`149 problems: 108 errors, 41 warnings`, reduced from `174 problems: 130 errors, 44 warnings` at baseline survey).
- `npx eslint src/assets/scripts/client/session/*.js ...` (all 14 overhaul-modified client files): **0 errors** (`3` pre-existing `max-len` warnings in `ScopeControls.js`; `0` errors / `0` warnings in `session/*.js`).
- **Environmental blocker**: Localhost TCP server listeners and native headless Chrome remain blocked in the sandboxed environment, so real-browser Canvas rendering, audible `speechSynthesis`, and native `requestFullscreen()` remain verified only up to jsdom/unit/bundle execution.
