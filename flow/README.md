# Flow — Multi-Screenshot to AI

**Premium Chrome Extension for Batch Screenshot Capture & Upload to AI Platforms**

Flow is a powerful, privacy-safe Chrome extension that lets you capture multiple screenshots and batch upload them to AI chat platforms (ChatGPT, Claude, Grok) with one click.

## ✨ Features

- **Quick Capture**: Press `Ctrl+Shift+S` (or `Cmd+Shift+S` on Mac) to instantly capture screenshots
- **Smart Storage**: Automatically manages up to 10 snapshots with FIFO queue
- **Auto Clipboard**: Every screenshot is automatically copied to your clipboard
- **Multi-Select**: Check boxes to select specific images for batch operations
- **Batch Copy**: Copy multiple selected screenshots sequentially to clipboard
- **Batch Download**: Download selected screenshots as individual PNG files
- **Batch Upload**: One-click upload of all snapshots to AI platforms
- **Premium UI**: Beautiful dark glassmorphism interface with glowing cyan orb
- **Privacy First**: No external servers, no tracking, all data stays local
- **Platform Support**: ChatGPT, Claude AI, and Grok

## 🚀 Installation

### Load Unpacked Extension

1. **Open Chrome Extensions Page**
   - Navigate to `chrome://extensions/`
   - Or click Menu (⋮) → Extensions → Manage Extensions

2. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

3. **Load the Extension**
   - Click "Load unpacked"
   - Select the `flow` folder from this project
   - The Flow extension should now appear in your extensions list

4. **Pin the Extension** (Optional)
   - Click the extensions icon (puzzle piece) in Chrome toolbar
   - Find "Flow — Multi-Screenshot to AI"
   - Click the pin icon to keep it visible

## 📖 How to Use

### Capturing Screenshots

**Method 1: Keyboard Shortcut**
- Press `Ctrl+Shift+S` (Windows/Linux) or `Cmd+Shift+S` (Mac)
- Screenshot is automatically captured and saved
- Image is copied to your clipboard
- Badge shows number of captured snaps

**Method 2: Extension Popup**
- Click the Flow extension icon
- Click the glowing cyan orb button
- Screenshot is captured and added to your collection

### Viewing Your Snapshots

- Click the Flow extension icon to open the popup
- See all your captured screenshots as thumbnails
- Counter shows "X / 10" (current count / max capacity)
- Thumbnails are numbered for easy reference

### Uploading to AI Platforms

1. **Navigate to an AI Platform**
   - Go to ChatGPT, Claude, or Grok
   - Make sure you have snapshots captured

2. **Click the Orb**
   - Open Flow popup
   - Click the glowing cyan orb
   - All snapshots will upload automatically with 1.4s delay between each

3. **Auto-Clear**
   - After successful upload, all snapshots are cleared
   - Badge resets to 0
   - You'll see a success toast notification

### Managing Snapshots

- **Select Snaps**: Click checkboxes on thumbnails to select specific images
- **Select All / Deselect All**: Toggle to quickly select or deselect all snapshots
- **Copy Selected**: Copy selected screenshots to clipboard (sequentially)
- **Download Selected**: Download selected screenshots as PNG files to your computer
- **Clear All**: Click the red "Clear All" button to remove all snapshots
- **Auto FIFO**: When you reach 10 snapshots, oldest ones are automatically removed
- **Platform Selector**: Choose your preferred AI platform (or leave on Auto-detect)

## 🎨 UI Overview

- **Glowing Cyan Orb**: Main action button (capture or upload)
- **Status Line**: Shows current operation status
- **Counter**: Displays "X / 10" snapshot count
- **Thumbnails Grid**: Visual preview of all captured snapshots
- **Platform Dropdown**: Select target AI platform
- **Clear All Button**: Red button to clear all snapshots

## 🔒 Privacy & Security

- **No External Servers**: Everything runs locally in your browser
- **No Tracking**: Zero analytics or data collection
- **Session Storage Only**: Screenshots stored in Chrome's session storage
- **User-Initiated Uploads**: Only uploads when you click the orb on AI sites
- **No Permissions Abuse**: Minimal permissions for core functionality

## 🛠 Technical Details

- **Manifest Version**: V3 (latest Chrome extension standard)
- **Storage**: `chrome.storage.session` (temporary, cleared on browser close)
- **Capture API**: `chrome.tabs.captureVisibleTab`
- **Clipboard**: `navigator.clipboard.write()` (secure, requires user gesture)
- **No Dependencies**: Pure vanilla JavaScript, no external libraries

## 🎯 Supported AI Platforms

| Platform | URL | Status |
|----------|-----|--------|
| ChatGPT | chatgpt.com, chat.openai.com | ✅ Supported |
| Claude | claude.ai | ✅ Supported |
| Grok | grok.com | ✅ Supported |

## 🐛 Troubleshooting

**Screenshots not capturing?**
- Make sure the tab is visible and active
- Check that you have the `activeTab` permission enabled
- Try refreshing the page and trying again

**Upload not working?**
- Ensure you're on a supported AI platform
- Check that the AI platform's file input is available on the page
- Try capturing the screen again

**Clipboard not working?**
- Clipboard write requires user gesture (click or keyboard shortcut)
- Make sure the content script has loaded (wait 1-2 seconds after page load)

**Badge not updating?**
- Refresh the extension popup
- Try capturing a new screenshot

## 📝 Version History

### v1.0.0 (Initial Release)
- Screenshot capture with Ctrl+Shift+S
- Session storage with FIFO queue (max 10)
- Auto clipboard copy
- Batch upload to AI platforms
- Premium glassmorphism UI
- Floating toast notifications
- Badge counter
- Platform auto-detection

## 💎 Premium Features

This is the premium version of Flow with:
- Unlimited capture sessions
- Premium UI design
- Advanced upload logic with delays
- Multi-platform support
- Professional toast notifications
- Auto-clear functionality

## 📄 License

All rights reserved. This is a premium extension.

## 🙏 Support

If you encounter any issues, please ensure:
1. You're using the latest version of Chrome
2. Developer mode is enabled
3. The extension has all required permissions

---

**Flow** — Capture. Upload. Flow. 🌊
