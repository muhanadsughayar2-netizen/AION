// Pure Autopilot decision-logic — the rules that decide whether an agent
// action is safe to run, whether a "done" claim is real, and how failures
// get reported back to the model. Extracted out of ai-chat.js/content.js so
// these rules can be unit-tested directly (see tests/agent-logic.test.js)
// instead of only being checked by hand-running the extension in a real
// browser every time. No DOM, no chrome.* APIs, no network — every function
// here takes plain data in and returns plain data out.
//
// Same dual-environment pattern as video-pipeline-core.js: plain globals in
// the browser (loaded via <script> before ai-chat.js/content.js), CommonJS
// exports in Node for Jest.
//
// Wrapped in an IIFE (unlike a bare top-level 'const'/'function' file) because
// background.js's clearAndInject() re-injects this file into the SAME page
// on every self-healing retry, and the isolated world's global scope persists
// across those re-injections (a page navigation is the only thing that resets
// it) — content.js survives this because IT is already wrapped in its own
// IIFE, so each re-injection gets a fresh function scope. This file wasn't,
// so the second injection tried to redeclare 'const SEARCH_ENGINE_HOSTS' in
// the same persistent scope and threw "Identifier has already been declared",
// visibly on Google's own page, the very next time it was tested live.
// Plain 'global.foo = foo' assignments below are idempotent — safe to repeat
// on every re-injection — where 'const'/'function' declarations were not.
'use strict';

