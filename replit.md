# SnapToAI - Multi-Screenshot to AI Chrome Extension

## Overview

SnapToAI is a privacy-first Chrome Extension (Manifest V3) that enables users to capture multiple screenshots and batch upload them to AI chat platforms (ChatGPT, Claude, Grok). The extension operates entirely client-side with no backend server, storing screenshots temporarily in browser session storage and automatically managing a FIFO queue of up to 10 snapshots.

The extension provides two operational modes:
1. **Capture Mode** (on regular websites): Captures screenshots via keyboard shortcut or popup button, auto-copies to clipboard, and stores in session
2. **Upload Mode** (on AI platforms): Auto-detects AI chat sites and batch-uploads all stored screenshots directly to the platform's file input

**Premium Features:**
- **Simplified Annotation Tools**: Streamlined to 4 reliable tools with click-to-place UX
  - ✨ Highlight Brush: Glowing strokes with color picker and adjustable brush size (4-40px)
  - 🔢 Numbered Callouts: Add numbered markers (1, 2, 3...) with custom labels
  - ✏️ Text: Add custom text annotations that appear exactly where you click
  - 🏷️ Quick Stickers: Pre-made labels (BUG, IMPORTANT, FOCUS) + create your own custom stickers (max 5)
  - All annotations are fully draggable and can be deleted with the undo button
- **Custom Sticker Templates**: Users can create personalized sticker buttons with custom text (stored in chrome.storage.local)
- **Advanced PDF Export**: Full control over PDF generation with 4 export modes:
  - 📚 All as One PDF: Combine all screenshots into single combined PDF
  - 📑 All as Separate PDFs: Download each screenshot as individual PDF file
  - ✅ Selected as One PDF: Combine only selected screenshots into one PDF
  - 📋 Selected as Separate PDFs: Download each selected screenshot as individual PDF
  - Smart modal interface with disabled states when no selection exists
  - Clear file naming: `snaptoai-screenshots-{date}.pdf`, `snaptoai-screenshot-1-{date}.pdf`, etc.
- **Drag & Drop Reordering**: Rearrange thumbnails to control upload sequence
- **Multi-Select Operations**: Select All, Copy Selected, Download Selected batch actions
- **Delete Individual Snaps**: Remove unwanted screenshots with hover delete button
- **Full-Size Preview**: Click thumbnails to zoom and inspect screenshots
- **Complete Multi-Language Support**: All 55 Chrome-supported languages with full translations

## User Preferences

Preferred communication style: Simple, everyday language.
Branding: Changed from "Flow" to "SnapToAI" (November 2025)
Logo Display: "Snap To AI" (with spaces for premium look)
Tagline: "One click. One snap."
Subline: "Your pages, ready for AI in seconds."
Logo Animation: Each word animates independently with staggered timing, float effect, and glowing dual drop-shadow (WOW factor)

## System Architecture

### Frontend Architecture

**Extension Structure**: Chrome Extension Manifest V3 with modular components
- **Service Worker** (`background.js`): Handles screenshot capture via Chrome APIs, manages session storage, enforces FIFO queue limits, and coordinates messaging between components
- **Content Script** (`content.js`): Injected into all pages; manages floating toast notifications, handles AI platform upload logic, and tracks cursor position for toast placement
- **Popup Interface** (`popup.html/css/js`): User interface with glassmorphism dark theme; displays thumbnail grid, selection controls, and capture/upload controls

**UI Components**:
- Glowing cyan orb button (dual-purpose: capture on regular sites, upload on AI platforms)
- Thumbnail grid with multi-select checkboxes
- Selection toolbar with "Select All", "Copy Selected", "Download Selected" actions
- AI platform dropdown selector with auto-detect option
- Badge counter showing number of stored snapshots

**Styling Approach**: Custom CSS with dark gradient backgrounds, glassmorphism effects, and cyan accent colors; no external CSS frameworks

### Data Storage Solutions

