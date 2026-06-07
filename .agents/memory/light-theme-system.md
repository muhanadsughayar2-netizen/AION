---
name: Light/dark theme system
description: How the extension's light theme is built, gated, and which surfaces it applies to
---

# Light/dark theme system

A complete light theme already exists in `flow-premium/theme.css`, gated entirely on `:root[data-theme="light"]`. Dark is the default. `flow-premium/theme.js` is the central controller (loaded in `<head>` of every page); its `resolveTheme()` decides the rendered theme and sets `data-theme` before first paint. The user-facing toggle is intentionally hidden, so `resolveTheme()` ignores stored prefs and hard-codes the result per-surface.

**Current policy:** chat window light, everything else dark. `resolveTheme()` returns `light` when the path is the AI-chat page, else `dark`.

**Why:** User wanted the chat (Gemini-style) light/comfortable while the rest of the extension stays dark. Switching visual language between separate windows is fine; inconsistency *within* one window looks broken — so every surface visible inside the chat window must be light.

**How to apply / gotcha:** Much of the chat UI uses hardcoded dark colors and inline styles rather than `--st-*` tokens, so new/existing chat elements often need explicit `:root[data-theme="light"]` overrides or they break on white (low-contrast text, dark "islands"). When adding chat UI, audit every surface that can appear inside the chat window — message bubbles, side panels, modals, pill/chip buttons — not just the main column. A stylesheet `!important` rule beats an element's inline (non-important) style, which is how the inline-styled modals get re-skinned. For JS-injected inline colors, use `var(--st-*)` tokens (not hardcoded hex) so they resolve per-theme.

**Deliberate dark exceptions inside the light chat:** the build/preview buffer (intentional code-editor surface), the heavily-branded "takeover" modals (`#trialEndedModal` paywall, `#netlifyModal` deploy wizard — deeply nested branded inline styling, full-screen dramatic moments), and the `#promptToast` snackbar (dark snackbar over light is a conventional Material pattern). These are branded/dramatic full-screen moments, not everyday reading surfaces, so keeping them dark is intentional, not a miss.
