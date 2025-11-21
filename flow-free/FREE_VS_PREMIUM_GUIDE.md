# Flow Extension: Free vs Premium Version Strategy

This guide explains how to create and manage two versions of the Flow extension: a Free version (limited features) and a Premium/Paid version (all features).

---

## 📊 Feature Comparison

### **Free Version** (Basic)
✅ Screenshot capture (Ctrl+Shift+S + popup button)
✅ View thumbnails (max 10 FIFO queue)
✅ Session storage (privacy-safe)
✅ Clear all snaps
✅ Badge counter
✅ Basic dark UI
❌ No multi-select checkboxes
❌ No batch copy/download
❌ No individual delete
❌ No full-size preview
❌ No platform selector

### **Premium Version** (All Features)
✅ Everything in Free +
✅ Multi-select checkboxes
✅ Batch copy selected
✅ Batch download selected  
✅ Delete individual snaps (X button)
✅ Full-size preview modal
✅ Platform selector dropdown
✅ Premium glassmorphism UI
✅ Selection bar controls

---

## 🔧 Implementation Strategy

There are **3 main approaches** to creating free vs paid versions:

### **Option 1: Two Separate Extensions (Recommended)**

Create two completely separate extension folders:

```
project/
├── flow-free/          # Free version
│   ├── manifest.json   (name: "Flow Free", version: 1.0.0)
│   ├── popup.js        (features disabled)
│   └── ...
├── flow-premium/       # Premium version  
│   ├── manifest.json   (name: "Flow Premium", version: 1.0.0)
│   ├── popup.js        (all features enabled)
│   └── ...
```

**Pros:**
- Clean separation
- Easy to maintain
- Each published separately on Chrome Web Store
- Users install one or the other

**Cons:**
- Code duplication
- Need to update both when fixing bugs

---

### **Option 2: Feature Flags (Single Codebase)**

Use a license key system with feature flags:

```javascript
// config.js
const IS_PREMIUM = await checkLicenseKey(); // Check if user has valid license

// popup.js
if (IS_PREMIUM) {
  // Show multi-select, delete buttons, etc.
} else {
  // Hide premium features
}
```

**Pros:**
- Single codebase to maintain
- Users can upgrade without reinstalling
- Easier bug fixes

**Cons:**
- More complex code (lots of if/else)
- Need license key verification system
- Premium code visible to free users (security concern)

---

### **Option 3: Chrome Web Store Paid Items**

Publish one extension, use Chrome Web Store's built-in payment:

**Pros:**
- Google handles payments
- Official integration
- Automatic license management

**Cons:**
- Chrome Web Store takes 5% fee
- Limited pricing options
- Requires Google Payments setup

---

## 🚀 Recommended Approach: Two Separate Extensions

Here's how to create both versions:

### Step 1: Create Free Version

1. **Copy the current `flow` folder to `flow-free`**
   ```bash
   cp -r flow flow-free
   ```

2. **Edit `flow-free/manifest.json`:**
   ```json
   {
     "name": "Flow Free — Multi-Screenshot Capture",
     "version": "1.0.0",
     "description": "Free version: Capture up to 10 screenshots. Upgrade to Premium for multi-select, delete, and preview features.",
     ...
   }
   ```

3. **Edit `flow-free/popup.html`:**
   - Remove the selection bar (`<div id="selectionBar">`)
   - Keep basic thumbnail grid

4. **Edit `flow-free/popup.js`:**
   - Remove `selectedSnapIds` tracking
   - Remove checkbox rendering code
   - Remove delete button code
   - Remove preview modal code
   - Keep only: capture, view thumbnails, clear all

5. **Edit `flow-free/popup.css`:**
   - Remove `.selection-bar` styles
   - Remove `.thumbnail-checkbox` styles
   - Remove `.thumbnail-delete` styles
   - Remove `.preview-modal` styles

### Step 2: Create Premium Version

1. **Copy the current `flow` folder to `flow-premium`**
   ```bash
   cp -r flow flow-premium
   ```

2. **Edit `flow-premium/manifest.json`:**
   ```json
   {
     "name": "Flow Premium — Multi-Screenshot to AI",
     "version": "1.0.0",
     "description": "Premium version with multi-select, batch copy/download, individual delete, and full-size preview. Worth every penny!",
     ...
   }
   ```

3. **Keep ALL features** (this is already done)

---

## 💰 Pricing Strategy

### Free Version
- **Price:** $0 (Free)
- **Publish on:** Chrome Web Store (Free listing)
- **Target:** Users who want basic screenshot capture
- **Upsell:** Show "Upgrade to Premium" button in popup

