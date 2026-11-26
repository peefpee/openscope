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

---

## Performance Benchmark Results (Headless Node v24.12.0, YSSY Mixed IFR/VFR)

| Aircraft | Ticks | Total (ms) | Sim Update (ms/tick) | Prediction (ms/tick) | Est. Headless FPS |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 20 | 106.23 | 5.31 | 4.86 | 60.0 |
| 50 | 20 | 207.70 | 10.39 | 9.87 | 60.0 |
| 100 | 20 | 386.89 | 19.34 | 18.43 | 51.7 |
