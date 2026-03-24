# SnapToAI - Multi-Screenshot to AI Chrome Extension

## Overview

SnapToAI is a privacy-first, client-side Chrome Extension (Manifest V3) designed to streamline capturing multiple screenshots and uploading them in batches to AI chat platforms like ChatGPT, Claude, and Grok. It temporarily stores up to 10 screenshots in browser session storage using a FIFO queue and operates without any backend server. The extension features a "Capture Mode" for taking screenshots and an "Upload Mode" that auto-detects AI chat sites for batch-uploading.

Key capabilities include simplified annotation tools (Highlight Brush, Numbered Callouts, Text, Quick Stickers), custom sticker templates, advanced PDF export options, drag & drop reordering, multi-select operations, individual snapshot management, and full multi-language support (55 Chrome-supported languages). The project also includes a viral, responsive, glassmorphism-designed landing page with professional SaaS copywriting, emphasizing time savings, privacy, and workflow transformation.

## User Preferences

Preferred communication style: Simple, everyday language.
Branding: Changed from "Flow" to "SnapToAI" (November 2025)
Logo Display: "Snap To AI" (with spaces for premium look)
Logo: Keep camera emoji (📸) in logo - user's preference

## System Architecture

### UI/UX Decisions
The extension features a glassmorphism dark theme for its popup interface. The landing page utilizes a glassmorphism design with a responsive, mobile-first approach, elegant text badges, and professional styling, available in 55 languages. It includes a "Taste It Now" interactive demo with a 3-click modal system for generating sample code snippets. The workflow presentation on the landing page is ultra-clean, minimal, and emoji-driven.

### Technical Implementations
The landing page implements a robust SEO strategy with separate, pre-rendered HTML files for each of the 54 supported languages, utilizing proper `lang` and `dir` attributes, canonical URLs, and `hreflang` tags. An XML sitemap and `robots.txt` are configured to optimize search engine indexing and crawling. Aggressive no-cache headers ensure fresh content delivery.

### Feature Specifications
The extension supports capturing, annotating, organizing (reordering, multi-select), and exporting screenshots. It provides distinct "Capture Mode" and "Upload Mode" functionalities. The landing page includes enhanced testimonials with real attribution, expanded FAQs, case studies demonstrating ROI, and a professional footer with 16 links.

**Snip Feature (November 2025):** Dual circular buttons (Snap + Snip) in popup interface. Snip captures a screenshot, opens the annotate screen with crop tool active, allows user to draw a rectangular selection, and saves only the cropped region to the queue. This enables precise region capture without external tools.

**Full Page Capture Feature (November 2025):** New "FULL PAGE" button alongside SNAP and SNIP. When clicked:
1. Shows progress overlay on the page with glassmorphism styling
2. Visibly scrolls the page from top to bottom (user can see it happening)
3. Captures screenshots at each viewport position with 50px overlap
4. Stitches all captures into one long continuous image
5. Applies invisible watermark (SnapToAI marketing)
6. Saves the stitched image to the queue
Handles infinite-scroll sites with scroll settlement detection. Works on any web page regardless of length.

**Agent Chat Feature (January 2026):** Simple data gathering automation:
- New "Agent" button in popup (purple orb) opens Agent Chat interface
- User describes tasks in natural language (e.g., "Go to https://example.com and snap it")
- Gemini AI plans simple automation steps (navigate, wait, snap, fullpage, click)
- **Core actions:**
  - `navigate` - Go to any URL
  - `wait` - Wait for page to load  
  - `snap` - Capture viewport screenshot (focuses window, captures, adds to queue)
  - `fullpage` - Attempt full page capture (may have limitations in automation mode)
  - `click` - Click buttons by text (e.g., "1y", "Max")
- **Smart Search:** 5-level fallback for clicking elements (CSS, exact text, partial text, XPath, description)
- **AI-powered retry:** When a step fails, asks Gemini for an alternative approach (up to 2 retries)
- **Live feedback:** Shows real-time status messages during automation
- **Queue management:** Checks for queue limits (max 10) before capturing
- **Known limitations:** Full page capture may timeout in agent mode - use popup FULL PAGE button for guaranteed results
- Files: agent-chat.html, agent-chat.js, background.js (agentCaptureTab, agentAddSnaps, agentFullPageCapture), content.js

