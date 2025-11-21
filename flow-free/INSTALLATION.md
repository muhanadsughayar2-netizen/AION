# Flow Chrome Extension - Installation & Testing Guide

## Quick Installation

### 1. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `flow` folder from this project
5. The Flow extension should now appear with a cyan orb icon

### 2. Pin the Extension (Recommended)

1. Click the extensions icon (puzzle piece) in Chrome toolbar
2. Find "Flow — Multi-Screenshot to AI"
3. Click the pin icon to keep it visible in the toolbar

## Testing the Extension

### Test 1: Capture Screenshots

**Using Popup (Recommended):**
1. Click the Flow icon in the toolbar
2. Click the glowing cyan orb button
3. You should see:
   - Screenshot captured
   - Image copied to clipboard (paste to verify)
   - Toast notification appears
   - Badge shows "●1"
   - Thumbnail appears in popup

**Using Keyboard Shortcut:**
1. Press `Ctrl+Shift+S` (Windows/Linux) or `Cmd+Shift+S` (Mac)
2. You should see:
   - Toast notification appears
   - Badge updates
   - Screenshot is stored (verify in popup)
   
**Note:** Clipboard auto-copy works best when using the popup. Keyboard shortcuts may not reliably copy to clipboard due to browser security restrictions on user gesture context.

### Test 2: Multiple Captures

1. Capture 3-5 screenshots using the popup
2. Open the popup to verify:
   - Counter shows "5 / 10"
   - All 5 thumbnails visible with checkboxes in top-left
   - Selection bar appears with "Select All", "Copy Selected", "Download Selected" buttons
   - Scrollable grid if needed

### Test 3: FIFO Queue (Max 10)

1. Capture 12 screenshots
2. Verify:
   - Counter shows "10 / 10"
   - Only the 10 most recent are kept
   - Oldest snapshots removed automatically

### Test 4: Upload to AI Platform

**ChatGPT:**
1. Navigate to `https://chatgpt.com`
2. Capture 2-3 screenshots
3. Click the Flow icon
4. Click the glowing orb button
5. Verify:
   - Status shows "Uploading X snaps..."
   - Files appear in ChatGPT's file input
   - 1.4s delay between uploads
   - Success toast after completion
   - Badge resets to empty
   - Popup shows 0 snaps

**Claude:**
1. Navigate to `https://claude.ai`
2. Repeat same steps as ChatGPT

**Grok:**
1. Navigate to `https://grok.com`
2. Repeat same steps as ChatGPT

### Test 5: Multi-Select & Batch Operations

1. Capture 5 screenshots
2. Open the Flow popup
3. Verify you see the selection bar with 3 buttons
4. Click checkboxes on 3 thumbnails (they should glow cyan)
5. Click "Copy Selected" - all 3 images copied sequentially
6. Click "Select All" - all thumbnails selected
7. Click "Download Selected" - all 5 images download to your computer
8. Click "Deselect All" - all checkboxes cleared

### Test 6: Platform Selector

1. Navigate to ChatGPT
2. Capture some screenshots
3. Open popup and select "Claude" from dropdown
4. Click orb to upload
5. Verify it attempts to use Claude's selectors (may fail if not on Claude.ai)

### Test 7: Clear All

1. Capture 5 screenshots
2. Open popup
3. Click the red "Clear All" button
4. Verify:
   - All thumbnails removed
   - Counter shows "0 / 10"
   - Badge cleared

## Common Issues & Solutions

### Issue: Clipboard not working
**Solution:** Use the popup to capture instead of keyboard shortcut. Popup has reliable user gesture context.

### Issue: Upload not working on AI platforms
**Solution:** 
- Make sure the file input is visible on the page
- Try refreshing the AI platform page
- Check if the platform has updated their UI (selectors may need updating)

### Issue: Badge not updating
**Solution:** 
- Refresh the extension popup
- Try disabling and re-enabling the extension

### Issue: Toast not appearing
**Solution:**
- Check if content script loaded (wait 2-3 seconds after page load)
- Refresh the page and try again

## Browser Compatibility

- **Supported:** Chrome 88+, Edge 88+, Brave, Opera
- **Manifest:** V3 (latest standard)
- **Requires:** Chrome extensions with Manifest V3 support

## Privacy & Security

- **No external servers:** All data stays in your browser
- **Session storage:** Cleared when browser closes
- **No tracking:** Zero analytics or data collection
- **User control:** Only uploads when you click the orb on AI sites

## File Structure

```
flow/
├── manifest.json          # Extension manifest (Manifest V3)
├── background.js          # Service worker (capture, storage, badge)
├── content.js            # Content script (toasts, uploads)
├── popup.html            # Popup UI structure
├── popup.css             # Premium dark glassmorphism styles
├── popup.js              # Popup logic and interactions
├── utils/
│   ├── capture.js        # Capture helper functions
│   └── upload.js         # Upload helper functions
├── icons/
│   ├── icon16.png        # 16x16 cyan orb icon
│   ├── icon48.png        # 48x48 cyan orb icon
│   └── icon128.png       # 128x128 cyan orb icon
└── README.md             # Main documentation
```

## Development Notes

### Keyboard Shortcut Limitation

Due to Chrome's security model, clipboard writes triggered by keyboard shortcuts may not work reliably because the user gesture context doesn't propagate through the background service worker messaging chain. For best results, use the popup to capture screenshots.

### AI Platform Selectors

The extension uses CSS selectors to find file inputs on AI platforms. If a platform updates their UI, the selectors may need to be updated in `content.js` and `utils/upload.js`.

### Session Storage

Screenshots are stored in `chrome.storage.session`, which means they are automatically cleared when the browser closes. This ensures privacy but also means captures don't persist between browser sessions.

## Support

If you encounter issues:
1. Check the browser console for errors (`F12` → Console tab)
2. Check the extension's background page console (`chrome://extensions/` → Details → Inspect views: service worker)
3. Verify all permissions are granted
4. Try reloading the extension

---

**Flow** — Capture. Upload. Flow. 🌊