### Premium Version
- **Price:** $4.99 - $9.99 (one-time payment) OR $1.99/month (subscription)
- **Publish on:** Chrome Web Store as paid extension
- **Target:** Power users, professionals, content creators
- **Value Prop:** "Save hours with batch operations"

---

## 📝 Publishing on Chrome Web Store

### Prerequisites
1. Google Developer Account ($5 one-time fee)
2. Extension ZIP file ready
3. Screenshots and promotional images
4. Privacy policy URL

### Step-by-Step Publishing

**For FREE Version:**
1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click "New Item"
3. Upload `flow-free.zip`
4. Fill in details:
   - Name: "Flow Free — Multi-Screenshot Capture"
   - Description: Emphasize basic features + mention Premium exists
   - Category: Productivity
   - Pricing: Free
5. Add screenshots (4-5 images showing UI)
6. Submit for review (takes 1-3 days)

**For PREMIUM Version:**
1. Same process as Free
2. In pricing section:
   - Select "This item uses Chrome Web Store Payments"
   - Set price: $4.99 (or your chosen price)
   - Choose one-time or subscription
3. Set up Google Payments account
4. Submit for review

---

## 🎨 Adding "Upgrade" Button to Free Version

Add this to `flow-free/popup.html`:

```html
<!-- After the Clear All button -->
<div class="upgrade-banner">
  <p>Want multi-select, delete, and preview?</p>
  <button id="upgradeBtn" class="upgrade-button">
    ⭐ Upgrade to Premium - $4.99
  </button>
</div>
```

Add CSS to `flow-free/popup.css`:

```css
.upgrade-banner {
  margin-top: 12px;
  padding: 12px;
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(255, 165, 0, 0.1));
  border: 2px solid rgba(255, 215, 0, 0.3);
  border-radius: 8px;
  text-align: center;
}

.upgrade-banner p {
  color: #ffd700;
  font-size: 11px;
  margin-bottom: 8px;
}

.upgrade-button {
  width: 100%;
  padding: 10px;
  background: linear-gradient(135deg, #ffd700, #ffa500);
  border: none;
  color: #000;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s ease;
}

.upgrade-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(255, 215, 0, 0.4);
}
```

Add click handler to `flow-free/popup.js`:

```javascript
document.getElementById('upgradeBtn')?.addEventListener('click', () => {
  chrome.tabs.create({ 
    url: 'https://chrome.google.com/webstore/detail/YOUR_PREMIUM_EXTENSION_ID' 
  });
});
```

---

## 📦 Creating ZIP Files for Upload

```bash
# Free version
cd flow-free
zip -r ../flow-free-v1.0.0.zip *

# Premium version  
cd ../flow-premium
zip -r ../flow-premium-v1.0.0.zip *
```

---

## 🔐 License Key System (Optional Advanced)

If you want ONE extension that unlocks features with a license key:

1. **Backend API** (you'll need a server):
   ```javascript
   // Example: Verify license key
   POST https://yourserver.com/api/verify-license
   { "licenseKey": "XXXX-XXXX-XXXX-XXXX" }
   Response: { "valid": true, "premium": true }
   ```

2. **Extension checks license on startup:**
   ```javascript
   async function checkPremium() {
     const { licenseKey } = await chrome.storage.sync.get('licenseKey');
     if (!licenseKey) return false;
     
     const response = await fetch('https://yourserver.com/api/verify-license', {
       method: 'POST',
       body: JSON.stringify({ licenseKey })
     });
     const data = await response.json();
     return data.premium;
   }
   ```

3. **Show/hide features based on result**

**Note:** This requires backend infrastructure (Firebase, AWS Lambda, etc.)

---

## 🎯 Summary

**Best Strategy for You:**
1. Create two separate extensions (flow-free and flow-premium)
2. Publish both on Chrome Web Store
3. Free version shows "Upgrade" button linking to Premium
4. Premium version is $4.99 one-time payment
5. Maintain code in parallel (copy-paste fixes to both)

**Why this works:**
- ✅ Simple to implement (no backend needed)
- ✅ Google handles payments
- ✅ Clear value proposition
- ✅ Easy for users to upgrade
- ✅ No ongoing server costs

---

## 📞 Next Steps

1. Create `flow-free` folder (remove premium features)
2. Create `flow-premium` folder (keep all features)
3. Test both versions locally
4. Create promotional screenshots
5. Write privacy policy
6. Publish to Chrome Web Store
7. Market Premium version to target audience

**Need Help?** Let me know and I can create the actual free/premium folder structures for you!
