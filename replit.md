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
The extension features a glassmorphism dark theme for its popup interface. The landing page utilizes a glassmorphism design with a responsive, mobile-first approach, elegant text badges, and professional styling, available in 55 languages. It includes an interactive demo with a 3-click modal system for generating sample code snippets. A cross-surface design-system unifies color tokens, typography, motion, spacing, focus, and brand color across all SnapToAI surfaces (extension UI, landing page, Vite/React studio, server-rendered admin dashboards). Global accessibility polish ensures a shared focus ring on every interactive element and honors `prefers-reduced-motion: reduce`.

### Technical Implementations
The landing page implements a robust SEO strategy with separate, pre-rendered HTML files for each of the 54 supported languages, utilizing proper `lang` and `dir` attributes, canonical URLs, and `hreflang` tags. An XML sitemap and `robots.txt` are configured. The extension is built as a Manifest V3 Chrome Extension. The Flask backend (`app.py`) hosts the landing page plus all subscription, auth, admin, and institution APIs against a PostgreSQL database. Branding is pushed to the extension via the `/api/subscription/status` JSON response.

### Feature Specifications
The extension supports capturing, annotating, organizing (reordering, multi-select), and exporting screenshots. It provides distinct "Capture Mode" and "Upload Mode" functionalities, including region-selected "Snip" and "Full Page Capture." An "Agent Chat Feature" allows natural language task descriptions for AI-powered automation. The "SnapToAI Mouse Wand Menu" provides extensive right-click context menu options. In-app "Video Tutorials" are available. A "Subscription System" via Whop.com offers a free trial, with core features remaining free and AI analysis requiring subscription. Google Sign-In is integrated for user authentication. The UI has been redesigned to prioritize a queue-only view in the popup, with capture actions moved to the right-click menu. A "Monetization Funnel" offers complimentary AI prompts before encouraging subscription. A "Review Prompting System" encourages user reviews. The "AI Mode System" supports Vision, Image, Music, and Video generation with various Gemini models, including dedicated "Song Studio," "Image Studio," and "Video Studio" interfaces. A "Sidebar Mode" provides a native Chrome side-panel UI with a live tab preview and capture capabilities, but is **temporarily hidden from users** — the "Sidebar" entry button in `popup.html` is `display:none`, and `background.js applyUiMode()` is hard-coded to always set popup mode (overriding any persisted `uiMode: 'sidebar'`). The `sidePanel` permission and `side_panel` manifest entry, plus all sidebar.html/sidebar.js code, are kept intact. To re-enable: unhide `#openSidebarBtn` and restore the original `applyUiMode()` branch on `mode === 'sidebar'`. A global "Light & Dark Theme System" exists in the codebase (theme.js, theme.css, theme-cycle-btn.js, options Appearance section) but is **temporarily hidden from users** — the theme picker buttons in `popup.html`, `sidebar.html`, and the Appearance section in `options.html` are `display:none`, and `theme.js`'s `resolveTheme()` is hard-coded to return `'dark'` so every surface renders dark regardless of stored preference or OS `prefers-color-scheme`. To re-enable: remove the `display:none` styles and restore the original `resolveTheme()` body. "Institutions / White-Label Multi-Tenant" functionality allows branded institutional licenses with role-based access and branding customization within the extension. "Multi-Clip Visual Chaining" for video generation ensures continuity between clips. The Veo multi-clip pipeline runs through an AI director (`generateAnchoredStoryboard` in `ai-chat.js`) that expands the user's brief into a Style Bible + per-shot cinematic instructions before each clip is rendered (Task #31 — restored after Task #28 / commit 0484b47 had degraded it to literal-prompt mode). The director uses Gemini at temperature 0.35 with a brief-anchoring guard (`briefAdheres`) that requires either the style bible or a majority of clips to mention the user's subject tokens, falling back to `buildAnchoredFallback` only when the director call fails. Per-clip prompts use a calm `User brief:` label (replacing the strict `[USER REQUEST — RENDER THIS EXACTLY]` framing) while keeping the original `[THIS SEGMENT]` / `[SUPPORTING STYLE]` / `[CONTINUITY]` block structure intact so downstream parsers (`slimSceneForChainImage`, the editor's recompile flow) keep working. Institutions can provision a single AI key for all members, controlled by an admin policy, with encryption and billing behavior options.

#### Institution-shared Gemini key (Task #27)
- **Schema (`institutions` table).** Migrated columns: `gemini_key_encrypted` (Fernet ciphertext), `gemini_key_hint` (last 4 only — never plaintext), `key_policy` (`institution-only` / `prefer-institution-key` / `prefer-user-key`, default `prefer-user-key`), `billing_behavior` (`bypass-snaptoai-quota` / `count-against-snaptoai-quota`, default `count-against-snaptoai-quota`), audit timestamps `key_set_at` / `key_last_rotated_at` / `key_last_used_at`.
- **Encryption.** Fernet via `cryptography`, data key derived through PBKDF2-HMAC-SHA256 (390k rounds) from `INSTITUTION_KEY_ENCRYPTION_SECRET` (falls back to `GEMINI_OWNER_KEY`). Plaintext is **never** logged, returned, or exposed in any client payload.
- **Resolution.** `_resolve_institution_key_for_email(email)` is the single source of truth in `/api/ai/proxy`. `institution-only` with no/invalid key returns `error: "institution_key_invalid"` with **no silent fallback**. `prefer-institution-key` uses the institution key when present, otherwise the SnapToAI shared key. `bypass-snaptoai-quota` skips free-prompt metering when the institution key was actually used (response includes `metered: false`). Successful proxy calls update `key_last_used_at`.
- **Admin endpoints.** `GET/POST/DELETE /api/institution/<slug>/gemini-key`, `POST .../gemini-key/test` (also accepts `{stored: true}` to test the saved key — uses Gemini `models.list`, never sends content), `PUT .../gemini-key/policy`. All require `_verify_inst_admin`. UI is the "🔑 Agentic AI / API key" section in the per-institution dashboard. Save flow validates the key against Google before persisting (override with `skipTest: true`).
- **Subscription payload.** Branding now exposes `hasInstitutionKey`, `keyHint`, `keyPolicy`, `billingBehavior`, and the audit timestamps — no plaintext.
- **Extension.** `ai-chat.js` adds `getInstitutionKeyInfo()`, attaches the signed-in user's `accessToken` to proxy requests (so the server can verify the email when an institution key would be used — blocks email-spoofing), and renders a "contact your admin" card on `institution_key_invalid`. `popup.js handleAIButtonClick`, `ai-chat.js showProxyKeyPrompt`, and `sidebar.js openKeyManager` all short-circuit in `institution-only` mode instead of opening the BYOK modal. Storage listeners re-render the AI button + key pill when the policy or branding changes server-side.
- **Out of scope.** Image / Music / Video studios still call Google directly with BYOK; chat / vision (the primary path) is fully proxied.

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