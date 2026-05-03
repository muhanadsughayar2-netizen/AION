# SnapToAI - Multi-Screenshot to AI Chrome Extension

## Overview

SnapToAI is a privacy-first, client-side Chrome Extension (Manifest V3) designed to streamline capturing multiple screenshots and uploading them in batches to AI chat platforms like ChatGPT, Claude, and Grok. It temporarily stores up to 10 screenshots in browser session storage and operates without any backend server for core screenshot functionalities. The extension features a "Capture Mode" for taking screenshots and an "Upload Mode" that auto-detects AI chat sites for batch-uploading.

Key capabilities include simplified annotation tools, custom sticker templates, advanced PDF export options, drag & drop reordering, multi-select operations, individual snapshot management, full multi-language support (55 Chrome-supported languages), and a viral, responsive, glassmorphism-designed landing page emphasizing time savings, privacy, and workflow transformation. The project aims to provide a comprehensive tool for visual information sharing with AI, enhancing productivity and communication.

## User Preferences

Preferred communication style: Simple, everyday language.
Branding: Changed from "Flow" to "SnapToAI"
Logo Display: "Snap To AI" (with spaces for premium look)
Logo: Keep camera emoji (📸) in logo

## System Architecture

### UI/UX Decisions
The extension features a glassmorphism dark theme for its popup interface. The landing page utilizes a glassmorphism design with a responsive, mobile-first approach, elegant text badges, and professional styling, available in 55 languages. It includes an interactive demo with a 3-click modal system for generating sample code snippets. The workflow presentation on the landing page is ultra-clean, minimal, and emoji-driven.

#### Premium polish pass (Task #26 — phased)
A staged design-system unification across every surface, run in low-risk slices so each round can be reviewed independently.
- **Round 1 — token plumbing (DONE).** Replaced 1:1-matching color literals (`#0a0a0a`, `#151515`, `#1a1a1a`, `#00d9ff`, `#00b8d4`) inside the inline `<style>` blocks of `flow-premium/sidebar.html` and `flow-premium/ai-chat.html` with the corresponding `--st-bg-app` / `--st-bg-surface` / `--st-bg-elevated` / `--st-accent` / `--st-accent-2` tokens from `flow-premium/theme.css`. Dark mode is byte-identical (token values equal the original literals); light mode keeps using the existing `:root[data-theme="light"]` `!important` overrides. Net effect: future palette tweaks in `theme.css` now ripple into the sidebar/AI-chat surfaces automatically instead of being silently overridden by hard-coded values.
- **Round 2+ (NOT YET STARTED).** Remaining: typography unification (Outfit/Inter/system drift), component vocabulary (toasts, modals, badges, pills), light-mode parity audit on the landing page, 4/8-px spacing rhythm, motion tokens, iconography, accessibility sweep, cross-surface QA. To be picked up in subsequent rounds.

### Technical Implementations
The landing page implements a robust SEO strategy with separate, pre-rendered HTML files for each of the 54 supported languages, utilizing proper `lang` and `dir` attributes, canonical URLs, and `hreflang` tags. An XML sitemap and `robots.txt` are configured. Aggressive no-cache headers ensure fresh content delivery. The extension is built as a Manifest V3 Chrome Extension (current version 2.7.4). The Flask backend (`app.py`) hosts the landing page plus all subscription, auth, admin, and institution APIs against a PostgreSQL database. Institutions/white-label uses three tables (`institutions`, `institution_members`, `institution_invites`) plus a nullable `users.institution_id` FK; super-admin and per-institution dashboards are server-rendered HTML, branding is pushed to the extension via the `/api/subscription/status` JSON response (cached in `chrome.storage.local.snaptoai_branding`), and the popup/sidebar swap logo + accent color in real time when the cached branding changes. Membership resolution runs on every sign-in and status check, with a hardcoded public-domain blocklist preventing accidental gmail/outlook auto-binding.

### Feature Specifications
The extension supports capturing, annotating, organizing (reordering, multi-select), and exporting screenshots. It provides distinct "Capture Mode" and "Upload Mode" functionalities, including region-selected "Snip" and "Full Page Capture." An "Agent Chat Feature" allows natural language task descriptions for AI-powered automation. The "SnapToAI Mouse Wand Menu" provides extensive right-click context menu options. In-app "Video Tutorials" are available. A "Subscription System" via Whop.com offers a free trial, with core features remaining free and AI analysis requiring subscription. Google Sign-In is integrated for user authentication. The UI has been redesigned to prioritize a queue-only view in the popup, with capture actions moved to the right-click menu. A "Monetization Funnel" offers complimentary AI prompts before encouraging subscription. A "Review Prompting System" encourages user reviews. The "AI Mode System" supports Vision, Image, Music, and Video generation with various Gemini models, including dedicated "Song Studio," "Image Studio," and "Video Studio" interfaces. A "Sidebar Mode" provides a native Chrome side-panel UI with a live tab preview and capture capabilities. A global "Light & Dark Theme System" allows users to select themes, including an auto-mode based on OS preferences. "Institutions / White-Label Multi-Tenant" functionality allows branded institutional licenses with role-based access and branding customization within the extension. "Multi-Clip Visual Chaining" for video generation ensures continuity between clips by using the previous clip's last frame as the starting image for the next. v2.7.2 hardened the chain with: (a) a one-time **character anchor** captured from clip 1's last frame and reused for any later clip whose shot text mentions a person — prevents identity drift across long videos; (b) a **0.5 s alpha-blend crossfade** between consecutive clips during stitching, with matching audio gain ramps on the AudioContext clock — joins read as deliberate dissolves instead of hard cuts; and (c) a **continuity-failure UI** — when `extractLastFrame` throws, the result panel surfaces a "⚠ chain weakened" badge above the affected clip's row with the failure reason and a "Use my own reference image" file picker that becomes the conditioning frame for the next Fix Stitch.

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