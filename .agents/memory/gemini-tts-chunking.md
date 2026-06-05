---
name: Gemini TTS fast playback (chunking + queue)
description: How the Read-aloud TTS achieves low latency with natural Gemini voices
---

# Gemini TTS — fast start with natural voices

The `generateContent` TTS API (`...:generateContent` with `responseModalities:['AUDIO']`) does NOT stream a single request — it returns the whole audio file at once, so a 2000-char block can take minutes. The Live API (WebSocket) is the only true-streaming option.

**Solution used (in `flow-premium/ai-chat.js` Read-aloud / `runTts`):** chunk the TEXT into ~280-char sentence groups, generate chunk 0, start playing it, and prefetch the next ~2 chunks in the background (bounded look-ahead producer/consumer). First audio starts in ~2s instead of waiting for the whole block. Natural voices (Zephyr/Kore/Puck/Aoede via `prebuiltVoiceConfig`) are preserved.

**Why:** keeps the natural Gemini voices the user wanted while killing the multi-minute wait.

**How to apply:**
- Stop = `AbortController.abort()` on the session controller + pause current audio + revoke all object URLs. Session object holds `{stopped, controller, audio, urls, workingModel}`.
- TTS models: try `gemini-3.1-flash-tts-preview` first, fall back to `gemini-2.5-flash-preview-tts`; pin the first working model on the session so concurrent chunks don't all re-probe.
- Audio is base64 PCM 24kHz mono → must wrap in a 44-byte WAV header before playback.
- Style control: prepend a natural-language instruction to each chunk (e.g. "In a natural, warm, conversational pace: ...") — the only style lever in generateContent TTS.
- Fallback: if the API has no key or chunk 0 fails, fall back to browser `speechSynthesis` (instant, free).
