---
name: Gemini TTS fast playback (chunking + queue)
description: How the Read-aloud TTS achieves low latency with natural Gemini voices
---

# Gemini TTS — fast start with natural voices

The `generateContent` TTS API does NOT stream — it returns the whole audio file at once. The Live API (WebSocket) is the only true-streaming option.

**Solution (in `flow-premium/ai-chat.js` Read-aloud / `runTts`):** chunk text into ~280-char sentence groups, generate chunk 0, start playing, prefetch next ~2 chunks in the background. First audio starts in ~2s.

**Why:** keeps natural Gemini voices while killing the multi-minute wait.

## Critical: mimeType handling (was the silent-audio bug)

The Gemini TTS API returns `audio/L16;rate=24000` (after `.toLowerCase()` → `audio/l16;rate=24000`). You MUST wrap the raw PCM bytes in a 44-byte WAV header before playback. The condition must use `.startsWith('audio/l16')` NOT `=== 'audio/l16'` — the exact-match check misses the `;rate=24000` suffix and sends headerless bytes to the Audio element, producing silence.

```js
if (mimeType.includes('pcm') || mimeType.startsWith('audio/l16') || mimeType.startsWith('audio/l-16') || mimeType === '') {
  // build WAV header (44 bytes, 24kHz, mono, 16-bit) then create Blob
}
```

## Real TTS models (as of June 2026)

- `gemini-2.5-flash-preview-tts` — confirmed working, fast
- `gemini-2.5-pro-preview-tts` — fallback, higher quality
- `gemini-3.1-flash-tts-preview` — **does NOT exist**, causes a wasted 404 round-trip

## How to apply

- Stop = `AbortController.abort()` on session controller + pause audio + revoke object URLs.
- Session: `{ stopped, controller, audio, urls, workingModel }` — created synchronously before any `await` so 2nd click = Stop immediately.
- Prefetch promises: `.catch(() => null)` — rejection-safe. If chunk 0 = null → fall back to `speechSynthesis`.
- Style prefix per chunk: `"In a natural, warm, conversational pace: ..."` — only style lever in generateContent TTS.
- Natural voices: Zephyr, Kore, Puck, Aoede via `prebuiltVoiceConfig`.
