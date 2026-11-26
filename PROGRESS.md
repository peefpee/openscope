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
| B.1 | Centralised aircraft clearance-state consistency (2.3) | Pending | |
| B.2 | OCTA navigation and controlled-airspace protection (2.1) | Pending | |
| B.3 | Airspace-specific entry clearances (2.2) | Pending | |
| B.4 | Airspace importing and data integrity (6) | Pending | |
| C.1 | Automated Tower arrival sequencing (3.1) | Pending | |
| C.2 | Improve Tower handoffs (3.2) | Pending | |
| C.3 | Departure sequencing (3.3) | Pending | |
| C.4 | Missed approaches and go-arounds (3.4) | Pending | |
| D.1 | Unified trajectory prediction (4.1) | Pending | |
| D.2 | Conflict detection and Australian separation (4.2) | Pending | |
| D.3 | Performance profiling and optimisation (9) | Pending | |
| E.1 | Reporting point selection (5.1) | Pending | |
| E.2 | Circuit navigation & VFR traffic management (5.2, 5.3) | Pending | |
| E.3 | Australian phraseology (7) | Pending | |
| E.4 | Radar interface: frequency panel, data blocks, keyboard controls (8) | Pending | |
| F.1 | Required integration scenarios (10.1–24) | Pending | |
| F.2 | Final validation, benchmarks, and documentation | Pending | |
