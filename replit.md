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
- Viral 55-language landing page with auto-detection, glassmorphism design, and responsive mobile-first approach.
- Professional styling with clean aesthetics, elegant text badges, and consistent branding.
- World-class SaaS copywriting transformation positioning the product as an enterprise-grade AI workflow solution, emphasizing time savings, privacy, and workflow transformation.

## User Preferences

Preferred communication style: Simple, everyday language.
Branding: Changed from "Flow" to "SnapToAI" (November 2025)
Logo Display: "Snap To AI" (with spaces for premium look)
Tagline: "One click. One snap."
Subline: "Your pages, ready for AI in seconds."
Logo Animation: Each word animates independently with staggered timing, float effect, and glowing dual drop-shadow (WOW factor)
Logo: Keep camera emoji (📸) in logo - user's preference

## System Architecture

### Frontend Architecture

The extension is built as a Manifest V3 Chrome Extension with modular components:
- **Service Worker (`background.js`)**: Manages screenshot capture via Chrome APIs, session storage (FIFO queue up to 10 snapshots), and inter-component messaging.
- **Content Script (`content.js`)**: Injected into all pages to handle floating toast notifications, AI platform upload logic, and cursor position tracking.
- **Popup Interface (`popup.html/css/js`)**: Provides the user interface with a glassmorphism dark theme, displaying thumbnail grids, selection controls, and capture/upload options.
UI/UX decisions include a glowing cyan orb button, thumbnail grid with multi-select, and a selection toolbar. Styling uses custom CSS for dark gradients, glassmorphism effects, and cyan accents, without external CSS frameworks.

### Data Storage Solutions

- **Chrome Session Storage (`chrome.storage.session`)**: Primary storage for screenshots as base64 dataURL strings. It implements a FIFO queue, automatically removing the oldest snapshots when the 10-snap limit is reached. Data is temporary and clears on browser restart.
- **Chrome Local Storage (`chrome.storage.local`)**: Used to store user preferences, such as the preferred AI platform selection.
- **No External Database**: The system is entirely client-side, with no server-side persistence.

### Core Design Patterns

- **Screenshot Capture Flow**: Triggered by user input (keyboard shortcut or popup button), the service worker captures the visible tab, converts the dataURL to a Blob, enforces the FIFO queue, updates the badge, and sends a toast notification. Clipboard writing is handled by the popup.
- **AI Platform Upload Flow**: Detects AI platforms by hostname. The content script finds file input elements, converts stored dataURLs to File objects, uses the `DataTransfer` API to populate inputs, and dispatches change events. A 1.4-second delay is applied between uploads for processing.
- **Privacy Architecture**: The extension has zero external network requests, no backend server, no analytics, and all data is stored locally. Uploads only occur with explicit user action, ensuring no tracking or third-party service involvement.
- **Message Passing System**: Chrome Runtime Messaging facilitates communication between the service worker, content script, and popup for actions like capturing, uploading, retrieving/clearing snaps, and displaying toasts.

### System Design Choices

- **Language Support**: All 55 Chrome-supported languages are fully translated for UI elements, marketing copy, and browser compatibility sections.
- **Aesthetic**: A professional, clean aesthetic replaces decorative emojis with elegant text badges, emphasizing a premium feel.
- **Performance**: Vanilla JavaScript, HTML, and CSS are used, avoiding npm packages, frameworks, or build tools for minimal size and maximum performance.

## External Dependencies

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
- **Python HTTP Server (`server.py`)**: A simple local file server used only for development and testing, serving extension files and disabling caching. It is not a runtime dependency.