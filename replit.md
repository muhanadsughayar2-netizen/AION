# SnapToAI - Multi-Screenshot to AI Chrome Extension

## Overview
SnapToAI is a privacy-first, client-side Chrome Extension (Manifest V3) designed to streamline capturing multiple screenshots and uploading them in batches to AI chat platforms like ChatGPT, Claude, and Grok. It temporarily stores up to 10 screenshots in browser session storage and operates without any backend server for core screenshot functionalities. The extension features a "Capture Mode" for taking screenshots and an "Upload Mode" that auto-detects AI chat sites for batch-uploading.

Key capabilities include simplified annotation tools, custom sticker templates, advanced PDF export options, drag & drop reordering, multi-select operations, individual snapshot management, and full multi-language support (55 Chrome-supported languages). The project aims to provide a comprehensive tool for visual information sharing with AI, enhancing productivity and communication.

## User Preferences
Preferred communication style: Simple, everyday language.
Branding: Changed from "Flow" to "SnapToAI"
Logo Display: "Snap To AI" (with spaces for premium look)
Logo: Keep camera emoji (📸) in logo

## System Architecture

### UI/UX Decisions
The extension features a glassmorphism dark theme for its popup interface. The landing page utilizes a glassmorphism design with a responsive, mobile-first approach, elegant text badges, and professional styling, available in 55 languages. A cross-surface design-system unifies color tokens, typography, motion, spacing, focus, and brand color. Global accessibility polish ensures a shared focus ring on every interactive element and honors `prefers-reduced-motion: reduce`.

### Technical Implementations
The landing page implements a robust SEO strategy with separate, pre-rendered HTML files for each of the 54 supported languages, utilizing proper `lang` and `dir` attributes, canonical URLs, and `hreflang` tags. An XML sitemap and `robots.txt` are configured. The extension is built as a Manifest V3 Chrome Extension. The Flask backend (`app.py`) hosts the landing page plus all subscription, auth, admin, and institution APIs against a PostgreSQL database. Branding is pushed to the extension via the `/api/subscription/status` JSON response.

