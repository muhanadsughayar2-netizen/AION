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

**Agent Chat Feature (January 2026):** Autonomous web automation agent:
- New "Agent" button in popup (purple orb) opens Agent Chat interface
- User describes tasks in natural language (e.g., "Go to TradingView, search AAPL, screenshot 5min and 15min charts")
- Gemini AI plans automation steps (navigate, click, type, wait, screenshot)
- Agent executes steps automatically while user watches
- **Smart Search (Anti-Stuck Protocol):** 5-level fallback for finding elements:
  - Plan A: CSS Selector
  - Plan B: Exact text match (for "1y", "Max", "Buy" buttons)
  - Plan C: Partial text match
  - Plan D: XPath search
  - Plan E: Extract button text from description
- **AI-powered retry:** When a step fails, asks Gemini for an alternative approach (up to 2 retries)
- **Live feedback:** Shows real-time status messages during automation ("Step 1: Navigating to Amazon...")
- **Technical indicators rule:** For Moving Averages/RSI, agent clicks Indicators menu, types name, selects result
- **Full page screenshots:** Supports "fullPage": true parameter for automatic page stitching
- Screenshots captured and added to snap queue automatically
- Progress UI shows live step completion with thumbnails
- Integrates with existing AI analysis workflow
- Files: agent-chat.html, agent-chat.js, content.js (handleAgentAction)

**Subscription System (January 2026):** Client-side subscription with Gumroad integration:
- 30-day free trial starting on install (tracked in chrome.storage.local)
- After trial: Capture features remain FREE forever, only AI analysis requires subscription
- Pricing: $12/month or $99/year (31% savings)
- License verification via Gumroad API with 48-hour grace period for network issues
- Subscription modal shown when AI button clicked after trial expires
- License key input for activating purchased subscriptions
- Placeholder URLs: Replace YOUR_PRODUCT_PERMALINK, YOUR_MONTHLY_LINK, YOUR_YEARLY_LINK after Gumroad setup

### System Design Choices
The extension is built as a Manifest V3 Chrome Extension. It employs a Service Worker for background processes, a Content Script for in-page interactions and AI platform detection, and a Popup Interface for user interaction. Data is stored entirely client-side using Chrome's session and local storage APIs, ensuring privacy and eliminating the need for an external backend database. Screenshots are stored as base64 dataURL strings in a FIFO queue within session storage.

## External Dependencies

### Browser APIs
- **Chrome Extensions API**: `chrome.tabs`, `chrome.storage.session`, `chrome.storage.local`, `chrome.runtime`, `chrome.action`, `chrome.commands`.
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
