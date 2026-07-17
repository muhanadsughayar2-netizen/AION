---
name: CDP Methods Reference
description: Chrome DevTools Protocol domains and methods used in the Aion AI Autopilot agent (background.js). Kept current as the authoritative reference for all CDP usage in this project.
---

# CDP Methods — Aion AI Autopilot Reference

## How we attach/detach

```js
chrome.debugger.attach({ tabId }, '1.3', callback)
chrome.debugger.detach({ tabId }, callback)
chrome.debugger.sendCommand({ tabId }, method, params, callback)
```

Only ONE debugger can be attached per tab at a time. If DevTools is open on that tab, attach() fails. Always detach in a `finally` block.

---

## Input domain

### Input.dispatchMouseEvent
Fire a trusted hardware-level mouse event. `isTrusted:true` — pages cannot distinguish from a real click.

```js
{ type: 'mousePressed'|'mouseReleased'|'mouseMoved',
  x, y,
  button: 'left'|'right'|'middle',
  buttons: 1,        // bitmask: left=1
  clickCount: 1|2,   // 2 for double-click
  modifiers: 0       // Alt=1, Ctrl=2, Meta=4, Shift=8
}
```

### Input.dispatchKeyEvent
Types: `'rawKeyDown'` (modifier keys, arrows, Enter, Escape — no text insertion), `'keyDown'` (inserts text via `text` field), `'keyUp'`, `'char'` (inserts single character, no keyCode needed).

```js
// Printable character — use 'char':
{ type: 'char', text: 'a', unmodifiedText: 'a', key: 'a' }

// Special key (Enter, Tab, arrows) — use rawKeyDown + keyUp:
{ type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
{ type: 'keyUp',     key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }

// Keyboard shortcut (Ctrl+S) — rawKeyDown with modifiers bitmask:
{ type: 'rawKeyDown', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 }
{ type: 'keyUp',      modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 }
```

**Modifier bitmask**: Alt=1, Ctrl=2, Meta=4, Shift=8. Combine with `|`.

**IMPORTANT**: `keyDown` with `text` field inserts text AND fires key events. `char` inserts text only. Do NOT send both `keyDown`+`char` for the same character — that causes doubled text.

---

## Runtime domain

Must call `Runtime.enable` before `Runtime.evaluate`.

### Runtime.evaluate
Execute JavaScript in the page's main frame context.

```js
// params:
{ expression: '...JS string...',
  awaitPromise: true,    // if expression returns a Promise
  returnByValue: true    // get result as plain value not remote object ref
}
// returns: { result: { type, value, description }, exceptionDetails? }
```

**Key use case — focus the Google Docs hidden input iframe**:
```js
await Runtime.evaluate({
  expression: `(async () => {
    const iframe = document.querySelector('.docs-texteventtarget-iframe');
    if (!iframe?.contentDocument) return 'no-iframe';
    iframe.contentDocument.body.focus();
    return 'focused';
  })()`,
  awaitPromise: true,
  returnByValue: true
});
```

**Key use case — focus Excel Online Name Box**:
```js
await Runtime.evaluate({
  expression: `(async () => {
    const nb = document.querySelector(
      'input[aria-label="Name Box"], input#NameBox, input.nameBox'
    );
    if (nb) { nb.focus(); nb.select(); return 'found'; }
    return 'not-found';
  })()`,
  awaitPromise: true,
  returnByValue: true
});
```

### Runtime.callFunctionOn
Run a function on a specific remote object (e.g. a DOM node returned by a previous call). Less common — use Runtime.evaluate for most cases.

---

## Accessibility domain

Must call `Accessibility.enable` before other Accessibility methods.

### Accessibility.queryAXTree  ← THE WOW-FACTOR METHOD
Find elements by their **accessible name** (visible label) and/or **role**, anywhere on the page — including inside iframes and shadow DOM. CSS selector knowledge not required.

```js
// params:
{ accessibleName: 'Save',         // what the user sees / what a screen reader reads
  role: 'button'                  // optional: button, link, menuitem, textbox, etc.
  // nodeId / backendNodeId / objectId — scope the search to a subtree (optional)
}

// returns:
{ nodes: [
    { nodeId, backendDOMNodeId, role: {value}, name: {value}, description: {value}, ... }
  ]
}
```

