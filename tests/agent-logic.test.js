/**
 * @jest-environment node
 *
 * No DOM needed — every function under test takes plain data in and returns
 * plain data out. Overriding to 'node' here (instead of the jsdom default in
 * jest.config.js) avoids requiring jest-environment-jsdom as a dependency
 * just for this file.
 *
 * Autopilot decision-logic tests.
 *
 * Functions under test are imported from the PRODUCTION module
 * flow-premium/agent-logic-core.js (the single source of truth also loaded
 * by ai-chat.html, manifest.json's content_scripts, and background.js's
 * clearAndInject). Regressions here are caught automatically by `npm test`
 * instead of only being found by hand-running the real extension in Chrome.
 *
 * Every case below is a real bug that shipped and was reported by the user
 * before being fixed — not a hypothetical.
 */

'use strict';

const {
  buildActionSignature,
  shouldRunSequentially,
  rankElementMatches,
  formatElementLabel,
  evaluateReadClaim,
  evaluateOpenedResultClaim,
  detectBlockPage,
} = require('../flow-premium/agent-logic-core.js');

// ===========================================================================
// buildActionSignature — loop/repeat detection fingerprinting
// ===========================================================================
describe('buildActionSignature', () => {
  test('blind retypes with different wording still collapse to the same signature', () => {
    // The real transcript: five DIFFERENT poems, typed blindly into an
    // unconfirmed Google Docs target, none of them caught as a repeat.
    const poems = [
      'The Morning Sun The golden light begins to creep...',
      'The morning sun begins to rise, A golden glow across the skies...',
      'The morning dew on petals bright, Reflects the dawn\'s soft, golden light...',
    ];
    const sigs = poems.map(p => buildActionSignature('type', { text: p }));
    expect(new Set(sigs).size).toBe(1);
    expect(sigs[0]).toBe('type:#blind-target');
  });

  test('type into a known index is NOT treated as blind', () => {
    const sig = buildActionSignature('type', { index: 5, text: 'anything' });
    expect(sig).toBe('type:#5');
  });

  test('type into a known selector is NOT treated as blind', () => {
    const sig = buildActionSignature('type', { selector: '#title', text: 'anything' });
    expect(sig).not.toBe('type:#blind-target');
  });

  test('non-type actions still fingerprint on their real target', () => {
    const sig = buildActionSignature('click', { text: 'Send prompt' });
    expect(sig).toBe('click:Send prompt');
  });

  test('click by index uses the index, not text', () => {
    const sig = buildActionSignature('click', { index: 7, text: 'ignored' });
    expect(sig).toBe('click:#7');
  });
});

// ===========================================================================
// shouldRunSequentially — the sonnet-overwrite race condition
// ===========================================================================
describe('shouldRunSequentially', () => {
  test('a single action never needs to be sequential', () => {
    expect(shouldRunSequentially(['click'])).toBe(false);
  });

  test('click + type in the same turn must run sequentially (the sonnet bug)', () => {
    // Real transcript: click("Untitled document") + type("Sonnet") fired at
    // the same instant, the click missed, the type ran anyway and landed in
    // the document body on top of the sonnet that was already there.
    expect(shouldRunSequentially(['click', 'type'])).toBe(true);
  });

  test('an all-read-only batch stays parallel for speed', () => {
    expect(shouldRunSequentially(['snapshotPage', 'getCookies', 'getSecurityInfo'])).toBe(false);
  });

  test('one page-changing action mixed into a read-only batch forces sequential', () => {
    expect(shouldRunSequentially(['snapshotPage', 'click'])).toBe(true);
  });
});

// ===========================================================================
// rankElementMatches — "Read Aloud" vs "Read aloud"
// ===========================================================================
describe('rankElementMatches', () => {
  const page = [
    '[0] button "New chat"', '[1] button "Search"', '[2] button "Copy"',
    '[3] button "Good response"', '[4] button "Share"', '[5] button "Read aloud"',
    '[6] button "Switch model"', '[7] button "More actions"', '[8] button "Send prompt"',
    '[9] textarea "Ask anything"', '[10] button "Edit"', '[11] button "Upgrade"',
  ];

  test('finds the real button despite a capitalisation mismatch', () => {
    // The actual failure: agent asked for "Read Aloud", the real button says
    // "Read aloud" — a single letter of difference caused a full retry loop
    // that ended in the agent giving up and asking the user for help.
    const hits = rankElementMatches(page, 'Read Aloud', 15);
    expect(hits[0]).toContain('Read aloud');
  });

  test('an unrelated request returns no false positive', () => {
    const hits = rankElementMatches(page, 'Purple Elephant', 15);
    expect(hits).toEqual([]);
  });

  test('empty search term returns nothing (falls through to full list)', () => {
    expect(rankElementMatches(page, '', 15)).toEqual([]);
  });
});

