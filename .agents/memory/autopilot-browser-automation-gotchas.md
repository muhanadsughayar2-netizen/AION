---
name: Autopilot browser automation gotchas
description: Lessons from building the in-extension "Autopilot" agent that drives the browser via a content script (click/type/scroll/navigate/doubleClick/drag).
---

## Don't hard-block on "system pages" before the first action
A tab-detection guard that immediately refuses to start ("Can't act on a browser
system page") breaks any task that legitimately *starts* with a navigate
instruction (e.g. "go to YouTube"), since `chrome.tabs.update` works fine from
a `chrome://newtab` or extension popup tab — no content script needed.

**Why:** the user reported "it stopped navigating entirely" right after this
guard was added; it was firing whenever the active tab momentarily was a
system page, even though the task's first planned step was a navigate.

**How to apply:** on a system-page tab, skip content-script-dependent reads
(page text) and tell the model via context that it must call `navigate`
first, instead of aborting before any step runs.

## Native double-click and drag need real event sequences
A single synthetic `dblclick` event is ignored by many apps (e.g. Google
Drive's file-open) that count raw `mousedown`/`mouseup`/`click` pairs
themselves. Real drag targets (chess boards, sortable lists) similarly need
`mousedown` → several `mousemove` steps → `mouseup`, not an instant jump —
some libraries only "pick up" an item once real movement deltas are seen.
Fire both raw mouse events AND HTML5 `dragstart/dragover/drop` events since
different sites listen to different APIs.

## Scrolling only `window` misses embedded scroll panes
Google Docs/Drive previews, PDF viewers, and many SPA "document" views render
content inside an inner `overflow:auto` div, not the page body — scrolling
`window` does nothing visible. Find the scrollable ancestor of the element at
viewport-center (or the largest scrollable element on the page) and scroll
that instead, falling back to `window`.

## The Autopilot chat window is a real OS popup, not a page overlay
It's opened via `chrome.windows.create({type:'popup', ...})`, so `chrome.windows.getCurrent()`
inside its own script refers to *that* window, and `chrome.windows.update(id, {width,height,left,top})`
can resize/reposition it live without reloading or interrupting an in-flight
agent loop — useful for shrinking it into a small corner strip during a task
so it stops covering the page it's controlling.

**Why:** it's easy to assume "the extension UI" is a page-injected overlay
(like the ghost cursor/banner in content.js) and reach for CSS/DOM tricks,
but the chat window and the on-page automation visuals are two totally
separate surfaces living in different documents.

**How to apply:** to shrink/restore the chat window itself, resize the real
window via `chrome.windows.update`; to change on-page automation visuals
(cursor, banners), edit the content-script-injected styles instead.

## Cross-origin iframe content needs `allFrames: true`
If `chrome.scripting.executeScript` injects only into the top frame,
Autopilot can't read or act on content rendered inside a same-tab iframe
(e.g. a docs.google.com preview embedded in a drive.google.com page), even
though `chrome.tabs.sendMessage` without a `frameId` broadcasts to *all*
frames that have a listener. Broad `https://*/*` host_permissions are enough
to let content scripts run inside cross-origin iframes too — the injection
call just needs `allFrames: true`. Caveat: with multiple frames responding,
Chrome only delivers the first `sendResponse` call back to the caller, so a
wrong/empty response from the top frame can still beat out the iframe's real
answer — full reliability needs per-frame targeting via explicit `frameId`s,
which wasn't implemented (kept as a known limitation).