Use `backendDOMNodeId` from the result to get coordinates via `DOM.getBoxModel`.

**Roles to try when searching by text**: `button`, `link`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`, `tab`, `treeitem`, `textbox`, `combobox`

### Accessibility.getFullAXTree
Returns the complete accessibility tree. Useful for debugging what's visible but slow on large pages. Avoid in production loops.

### Accessibility.enable / disable
Must enable before queries. Disable when done to free resources (or just detach debugger).

---

## DOM domain

Must call `DOM.enable` before DOM methods.

### DOM.getBoxModel
Get the exact bounding box of any element given its `backendDOMNodeId` (from Accessibility queries).

```js
// params:
{ backendNodeId: 12345 }

// returns:
{ model: {
    content: [x1,y1, x2,y1, x2,y2, x1,y2],  // quad — 8 numbers, clockwise from top-left
    padding: [...],
    border: [...],
    margin: [...],
    width, height
} }

// Get center:
const [x1, y1, x2, , , y3] = box.model.content;
const cx = (x1 + x2) / 2;
const cy = (y1 + y3) / 2;
```

### DOM.querySelector
Find a node by CSS selector within the document.
```js
{ nodeId: rootNodeId, selector: '.some-class' }  → { nodeId }
```

### DOM.getDocument
Get the root document node (needed for DOM.querySelector scope).
```js
{}  →  { root: { nodeId, backendNodeId, ... } }
```

---

## Page domain

### Page.enable
Required before Page events and some Page methods.

### Page.handleFileChooser
Intercept a file-chooser dialog triggered by clicking a file-input button, and programmatically provide the file path — bypasses the OS file picker entirely.

```js
// Step 1: set interception BEFORE triggering the file input
Page.setInterceptFileChooserDialog({ enabled: true });

// Step 2: listen for Page.fileChooserOpened event
// Step 3: respond with files
Page.handleFileChooser({ action: 'accept', files: ['/path/to/file.pdf'] });
// or cancel:
Page.handleFileChooser({ action: 'cancel' });
```

**Why useful**: Word Online "attach file" / "insert picture" opens a native OS dialog — this intercepts it and injects the file without OS interaction.

---

## Combining Accessibility + DOM — the full "find and click" pattern

```js
// 1. Enable needed domains
await CDP('Accessibility.enable');
await CDP('DOM.enable');

// 2. Find element by what the user sees
const { nodes } = await CDP('Accessibility.queryAXTree', {
  accessibleName: 'Save',   // visible label
  role: 'button'            // narrow to buttons only
});

// 3. Get its screen position
const { model } = await CDP('DOM.getBoxModel', { backendNodeId: nodes[0].backendDOMNodeId });
const [x1, y1, x2, , , y3] = model.content;
const cx = (x1 + x2) / 2, cy = (y1 + y3) / 2;