### Feature Specifications
The extension supports capturing, annotating, organizing (reordering, multi-select), and exporting screenshots. It provides distinct "Capture Mode" and "Upload Mode" functionalities, including region-selected "Snip" and "Full Page Capture." An "Agent Chat Feature" allows natural language task descriptions for AI-powered automation. The "SnapToAI Mouse Wand Menu" provides extensive right-click context menu options. In-app "Video Tutorials" are available. A "Subscription System" via Whop.com offers a free trial, with core features remaining free and AI analysis requiring subscription. Google Sign-In is integrated for user authentication. The UI prioritizes a queue-only view in the popup, with capture actions moved to the right-click menu. A "Monetization Funnel" offers complimentary AI prompts before encouraging subscription. A "Review Prompting System" encourages user reviews. The "AI Mode System" supports Vision, Image, Music, and Video generation with various Gemini models, including dedicated "Song Studio," "Image Studio," and "Video Studio" interfaces. A "Sidebar Mode" provides a native Chrome side-panel UI with a live tab preview and capture capabilities, but is currently hidden. A global "Light & Dark Theme System" exists but is also currently hidden and defaults to dark theme. "Institutions / White-Label Multi-Tenant" functionality allows branded institutional licenses with role-based access, branding customization, and per-member access expiry. Institution onboarding is email-only; admins add member emails in the dashboard, and members are auto-enrolled upon installing the extension and signing in with Google. "Multi-Clip Visual Chaining" for video generation ensures continuity between clips using a hard-cut sequential approach for browser-side video stitching. Storyboard editor exposes 16:9 / 9:16 / 1:1 aspect ratios (stitcher canvas math at ~lines 4225-4240 handles all three). Veo poll loops (`pollVideoStatusAsync` ~line 3877, `pollVideoStatus` ~line 4640) use recursive `setTimeout` (NOT `setInterval`) so a slow poll request never overlaps the next tick under bad network. Polling is adaptive: 5s for the first 6 polls (so users see early progress within seconds, not 15s), then 15s for the long tail. `stitchVideos` resets `stitchCtx.aborted = false; stitchCtx.userStopped = false` at entry so a retry after a previous timeout/stop doesn't immediately throw "User stopped" from the sticky flag. The stitcher protects against three Chrome `MediaRecorder`/audio hang sources that previously made the outer 30-120s timeout the only escape: (a) `recordingDone` has a 5s deadline so if `recorder.onstop` never fires we still finalize with whatever chunks we have; (b) `audioCtx.close()` is wrapped in a 2s `Promise.race`; (c) per-clip `await v.play()` has a 3s deadline (the in-loop watchdog still bails the clip if it can't actually play). The combined output used to **hang on playback** because Chrome's `MediaRecorder` writes EBML clusters but **never back-fills the Segment Info Duration field** (`ffprobe` reports `duration=N/A`, players freeze on seek). Fixed by `fixWebmDuration(blob, durationMs)` at the top of `flow-premium/ai-chat.js` (~line 3983, ~170 lines, pure JS, no deps, MV3-CSP-safe). It walks the EBML to find Segment (id `0x18538067`) → SegmentInfo (id `0x1549A966`) → Duration (id `0x4489`); if Duration exists it overwrites the float in place (preserves all offsets), otherwise it injects an 11-byte `[0x4489][0x88][float64]` element at the start of SegmentInfo AND grows the parent SegmentInfo's size VINT by +11 (re-encoded with `encodeVint`, in place when the byte-count is unchanged or spliced when it grows) — without growing the parent size, strict players reject the file with "element exceeds containing master element". Wall-clock duration is captured via `performance.now()` from the start of the playback loop. Verified end-to-end on the user's broken sample: `ffprobe` now reports `duration=24.000000`, no element-bounds warnings. Also fixed in the same pass: (a) memory leak — the `blobs` array holding raw clip data is now cleared in `finally` so GC can reclaim it across retry sessions, and (b) per-clip stall hang — added a watchdog that bails out of a clip if `currentTime` doesn't advance for 2.5s OR if real elapsed exceeds `dur*1.5+3s`, instead of waiting for the global 120s timeout (some short Veo clips don't reliably emit `onended`). Long-term, the realtime canvas+MediaRecorder approach should be replaced with `ffmpeg.wasm` `-c copy` concat (lossless, fast, proper MP4 output) but that requires bundling ~30MB into the extension package since MV3 forbids remote code execution — tracked as a follow-up. The Veo multi-clip pipeline runs through an AI director (`generateAnchoredStoryboard`) that expands the user's brief into a Style Bible and per-shot cinematic instructions. Institutions can provision a single AI key for all members, controlled by an admin policy, with encryption and billing behavior options.

### System Design Choices
The extension is built as a Manifest V3 Chrome Extension, employing a Service Worker for background processes, a Content Script for in-page interactions, and a Popup Interface for user interaction. Data is stored client-side using Chrome's session and local storage APIs for screenshots (privacy-first). User identity is managed via Google Sign-In through the `chrome.identity` API, with user data stored server-side in PostgreSQL for monitoring purposes.

## External Dependencies

### Browser APIs
- **Chrome Extensions API**: `chrome.tabs`, `chrome.storage.session`, `chrome.storage.local`, `chrome.runtime`, `chrome.action`, `chrome.commands`, `chrome.identity`, `chrome.contextMenus`, `chrome.scripting`.
- **Clipboard API**: `navigator.clipboard.write()`.
- **FileReader API**.
- **DataTransfer API`.

### Target AI Platforms
- **ChatGPT** (chat.openai.com, chatgpt.com)
- **Claude AI** (claude.ai)
- **Grok** (grok.com)

### AI Models
- **Google Gemini API**: Used for AI chat features and automation. Specific models include Gemini 2.0 Flash, 2.0 Flash Lite, 2.5 Flash, 2.5 Pro, and Veo (video generation via predictLongRunning API).

### Payment & Authentication
- **Whop.com**: Merchant of Record for subscription management.
- **Google OAuth**: For user sign-in and identity management.

### Backend & Database
- **Python HTTP Server (Flask)**: Used to serve the multi-language landing page and handle backend API endpoints.
- **PostgreSQL**: For storing user data, subscription information, free prompt usage, and activity logs.

### Analytics & Monitoring
- **Google Search Console**: For SEO and search performance monitoring.
- **ProductHunt**: For product launch and visibility.