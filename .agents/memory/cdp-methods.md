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