// ===========================================================================
// formatElementLabel — the invisible Google Docs title field
// ===========================================================================
describe('formatElementLabel', () => {
  test('shows a live input value alongside its aria-label', () => {
    // Real failure: Google's title field only exposes its text via the live
    // .value DOM property (set by JS), which has no matching HTML attribute.
    // Without reading it, the field showed up blank in the element list, the
    // agent couldn't recognise it, kept guessing at "Rename" (which doesn't
    // exist), and ended up typing the new filename into the document body.
    const label = formatElementLabel({
      tag: 'input', value: 'Untitled document',
      attrs: { 'aria-label': 'Rename' }, id: 'docs-title-input',
    });
    expect(label).toBe('Rename = "Untitled document"');
  });

  test('a plain labeled button is unaffected', () => {
    const label = formatElementLabel({
      tag: 'button', attrs: { 'aria-label': 'Send prompt' }, text: '',
    });
    expect(label).toBe('Send prompt');
  });

  test('an input with only a typed value, no aria-label, shows the value quoted', () => {
    const label = formatElementLabel({
      tag: 'input', value: 'poem number 2', attrs: {}, id: '', text: '',
    });
    expect(label).toBe('"poem number 2"');
  });

  test('non-input elements never read .value even if present on the object', () => {
    const label = formatElementLabel({
      tag: 'div', value: 'should be ignored', attrs: {}, text: 'Real content',
    });
    expect(label).toBe('Real content');
  });
});

// ===========================================================================
// evaluateReadClaim — checkPlan claiming a poem was read aloud when it wasn't
// ===========================================================================
describe('evaluateReadClaim', () => {
  test('a non-reading step is never blocked', () => {
    expect(evaluateReadClaim('Write the poem', 0, 0)).toEqual({ blocked: false, isReadStep: false });
  });

  test('claiming "read aloud" done with zero speak() calls is rejected', () => {
    // Real failure: the model marked "Read the poem out loud" done via
    // checkPlan without ever calling speak — the user was told the poem had
    // been read aloud when nothing was ever spoken.
    const r = evaluateReadClaim('Read the poem out loud using the speak tool', 0, 0);
    expect(r.isReadStep).toBe(true);
    expect(r.blocked).toBe(true);
  });

  test('a genuine speak() call clears the claim', () => {
    const r = evaluateReadClaim('Read the poem out loud', 1, 0);
    expect(r.blocked).toBe(false);
  });

  test('a SECOND reading step needs a FRESH speak() call, not a stale one', () => {
    // Real scenario: "read the poem" (speak call #1, accepted, checkpoint=1),
    // then later "read the extended poem" — must not pass on the strength of
    // the first, now-stale speak call.
    const stillStale = evaluateReadClaim('Read the extended poem out loud', 1, 1);
    expect(stillStale.blocked).toBe(true);

    const freshlySpoken = evaluateReadClaim('Read the extended poem out loud', 2, 1);
    expect(freshlySpoken.blocked).toBe(false);
  });
});

// ===========================================================================
// evaluateOpenedResultClaim — the fabricated "opened the result" report
// ===========================================================================
describe('evaluateOpenedResultClaim', () => {
  test('a non-navigation step is never blocked', () => {
    expect(evaluateOpenedResultClaim('Write the poem', 'www.google.com').isOpenResultStep).toBe(false);
  });

  test('claiming a result was opened while still on Google is rejected', () => {
    // Real failure: a targetless fallback click opened Google's own apps
    // menu by accident, the task never left google.com, and the agent
    // still reported "Opened the first result (Everyday Parisian)... Opened
    // the third result (Wheatless Wanderlust)" — invented site visits.
    const r = evaluateOpenedResultClaim('Open the first search result', 'www.google.com');
    expect(r.isOpenResultStep).toBe(true);
    expect(r.blocked).toBe(true);
  });

  test('a genuine navigation to a different site is accepted', () => {
    const r = evaluateOpenedResultClaim('Open the first search result', 'everydayparisian.com');
    expect(r.blocked).toBe(false);
  });

  test('other search engines are covered too, not just google.com', () => {
    expect(evaluateOpenedResultClaim('Open the third result', 'www.bing.com').blocked).toBe(true);
    expect(evaluateOpenedResultClaim('Open the third result', 'duckduckgo.com').blocked).toBe(true);
  });
});

// ===========================================================================
// detectBlockPage — Google's "unusual traffic" interstitial mistaken for a
// real page with a missing button, twice in the same session
// ===========================================================================
describe('detectBlockPage', () => {
  test('recognises the real Google block-page text verified live', () => {
    // Verified by actually navigating to google.com/search and reading the
    // real page — this is the literal text Google returned instead of
    // search results.
    const realBlockPageText = `About this page\n\nOur systems have detected unusual traffic from your computer network. This page checks to see if it's really you sending the requests, and not a robot. Why did this happen?\n\nIP address: 176.28.246.39\nTime: 2026-08-06T06:44:43Z`;
    expect(detectBlockPage(realBlockPageText)).toBe(true);
  });

  test('a normal page of content is not flagged', () => {
    expect(detectBlockPage('The 4 Best Noise-Cancelling Headphones of 2026 — our top picks for every budget.')).toBe(false);
  });

  test('empty/undefined text is not flagged', () => {
    expect(detectBlockPage('')).toBe(false);
    expect(detectBlockPage(undefined)).toBe(false);
  });

  test('catches a few common phrasing variants', () => {
    expect(detectBlockPage('Please verify you are human before continuing.')).toBe(true);
    expect(detectBlockPage("Confirm you're not a robot to proceed.")).toBe(true);
  });
});
