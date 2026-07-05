---
name: Autopilot tab tracking
description: Why an in-browser automation agent must never re-select "the currently active/focused tab" mid-task, and what to do instead.
---

An agent loop that re-detects "whichever tab is active and focused right now" after every step (to follow links that open in a new tab) looks correct for the single-agent, hands-off case, but breaks as soon as either of these happen:
- The user runs a second agent task in another window at the same time.
- The user simply switches to another tab/window to do something else while the agent works.

In both cases "active/focused tab" is global browser state, not scoped to the task, so one agent's next step can silently hijack a tab that belongs to the user or to a different agent instance.

**Why:** Chrome's `windows.getAll({populate:true})` + filtering by `t.active`/`w.focused` returns whatever the user is currently looking at, with no relation to which tab a specific task actually started on or opened.

**How to apply:** Pin the task to the specific `tab.id` it started on. To detect "the site opened a new tab from my last click" (the actual reason to follow), query `chrome.tabs.query({})` and look for a tab whose `openerTabId` equals the tab you're currently driving — that's a direct causal link, not a focus guess. If no such tab exists, just re-fetch the pinned tab (`chrome.tabs.get(tab.id)`) to confirm it's still open, rather than switching to whatever is focused. This keeps multiple concurrent agent windows (and normal user tab-switching) from interfering with each other.