(function (global) {
  const SEARCH_ENGINE_HOSTS = /(^|\.)google\.\w+$|(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)yahoo\.com$/i;
  const READ_ONLY_ACTIONS = new Set([
    'snapshotPage', 'readText', 'readDocContent', 'findElement', 'getComputedStyle',
    'getCookies', 'readStorage', 'readDOMStorage', 'readIndexedDB', 'readCache',
    'getPerformance', 'auditPage', 'getEventListeners', 'readBrowserLog',
    'getSecurityInfo', 'listTargets', 'getSystemInfo', 'getAnimations',
    'getMemoryInfo', 'trackWebVitals', 'getPreloadRules', 'getPWAInfo',
    'getCDPSchema', 'inspectMedia', 'getFileSystem', 'getLayerTree',
    'getFedCmInfo', 'highlightElement', 'readNetworkResponse', 'captureConsole',
    'readBackgroundEvents', 'inspectWebAudio'
  ]);

  /**
   * Fingerprint one agent action for repeated-action / loop detection.
   *
   * 'type' with no index/selector — "type into whatever is currently focused"
   * — used to fingerprint on the literal text being typed. When the model
   * retried a failed type with fresh wording each time (a new poem, not the
   * same one), every attempt got a different signature and the loop detector
   * never recognised "typing into the same probably-broken target, repeatedly"
   * as a loop. Real damage: 5+ blind retypes into an unconfirmed Google Docs
   * target, scattering/overwriting the user's poem, with zero warnings fired.
   * Fix: blind types fingerprint on the TARGET, not the content.
   */
  function buildActionSignature(name, args) {
    const isBlindType = name === 'type' && (!args || args.index === undefined) && !(args && args.selector);
    if (isBlindType) return 'type:#blind-target';
    const a = args || {};
    return `${name}:${a.index !== undefined ? `#${a.index}` : String(a.text || a.selector || a.url || a.description || a.direction || '').slice(0, 60)}`;
  }

  /**
   * Should this turn's actions run one-at-a-time (abort the rest on first
   * failure) or all in parallel?
   *
   * Used to be an unconditional Promise.allSettled — every call in a turn
   * fired at the same instant. A dependent pair like
   *   click("Untitled document") + type("Sonnet")
   * therefore raced instead of running in order: the click failed to find the
   * title box, the type ran anyway with nothing focused, and "Sonnet" landed
   * in the document body on top of the sonnet that had just been written
   * there. Read-only inspection calls (snapshotPage, getCookies, ...) are safe
   * to keep running together since none of them change the page.
   */
  function shouldRunSequentially(actionNames) {
    if (!actionNames || actionNames.length <= 1) return false;
    return !actionNames.every(n => READ_ONLY_ACTIONS.has(n));
  }

  /**
   * Rank a page's element-index lines against what the agent was looking for,
   * closest match first. Used when a click/type target can't be found by exact
   * or partial text, so the agent gets "here's what IS on the page" instead of
   * a bare "not found" that teaches it nothing and just invites another guess.
   */
  function rankElementMatches(lines, wantedRaw, limit) {
    const wanted = (wantedRaw || '').toLowerCase().trim();
    if (!wanted) return [];
    const words = wanted.split(/\s+/).filter(w => w.length > 2);
    const score = (line) => {
      const l = line.toLowerCase();
      if (l.includes(wanted)) return 100;
      if (!words.length) return 0;
      const hits = words.filter(w => l.includes(w)).length;
      return hits ? hits / words.length : 0;
    };
    return lines.map(l => ({ l, s: score(l) }))
                .filter(r => r.s > 0)
                .sort((a, b) => b.s - a.s)
                .slice(0, limit || 15)
                .map(r => r.l);
  }

  /**
   * Label an interactive element for the agent's element index.
   *
   * For text inputs (e.g. Google Docs' title field) the visible text is the
   * LIVE .value DOM property, set by JavaScript — it has no matching HTML
   * attribute for an attribute-based search to find, and no textContent
   * either. Without reading .value, the title field showed up with no
   * readable label at all, so the agent had no way to recognise it as "the
   * box that currently says Untitled document" and kept guessing at labels
   * like "Rename" that don't exist, then typing the new name into whatever
   * was left focused — landing inside the document body on top of the poem.
   *
   * `el` here is a plain object: { tag, value, attrs: {...}, text }
   * (the real DOM version reads these live off the element; this pure form
   * exists so the formatting logic itself is unit-testable).
   */
  function formatElementLabel(el) {
    const tag = (el.tag || '').toLowerCase();
    const attrs = el.attrs || {};
    const liveValue = (tag === 'input' || tag === 'textarea') && typeof el.value === 'string'
      ? el.value.trim().slice(0, 60)
      : '';
    const aria = attrs['aria-label'] || '';
    const base = (
      aria ||
      attrs.title ||
      attrs.placeholder ||
      attrs.alt ||
      (el.text || '').replace(/\s+/g, ' ').trim().slice(0, 60) ||
      attrs.name ||
      el.id || ''
    ).trim();
    if (liveValue && liveValue !== base) {
      return (base ? `${base} = "${liveValue}"` : `"${liveValue}"`).trim();
    }
    return base;
  }

  /**
   * Verify a checkPlan claim that a step reading/speaking text aloud is done.
   *
   * checkPlan is entirely self-reported. The model once marked "Read the poem
   * out loud" done via checkPlan without ever calling speak() — not in that
   * turn or any prior one — and the user was told the poem had been read when
   * nothing was ever spoken. With TWO reading steps in one plan (read the
   * poem, then read the extended version), a plain "spoke at least once ever"
   * check let the second claim ride on the first's coattails — so this
   * compares against speakCallsSinceLastReadCheck, not a lifetime total.
   *
   * Returns { blocked, isReadStep }. blocked === true means reject the claim.
   */
  function evaluateReadClaim(stepText, speakCallsThisTask, speakCountAtLastReadCheck) {
    const isReadStep = /\b(read|speak|spoken|aloud|say it|narrate)\b/i.test(stepText || '');
    if (!isReadStep) return { blocked: false, isReadStep: false };
    return { blocked: speakCallsThisTask <= speakCountAtLastReadCheck, isReadStep: true };
  }

  /**
   * Verify a checkPlan claim that a search result / link was "opened".
   *
   * Given "open the first result, then the third," a targetless fallback
   * click landed on Google's own apps menu (Gmail/Maps/Calendar icons), the
   * task never left google.com, and yet checkPlan/finish reported "Opened the
   * first result (Everyday Parisian)... Opened the third result (Wheatless
   * Wanderlust)" — specific site names it fabricated, describing a visit that
   * never happened. This checks the claim against the tab's REAL current
   * hostname: if it's still a search engine's own domain, the result was not
   * actually opened, no matter what the model says.
   *
   * Returns { blocked, isOpenResultStep }.
   */
  function evaluateOpenedResultClaim(stepText, liveHostname) {
    const isOpenResultStep = /\b(open|opened|visit|visited|click(ed)?)\b.*\b(result|link)\b/i.test(stepText || '');
    if (!isOpenResultStep) return { blocked: false, isOpenResultStep: false };
    return { blocked: SEARCH_ENGINE_HOSTS.test(liveHostname || ''), isOpenResultStep: true };
  }

  /**
   * Does a click/type call have ANYTHING to search by?
   *
   * Real failure: given a numbered element list with the correct target
   * clearly listed ("[35] The Best Noise-Cancelling Headphones..."), the next
   * call was click() with no index, no text, no description, no selector —
   * nothing at all. Every fallback strategy (DOM search, Accessibility tree,
   * XPath, and a real paid Gemini Vision API call) was then attempted anyway,
   * all doomed from the start, before failing with a vague "?" error. This
   * lets the caller fail fast and cheaply instead, with an error that names
   * the actual problem.
   */
  function hasSearchTarget(params) {
    const p = params || {};
    return p.index != null || !!p.text || !!p.description || !!p.selector;
  }

  /**
   * Recognise a search-engine bot-detection / CAPTCHA interstitial for what it
   * is, instead of letting the agent treat it as a normal "can't find the
   * button" failure and retry blindly forever.
   *
   * Real failure: asked to open Google search results, the agent got Google's
   * "Our systems have detected unusual traffic from your computer network"
   * block page instead. That page's only real link is "Why did this happen?" —
   * everything else in the element list (Account, Drive, Gmail, Maps...) is
   * just Google's persistent header, which still renders on the block page.
   * No selector fix can find search results that were never actually served;
   * the honest answer is "Google blocked this as automated traffic," not
   * another guess at a button label.
   */
  function detectBlockPage(pageText) {
    const t = (pageText || '').toLowerCase();
    const patterns = [
      'unusual traffic from your computer network',
      'our systems have detected unusual traffic',
      'verify you are human',
      "confirm you're not a robot",
      'complete the security check',
      'detected unusual activity',
    ];
    return patterns.some(p => t.includes(p));
  }

  /**
   * Has this exact text been typed too many times already, regardless of
   * WHERE each attempt targeted?
   *
   * Real failure: renaming a Google Doc to "Astronaut Bio" failed silently
   * six times in a row. Each attempt clicked a different guessed target
   * ("Rename", "Untitled document", "File", a bare click) so the existing
   * signature-based loop detector — which fingerprints on the TARGET — never
   * saw two identical signatures and never fired, even though the outcome
   * (retyping the identical string, again, still not working) was plainly
   * the same failure repeating. This checks the TEXT itself, independent of
   * target, so a person retyping the same string at guess after guess gets
   * caught even when every guess looks superficially "new" to target-based
   * detection.
   */
  function isTextRepeatedTooOften(recentTypedTexts, newText, threshold) {
    const limit = threshold || 3;
    if (!newText) return { blocked: false, count: 0 };
    const count = (recentTypedTexts || []).filter(t => t === newText).length + 1;
    return { blocked: count >= limit, count };
  }

  /**
   * Choose the human-facing label for a stuck/failed action — the text read
   * aloud and shown on an intervention card asking the user to do one step
   * themselves.
   *
   * Real failure: asked to gather YouTube video links, a click call had no
   * 'text' and no 'description', only a raw CSS selector the model had
   * guessed at: "#contents > ytd-post-renderer:nth-child(1) a.yt-simple-
   * endpoint.style-scope.yt-formatted-string". The old fallback chain was
   * text || description || selector || fallback, so that exact string got
   * spoken and shown on the intervention card — asking the user to
   * personally go find and click a CSS selector, which is meaningless to
   * read. A selector is an internal targeting detail, never something meant
   * for a person; this drops it from the user-facing chain entirely so only
   * plain text/description (or the generic fallback) ever reach the user.
   * (Internal bookkeeping keys that use the action for loop/fail-count
   * tracking are a different, legitimate use of selector and are untouched —
   * this is only for strings a person actually has to read.)
   */
  function pickStuckTargetLabel(args, fallback) {
    const a = args || {};
    return a.text || a.description || fallback || 'that step';
  }

  const AionLogic = {
    SEARCH_ENGINE_HOSTS,
    READ_ONLY_ACTIONS,
    buildActionSignature,
    shouldRunSequentially,
    rankElementMatches,
    formatElementLabel,
    evaluateReadClaim,
    evaluateOpenedResultClaim,
    detectBlockPage,
    hasSearchTarget,
    isTextRepeatedTooOften,
    pickStuckTargetLabel,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AionLogic;
  } else {
    // Browser / content-script context. ai-chat.js and content.js call these
    // functions unqualified (buildActionSignature(...), not
    // AionLogic.buildActionSignature(...)) — Object.assign puts each one
    // directly on the global object, which is what a bare top-level
    // 'function foo(){}' would have done too, except these assignments are
    // safe to repeat on every re-injection where redeclaration was not.
    Object.assign(global, AionLogic);
    global.AionLogic = AionLogic;
  }
})(typeof window !== 'undefined' ? window : globalThis);