**SnapToAI Mouse Wand Menu (March 2026):** Full right-click context menu with ALL core features:
- Parent menu "SnapToAI" with submenu items for every core action
- **Capture actions:** Snap Viewport (captureScreenshot with tab.id), Snip Region (captureVisibleTab → annotate.html?mode=snip), Full Page Capture (startFullPageCapture with tab.id)
- **AI actions:** Ask AI About This (screenshot + context → auto-analysis), Explain Selected Text (selection context only), Analyze This Image (image context only)
- **Queue/Chat actions:** Send Queue to AI (loads all snaps → ai-chat with count), Open AI Chat (direct mode), View Queue (opens popup.html in window with source tab tracking)
- Keyboard shortcut: Ctrl+Shift+A (Cmd+Shift+A on Mac) for Ask AI
- Restricted page guard (chrome://, about://, edge://, devtools:// pages blocked)
- Context extraction via chrome.scripting.executeScript: selected text, code blocks, clicked element
- Files: manifest.json (contextMenus permission, ask-ai command), background.js (registerSnapToAIMenu, handleAskSnapToAI), ai-chat.js (isContextMenu branch in initializeChat)

**Video Tutorials Feature (January 2026):** In-app help system:
- Small "?" help button in popup header (subtle glassmorphism design)
- Dropdown menu with 6 tutorial categories: Snap, Snip, Full Page, AI Chat, Annotate, Upload
- Links to YouTube videos for each feature
- "View All Tutorials" links to YouTube channel
- Shows "Tutorial coming soon!" message if video not yet available
- Placeholder URLs in popup.js - replace YOUR_VIDEO_ID with actual YouTube video IDs

**Subscription System (March 2026 - Email-Based via Whop.com):**
- **Payment Provider:** Whop.com (Merchant of Record)
- **No license keys** — subscription tied to Google Sign-In email
- 30-day free trial starts when user signs in with Google (tracked by email in `subscriptions` table)
- After trial: Capture features remain FREE forever, only AI analysis requires subscription
- Pricing: $4.99/month or $39/year (35% savings) - "Less than a coffee" pitch
- **Offline Grace Period:** Validated subscriptions work offline for up to 7 days
- Subscription modal shown when AI button clicked after trial expires (both AI button AND Direct AI button are gated)
- Settings page (options.html) shows subscription status with "Refresh" button (no license key input)
- **Checkout URL:** https://whop.com/snaptoai/
- **Backend Endpoints:**
  - `POST /api/subscription/status` — checks trial/subscription by email, returns canUseAI status
  - `POST /api/whop/webhook` — receives Whop payment events, updates subscription status
- **Whop Webhook Events:** membership.went_valid, membership.renewed, payment.succeeded → activate; membership.went_invalid, membership.expired → expire; membership.canceled → cancel
- **DB Table:** `subscriptions` (email, whop_user_id, whop_membership_id, plan_type, status, trial_start, trial_end, subscription_start, subscription_end)
- **Anti-Cheat:** Trial start uses earliest date from email record, device ID, or IP address
- **Files:** subscription.js (email-based check), options.js/html (status UI), app.py (/api/subscription/status, /api/whop/webhook)
- **Environment Secrets:** WHOP_API_KEY, MONTHLY_PLAN_ID, YEARLY_PLAN_ID

**Google Sign-In System (March 2026):**
- Sign-in gate on first extension open via `chrome.identity` + Google OAuth
- Full-screen glassmorphic welcome overlay with "Continue with Google" button
- User data (name, email, profile photo) sent to backend and stored in PostgreSQL `users` table
- Signed-in state shows circular avatar + first name in popup header
- Account popover on avatar click: email, manage API key, sign out
- Backend tracks: user registrations, capture activity, review prompts
- API endpoints: POST /api/auth/register, POST /api/auth/activity
- Admin monitoring: GET /api/admin/users, GET /api/admin/activity (password-protected)
- Admin dashboard includes "Registered Users" and "Recent Activity" sections
- Placeholder OAuth client_id in manifest.json — replace with real one from Google Cloud Console
- Files: popup.html, popup.js, popup.css (overlay + header), manifest.json (identity + oauth2), app.py (API + DB)

**Right-Click Hero Redesign (March 2026):**
- Popup stripped to queue-only view: hero panel shows right-click tip instead of capture buttons
- All capture actions accessed via right-click context menu (SnapToAI Mouse Wand)
- Hero panel has "Open AI Chat" and "Add Gemini Key" buttons
- Counter chip shows current queue count (X/9)
- Selection bar includes "Send to AI" button for quick multi-select AI analysis
- Dynamic right-click menu: "Send X Snaps to AI" updates count automatically via storage listener
- Files: popup.html, popup.css, popup.js, background.js

**Monetization Funnel (March 2026):**
- 10 complimentary backend-proxied AI prompts (no API key needed)
- Backend `/api/ai/proxy` endpoint: tracks usage per email/deviceId, 3 req/min rate limit
- DB table: `free_prompts` (identifier, usage_count, last_used, created_at)
- After 10 prompts: shows $300 Google Cloud credit pitch to encourage own Gemini key
- Gemini key modal enhanced with green $300 credit banner
- Trial countdown toast: appears at 7 and 3 days remaining, dismissible
- Flow: 10 free prompts → $300 pitch → own Gemini key → 30-day trial → Whop subscription
- Environment secret needed: GEMINI_OWNER_KEY (for backend proxy)
- Files: app.py, ai-chat.js, popup.html, popup.css, popup.js

**Review Prompting System (March 2026):**
- Triggers after 5, 15, and 30 successful captures
- Glassmorphic modal: "Enjoying SnapToAI?" with star emojis
- "Leave a Review" opens Chrome Web Store review page
- "Maybe Later" dismisses (max 3 dismissals, then stops)
- Tracks reviewed/dismissed state in chrome.storage.local
- Reports review_prompt_shown and review_clicked to backend activity log
- Placeholder EXTENSION_ID in review URL — replace with real Chrome Web Store extension ID

### System Design Choices
The extension is built as a Manifest V3 Chrome Extension. It employs a Service Worker for background processes, a Content Script for in-page interactions and AI platform detection, and a Popup Interface for user interaction. Data is stored client-side using Chrome's session and local storage APIs for screenshots (privacy-first). User identity is managed via Google Sign-In through chrome.identity API, with user data stored server-side in PostgreSQL for monitoring.

## External Dependencies

### Browser APIs
- **Chrome Extensions API**: `chrome.tabs`, `chrome.storage.session`, `chrome.storage.local`, `chrome.runtime`, `chrome.action`, `chrome.commands`, `chrome.identity`.
- **Clipboard API**: `navigator.clipboard.write()`.
- **FileReader API**.
- **DataTransfer API**.

### Target AI Platforms
- **ChatGPT** (chat.openai.com, chatgpt.com)
- **Claude AI** (claude.ai)
- **Grok** (grok.com)

### Development Server
- **Python HTTP Server (Flask)**: Used to serve the multi-language landing page on port 5000.
### Phase 8: Rich Snippet Schema Markup ✅ (November 27, 2025)

**JSON-LD Schema for Better Search Results:**

Schema markup is now embedded in all 54 language pages. Google will show:
- ✅ App name with description
- ✅ "FREE" price label 
- ✅ Links to Chrome Web Store
- ✅ Organization information

**Impact:**
- Rich search results get 30%+ more clicks
- Better SERP appearance than plain text
- Google understands SnapToAI is a free app

**Test Your Schema:**
- Google Rich Results Test: https://search.google.com/test/rich-results
- Enter any page URL to verify

## ✅ PRODUCTION CHECKLIST - READY TO LAUNCH

### SEO Complete ✅
- [x] 54 language pages with proper hreflang tags
- [x] XML sitemap with all languages
- [x] robots.txt for search engines
- [x] JSON-LD schema markup for rich snippets
- [x] Mobile responsive design
- [x] Cache control headers
- [x] Meta descriptions in all languages

### Domain Complete ✅
- [x] snaptoai.com connected and verified
- [x] www.snaptoai.com redirects to main domain
- [x] Both domains point to Replit with correct IPs

### Frontend Complete ✅
- [x] 54 language versions (100% translation coverage)
- [x] Auto-detect browser language with suggestion banner
- [x] Glassmorphism dark UI
- [x] "Taste It Now" interactive demo
- [x] Professional testimonials & FAQ
- [x] Mobile-first responsive design

## Next Steps
1. **Submit to Google Search Console** (free)
   - Go to: https://search.google.com/search-console/
   - Add your domain: snaptoai.com
   - Submit sitemap URL: snaptoai.com/sitemap.xml
   - Wait 7-14 days for indexing

2. **Publish to ProductHunt** 
   - Create account at producthunt.com
   - Submit SnapToAI with landing page screenshots
   - Launch during peak hours (PST 6am-9am on Tuesday-Thursday)

3. **Share on Twitter**
   - Link to snaptoai.com
   - Use hashtags: #ChromeExtension #AI #ProductLaunch #Productivity

Your landing page is **LIVE and PRODUCTION-READY** at snaptoai.com!
