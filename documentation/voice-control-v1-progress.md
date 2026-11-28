# openScope — Voice Control V1 & Interface Stability Progress

**Branch:** `feature/voice-control-v1`
**Base:** `feature/airspace-arrivals-airport-globe` (`73f3440e3`, built on `origin/develop` `e40f9b6db`)

## 1. Root Causes of Interface Bugs (Part A)

1. **Bottom-right radar toolbar overflow**:
   - `.control-item-content` in `src/assets/style/module/controls/_controls.less` had `left: 0;` while `.controls-menu` sits on the right side of `.footer`, causing `width: max-content` popups (e.g. "Airspace Depiction", "SID & STAR fixes") to expand off the right edge of the radar iframe viewport.
   - **Fix**: Anchored `.control-item-content` to `left: auto; right: 0; bottom: 100%;` with `max-height`, `overflow-y: auto`, flex item layout, and dynamic `_positionControlPopup()` bounds clamping in `UiController.js` on hover/focus/resize/fullscreenchange.
2. **Airport globe selection bug**:
   - `AirportGlobe.js` set `this.dragMoved = true` when dragging the globe and did not reset it on `_onPointerUp`, causing subsequent marker `click` handlers (`if (this.dragMoved) return;`) to silently reject all selections. Additionally, `Menu.updateClassicMeta()` lacked an async request token to prevent slower metadata fetches from overwriting newer selections.
   - **Fix**: Reset `dragMoved` after `pointerup`, increased drag threshold to `5px` from `pointerdown`, interrupted active camera animations on marker click, and added `metaRequestId` cancellation in `Menu.js`.

## 2. Voice Control V1 Architecture (Part B & C)

- **Parser (`src/assets/scripts/client/voice/parser/`)**:
  - `NumberNormalizer.js`, `CallsignResolver.js`, `WaypointResolver.js`, `PhraseologyGrammar.js`, `AtcParser.js`, `CommandValidator.js`.
  - Normalizes Australian phraseology (`niner`, `fife`, `tree`, `fower`, flight levels, non-round altitudes, headings, speeds, frequencies, runways), resolves live callsigns & waypoints without inventing entities, enforces full-clause understanding before `parsed`, and validates aircraft ownership/limits/VFR rules.
- **Execution & Lifecycle (`src/assets/scripts/client/voice/integration/`, `PushToTalkController.js`, `VoiceController.js`)**:
  - `CommandAdapter.js` maps validated commands to existing openScope commands (`id`, `tlh`/`trh`/`fh`/`fph`, `c`/`d`/`a`, `sp`, `dct`, `ils`/`rnav`/`vis`/`abort`, `contact`/`fca`, `octa`, `dw`/`xw`/`base`/`final`, `dvs`/`cvs`) and runs them through `CommandParser` + `AircraftCommander`.
  - `PushToTalkController.js` supports configurable keyboard PTT (`ControlLeft` default), optional Gamepad button polling, real-time audio level metering, focus-loss cancellation, and stream release on pause/exit.
- **Speech Providers (`src/assets/scripts/client/voice/providers/`)**:
  - `BrowserSpeechProvider.js` (Web Speech API, `en-AU`, single-final guard, external service disclosure).
  - `WhisperBrowserProvider.js` (on-demand `tiny.en`/`base.en`/`small.en` via Web Worker + WebGPU/WASM + Cache API).
  - `WhisperServerProvider.js` (WAV 16 kHz encoding + OpenAI-compatible/whisper.cpp `/v1/audio/transcriptions` endpoint).
- **9Router LLM Fallback (`LlmFallbackClient.js` & `src/assets/scripts/server/voiceInterpret.js`)**:
  - `POST /api/voice/interpret` and `GET /api/voice/status` with server-side API key storage, rate limiting, input size cap, timeout, untrusted-transcript system prompt, and strict schema validation.
- **UI & Settings (`VoiceStatusView.js`, `VoiceSettingsView.js`, `_sessionMenu.hbs`, `storage.js`, `runtime.js`)**:
  - Compact in-game `.voice-status-bar` with collapsible debug & dry-run parser tester; dedicated Voice Control settings in Main Menu V2 Settings.

## 3. Verification & Limitations

- Verified with `npm run build`, `npm test` (AVA), `npm run test:session`, and `npm run validator:yssy`.
- **Browser limitation**: `playwright`, `chromium`, and `safari` CLI binaries are not installed in this environment, so automated native browser screenshots and live microphone capture could not be executed here. See `documentation/voice-control-setup.md` for manual verification steps.
