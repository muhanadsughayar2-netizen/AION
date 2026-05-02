# SnapToAI - Multi-Screenshot to AI Chrome Extension

## Overview

SnapToAI is a privacy-first, client-side Chrome Extension (Manifest V3) designed to streamline capturing multiple screenshots and uploading them in batches to AI chat platforms like ChatGPT, Claude, and Grok. It temporarily stores up to 10 screenshots in browser session storage and operates without any backend server for core screenshot functionalities. The extension features a "Capture Mode" for taking screenshots and an "Upload Mode" that auto-detects AI chat sites for batch-uploading.

Key capabilities include simplified annotation tools (Highlight Brush, Numbered Callouts, Text, Quick Stickers), custom sticker templates, advanced PDF export options, drag & drop reordering, multi-select operations, individual snapshot management, full multi-language support (55 Chrome-supported languages), and a viral, responsive, glassmorphism-designed landing page emphasizing time savings, privacy, and workflow transformation. The project aims to provide a comprehensive tool for visual information sharing with AI, enhancing productivity and communication.

## User Preferences

Preferred communication style: Simple, everyday language.
Branding: Changed from "Flow" to "SnapToAI" (November 2025)
Logo Display: "Snap To AI" (with spaces for premium look)
Logo: Keep camera emoji (📸) in logo - user's preference

## System Architecture

### UI/UX Decisions
The extension features a glassmorphism dark theme for its popup interface. The landing page utilizes a glassmorphism design with a responsive, mobile-first approach, elegant text badges, and professional styling, available in 55 languages. It includes a "Taste It Now" interactive demo with a 3-click modal system for generating sample code snippets. The workflow presentation on the landing page is ultra-clean, minimal, and emoji-driven.

### Technical Implementations
The landing page implements a robust SEO strategy with separate, pre-rendered HTML files for each of the 54 supported languages, utilizing proper `lang` and `dir` attributes, canonical URLs, and `hreflang` tags. An XML sitemap and `robots.txt` are configured. Aggressive no-cache headers ensure fresh content delivery. The extension is built as a Manifest V3 Chrome Extension.

