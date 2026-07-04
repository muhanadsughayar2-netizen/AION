---
name: Veo native video extend vs frame-capture continuation
description: How to properly continue/extend a Veo-generated video so audio and motion stay continuous, and why the old approach caused music cuts.
---

Google's Gemini API has a real "extend video" feature for Veo 3.1 / Veo 3.1 Fast only (not Lite, not 3.0, not 2.0): call `generate_videos` again passing the actual previous video object (`instances[0].video = { uri, mimeType }`, from the polled operation's response) instead of an image, with `resolution: '720p'`. Google appends +7 seconds and returns ONE combined, already-stitched video — no client-side joining needed. Limits: input video ≤141s, up to 20 extensions per video, extended video stored 2 days (timer resets each time it's referenced).

**Why this matters:** a naive "continuation" built by capturing the last frame as a static image and generating a brand-new image-to-video clip looks similar to the old ending but is NOT actually continuous — it's two independent generations (each with their own independently-generated music) glued together client-side (canvas + MediaRecorder). That architecture is why music/audio hard-cuts between "extended" segments — there's no way to make two separately-generated audio tracks line up in rhythm, because Google never intended them to connect. Real extend avoids this because Google generates the continuation audio/motion using the actual prior video as context, then stitches server-side.

**How to apply:** when building any "continue/extend video" feature that uses Veo, always try to pass the model the actual generated video reference (extracted from `response.generateVideoResponse.generatedSamples[0].video.uri` or similar per Google's REST shape) and only offer the feature when the active model is Veo 3.1 or Veo 3.1 Fast. Fall back to frame-capture/image-to-video only for models that don't support native extend. Track cumulative duration and extension count against the docs' caps (141s / 20 extensions).
