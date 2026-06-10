---
name: Gemini image generation models
description: Correct Gemini "Nano Banana" image model IDs and which ones are dead
---

# Gemini image generation model IDs (as of June 2026)

All use the `generateContent` endpoint with `generationConfig.responseModalities: ['TEXT','IMAGE']`. Response image comes back as `candidates[0].content.parts[].inlineData` (base64). Imagen models use the `predict` endpoint and are text-to-image only (cannot edit/reference an input image).

**Working native image models ("Nano Banana" family):**
- `gemini-3.1-flash-image` — "Nano Banana 2", fast, GA, best default, up to 4K
- `gemini-2.5-flash-image` — "Nano Banana" original, cheapest, stable, low-latency
- `gemini-3-pro-image-preview` — "Nano Banana Pro", highest quality / complex edits / text rendering

**Why:** Model IDs are non-obvious branding ("nano banana") and the wrong/older names silently fail. Earlier the code shipped fake names (`gemini-3-flash-preview`) and dead ones.

**How to apply:** In `flow-premium/ai-chat.js` the image fallback chain lives in two places (the `models` array ~line 1787 and the `imageModels` array ~line 7092 inside the `gemini-image` mode block). Keep both in sync.

**DEAD — do not use:** `gemini-2.0-flash` and all its image variants (`gemini-2.0-flash-preview-image-generation`, `gemini-2.0-flash-exp`) were **shut down June 1, 2026**. `gemini-2.5-flash-image-preview` shut down Jan 15, 2026 (use the non-preview `gemini-2.5-flash-image`).

**`gemini-2.0-flash` is dead for TEXT/chat too, not just images.** A hardcoded `gemini-2.0-flash` text `generateContent` call returns no candidates (often a quiet 200 with an `error`/empty body), so any `data.candidates?.[0]?...?.text || 'fallback'` pattern silently shows the same canned fallback every turn. Symptom looked like "the chat only ever says one message." **Always route new text/chat calls through the `MODELS` constants (`MODELS.chat` = `gemini-3.5-flash`), never a hardcoded model ID** — and surface `data.error.message` instead of swallowing it into a fallback string so the next failure is diagnosable.

**Geo note:** Some preview image models return 400 "Image generation is not available in your country" — the fallback chain handles this by trying the next model. `gemini-2.5-flash-image` was confirmed reachable (200 OK) from the user's region. All native image generation requires a PAID/billing-enabled key.
