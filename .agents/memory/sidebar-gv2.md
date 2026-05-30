---
name: Sidebar GV2 Migration
description: AmieGlowGeminiV2 design — 3-tab chrome wrapping unchanged ai-chat.js and sidebar.js
---

## What changed
`flow-premium/sidebar.html` fully rewritten. `sidebar.js` and `ai-chat.js` are NOT modified.

## Architecture
- **GV2 header**: white (#fff), Google gradient logo, Material underline tabs (Capture / Chat / Build)
- **Capture tab** (`#tabCapture`): light/white Google theme — live preview, 4 cap buttons, key pill, queue
- **Chat tab** (`#tabChat`): dark theme preserved — modeBar + chips row + full chat panel
- **Build tab** (`#tabBuild`): dark code editor + lang select + AI prompt bar that sends to chat

## Critical constraints
- All IDs queried by `sidebar.js` and `ai-chat.js` must stay verbatim (they do)
- `#sbLogo .sb-logo-text` and `.sb-logo-accent` class names must exist for `applyInstitutionBranding()`
- Script load order (end of body): purify.min.js → subscription.js → prompts.js → ai-chat.js → sidebar.js → theme-cycle-btn.js → inline GV2 script
- `sbAskAiBtn` gets a capture-phase listener that calls `gv2SwitchTab('chat')` BEFORE sidebar.js's bubble-phase listener focuses chatInput

**Why:** sidebar.js's `doAskAi()` calls `chatInput.scrollIntoView()` which silently fails when chatInput is hidden in an inactive tab pane. Switching tab first in capture phase means the element is visible by the time sidebar.js runs.

## Tab switching
`window.gv2SwitchTab(name)` is exposed globally for any code that needs it.

## Chips
`CHIPS` map in inline script — 4-5 chips per mode (vision/image/music/video). Clicking a chip pre-fills `#chatInput`. Chips re-render on each `modeBar` click.

## Build tab → Chat
`buildAskBtn` click: concatenates prompt + fenced code block → puts in chatInput → switches to Chat tab → auto-clicks sendBtn after 90ms.
