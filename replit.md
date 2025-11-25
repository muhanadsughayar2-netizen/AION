# SnapToAI - Multi-Screenshot to AI Chrome Extension

## Overview

SnapToAI is a privacy-first, client-side Chrome Extension (Manifest V3) designed to streamline the process of capturing multiple screenshots and uploading them in batches to AI chat platforms like ChatGPT, Claude, and Grok. It stores screenshots temporarily in browser session storage using a FIFO queue (up to 10 snapshots) and operates without any backend server. The extension offers two primary modes: a "Capture Mode" for taking screenshots on regular websites and an "Upload Mode" that auto-detects AI chat sites to batch-upload all stored images.

Key capabilities include:
- Simplified annotation tools (Highlight Brush, Numbered Callouts, Text, Quick Stickers)
- Custom sticker templates
- Advanced PDF export options (combining all, separate, selected)
- Drag & drop reordering of thumbnails
- Multi-select operations (Select All, Copy Selected, Download Selected)
- Individual snapshot deletion and full-size preview
- Full multi-language support (all 55 Chrome-supported languages)
- Viral 55-language landing page with rotating story hero and animated transitions
- Revolutionary animated storytelling design inspired by Robin Noguier's portfolio
- Professional styling with glassmorphism, gradient effects, and premium branding
- World-class SaaS copywriting with enterprise-grade positioning

## User Preferences

Preferred communication style: Simple, everyday language.
Branding: Changed from "Flow" to "SnapToAI" (November 2025)
Logo Display: "Snap To AI" (with spaces for premium look)
Logo: Keep camera emoji (📸) in logo - user's preference
Design Inspiration: Robin Noguier's rotating message storytelling approach
Target Wow Factor: 100/10 - "Changing history" level design

## Landing Page Status - November 25, 2025

### Phase 4: REVOLUTIONARY DESIGN OVERHAUL ✅ (November 25, 2025)

**MAJOR REDESIGN INSPIRED BY ROBIN NOGUIER'S ANIMATED STORYTELLING**

#### Hero Section Transformation:
- **Rotating Message System**: 4 core messages that rotate every 4 seconds
  1. ⚡ **Fast** - "Convert any webpage to AI context in seconds, not minutes"
  2. 🔒 **Secure** - "Your screenshots stay on your computer. Zero servers. Zero tracking."
  3. 📈 **Productivity** - "Save 5-10 minutes per session. That's 40+ hours per year."
  4. 🤖 **Better for AI** - "ChatGPT, Claude, Grok - one click uploads to everything"

- **Dynamic Story Scenes**: Surrounding elements change with each message
  - Fast Scene: ⚡📸🚀⏱️✅ (speed, efficiency, action)
  - Secure Scene: 🔒🛡️🔐💻✓ (privacy, protection, trust)
  - Productivity Scene: 📈⏱️💰📊🎯 (metrics, time, ROI)
  - AI Scene: 🤖💬🧠⚙️🌐 (intelligence, platforms, integration)

- **Interactive Dot Navigation**: Click dots to jump to specific message or auto-rotate
- **Smooth Transitions**: Fade animations between scenes, 0.8s transitions
- **Two-Column Layout**: Left content + Right animated visuals

#### Feature Cards Enhancement:
- **9 Feature Cards** repositioned below hero with dual layer content
  1. 📸 Capture - From any webpage
  2. 🎯 Batch - Up to 10 at once
  3. 🤖 AI Ready - Auto-formatted
  4. 💬 ChatGPT - Instant upload
  5. ✨ Claude - Batch ready
  6. 🚀 Grok - One-click
  7. 🌍 55 Languages - Global support
  8. 🔒 Privacy First - Client-side only
  9. ⚡ Lightning Fast - Zero friction

- **Hero Stats** (improved layout):
  - 55 Languages
  - ∞ Screenshots
  - 0ms Server Upload

- **Dual CTA System**:
  - Primary: "Download for Chrome" (cyan gradient)
  - Secondary: "Try Demo" (transparent with border)

#### Implementation Details:

**HTML Structure:**
- Completely restructured for story-driven experience
- Semantic sections for each message story
- Grid-based 2-column hero layout
- Responsive feature cards grid

**CSS Innovations:**
- `hero-container`: 2-column grid layout
- `story-scene` containers: absolutely positioned overlays
- Dynamic scene element positioning with animations
- Smooth message transitions (0.8s fade)
- Message indicator dots with active state
- Feature cards with enhanced hover effects

**JavaScript Features:**
- **Message Rotation System**: Auto-cycles every 4 seconds
- **Interactive Dots**: Click to jump to message or pause auto-rotation
- **Scene Management**: Shows/hides corresponding story scenes
- **Transition Timing**: Staggered animations for narrative flow
- **Language Support**: Integrated with existing translation system
- **Demo Modal**: Keeps existing "Taste It Now" demo functionality