**Chrome Session Storage**: Primary storage mechanism using `chrome.storage.session` API
- Stores screenshots as base64 dataURL strings
- Each snapshot includes: `id` (timestamp), `dataUrl` (base64 PNG), `timestamp`
- FIFO queue automatically removes oldest snapshots when exceeding 10-snap limit
- Data persists only during browser session (cleared on browser restart)

**Platform Preference Storage**: Uses `chrome.storage.local` to remember user's preferred AI platform selection

**No External Database**: Entirely client-side storage; no server-side persistence

### Authentication and Authorization Mechanisms

**No Authentication Required**: Extension operates without user accounts or login systems

**Chrome Extension Permissions**:
- `tabs`: Query active tab information
- `activeTab`: Capture visible tab screenshots
- `storage`: Access session and local storage APIs
- `scripting`: Inject content scripts dynamically
- `clipboardWrite`: Copy screenshots to clipboard

**Host Permissions**: Limited to specific AI platform domains (grok.com, chat.openai.com, chatgpt.com, claude.ai) for upload functionality

### Core Design Patterns

**Screenshot Capture Flow**:
1. User triggers capture via keyboard shortcut (`Ctrl+Shift+S`) or popup button click
2. Background service worker checks 500ms cooldown to prevent Chrome API rate limiting
3. Background service worker calls `chrome.tabs.captureVisibleTab()` to get dataURL
4. Converts dataURL to Blob for storage efficiency
5. Enforces FIFO queue (max 10 snapshots)
6. Updates badge counter and sends message to content script for toast notification
7. Popup handles clipboard write using `navigator.clipboard.write()` (requires user gesture context)

**AI Platform Upload Flow**:
1. Detects AI platform by checking active tab hostname
2. Content script queries DOM for file input elements using platform-specific selectors
3. Converts each stored dataURL → Blob → File object with incremental naming (`snap_1.png`, `snap_2.png`)
4. Uses `DataTransfer` API to populate file input's FileList
5. Dispatches `change` event to trigger platform's upload handler
6. Applies 1.4-second delay between uploads to ensure platform processes files sequentially
7. Clears session storage and resets badge after successful upload

**Privacy Architecture**:
- Zero external network requests (no backend server, no analytics)
- All screenshots stored locally in browser session storage
- Only uploads occur when user explicitly clicks upload on AI platform
- No tracking, no telemetry, no third-party services

### Message Passing System

**Chrome Runtime Messaging**: Coordinates communication between service worker, content script, and popup
- `capture`: Trigger screenshot capture
- `upload`: Initiate batch upload to AI platform
- `getSnaps`: Retrieve all stored snapshots
- `clearSnaps`: Clear all snapshots from storage
- `showToast`: Display floating notification
- `captureComplete`: Notify content script of successful capture
- `beginUpload`: Start upload sequence from content script

## External Dependencies

### Browser APIs
- **Chrome Extensions API**: Core extension functionality (Manifest V3)
  - `chrome.tabs`: Tab management and screenshot capture
  - `chrome.storage.session`: Temporary snapshot storage
  - `chrome.storage.local`: User preference persistence
  - `chrome.runtime`: Message passing between components
  - `chrome.action`: Badge updates and popup management
  - `chrome.commands`: Keyboard shortcut registration

- **Clipboard API**: `navigator.clipboard.write()` for auto-copy functionality
- **FileReader API**: Converting between Blob and dataURL formats
- **DataTransfer API**: Programmatically populating file inputs for upload

### Target AI Platforms
- **ChatGPT** (chat.openai.com, chatgpt.com): File input upload integration
- **Claude AI** (claude.ai): File input upload integration
- **Grok** (grok.com): File input upload integration

Platform detection uses hostname matching; file input selectors are defined in `utils/upload.js` with fallback strategies for each platform.

### Development Server
- **Python HTTP Server** (`server.py`): Simple file server for local development and testing
  - Serves extension files from `flow/` directory on port 5000
  - Disables caching for development workflow
  - No runtime dependency (only for development/installation)

### No External Libraries
The extension is built with vanilla JavaScript, HTML, and CSS without any npm packages, frameworks, or build tools. This ensures minimal size, maximum performance, and zero supply-chain security risks.