// 4. Trusted click
await CDP('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
await CDP('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
```

---

## App-specific typing strategies (confirmed working)

| App | Strategy |
|-----|-----------|
| Google Docs | `Runtime.evaluate` → focus `.docs-texteventtarget-iframe` body → CDP `char` events |
| Google Sheets | CDP double-click canvas → `keyDown` + `text` field events |
| Excel Online | `Runtime.evaluate` → focus Name Box → type "A1" + Enter → CDP click grid → `char` events |
| Word Online | CDP single-click iframe → `char` events |
| Any app — save | CDP `rawKeyDown` with modifiers=2, key='s' (Ctrl+S) |
| Any app — shortcuts | CDP `rawKeyDown` with modifier bitmask |

## Animation domain (reference)

Mostly useful for debugging/testing — not needed for automation:
- `Animation.enable/disable` — enable animation events
- `Animation.getCurrentTime` — get current time of an animation
- `Animation.setPlaybackRate` — speed up/slow down all animations (useful for testing)
- `Animation.setPaused` — pause/resume animations
- `Animation.seekAnimations` — jump to a time position

For agent automation, the most relevant use: `Animation.setPlaybackRate({ playbackRate: 0 })` to freeze all CSS/JS animations before taking screenshots (avoids motion blur / mid-transition captures).

---

## Autofill domain — fill forms in one call ⭐

`Autofill.trigger` fills an entire form automatically given a `DOM.BackendNodeId` anchor field. No clicking, no typing — one call.

```js
await CDP('Autofill.enable');

// Fill with address
await CDP('Autofill.trigger', {
  fieldId: backendNodeId,   // any field in the form (anchor)
  frameId: frameId,         // Page.FrameId the field lives in
  address: {
    fields: [
      { name: 'GIVEN_NAME',   value: 'Jon' },
      { name: 'FAMILY_NAME',  value: 'Doe' },
      { name: 'ADDRESS_LINE1',value: '123 Main St' },
      { name: 'CITY',         value: 'New York' },
      { name: 'STATE',        value: 'NY' },
      { name: 'ZIP_CODE',     value: '10001' },
      { name: 'COUNTRY_CODE', value: 'US' },
      { name: 'EMAIL',        value: 'jon@example.com' },
      { name: 'PHONE',        value: '+12125550100' },
    ]
  }
});

// Fill with credit card (mutually exclusive with address)
await CDP('Autofill.trigger', {
  fieldId: backendNodeId,
  frameId: frameId,
  card: {
    number: '4111111111111111',
    name: 'Jon Doe',
    expiryMonth: '12',
    expiryYear: '2028',
    cvc: '123'
  }
});
```

**How to get fieldId + frameId**: use `Accessibility.queryAXTree` to find the first form input, then `DOM.getBoxModel` gives `backendNodeId`. For `frameId`, use `Page.getFrameTree` and pick the main frame's `id`.

**Event fired**: `Autofill.addressFormFilled` — confirms which fields were actually filled.

Full address field name list: `GIVEN_NAME`, `FAMILY_NAME`, `FULL_NAME`, `EMAIL`, `PHONE`, `ADDRESS_LINE1`, `ADDRESS_LINE2`, `CITY`, `STATE`, `ZIP_CODE`, `COUNTRY_CODE`, `COMPANY_NAME`. See [Chromium source](https://source.chromium.org/chromium/chromium/src/+/main:components/autofill/core/browser/field_types.cc;l=38).

---

## Browser domain — permissions, downloads, window control

### Browser.setPermission — grant any permission without the OS dialog ⭐
```js
await CDP('Browser.setPermission', {
  permission: { name: 'clipboard-read' },   // or clipboard-write, camera, microphone, geolocation, notifications...
  setting: 'granted',                        // 'granted' | 'denied' | 'prompt'
  origin: 'https://example.com'             // omit = all origins
});
```
**Useful for**: granting clipboard access so `navigator.clipboard.writeText/readText` works without a prompt; granting camera for WebRTC tests; granting notifications.

Full `name` values: `clipboard-read`, `clipboard-write`, `camera`, `microphone`, `geolocation`, `notifications`, `midi`, `sensors`, `backgroundSync`, `periodicBackgroundSync`, `nfc`, `keyboardLock`, `idleDetection`, `displayCapture`, `durableStorage`, `payment-handler`, `smartCard`.

### Browser.setDownloadBehavior — control file download destination ⭐
```js
await CDP('Browser.setDownloadBehavior', {
  behavior: 'allowAndName',    // 'allow' | 'deny' | 'allowAndName' | 'default'
  downloadPath: '/tmp/agent-downloads',
  eventsEnabled: true          // fires Browser.downloadProgress events
});
```
Events: `Browser.downloadWillBegin` (has `url`, `suggestedFilename`, `guid`), `Browser.downloadProgress` (has `receivedBytes`, `totalBytes`, `state`).

**cancelDownload**: `Browser.cancelDownload({ guid })`.

### Browser.setWindowBounds — resize/move the browser window
```js
const { windowId } = await CDP('Browser.getWindowForTarget');
await CDP('Browser.setWindowBounds', {
  windowId,
  bounds: { left: 0, top: 0, width: 1280, height: 900, windowState: 'normal' }
  // windowState: 'normal' | 'minimized' | 'maximized' | 'fullscreen'
});
```

### Browser.resetPermissions — clear all permission overrides
```js
await CDP('Browser.resetPermissions', {});
```

---

## CSS domain — pseudo-states and computed styles

### CSS.forcePseudoState — trigger hover/focus menus ⭐
Force CSS pseudo-classes on an element without actually hovering. Essential for expanding dropdown menus that only appear on `:hover`.

```js
await CDP('CSS.enable');

// Get nodeId via DOM first
const { root } = await CDP('DOM.getDocument');
const { nodeId } = await CDP('DOM.querySelector', { nodeId: root.nodeId, selector: '.nav-menu' });

// Force :hover — exposes dropdown sub-items
await CDP('CSS.forcePseudoState', {
  nodeId,
  forcedPseudoClasses: ['hover']   // array: 'active', 'focus', 'focus-within', 'focus-visible', 'hover', 'visited', 'target', 'enabled', 'disabled', 'checked'
});

// After clicking the sub-item, release the forced state
await CDP('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
```

### CSS.getComputedStyleForNode — read final resolved styles
```js
const { computedStyle } = await CDP('CSS.getComputedStyleForNode', { nodeId });
// computedStyle = [{ name: 'display', value: 'flex' }, { name: 'color', value: 'rgb(0,0,0)' }, ...]
const display = computedStyle.find(p => p.name === 'display')?.value;
```

### CSS.getMatchedStylesForNode — see exactly which rules apply
Returns inline styles, matched CSS rules, pseudo-element styles, inherited chain. Useful for debugging why an element looks a certain way.

---

## Debugger domain — live JavaScript patching

### Debugger.setScriptSource — edit live JavaScript on a running page ⭐
Replace the source of any already-loaded script. The change takes effect immediately — no reload required. Useful for patching rate limits, disabling confirmations, or injecting helper code.

```js
await CDP('Debugger.enable');

// 1. Listen for Debugger.scriptParsed to capture script IDs:
//    { scriptId, url, ... }

// 2. Patch a specific script
await CDP('Debugger.setScriptSource', {
  scriptId: '42',
  scriptSource: '...new source code...',
  dryRun: false   // true = validate only, false = apply for real
});
// Returns: { status: 'Ok' | 'CompileError' | 'BlockedByActiveFunction' | ... }
```

**Limitation**: cannot edit a function that is currently on the call stack (returns `BlockedByActiveFunction`).

### Debugger.evaluateOnCallFrame — run code in a paused frame
Only works when execution is paused (after a breakpoint). Evaluates in the full local/closure scope of that frame — can read/write local variables.
```js
const { result } = await CDP('Debugger.evaluateOnCallFrame', {
  callFrameId: frame.callFrameId,
  expression: 'localVariable',
  returnByValue: true
});
```

### Debugger.setBreakpointByUrl — set a persistent breakpoint
```js
const { breakpointId } = await CDP('Debugger.setBreakpointByUrl', {
  url: 'https://example.com/app.js',
  lineNumber: 42,
  condition: 'amount > 1000'  // optional — only break if true
});
```

---

## Console domain (deprecated — prefer Log or Runtime)

`Console.enable` then listen for `Console.messageAdded` events:
```js
// event payload:
{ message: {
    source: 'javascript' | 'network' | 'console-api' | ...,
    level: 'log' | 'warning' | 'error' | 'debug' | 'info',
    text: 'the message string',
    url, line, column
} }
```
**Better alternative**: `Runtime.enable` + listen for `Runtime.consoleAPICalled` and `Runtime.exceptionThrown` — richer data including stack traces and object references.

---

## CacheStorage domain — inspect/clear Service Worker caches

```js
// List all caches for an origin
const { caches } = await CDP('CacheStorage.requestCacheNames', {
  storageKey: 'https://example.com'
});

// Read entries from a cache
const { cacheDataEntries } = await CDP('CacheStorage.requestEntries', {
  cacheId: caches[0].cacheId,
  pageSize: 100
});

// Delete a specific cached response
await CDP('CacheStorage.deleteEntry', {
  cacheId: caches[0].cacheId,
  request: 'https://example.com/api/data'
});

// Delete an entire cache
await CDP('CacheStorage.deleteCache', { cacheId: caches[0].cacheId });
```

**Useful for**: forcing a fresh fetch by clearing cached responses; inspecting what a PWA has stored.

---

## BackgroundService domain — monitor Service Worker background events

```js
await CDP('BackgroundService.startObserving', { service: 'backgroundSync' });
// services: backgroundFetch, backgroundSync, pushMessaging, notifications, paymentHandler, periodicBackgroundSync

// Event: BackgroundService.backgroundServiceEventReceived
// { backgroundServiceEvent: { timestamp, origin, eventName, instanceId, eventMetadata: [{key,value}] } }

await CDP('BackgroundService.stopObserving', { service: 'backgroundSync' });
await CDP('BackgroundService.clearEvents', { service: 'backgroundSync' });
```

---

## DeviceAccess domain — handle USB/Bluetooth device prompts

When a page calls `navigator.usb.requestDevice()` or `navigator.bluetooth.requestDevice()`, Chrome shows a picker. CDP can intercept and auto-select.

```js
await CDP('DeviceAccess.enable');
// Listen for DeviceAccess.deviceRequestPrompted:
// { id: RequestId, devices: [{ id: DeviceId, name: string }] }

// Auto-select the first matching device
await CDP('DeviceAccess.selectPrompt', { id: requestId, deviceId: devices[0].id });
// Or dismiss it
await CDP('DeviceAccess.cancelPrompt', { id: requestId });

await CDP('DeviceAccess.disable');
```

---

## DOM domain — direct DOM manipulation ⭐

### DOM.setFileInputFiles — inject files without OS dialog ⭐
```js
await CDP('DOM.enable');
const { root } = await CDP('DOM.getDocument');
const { nodeId } = await CDP('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' });

await CDP('DOM.setFileInputFiles', {
  files: ['/tmp/agent-downloads/report.pdf', '/tmp/screenshot.png'],
  nodeId   // or backendNodeId or objectId
});
```
The files are attached as if the user selected them from the OS dialog. Works for single and multiple file inputs.

### DOM.getNodeForLocation — find element at screen coordinates
```js
const { nodeId, backendNodeId, frameId } = await CDP('DOM.getNodeForLocation', {
  x: 400, y: 300,
  includeUserAgentShadowDOM: false,
  ignorePointerEventsNone: false
});
```
Inverse of `getBoxModel` — given a pixel coordinate, returns which node is there. Useful for confirming what's under the cursor before clicking.

### DOM.focus — focus any element
```js
await CDP('DOM.focus', { nodeId });
// or: await CDP('DOM.focus', { backendNodeId });
```

### DOM.scrollIntoViewIfNeeded — scroll element into view
```js
await CDP('DOM.scrollIntoViewIfNeeded', {
  nodeId,
  rect: { x: 0, y: 0, width: 0, height: 0 }  // omit to center element
});
```

### DOM.setAttributeValue / setAttributesAsText — modify element attributes
```js
// Single attribute
await CDP('DOM.setAttributeValue', { nodeId, name: 'disabled', value: '' });
await CDP('DOM.removeAttribute', { nodeId, name: 'disabled' });

// Multiple at once (parses HTML-style attribute string)
await CDP('DOM.setAttributesAsText', { nodeId, text: 'class="active highlighted" data-state="open"' });
```

### DOM.setOuterHTML — replace element with new HTML
```js
await CDP('DOM.setOuterHTML', {
  nodeId,
  outerHTML: '<button class="patched-btn">Click Me</button>'
});
```

### DOM.resolveNode — get JS object reference from nodeId
```js
const { object } = await CDP('DOM.resolveNode', { nodeId });
// object.objectId can be passed to Runtime.callFunctionOn
```
Bridge between DOM nodeId and Runtime objectId.

### DOM.getOuterHTML — read element markup
```js
const { outerHTML } = await CDP('DOM.getOuterHTML', { nodeId });
```

### DOM.removeNode — delete a node from the DOM
```js
await CDP('DOM.removeNode', { nodeId });
```

### DOM.querySelectorAll — find multiple elements
```js
const { nodeIds } = await CDP('DOM.querySelectorAll', {
  nodeId: root.nodeId,
  selector: 'input[type="text"]'
});
```

---

## DOMDebugger domain — introspect event listeners

### DOMDebugger.getEventListeners — see all JS listeners on an element ⭐
```js
// First get a Runtime.RemoteObjectId for the element
const { object } = await CDP('DOM.resolveNode', { nodeId });

const { listeners } = await CDP('DOMDebugger.getEventListeners', {
  objectId: object.objectId,
  depth: 1,
  pierce: true
});

// listeners[].type = 'click' | 'keydown' | 'submit' | ...
// listeners[].scriptId, .lineNumber, .columnNumber = where handler is defined
// listeners[].passive, .once, .useCapture
```
Very useful for understanding why a click isn't working — check what events the element actually listens to before simulating them.

### DOMDebugger.setXHRBreakpoint — break on any XHR/fetch to a URL
```js
await CDP('DOMDebugger.setXHRBreakpoint', { url: '/api/submit' });
// Breaks when any XHR/fetch URL contains this substring
await CDP('DOMDebugger.removeXHRBreakpoint', { url: '/api/submit' });
```

### DOMDebugger.setDOMBreakpoint — break on DOM mutations
```js
await CDP('DOMDebugger.setDOMBreakpoint', {
  nodeId,
  type: 'subtree-modified'  // 'subtree-modified' | 'attribute-modified' | 'node-removed'
});
```

---

## DOMSnapshot domain — full page structure capture

### DOMSnapshot.captureSnapshot — entire page tree + layout + styles in one call ⭐
```js
await CDP('DOMSnapshot.enable');

const { documents, strings } = await CDP('DOMSnapshot.captureSnapshot', {
  computedStyles: ['display', 'visibility', 'color', 'font-size'],
  includePaintOrder: false,
  includeDOMRects: true,   // includes offsetRects, clientRects, scrollRects per node
  includeBlendedBackgroundColors: false
});

// documents[0] = root document; documents[1..n] = iframes
// Each document has:
//   .nodes (NodeTreeSnapshot) — parallel arrays: parentIndex, nodeType, nodeName, nodeValue, backendNodeId, attributes, inputValue...
//   .layout (LayoutTreeSnapshot) — bounds (absolute bounding boxes), styles, text
//   .textBoxes (TextBoxSnapshot) — post-layout inline text positions
//   .scrollOffsetX / .scrollOffsetY

// All strings are interned: strings[index] = actual string value
// Access a node's name: strings[documents[0].nodes.nodeName[i]]
```
Best way to get a complete structural snapshot of the page for analysis. Much faster than querying individual elements.

---

## DOMStorage domain — read/write localStorage and sessionStorage

```js
await CDP('DOMStorage.enable');

const storageId = {
  securityOrigin: 'https://example.com',
  isLocalStorage: true    // false = sessionStorage
};

// Read all items
const { entries } = await CDP('DOMStorage.getDOMStorageItems', { storageId });
// entries = [['key1', 'value1'], ['key2', 'value2'], ...]

// Write a value
await CDP('DOMStorage.setDOMStorageItem', { storageId, key: 'authToken', value: 'abc123' });

// Delete a key
await CDP('DOMStorage.removeDOMStorageItem', { storageId, key: 'authToken' });

// Clear everything
await CDP('DOMStorage.clear', { storageId });
```

Events (while enabled): `DOMStorage.domStorageItemAdded`, `domStorageItemUpdated`, `domStorageItemRemoved`, `domStorageItemsCleared`.

**Use case**: inspect or seed app state (auth tokens, feature flags, cached data) without running JS.

---

## Emulation domain — fake environment ⭐

### Emulation.setGeolocationOverride — fake GPS location
```js
await CDP('Emulation.setGeolocationOverride', {
  latitude: 40.7128,
  longitude: -74.0060,
  accuracy: 10
});
await CDP('Emulation.clearGeolocationOverride');
```

### Emulation.setUserAgentOverride — spoof user agent
```js
await CDP('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  acceptLanguage: 'en-US',
  platform: 'iPhone'
});
```

### Emulation.setDeviceMetricsOverride — simulate screen size / mobile
```js
await CDP('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true
});
await CDP('Emulation.clearDeviceMetricsOverride');
```

### Emulation.setEmulatedMedia — force CSS media queries
```js
// Force dark mode
await CDP('Emulation.setEmulatedMedia', {
  media: 'screen',
  features: [{ name: 'prefers-color-scheme', value: 'dark' }]
});

