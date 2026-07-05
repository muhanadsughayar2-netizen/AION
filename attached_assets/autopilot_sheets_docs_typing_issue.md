# Autopilot: Typing into Google Sheets / Google Docs — Full Problem Writeup

## 1. What "Autopilot" is
Autopilot is a feature inside the SnapToAI/Aion Chrome extension. It's an AI agent
(Google Gemini) that controls the browser step-by-step: it looks at a screenshot +
a text summary of the current page, decides one action (click, type, scroll,
navigate, drag), the extension executes that action for real in the browser, then
the agent looks again and decides the next step. This loop repeats until the task
is done or it gives up.

The actions are executed by two extension files:
- `content.js` — runs inside the web page itself, and is responsible for
  *finding* things on the page (buttons, text boxes, elements).
- `background.js` — the extension's background service worker. It receives the
  action request, and for some actions uses Chrome's DevTools Protocol
  (`chrome.debugger`) to send genuinely trusted mouse/keyboard input — because
  some sites detect and ignore fake/scripted input.

## 2. The specific problem
When the user asks Autopilot to type data into a **Google Sheet** (an "Excel
sheet") or a **Google Doc** ("Word document"), the typed text does **not** land
inside the actual sheet grid or document body. Instead it has variously:
- Landed in the filename/title box at the very top of the page.
- Failed outright with "Element not found" / "Input not found" errors, because
  the code tried CSS selectors that don't exist on the live page.
- Reported "success" back to the AI even when nothing actually got typed,
  because there is currently no verification step confirming the text landed
  in the right place.

## 3. Why this is fundamentally harder than a normal website
Most websites (investing.com, Amazon, a search box, a Gmail compose box, etc.)
render their content as normal HTML: real `<input>`, `<textarea>`, or
`contenteditable` elements that JavaScript can directly find with
`document.querySelector(...)` and whose value can be read/set directly.

**Google Sheets renders its grid as `<canvas>`.** The cells you see are pixels
drawn onto a canvas element, not real DOM nodes — there is no
`<div class="cell">A1</div>` to find or click on. This means:
- We cannot query "the A1 cell" or "the selected cell" directly from the page's
  HTML — it doesn't exist as an element.
- We can only click at raw x/y pixel coordinates and hope that lands inside the
  grid, then hope the currently-selected cell is the one we want.
- We cannot read back "what does the cell currently contain" from the DOM either
  (no text node holds it) — so there is no easy way to verify success by reading
  page content, only by taking a screenshot and visually checking (or reading
  Sheets' internal state via reverse-engineering, which Google does not
  document or support).

**Google Docs is a hybrid.** The visible page (`.kix-appview-editor`,
`.kix-page`) is also drawn with a canvas-like rendering layer for display, but
Docs internally uses a hidden, off-screen `<iframe class="docs-texteventtarget-iframe">`
with a real `contenteditable` body that captures your actual keystrokes and feeds
them into Docs' internal document model. This iframe is the "real" input target,
but it is undocumented, unofficial, and only discoverable by inspecting Docs'
DOM by hand — Google can change or rename it at any time without notice, and it
sometimes does not exist until the document has fully finished loading.

**Both of these class names / structures (`.grid-container`, `#waffle`,
`.kix-appview-editor`, etc.) are internal Google implementation details, not a
published API.** They:
- Are not documented anywhere by Google.
- Can change between releases without warning.
- May differ depending on Chrome version, account type (personal vs Workspace),
  language/locale, and whether experimental Sheets/Docs features are enabled for
  that account.

This is the root reason repeated attempts to "find the right selector" keep
breaking — we are guessing at Google's private internal DOM structure instead of
using anything Google guarantees will stay stable.

## 4. What has been tried so far (current code, as of this writeup)

### 4a. `content.js` — `locateForType` action
This runs inside the Sheets/Docs page and tries to find the grid or document
body so we know where to click:

```js
case 'locateForType': {
  const host = location.hostname;
  const isSheets = host.includes('docs.google.com') && location.pathname.includes('/spreadsheets/');
  const isDocs = host.includes('docs.google.com') && location.pathname.includes('/document/');

  if (!isSheets && !isDocs) {
    return { success: false };
  }

  const sheetSelectors = [
    '.grid-container', '#waffle', '.grid-scrollable-wrapper-3',
    '.grid-scrollable-view', 'canvas.grid-canvas', 'div[role="grid"]',
    '.waffle-container'
  ];
  const docsSelectors = [
    '.kix-appview-editor', '.kix-page-content-wrapper', '.kix-page',
    '#docs-editor-container', 'div[role="textbox"]'
  ];
  const selectors = isSheets ? sheetSelectors : docsSelectors;

  const findTarget = () => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) return el;
      }
    }
    return null;
  };

  let target = findTarget();
  for (let attempt = 0; attempt < 6 && !target; attempt++) {
    await new Promise(r => setTimeout(r, 400));
    target = findTarget();
  }

  let x, y;
  if (target) {
    const rect = target.getBoundingClientRect();
    x = rect.left + Math.min(120, rect.width * 0.15);
    y = rect.top + Math.min(80, rect.height * 0.12);
  } else {
    // Nothing matched — guess a point in the middle of the screen.
    x = isSheets ? window.innerWidth * 0.3 : window.innerWidth * 0.5;
    y = isSheets ? window.innerHeight * 0.45 : window.innerHeight * 0.4;
  }

  return { success: true, x, y, mode: isSheets ? 'sheets' : 'docs' };
}
```

Problem: even the "broad list" of selectors is a guess based on publicly
documented reverse-engineering write-ups of Sheets/Docs internals (not an
official API), and the final fallback is literally "click roughly in the middle
of the screen" — which is not reliable if the toolbar, sidebar, a modal/dialog,
a sharing prompt, the "$300 Google Cloud credit" banner, or anything else is
currently on screen.

### 4b. `background.js` — trusted typing via Chrome DevTools Protocol
Once we have an x/y guess, this clicks there and "types" using
`chrome.debugger`'s `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`
(genuinely OS-level trusted input, since Sheets/Docs ignore fake
`isTrusted:false` synthetic keyboard events dispatched directly in JS):

```js
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
await new Promise(r => setTimeout(r, 200));

for (const ch of text) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
  await send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, key: ch });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
}

if (mode === 'sheets' && params.pressEnter !== false) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}

sendResponse({ success: true });
```

Problem: this always reports `{ success: true }` once the key events are sent —
there is **no verification** that the click actually landed inside the grid/page
(vs. a banner, dialog, sidebar, or empty margin) or that the characters were
actually accepted by Sheets/Docs. This is why the AI has been told "success" on
steps where, visually, nothing happened.

## 5. Honest state of testing
This code has only been checked for JavaScript syntax errors (`node --check`).
It has **not** been tested against a live Google account / real Google Sheet or
Doc in a real Chrome browser, because the development environment used to write
this code has no Chrome browser or Google login available to it. All fixes so
far have been based on reasoning about Sheets/Docs' known architecture plus
publicly available reverse-engineering notes about Google's internal class
names — not on an observed, confirmed-working live run.

## 6. The real underlying issue to research
**Pixel-coordinate clicking + guessed CSS selectors is not a reliable way to
control a canvas-rendered app like Google Sheets.** Two real paths forward:

**Option A — Keep browser automation, but verify visually.**
After every click/type into Sheets or Docs, take a screenshot and have the AI
model itself look at the screenshot to confirm the text landed where expected,
retrying with adjusted coordinates if not (rather than trusting the DOM event
dispatch alone). This is more robust but still fundamentally a guess-and-check
loop, and can still fail if a dialog/banner is covering the grid.

**Option B — Use Google's official APIs instead of simulating clicks.**
Google publishes a real, documented, stable **Google Sheets API** and
**Google Docs API** (REST APIs, part of Google Workspace APIs) that can write
directly to a specific cell (e.g. `Sheet1!A1`) or insert text at a specific
position in a document, with no guessing, no canvas, no coordinates, and no
risk of Google's internal HTML changing and breaking things. This requires:
- The user to sign in with Google and grant the extension permission
  (OAuth scopes: `https://www.googleapis.com/auth/spreadsheets` and
  `https://www.googleapis.com/auth/documents`).
- Calling `https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}` /
  `https://docs.googleapis.com/v1/documents/{id}:batchUpdate` with the
  extension's existing Google Sign-In flow.

Option B is what would make this "actually reliable" rather than "improved
guessing" — it trades pixel-clicking for a real, Google-supported integration.
This is the trade-off worth researching / discussing with Google's own
documentation (search "Google Sheets API quickstart" / "Google Docs API
batchUpdate").

## 7. Related but separate asks from the user (not yet implemented)
- **Inserting prepared images** into a Sheet/Doc/email — not yet built. Feasible
  via Chrome DevTools Protocol's `DOM.setFileInputFiles` if the target app has a
  real file-upload input, or via Sheets/Docs API `insertInlineImage` under
  Option B above.
- **Writing/composing an email in Gmail** — Gmail's compose box IS a normal
  `contenteditable` `<div>` (not canvas), so the existing generic typing path is
  much more likely to work there already, but this has likewise not been tested
  live.
