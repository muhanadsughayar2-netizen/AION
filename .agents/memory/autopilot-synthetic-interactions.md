---
name: Autopilot synthetic drag/scroll/dblclick
description: How to make content-script browser automation actually work for double-click, drag-and-drop, and scrolling inside embedded/nested content — not just top-level clicks.
---

## Double-click
Browsers only emit a native `dblclick` event from two REAL trusted clicks in quick succession. Calling `element.click()` twice programmatically never fires `dblclick`. Any "open on double-click" handler (file grids, file managers, etc.) needs an explicit synthetic `dblclick` MouseEvent dispatched manually, in addition to the two click events.

**Why:** Silent no-op — the action reports "success" but the file/item never opens, because the listener the site actually cares about never fires.

**How to apply:** After the normal single-click sequence, dispatch `mousedown`/`mouseup`/`click` a second time with `detail: 2`, then dispatch a `dblclick` MouseEvent by hand.

## Drag-and-drop
A single click cannot "carry" an item (chess pieces, sortable cards, etc.). Real drag interactions need a full synthetic sequence: `pointerdown`/`mousedown` on the source → several interpolated `pointermove`/`mousemove` steps toward the destination (re-resolving `document.elementFromPoint` at each step so hover/highlight logic on the target updates) → `pointerup`/`mouseup` on the destination. For elements using native HTML5 drag (`draggable="true"`), also fire `dragstart`/`dragover`/`drop`/`dragend` with a `DataTransfer` object, since different libraries listen to different event families.

**Why:** Many boards/sortable UIs (chess, kanban) implement drag purely through mouse/pointer event listeners with no native `draggable` attribute; others (native browser drag) only respond to the HTML5 Drag Events API. Supporting only one family silently fails on sites using the other.

**How to apply:** Dispatch both event families in the same drag helper rather than trying to detect which one a given site uses.

## Scrolling inside embedded content
`window.scrollBy`/`scrollTo` only moves the top-level document. Real content is often inside an inner div with its own `overflow:auto` (Google Docs editor, Drive preview panes, chat threads) — the outer page never moves, which looks like "scroll does nothing."

**Why:** Agent looked "stuck" because it kept calling scroll successfully (no error) but the visible content never moved.

**How to apply:** Before scrolling, find the actual scrollable container: walk up from `document.elementFromPoint(centerX, centerY)` looking for `overflowY: auto/scroll/overlay` with `scrollHeight > clientHeight`; fall back to scanning the DOM for the largest such element. Scroll that container's `scrollTop`/`scrollBy`, and also dispatch a synthetic `wheel` event on it, since some virtualized/canvas-based viewers only respond to wheel events rather than scrollTop writes. Cross-origin iframes remain unreachable from a content script regardless of this fix.
