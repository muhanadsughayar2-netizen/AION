/**
 * End-to-end video generation pipeline tests — Task #41.
 *
 * Functions under test are imported from the PRODUCTION module
 * flow-premium/video-pipeline-core.js (the single source of truth also loaded
 * by ai-chat.html).  Regressions in that file are caught automatically here.
 *
 * Scenarios:
 *   1. Concurrency — generation A aborted when B starts; A never writes to B's UI.
 *   2. Network stall — fetchWithTimeout rejects at 20 s AND the poll retries.
 *   3. Stop during stitch prefetch — in-flight fetch cancelled immediately on stop.
 *   4. done=true with no URI — re-poll loop resolves success within 5 attempts.
 */

'use strict';

const {
  fetchWithTimeout,
  pollVideoStatusAsync,
  fetchClipsWithAbort,
  createSingleVideoPoller,
} = require('../flow-premium/video-pipeline-core.js');

// ===========================================================================
// Shared helpers
// ===========================================================================

function makeBubble() {
  return { _text: '', lastPct: 0, updatedBy: null, done: false };
}

/**
 * Minimal fetch-response object.  Avoids the browser-only Response constructor
 * which is absent in the jsdom test environment.
 */
function mockResponse(body, { status = 200, ok = null } = {}) {
  const isOk = ok !== null ? ok : status >= 200 && status < 300;
  return {
    ok: isOk,
    status,
    json: () => Promise.resolve(typeof body === 'object' ? body : {}),
    blob: () => Promise.resolve(new Uint8Array([0])),
  };
}

/**
 * A fetch mock that hangs until the provided AbortSignal fires, then rejects
 * with an AbortError — matching real browser behaviour.
 */
function hangingFetch(url, { signal } = {}) {
  return new Promise((_, reject) => {
    const abort = () => {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      reject(err);
    };
    if (signal && signal.aborted) { abort(); return; }
    if (signal) signal.addEventListener('abort', abort, { once: true });
  });
}

/** Flush the JS microtask queue. */
async function flushMicrotasks(rounds = 20) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** Advance fake timers then flush microtasks so async code makes progress. */
async function tick(ms = 5001) {
  jest.advanceTimersByTime(ms);
  await flushMicrotasks();
}

