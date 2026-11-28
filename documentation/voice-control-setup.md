# openScope Voice Control V1 — Setup & Usage Guide

## 1. Enabling Voice Control

1. Open **Settings** from the main menu or pause overlay and expand **Voice control (beta)**.
2. Check **Enable microphone push-to-talk** (disabled by default; opt-in).
3. Click **Test microphone** to grant browser microphone permission and select an input device.
4. Configure your **Push-to-talk key** (default: `ControlLeft`) by clicking the field and pressing your desired key.

## 2. Speech Recognition Providers

- **Browser Speech API (Default)**: Uses `SpeechRecognition` / `webkitSpeechRecognition` (`en-AU`). Minimal setup; may send audio to an external cloud recognition service.
- **Local Whisper (WebGPU / WASM)**: Runs `Xenova/whisper-tiny.en` (~40 MB), `base.en` (~75 MB), or `small.en` (~240 MB) in a Web Worker. Click **Download / Load model** to cache locally; click **Clear cached model** to remove.
- **Custom Whisper Server**: Connects to a local `whisper.cpp`, `Faster-Whisper`, or OpenAI-compatible `/v1/audio/transcriptions` endpoint.

## 3. Optional 9Router LLM Fallback

When enabled, transmissions that the deterministic local parser cannot completely resolve are sent as **text only** (never raw audio) to `POST /api/voice/interpret`.

Configure `.env` on the server (see `.env.example`):

```env
VOICE_LLM_ENABLED=true
VOICE_LLM_BASE_URL=http://localhost:20128/v1
VOICE_LLM_API_KEY=your-key-here
VOICE_LLM_MODEL=your-model
VOICE_LLM_TIMEOUT_MS=3000
```

## 4. Confirmation Modes

- **Auto local / confirm LLM** (default): Fully parsed, validated local clearances execute immediately; LLM-interpreted clearances prompt for confirmation.
- **Auto all unambiguous**: Executes unambiguous validated local and LLM clearances.
- **Always confirm**: Prompts before executing any voice clearance.
