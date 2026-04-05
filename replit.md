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
- **AI Mode System:** 4 mode buttons in AI chat + dropdown in popup settings. Modes: Vision (`gemini-3-flash-preview`, streaming text analysis), Image (`gemini-2.5-flash-image` aka Nano Banana, native image generation via generateContent with responseModalities: ['TEXT','IMAGE'], fallbacks: `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`), Music (`lyria-3-clip-preview`, actual music generation via generateContent with responseModalities: ['AUDIO'], fallbacks: `lyria-3-pro-preview`, `gemini-2.5-flash-preview-tts`), Research (`gemini-2.5-flash` with `tools: [{ google_search: {} }]` for web-grounded answers with cited sources, fallbacks: `gemini-2.5-pro`, `gemini-2.0-flash`). Stored as `geminiModel` in chrome.storage.sync. Mode buttons are pill-shaped chips above the input area. Popup AI always uses gemini-2.0-flash regardless of selected mode.
- **Song Studio:** Interactive guided experience in Music mode with 20 genre chips, 12 mood chips, 4 tempo options, topic input, and a "Surprise Me" randomizer. Builds structured prompts for Lyria music generation.
- **Image Studio:** Interactive guided experience in Image mode with 12 format categories (Brochure, Poster, Social Media Post, etc.), 16 art styles, 10 color options (pick up to 2), description input, and "Surprise Me" randomizer. Includes text overlay system for adding text layers with customizable size, position, and color — solving AI's weakness with Arabic/Hebrew/RTL text rendering.
- **Text Overlay System:** Post-generation text overlay on any AI-generated image. Users can add multiple text layers with exact text in any language (Arabic, Hebrew, etc.), choose size (Small/Medium/Large/X-Large), position (Top/Center/Bottom), and color. Uses HTML5 Canvas for rendering. Available both through Image Studio pre-creation flow and via "Add Text" button on any generated image.

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
- **Google Gemini API**: Used for AI chat features and automation. Specific models include Gemini 2.0 Flash, 2.0 Flash Lite, 2.5 Flash, and 2.5 Pro.

### Payment & Authentication
- **Whop.com**: Merchant of Record for subscription management.
- **Google OAuth**: For user sign-in and identity management.

### Backend & Database
- **Python HTTP Server (Flask)**: Used to serve the multi-language landing page and handle backend API endpoints.
- **PostgreSQL**: For storing user data, subscription information, free prompt usage, and activity logs.

### Analytics & Monitoring
- **Google Search Console**: For SEO and search performance monitoring.
- **ProductHunt**: For product launch and visibility.