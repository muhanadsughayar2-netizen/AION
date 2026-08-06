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
  hasSearchTarget,
  isTextRepeatedTooOften,
  pickStuckTargetLabel,
  extractUrls,
  isYouTubeWatchUrl,
  isFabricatedYouTubeUrl,
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

  // Real failure: asked to "collect 5 YouTube video links", the model had no
  // way to learn a link's real URL anywhere in the toolset — text/labels
  // only. This appends the real destination so a whole results page of links
  // can be read in one pass instead of clicking through them one at a time.
  test('a real link appends its resolved URL', () => {
    const label = formatElementLabel({
      tag: 'a', text: 'Dr. William Li — How the food you eat affects cancer',
      attrs: { href: 'https://www.youtube.com/watch?v=abc123XYZ' },
    });
    expect(label).toBe('Dr. William Li — How the food you eat affects cancer → https://www.youtube.com/watch?v=abc123XYZ');
  });

  test('a link with no readable text still surfaces the URL', () => {
    const label = formatElementLabel({ tag: 'a', text: '', attrs: { href: 'https://example.com/x' } });
    expect(label).toBe('link → https://example.com/x');
  });

  test('javascript:, mailto:, tel:, and bare # links are never appended', () => {
    expect(formatElementLabel({ tag: 'a', text: 'Menu', attrs: { href: 'javascript:void(0)' } })).toBe('Menu');
    expect(formatElementLabel({ tag: 'a', text: 'Email us', attrs: { href: 'mailto:hi@example.com' } })).toBe('Email us');
    expect(formatElementLabel({ tag: 'a', text: 'Call', attrs: { href: 'tel:+1234567890' } })).toBe('Call');
    expect(formatElementLabel({ tag: 'a', text: 'Top', attrs: { href: '#' } })).toBe('Top');
  });

  test('non-anchor elements never get a URL appended even if href is present on the object', () => {
    const label = formatElementLabel({ tag: 'button', text: 'Submit', attrs: { href: 'https://example.com' } });
    expect(label).toBe('Submit');
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

// ===========================================================================
// hasSearchTarget — click() called with nothing to search by, right after
// being shown the correct index in a numbered list
// ===========================================================================
describe('hasSearchTarget', () => {
  test('rejects a truly empty click call', () => {
    // Real failure: given "[35] The Best Noise-Cancelling Headphones...",
    // the very next call was click() with none of index/text/description/
    // selector set. Every fallback (DOM, AX tree, XPath, a real paid Vision
    // API call) ran anyway before failing -- all doomed from the start.
    expect(hasSearchTarget({})).toBe(false);
    expect(hasSearchTarget(undefined)).toBe(false);
    expect(hasSearchTarget({ index: undefined, text: '', description: '', selector: '' })).toBe(false);
  });

  test('an index alone is a valid target, even index 0', () => {
    expect(hasSearchTarget({ index: 35 })).toBe(true);
    expect(hasSearchTarget({ index: 0 })).toBe(true); // falsy number, must not be treated as missing
  });

  test('text, description, or selector alone are each valid', () => {
    expect(hasSearchTarget({ text: 'Send' })).toBe(true);
    expect(hasSearchTarget({ description: 'the blue button' })).toBe(true);
    expect(hasSearchTarget({ selector: '#submit' })).toBe(true);
  });
});

// ===========================================================================
// isTextRepeatedTooOften — the Astronaut Bio rename loop: 6 identical retypes
// at 6 different guessed targets, none of which the target-based detector
// (buildActionSignature) could ever catch since every target differed
// ===========================================================================
describe('isTextRepeatedTooOften', () => {
  test('the exact real failure: same text, 6 different guessed targets', () => {
    // recentTypedTexts only ever records the TEXT — target-based signatures
    // are a separate, complementary check (see shouldRunSequentially /
    // buildActionSignature tests above) and are irrelevant here.
    const history = ['Astronaut Bio', 'Astronaut Bio'];
    const r = isTextRepeatedTooOften(history, 'Astronaut Bio');
    expect(r.blocked).toBe(true);
    expect(r.count).toBe(3);
  });

  test('does not block on the first or second attempt', () => {
    expect(isTextRepeatedTooOften([], 'Astronaut Bio').blocked).toBe(false);
    expect(isTextRepeatedTooOften(['Astronaut Bio'], 'Astronaut Bio').blocked).toBe(false);
  });

  test('different text each time never triggers it', () => {
    const history = ['first draft', 'second draft'];
    expect(isTextRepeatedTooOften(history, 'third draft').blocked).toBe(false);
  });

  test('empty text is never flagged', () => {
    expect(isTextRepeatedTooOften(['a', 'a', 'a'], '').blocked).toBe(false);
  });
});

// ===========================================================================
// pickStuckTargetLabel — never show the user a raw CSS selector
// ===========================================================================
describe('pickStuckTargetLabel', () => {
  test('the exact real failure: only a guessed CSS selector, no text/description', () => {
    // Real transcript: gathering YouTube video links, a click call had only
    // a guessed selector. The old chain (text || description || selector ||
    // fallback) would still have picked this up as a last resort — this
    // guards specifically against the broken ORDER that put selector before
    // description, and against selector ever being chosen at all.
    const args = { selector: '#contents > ytd-post-renderer:nth-child(1) a.yt-simple-endpoint.style-scope.yt-formatted-string' };
    expect(pickStuckTargetLabel(args, '')).toBe('that step');
  });

  test('prefers text over description and selector', () => {
    const args = { text: 'Sign up', description: 'the signup button', selector: '.btn-primary' };
    expect(pickStuckTargetLabel(args, '')).toBe('Sign up');
  });

  test('falls back to description when text is missing, never selector', () => {
    const args = { description: 'the first video result', selector: '.some-fragile-class' };
    expect(pickStuckTargetLabel(args, '')).toBe('the first video result');
  });

  test('uses the generic fallback when nothing readable is present', () => {
    expect(pickStuckTargetLabel({}, '')).toBe('that step');
    expect(pickStuckTargetLabel(null, '')).toBe('that step');
  });

  test('a caller-supplied fallback still loses to real text/description', () => {
    expect(pickStuckTargetLabel({ text: 'Continue' }, 'custom fallback')).toBe('Continue');
  });

  test('falls back to url when text/description are missing — a URL is genuinely readable', () => {
    const args = { url: 'https://example.com/page', selector: '.some-fragile-class' };
    expect(pickStuckTargetLabel(args, '')).toBe('open https://example.com/page');
  });

  test('falls back to index when only index is present — still more useful than "that step"', () => {
    expect(pickStuckTargetLabel({ index: 7 }, '')).toBe('element [7] on the page');
    expect(pickStuckTargetLabel({ index: 0 }, '')).toBe('element [0] on the page'); // index 0 must not be treated as falsy
  });

  test('a selector-cleanup attempt was tested against the real reported selector and rejected — ' +
       'stripping punctuation still leaves unreadable, mid-word-truncated text', () => {
    const args = { selector: '#contents > ytd-post-renderer:nth-child(1) a.yt-simple-endpoint.style-scope.yt-formatted-string' };
    const result = pickStuckTargetLabel(args, '');
    expect(result).toBe('that step'); // not a "cleaned up" version of the selector
    expect(result).not.toMatch(/contents|renderer|endpoint/); // never leaks selector fragments either
  });
});

// ===========================================================================
// extractUrls / isYouTubeWatchUrl / isFabricatedYouTubeUrl — the agent
// inventing fake YouTube links when real ones were hard to find
// ===========================================================================
describe('extractUrls', () => {
  test('pulls multiple URLs out of a sentence, stripping trailing punctuation', () => {
    const text = 'Sources: https://www.youtube.com/watch?v=abc123XYZ, and https://example.com/page.';
    expect(extractUrls(text)).toEqual([
      'https://www.youtube.com/watch?v=abc123XYZ',
      'https://example.com/page',
    ]);
  });

  test('returns an empty array when there are no URLs', () => {
    expect(extractUrls('no links here at all')).toEqual([]);
  });

  test('handles empty/undefined input safely', () => {
    expect(extractUrls('')).toEqual([]);
    expect(extractUrls(undefined)).toEqual([]);
  });
});

describe('isYouTubeWatchUrl', () => {
  test('recognises a real watch URL', () => {
    expect(isYouTubeWatchUrl('https://www.youtube.com/watch?v=B9bDZ5-zPtY')).toBe(true);
    expect(isYouTubeWatchUrl('https://youtube.com/watch?v=B9bDZ5-zPtY')).toBe(true);
  });

  test('rejects non-watch YouTube URLs and other sites', () => {
    expect(isYouTubeWatchUrl('https://www.youtube.com/results?search_query=x')).toBe(false);
    expect(isYouTubeWatchUrl('https://example.com/watch?v=abc123')).toBe(false);
    expect(isYouTubeWatchUrl('')).toBe(false);
  });
});

describe('isFabricatedYouTubeUrl', () => {
  test('the exact real failure: obviously placeholder video IDs, never seen anywhere', () => {
    const seen = new Set(['https://www.youtube.com/watch?v=RealID12345']);
    expect(isFabricatedYouTubeUrl('https://www.youtube.com/watch?v=Y-Y-Y-Y-Y-Y', seen)).toBe(true);
    expect(isFabricatedYouTubeUrl('https://www.youtube.com/watch?v=Z-Z-Z-Z-Z-Z', seen)).toBe(true);
  });

  test('a URL that really was shown earlier this task is never blocked', () => {
    const seen = new Set(['https://www.youtube.com/watch?v=RealID12345']);
    expect(isFabricatedYouTubeUrl('https://www.youtube.com/watch?v=RealID12345', seen)).toBe(false);
  });

  test('non-YouTube-watch URLs are never checked against seenUrls at all', () => {
    // A constructed search/navigation URL is legitimate even if never "seen" —
    // only opaque, unguessable video IDs need this guard.
    expect(isFabricatedYouTubeUrl('https://www.google.com/search?q=anything', new Set())).toBe(false);
  });

  test('an empty seenUrls set blocks every watch URL, including the very first one', () => {
    expect(isFabricatedYouTubeUrl('https://www.youtube.com/watch?v=RealID12345', new Set())).toBe(true);
  });
});