// Force print preview
await CDP('Emulation.setEmulatedMedia', { media: 'print', features: [] });
```
Supported features: `prefers-color-scheme` (dark/light), `prefers-reduced-motion` (reduce/no-preference), `prefers-contrast` (more/less/forced/no-preference), `color-gamut`, `forced-colors`.

### Emulation.setTimezoneOverride — fake timezone
```js
await CDP('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
// Empty string restores system timezone
```

### Emulation.setScriptExecutionDisabled — block all JS on page
```js
await CDP('Emulation.setScriptExecutionDisabled', { value: true });
// Subsequent page loads/navigations won't run any JavaScript
await CDP('Emulation.setScriptExecutionDisabled', { value: false });
```

### Emulation.setIdleOverride — fake idle/screen-lock state
```js
await CDP('Emulation.setIdleOverride', { isUserActive: false, isScreenUnlocked: false });
// Tests IdleDetector API behavior
```

### Emulation.setCPUThrottlingRate — simulate slow CPU
```js
await CDP('Emulation.setCPUThrottlingRate', { rate: 4 }); // 4x slowdown
await CDP('Emulation.setCPUThrottlingRate', { rate: 1 }); // restore
```

### Emulation.setTouchEmulationEnabled — enable touch events on desktop
```js
await CDP('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
```

---

## Extensions domain — read/write extension storage directly ⭐

These methods are available only in Chrome-attached-to-itself (i.e. from within a background service worker via `chrome.debugger.attach`), not from an external CDP client. Useful for the Aion AI background.js to inspect/modify its own state programmatically.

```js
// Read Aion AI extension storage
const { data } = await CDP('Extensions.getStorageItems', {
  id: chrome.runtime.id,
  storageArea: 'local',   // 'session' | 'local' | 'sync' | 'managed'
  keys: ['userProfile', 'subscriptionStatus']   // omit = return all
});

// Write values
await CDP('Extensions.setStorageItems', {
  id: chrome.runtime.id,
  storageArea: 'local',
  values: { featureFlag: true, debugMode: true }
});

// Delete specific keys
await CDP('Extensions.removeStorageItems', {
  id: chrome.runtime.id,
  storageArea: 'local',
  keys: ['tempCache']
});

// Clear all storage in an area
await CDP('Extensions.clearStorageItems', {
  id: chrome.runtime.id,
  storageArea: 'session'
});

// List all loaded unpacked extensions
const { extensions } = await CDP('Extensions.getExtensions');
// extensions[].id, .name, .version, .path, .enabled

// Programmatically load an unpacked extension
const { id } = await CDP('Extensions.loadUnpacked', {
  path: '/home/user/my-extension',
  enableInIncognito: false
});
```

---

## EventBreakpoints domain — break on native browser events

Sets breakpoints on internal browser events (not DOM events). When hit, Debugger fires `paused` just like a JS breakpoint.

```js
await CDP('EventBreakpoints.setInstrumentationBreakpoint', {
  eventName: 'setTimeout.callback'   // internal event name
});
await CDP('EventBreakpoints.removeInstrumentationBreakpoint', { eventName: 'setTimeout.callback' });
await CDP('EventBreakpoints.disable');  // remove all at once
```

Common `eventName` values: `setTimeout.callback`, `setInterval.callback`, `requestAnimationFrame.callback`, `xhr.send`, `fetch`, `websocket.send`, `webglErrorFired`, `scriptFirstStatement`.

---

## FedCm domain — handle federated login dialogs

When a page triggers a FedCM (Sign in with Google) flow, Chrome shows a chooser dialog. CDP can auto-select.

```js
await CDP('FedCm.enable', { disableRejectionDelay: true });

// Event: FedCm.dialogShown
// { dialogId, dialogType: 'AccountChooser'|'AutoReauthn'|'ConfirmIdpLogin'|'Error',
//   accounts: [{ accountId, email, name, givenName, pictureUrl, loginState: 'SignIn'|'SignUp' }] }

// Select the first account
await CDP('FedCm.selectAccount', { dialogId, accountIndex: 0 });

// Or dismiss (+ optional cooldown to allow re-showing)
await CDP('FedCm.dismissDialog', { dialogId, triggerCooldown: false });

// Reset cooldown so the dialog can appear again
await CDP('FedCm.resetCooldown');

await CDP('FedCm.disable');
```