#### User Experience Flow:
1. Page loads → Hero shows first message (Fast) with speed-focused visuals
2. Auto-rotates every 4s: Fast → Secure → Productivity → AI
3. Each rotation animates message, description, and surrounding scene
4. User can click dots to jump to specific message
5. Scene elements float with parallax animation
6. Feature cards below tell complete product story
7. Dual CTAs visible for download or demo

#### Design Philosophy:
- **Storytelling First**: Each message tells part of a complete product narrative
- **Visual Hierarchy**: Rotating messages create narrative structure
- **Motion & Polish**: Smooth transitions feel premium and intentional
- **Multi-Language**: All messages and descriptions support 55 languages
- **Icon + Emoji**: Rich visual language without needing external images initially
- **Ready for Real Icons**: Structure prepared to accept real platform logos (ChatGPT, Claude, Grok, Edge, Brave, Vivaldi)

#### Next Steps for 100/10 Wow Factor:
- User will provide real SVG/PNG icons for:
  - AI Platforms: ChatGPT, Claude, Grok logos
  - Browsers: Edge, Brave, Vivaldi logos
  - Feature Icons: Camera, Lock, Speed, Globe, etc.
- Replace emojis with professional icon assets
- Add micro-interactions (click, hover effects)
- Optimize for viral social sharing

### Previous Phases Summary

#### Phase 1: SaaS Copywriting Transformation ✅
- Workflow-focused headline
- Enterprise positioning
- Social proof signals
- Problem definition section

#### Phase 2: Professional Audit Quick Wins ✅ (Score: 6.3 → 8-8.5/10)
- Branding consistency
- Testimonials with real attribution
- FAQ expansion (5→10 questions)
- Case studies section
- Professional footer with 16 links

#### Phase 3: Viral Growth Feature ✅
- "Taste It Now" interactive demo
- 3-step modal flow
- Code reveal with confetti celebration
- Lifetime deal $99 pricing anchor

### Live Deployment Status
- Landing page: **LIVE on Replit** (Flask server on port 5000)
- Multi-language support: **All 55 languages** with native translations
- Hero design: **Revolutionary rotating story system** (NEW - November 25)
- Feature cards: **Enhanced with platform/browser support messaging**
- Browser compatibility: **Chrome, Edge, Brave, Opera, Vivaldi**
- Demo feature: **"Taste It Now" interactive code generator**
- Ready for: **VIRAL LAUNCH** - Rotating story design tells complete product value

## System Architecture

### Frontend Architecture

The extension is built as a Manifest V3 Chrome Extension with modular components:
- **Service Worker (`background.js`)**: Manages screenshot capture via Chrome APIs, session storage (FIFO queue up to 10 snapshots), and inter-component messaging.
- **Content Script (`content.js`)**: Injected into all pages to handle floating toast notifications, AI platform upload logic, and cursor position tracking.
- **Popup Interface (`popup.html/css/js`)**: Provides the user interface with a glassmorphism dark theme, displaying thumbnail grids, selection controls, and capture/upload options.

### Data Storage Solutions

- **Chrome Session Storage (`chrome.storage.session`)**: Primary storage for screenshots as base64 dataURL strings. Implements a FIFO queue, automatically removing the oldest snapshots when the 10-snap limit is reached. Data is temporary and clears on browser restart.
- **Chrome Local Storage (`chrome.storage.local`)**: Used to store user preferences, such as the preferred AI platform selection.
- **No External Database**: The system is entirely client-side, with no server-side persistence.

### External Dependencies

### Browser APIs
- **Chrome Extensions API**: For core functionality including `chrome.tabs`, `chrome.storage.session`, `chrome.storage.local`, `chrome.runtime`, `chrome.action`, and `chrome.commands`.
- **Clipboard API**: `navigator.clipboard.write()` for automatic clipboard copying.
- **FileReader API**: For converting between Blob and dataURL formats.
- **DataTransfer API**: For programmatically populating file inputs during uploads.

### Target AI Platforms
- **ChatGPT** (chat.openai.com, chatgpt.com): Integrated for file input upload.
- **Claude AI** (claude.ai): Integrated for file input upload.
- **Grok** (grok.com): Integrated for file input upload.
Platform detection relies on hostname matching, with specific file input selectors defined for each.

### Development Server
- **Python HTTP Server**: Serves landing page on port 5000. Configured with Flask for multi-language support and proper caching.

## Technical Stack

### Frontend
- HTML5 with semantic structure
- CSS3 with animations, gradients, glassmorphism effects
- Vanilla JavaScript (no frameworks needed for landing page)
- Responsive mobile-first design

### Language Support
- 55 Chrome-supported languages
- Automatic browser language detection
- Manual language switcher
- Client-side translation system

### Performance
- All CSS animations are GPU-accelerated
- No external JavaScript libraries required (pure vanilla JS)
- Optimized asset loading
- Smooth scrolling enabled
