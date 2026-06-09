---
name: Antigravity API integration
description: How to call the Gemini Interactions API (Antigravity agent) from the extension.
---

## The API is real
Antigravity appears in the user's AI Studio rate limits under "Agents" category: 200 RPM, 300K TPM, 10K RPD. It IS available on prepaid keys.

## Endpoint
```
POST https://generativelanguage.googleapis.com/v1beta/interactions
```

## Required headers
```
Content-Type: application/json
x-goog-api-key: <USER_API_KEY>
Api-Revision: 2026-05-20
```

## Request body
```json
{
  "agent": "antigravity-preview-05-2026",
  "input": "...",
  "environment": "remote"
}
```
To resume a previous session (same Linux sandbox + files), add:
```json
"interaction_id": "<previousId>"
```

## Response shape (best guess — handle all fields)
```json
{
  "id": "...",
  "output_text": "...",
  "name": "interactions/..."
}
```
Extract ID via: `data.id || data.interaction_id || data.name.split('/').pop()`
Extract text via: `data.output_text || data.text || data.response || data.candidates?.[0]?.content?.parts?.[0]?.text`

## Session persistence
Save the returned ID to `chrome.storage.local` as `antigravity_interaction_id`. Pass it on subsequent calls to continue editing the same sandbox.

## Timeout
Use `AbortSignal.timeout(300000)` — agent can take up to 5 minutes.

## Preview URL
Ask the agent to output: `PREVIEW_URL: https://...` on its own line. Extract with regex:
```js
outputText.match(/PREVIEW_URL:\s*(https?:\/\/[^\s\n]+)/i)
```

## Manifest CSP
`frame-src` must include Google Cloud hosting domains for the preview iframe:
- `https://*.run.app` — Cloud Run
- `https://*.web.app` — Firebase Hosting
- `https://*.firebaseapp.com`
- `https://*.appspot.com`
- `https://*.googleusercontent.com`
- `https://*.cloud.google.com`

**Why:** Antigravity provisions a real Linux sandbox and may serve the built app at one of these domains.

**How to apply:** When wiring Antigravity build results, call `renderLivePreview(outputText)` to extract the HTML code block. If `previewUrl` is also returned, show an "Open Live Preview" button linking to it.
