# Flow Extension - Deployment Guide

## 🌍 Browser Compatibility

Your extension works on:
- ✅ **Chrome** - Full support
- ✅ **Microsoft Edge** - 100% compatible (same Chromium engine)
- ✅ **Opera** - 100% compatible
- ✅ **Brave** - 100% compatible
- ✅ **Firefox** - Works with minor adjustments (change `chrome.*` to `browser.*` in code)

## 🗣️ Language Support (10 Languages)

Automatically detects user's browser language:
1. **English** (en)
2. **Spanish** (es)
3. **French** (fr)
4. **German** (de)
5. **Portuguese** (pt)
6. **Italian** (it) - Add messages.json
7. **Japanese** (ja)
8. **Chinese Simplified** (zh_CN)
9. **Arabic** (ar)
10. **Russian** (ru) - Add messages.json

## 💰 Subscription Model

### Current Implementation:
- **30 days free trial** (starts on install)
- **$9.90/year** subscription after trial
- License key validation system
- Stripe integration ready

### Setup Steps:

1. **Create Stripe Product:**
   - Go to [Stripe Dashboard](https://dashboard.stripe.com)
   - Create product: "Flow Extension - Annual"
   - Price: $9.90/year
   - Get your checkout link

2. **Update subscription.js:**
   ```javascript
   const STRIPE_CHECKOUT_URL = 'https://buy.stripe.com/YOUR_ACTUAL_LINK';
   ```

3. **Backend Server (Required for Production):**
   - Set up a simple server to validate license keys
   - Store customer data from Stripe webhooks
   - Validate extension ID + license key

### Simple Backend Example (Node.js/Express):
```javascript
app.post('/verify-license', async (req, res) => {
  const { licenseKey, extensionId } = req.body;
  
  // Check your database
  const isValid = await checkLicenseInDB(licenseKey, extensionId);
  
  res.json({ valid: isValid });
});
```

## 📦 Publishing to Chrome Web Store

1. **Prepare for submission:**
   ```bash
   # Create ZIP file
   zip -r flow-extension.zip flow/ -x "*.git*" "*.DS_Store"
   ```

2. **Chrome Web Store Developer Account:**
   - One-time fee: $5
   - Create at: https://chrome.google.com/webstore/devconsole

3. **Required Assets:**
   - Store listing icon: 128x128px
   - Screenshots: 1280x800px or 640x400px
   - Promotional images (optional)

4. **Store Listing Info:**
   - Category: Productivity
   - Language: All 10 supported languages
   - Pricing: Free with in-app purchases

## 🚀 Publishing to Other Stores

### Microsoft Edge Add-ons
- Use same ZIP file
- No changes needed
- https://partner.microsoft.com/dashboard

### Firefox Add-ons
1. Change `chrome.*` to `browser.*` in code
2. Submit at: https://addons.mozilla.org/developers/

### Opera Add-ons
- Use same ZIP file
- https://addons.opera.com/developer/

## 💡 Monetization Tips

1. **Offer Team Plans:**
   - 5 licenses for $39.90/year
   - 10 licenses for $69.90/year

2. **Limited Free Version:**
   - Max 3 screenshots per day
   - No PDF export
   - Upgrade for unlimited

3. **Affiliate Program:**
   - Give users referral codes
   - 20% commission on referrals

## 🔧 Testing Payments

1. **Stripe Test Mode:**
   - Use test card: 4242 4242 4242 4242
   - Any future expiry date
   - Any CVC

2. **Test License Keys:**
   - Generate format: `FLOW-XXXX-XXXX-XXXX-XXXX`
   - Store in test database

## 📊 Analytics (Optional)

Add Google Analytics:
```javascript
// In background.js
gtag('event', 'trial_started', {
  'event_category': 'subscription',
  'value': 1
});
```

## ✅ Launch Checklist

- [ ] Stripe account created and verified
- [ ] Product and pricing set up in Stripe
- [ ] Backend server deployed (Heroku, Vercel, etc.)
- [ ] License validation API working
- [ ] All 10 language translations complete
- [ ] Chrome Web Store account created
- [ ] Store listing prepared
- [ ] Privacy policy page created
- [ ] Support email set up
- [ ] Extension tested on all browsers

## 🎯 Revenue Projections

With proper marketing:
- **Month 1:** 100 users (trial) = $0
- **Month 2:** 50 conversions = $495
- **Month 6:** 500 paid users = $4,950
- **Year 1:** 2,000 paid users = $19,800

## Support & Updates

- Email support: support@flow-extension.com
- Regular updates every 2 months
- Feature requests tracker
- User community forum

Good luck with your launch! 🚀