### Feature Specifications
The extension supports capturing, annotating, organizing (reordering, multi-select), and exporting screenshots. It provides distinct "Capture Mode" and "Upload Mode" functionalities.
- **Snip Feature:** Captures a user-selected region of the screen and saves only the cropped area.
- **Full Page Capture:** Captures and stitches an entire web page, including scrolling content, into a single image.
- **Agent Chat Feature:** Allows users to describe tasks in natural language (e.g., "Go to URL and snap it"), enabling Gemini AI to plan and execute simple automation steps (navigate, wait, snap, fullpage, click) with smart search and AI-powered retries.
- **SnapToAI Mouse Wand Menu:** A comprehensive right-click context menu providing access to all core features including capture actions, AI analysis (Ask AI About This, Explain Selected Text, Analyze This Image), and queue/chat actions.
- **Video Tutorials Feature:** In-app help system linking to YouTube video tutorials for various features.
- **Subscription System:** Email-based via Whop.com, offering a 30-day free trial. Core capture features remain free, while AI analysis requires a subscription. Implements an offline grace period and anti-cheat measures.
- **Google Sign-In System:** User authentication via `chrome.identity` and Google OAuth, with user data stored in a PostgreSQL backend. Displays user avatar and provides account management options.
- **Right-Click Hero Redesign:** The popup primarily shows a queue-only view, with capture actions moved to the right-click context menu.
- **Monetization Funnel:** Offers 10 complimentary backend-proxied AI prompts, followed by a pitch for Google Cloud credits for users to obtain their own Gemini key, leading to the 30-day trial and subscription model.
- **Review Prompting System:** Triggers review prompts at specific usage milestones, guiding users to the Chrome Web Store.
- **AI Mode System:** 4 mode buttons in AI chat + dropdown in popup settings. Modes: Vision (`gemini-3-flash-preview`, streaming text analysis), Image (`gemini-2.5-flash-image` aka Nano Banana, native image generation via generateContent with responseModalities: ['TEXT','IMAGE'], fallbacks: `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`), Music (`lyria-3-clip-preview`, actual music generation via generateContent with responseModalities: ['AUDIO'], fallbacks: `lyria-3-pro-preview`, `gemini-2.5-flash-preview-tts`), Video (Veo via `predictLongRunning` API, client-side using user's own API key — same pattern as Image/Music). Stored as `geminiModel` in chrome.storage.sync. Mode buttons are pill-shaped chips above the input area. Popup AI always uses gemini-2.0-flash regardless of selected mode. Video mode button is hidden by default — only shown when user's API key has Veo models available (checked directly against Gemini API).
- **Song Studio:** Interactive guided experience in Music mode with 20 genre chips, 12 mood chips, 4 tempo options, topic input, Image-to-Music section (when screenshots loaded), and a "Surprise Me" randomizer. Builds structured prompts for Lyria music generation.
- **Image Studio:** Simple text description input with "Surprise Me" randomizer. User describes what they want, AI creates it. All prompts include instruction to avoid text/words in generated images for clean output.
- **Video Studio:** Prompt input with quality selector (6 Veo models: 3.1, 3.1 Fast, 3.1 Lite, 3.0, 3.0 Fast, 2.0) and optional "Use screenshot as starting frame" toggle (Image-to-Video). Client-side generation using user's own Gemini API key via Veo `predictLongRunning` API with polling every 15s. Auto-detects which Veo models the user's key supports. Default: Veo 3.1 Fast. Progress bar in chat bubble. Video plays inline with download button on completion.
- **Sidebar Mode (v2.5.0):** Native Chrome side-panel UI (`chrome.sidePanel` API) launched via a "Sidebar" button in the popup header. `sidebar.html` is a superset of `ai-chat.html` (same DOM IDs so `ai-chat.js` initializes unchanged) plus a new top hero containing: compact logo + account row, **live tab preview** (polled `chrome.tabs.captureVisibleTab` JPEG @ 0.5 fps ambient, ~1.25 fps on hover, paused on hidden/restricted pages, with LIVE badge and tab title overlay), capture row (Snap/Snip/Full Page/Ask AI), and an always-visible AI key status pill. `sidebar.js` wires the hero — Snap routes through the existing `runtime.sendMessage('capture')` background handler, Snip uses local `captureVisibleTab` + `annotate.html` window (matching popup), Full Page routes through `runtime.sendMessage('startFullPageCapture')`, Ask AI focuses the chat input below. Live preview pauses during user-initiated captures to avoid Chrome's `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` rate limit. Persists `uiMode='sidebar'` in `chrome.storage.local`. Responsive: stacks vertically <700px (image-panel hidden), shows side-by-side image-panel ≥700px. Manifest gains `sidePanel` permission, `side_panel.default_path: "sidebar.html"`, and adds sidebar files to `web_accessible_resources`.
- **Light & Dark Theme System (v2.6.0):** Single global theme stored in `chrome.storage.local.snaptoaiSettings.theme` with values `light | dark | auto`. Default `auto` for fresh installs / `dark` for existing v2.5.0 users (no visual regression). Toggle via sun/moon/auto cycle button in popup + sidebar headers (`#themeCycleBtn`) and 3 radio cards in the options page Appearance section. Implementation:
  - `theme.js` (loaded as the FIRST `<script>` in `<head>` of every extension page) reads a `localStorage` cache (`snaptoai_theme_cache`) synchronously and stamps `<html data-theme="light|dark" data-theme-pref="light|dark|auto">` BEFORE first paint (no FOUC). Then async-reconciles with chrome.storage. Listens to `chrome.storage.onChanged` for cross-surface live updates and `matchMedia('(prefers-color-scheme: light)')` for OS pref changes when in auto mode. Public API: `window.SnapToAITheme.{get, getResolved, set, cycle, onChange}`.
  - `theme.css` defines semantic `--st-*` tokens at `:root` (dark defaults — byte-equivalent to v2.5.0) and a comprehensive `:root[data-theme="light"]` override block targeting popup, ai-chat, sidebar, options, annotate (remaps the existing `--bg-dark/--bg-card/--accent/--text-primary` tokens used by `annotate.css`), welcome, magic-card, and tour. Light palette uses `#0891b2` accent (~4.7:1 on white — WCAG AA), `#0f172a` text (~17:1 — AAA).
  - Wired into `popup.html`, `sidebar.html`, `ai-chat.html`, `options.html`, `annotate.html`, `welcome.html`, `magic-card.html`. Cycle button + handler is inline at the bottom of `popup.html` and `sidebar.html` (avoids editing the giant popup.js/sidebar.js files). Options page has 3 `.appearance-card` radio cards in a new "🎨 Appearance" section that live-update via `SnapToAITheme.set()`.
  - `manifest.json` bumped to 2.6.0; `theme.js` and `theme.css` added to `web_accessible_resources`.
  - Scope-out: content.js toasts on host pages remain dark always (overlay UX is best with high-contrast regardless of extension theme; deferred to follow-up).
- **Multi-Clip Visual Chaining (v2.4.10):** When generating multi-clip stitched videos, each clip after the first uses the previous clip's last frame as its starting image (Veo image-to-video) so character/lighting/lens stay consistent across cuts. Implementation:
  - `extractLastFrame(videoUrl)`: fetches video bytes → blob URL → mounts an off-screen `<video>` IN THE DOM (Chrome skips frame decoding for detached elements, silently producing black canvas) → waits for `loadedmetadata` then `loadeddata` (readyState ≥ HAVE_CURRENT_DATA) → seeks to `duration − 0.1s` → waits for `requestVideoFrameCallback` (or two rAFs fallback) so the GPU texture is actually painted → draws to canvas → exports as JPEG @ 0.92 (PNG was 2-4 MB base64 and Veo silently rejected oversize bodies; JPEG is 150-300 KB). Returns `{base64, mimeType, _sourceUrl}` or null with diagnostic log.
  - `refreshTransitionFrame(ctx, idx)`: JIT helper, cached per source URL, called BEFORE reading the previous clip's frame (so retries always use the freshest version) and AFTER replacing any clip's URL (so downstream chaining sees the new clip).
  - `generateOneVeoClip`: for clip N>0, JIT-refreshes `transitionFrames[N-1]`, attaches it as `instances[0].image`, AND prepends a continuity instruction to the text prompt ("Continue seamlessly from the provided starting frame. Keep the same character, clothing, lighting, color palette, lens, and camera framing. Do not cut to a new scene…") so the storyboard text can't override the image.
  - Diagnostic console logging at every chain decision (`✓ Clip N CHAINED ...` / `✗ Clip N NOT chained ...`) so users can verify in DevTools.
  - Storyboard generation (`buildClipScenes` / `generateAnchoredStoryboard` / `buildAnchoredFallback`) uses the user's selected per-clip duration instead of hardcoded 8s.
  - Re-render, Retry, and Fix Stitch success paths invalidate the replaced clip's own cached frame so the next clip's future regeneration chains to the new version.
  - Dedicated "✂ Fix stitch (N→N+1)" button on each clip 2..N for explicit join repair.
  - INVALID_ARGUMENT image-input fallback: if a Veo model variant rejects the image, automatically retry once text-only for that attempt.

### System Design Choices
The extension is built as a Manifest V3 Chrome Extension, employing a Service Worker for background processes, a Content Script for in-page interactions, and a Popup Interface for user interaction. Data is stored client-side using Chrome's session and local storage APIs for screenshots (privacy-first). User identity is managed via Google Sign-In through the `chrome.identity` API, with user data stored server-side in PostgreSQL for monitoring purposes.

## External Dependencies

### Browser APIs
- **Chrome Extensions API**: `chrome.tabs`, `chrome.storage.session`, `chrome.storage.local`, `chrome.runtime`, `chrome.action`, `chrome.commands`, `chrome.identity`, `chrome.contextMenus`, `chrome.scripting`.
- **Clipboard API**: `navigator.clipboard.write()`.
- **FileReader API**.
- **DataTransfer API**.

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