// ===========================================================================
// Suite 1 — fetchWithTimeout: stalled network triggers AbortError at 20 s
//           AND the polling layer retries after the timeout
// ===========================================================================
describe('fetchWithTimeout — network stall', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  test('rejects with AbortError when fetch never resolves within timeoutMs', async () => {
    global.fetch = jest.fn(hangingFetch);

    const promise = fetchWithTimeout('https://example.com/op', { timeoutMs: 20000 });
    jest.advanceTimersByTime(20001);
    await flushMicrotasks();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('resolves normally when fetch completes before timeoutMs', async () => {
    global.fetch = jest.fn(() => Promise.resolve(mockResponse({ done: false })));

    const result = await fetchWithTimeout('https://example.com/op', { timeoutMs: 20000 });
    expect(result.ok).toBe(true);
  });

  test('caller-provided signal can abort independently of the built-in timeout', async () => {
    const ctrl = new AbortController();
    global.fetch = jest.fn(hangingFetch);

    const promise = fetchWithTimeout('https://example.com/op', {
      signal: ctrl.signal,
      timeoutMs: 20000,
    });

    ctrl.abort();
    await flushMicrotasks();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('pollVideoStatusAsync retries after a stalled poll times out', async () => {
    // Scenario 2: stall + retry.
    // First fetch hangs → fetchWithTimeout fires at 20 s → catch block increments
    // consecutiveErrors and schedules a retry tick.  Second fetch succeeds with done=true.
    let callCount = 0;
    global.fetch = jest.fn((url, opts = {}) => {
      callCount++;
      if (callCount === 1) return hangingFetch(url, opts); // hangs → timeout
      // Second call: quick done response with URI
      return Promise.resolve(mockResponse({
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://example.com/v.mp4' } }] } },
      }));
    });

    const bubble = makeBubble();
    const resultPromise = pollVideoStatusAsync('ops/stall-op', 'key', bubble, 1, 1);

    // Fire first 5 s delay → tick 1 starts (hangs)
    await tick(5001);
    // Advance 20 s → fetchWithTimeout fires, aborts hanging fetch → catch block
    await tick(20001);
    // Advance another 5 s → retry tick fires with good response
    await tick(5001);
    await flushMicrotasks(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// Suite 2 — Concurrency: generation A must not update B's UI after B starts
// ===========================================================================
describe('createSingleVideoPoller — concurrency guard', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  test('second poll cancels the first; aborted tick never writes to any bubble', async () => {
    let resolveHangingFetch;
    const hangPromise = new Promise(res => { resolveHangingFetch = res; });

    const mockFetch = jest.fn((url, opts = {}) => {
      if (url.includes('op-A')) {
        return new Promise((resolve, reject) => {
          const abort = () => { const e = Object.assign(new Error('AbortError'), { name: 'AbortError' }); reject(e); };
          if (opts.signal && opts.signal.aborted) { abort(); return; }
          if (opts.signal) opts.signal.addEventListener('abort', abort, { once: true });
          hangPromise.then(() => { if (!opts.signal || !opts.signal.aborted) resolve(mockResponse({ done: true })); });
        });
      }
      return Promise.resolve(mockResponse({ done: false, metadata: { percentComplete: 10 } }));
    });

    // createSingleVideoPoller with injected fetch so tests don't touch global.fetch
    const pollVideoStatus = createSingleVideoPoller(mockFetch);

    const bubbleA = makeBubble();
    const bubbleB = makeBubble();

    // Start generation A
    pollVideoStatus('op-A', 'key', bubbleA);
    await tick(5001); // A's first tick starts, hangs

    // Start generation B — this aborts A's AbortController immediately
    pollVideoStatus('op-B', 'key', bubbleB);
    await tick(5001); // B's first tick fires, updates bubbleB
    await flushMicrotasks();

    // Release A's hanging fetch — but A's signal is already aborted
    resolveHangingFetch();
    await flushMicrotasks();

    // B's bubble must have been updated by op-B
    expect(bubbleB.updatedBy).toBe('op-B');
    // A's tick detected the abort and returned early — bubbleA.done stays false
    expect(bubbleA.done).toBe(false);
    // bubbleB must never be attributed to op-A
    expect(bubbleB.updatedBy).not.toBe('op-A');
  });
});

// ===========================================================================
// Suite 3 — fetchClipsWithAbort: Stop flag aborts the in-flight fetch immediately
// ===========================================================================
describe('fetchClipsWithAbort — Stop cancels prefetch immediately', () => {
  afterEach(() => jest.restoreAllMocks());

  test('aborting _fetchAbort cancels the in-flight fetch immediately (not after resolve)', async () => {
    const stitchCtx = {};
    let abortFired = false;

    // Clip 1 hangs; will be aborted externally via stitchCtx._fetchAbort
    global.fetch = jest.fn((url, { signal } = {}) => {
      if (url.includes('clip1')) {
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            abortFired = true;
            const e = Object.assign(new Error('AbortError'), { name: 'AbortError' });
            reject(e);
          }, { once: true });
        });
      }
      return Promise.resolve(mockResponse(null));
    });

    const prefetchPromise = fetchClipsWithAbort(
      ['https://example.com/clip1.mp4', 'https://example.com/clip2.mp4'],
      stitchCtx,
    );

    // fetchClipsWithAbort sets stitchCtx._fetchAbort synchronously before the first await
    await flushMicrotasks(2);

    // Simulate Stop button: set flag AND abort the controller (same as production stitchVideos timeout does)
    stitchCtx.userStopped = true;
    stitchCtx._fetchAbort.abort();

    await flushMicrotasks();

    // The in-flight fetch got an AbortError immediately (not after it "resolved")
    expect(abortFired).toBe(true);
    // clip2 was never fetched
    const fetchedUrls = global.fetch.mock.calls.map(([url]) => url);
    expect(fetchedUrls).not.toContain('https://example.com/clip2.mp4');
    // The prefetch promise rejects (either with AbortError or 'User stopped')
    await expect(prefetchPromise).rejects.toThrow();
  });

  test('userStopped flag before fetch start throws "User stopped" immediately on next loop', async () => {
    const stitchCtx = {};
    let resolveClip1;
    const clip1Done = new Promise(res => { resolveClip1 = res; });

    global.fetch = jest.fn((url) => {
      if (url.includes('clip1')) return clip1Done.then(() => mockResponse(null));
      return Promise.resolve(mockResponse(null));
    });

    const prefetchPromise = fetchClipsWithAbort(
      ['https://example.com/clip1.mp4', 'https://example.com/clip2.mp4'],
      stitchCtx,
    );

    await flushMicrotasks(2);

    // Set flag while clip1 fetch is in flight
    stitchCtx.userStopped = true;

    // Allow clip1 to complete — loop then checks flag before fetching clip2
    resolveClip1();
    await flushMicrotasks();

    await expect(prefetchPromise).rejects.toThrow('User stopped');
    const fetchedUrls = global.fetch.mock.calls.map(([url]) => url);
    expect(fetchedUrls).not.toContain('https://example.com/clip2.mp4');
  });
});

// ===========================================================================
// Suite 4 — pollVideoStatusAsync: done=true with no URI triggers re-poll loop
// ===========================================================================
describe('pollVideoStatusAsync — done=true with no URI re-polls up to 5 times', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  test('resolves success when URI appears on re-poll attempt 3', async () => {
    const VIDEO_URI = 'https://storage.googleapis.com/veo/clip.mp4';
    let callCount = 0;

    global.fetch = jest.fn(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(mockResponse({ done: true })); // no URI
      if (callCount <= 3) return Promise.resolve(mockResponse({ done: true })); // still no URI
      return Promise.resolve(mockResponse({
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: VIDEO_URI } }] } },
      }));
    });

    const bubble = makeBubble();
    const resultPromise = pollVideoStatusAsync('ops/test-op', 'test-key', bubble, 1, 1);

    await tick(5001);             // initial poll → done, no URI → enters re-poll loop
    await tick(3001);             // re-poll attempt 1
    await tick(3001);             // re-poll attempt 2
    await tick(5001);             // re-poll attempt 3 → URI found

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.url).toContain(VIDEO_URI);
    expect(result.url).toContain('key=test-key');
  });

  test('resolves no_uri when all 5 re-poll attempts return done=true with no URI', async () => {
    global.fetch = jest.fn(() => Promise.resolve(mockResponse({ done: true })));

    const bubble = makeBubble();
    const resultPromise = pollVideoStatusAsync('ops/empty-op', 'test-key', bubble, 1, 1);

    await tick(5001);
    for (const ms of [3001, 3001, 5001, 5001, 5001]) await tick(ms);

    const result = await resultPromise;
    expect(result.status).toBe('no_uri');
    expect(result.url).toBeNull();
  });

  test('resolves safety_blocked when done=true carries a safety error', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(mockResponse({ done: true, error: { message: 'Content was blocked by safety filter.' } })),
    );

    const bubble = makeBubble();
    const resultPromise = pollVideoStatusAsync('ops/blocked-op', 'key', bubble, 1, 1);

    await tick(5001);

    const result = await resultPromise;
    expect(result.status).toBe('safety_blocked');
  });

  test('resolves rate_limit when done=true carries a quota/rate error', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(mockResponse({ done: true, error: { message: 'Quota exceeded for this resource.' } })),
    );

    const bubble = makeBubble();
    const resultPromise = pollVideoStatusAsync('ops/quota-op', 'key', bubble, 1, 1);

    await tick(5001);

    const result = await resultPromise;
    expect(result.status).toBe('rate_limit');
  });

  test('resolves timeout when maxPolls is exhausted without a done response', async () => {
    global.fetch = jest.fn(() => Promise.resolve(mockResponse({ done: false })));

    const bubble = { _text: '' };
    const resultPromise = pollVideoStatusAsync('ops/slow-op', 'key', bubble, 2, 3);

    for (let i = 0; i <= 61; i++) await tick(i < 6 ? 5001 : 15001);

    const result = await resultPromise;
    expect(result.status).toBe('timeout');
    expect(result.url).toBeNull();
  });
});
