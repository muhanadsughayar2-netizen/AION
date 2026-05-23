// video-pipeline-core.js
// Single source of truth for the testable parts of the Veo video pipeline.
// Loaded as a plain <script> tag in ai-chat.html so these functions become
// globals before ai-chat.js runs.  In Node.js (Jest) the module.exports block
// at the bottom makes them importable directly.
//
// Functions exported / made global:
//   fetchWithTimeout        — fetch wrapper with per-request timeout
//   pollVideoStatusAsync    — multi-clip poller returning {url, status}
//   fetchClipsWithAbort     — pre-fetch phase of stitchVideos (stop-flag aware)

// ---------------------------------------------------------------------------
// fetchWithTimeout — wraps fetch with a per-request timeout + optional abort
// signal. If the timeout fires first, an AbortError is thrown (same as a
// cancelled request) so callers can treat both cases identically.
// Source: ai-chat.js ~L4109
// ---------------------------------------------------------------------------
function fetchWithTimeout(url, { signal, timeoutMs = 20000 } = {}) {
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  // Combine caller signal + timeout into a single signal (AbortSignal.any if
  // available in the environment, otherwise manual forwarding).
  let combined = timeoutCtrl.signal;
  if (signal) {
    const relay = new AbortController();
    const done = () => relay.abort();
    signal.addEventListener('abort', done, { once: true });
    timeoutCtrl.signal.addEventListener('abort', done, { once: true });
    combined = relay.signal;
  }
  return fetch(url, { signal: combined }).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// pollVideoStatusAsync — polls a Veo operation until done, then resolves with
// { url, status }.  Status values:
//   'success'        → got a video URL
//   'transient'      → network/HTTP error (caller should retry same clip)
//   'rate_limit'     → 429/quota (caller should wait + retry)
//   'timeout'        → maxPolls exceeded (caller should retry)
//   'safety_blocked' → content/safety filter rejection (skip clip)
//   'no_uri'         → completed but no video URI (skip clip)
//   'job_error'      → permanent error (skip clip)
// Source: ai-chat.js ~L3943
// ---------------------------------------------------------------------------
function pollVideoStatusAsync(operationId, apiKey, progressBubble, clipNum, totalClips) {
  return new Promise((resolve) => {
    let pollCount = 0;
    // Adaptive interval: poll fast at first (5s) so users see early progress
    // updates, then back off to 15s once Veo is actually rendering.
    const maxPolls = 60;
    let consecutiveErrors = 0;
    let stopped = false;
    const FAST_POLL_MS = 5000;
    const SLOW_POLL_MS = 15000;
    const FAST_POLL_COUNT = 6;
    const nextDelay = () => (pollCount < FAST_POLL_COUNT ? FAST_POLL_MS : SLOW_POLL_MS);

    const extractUri = (d) => {
      const gvr = d.response && d.response.generateVideoResponse;
      if (gvr && gvr.generatedSamples && gvr.generatedSamples[0] && gvr.generatedSamples[0].video && gvr.generatedSamples[0].video.uri) return gvr.generatedSamples[0].video.uri;
      if (gvr && gvr.generatedSamples && gvr.generatedSamples[0] && gvr.generatedSamples[0].uri) return gvr.generatedSamples[0].uri;
      if (d.response && d.response.videos && d.response.videos[0] && d.response.videos[0].uri) return d.response.videos[0].uri;
      if (d.response && d.response.videos && d.response.videos[0] && d.response.videos[0].video && d.response.videos[0].video.uri) return d.response.videos[0].video.uri;
      if (d.response && d.response.generatedSamples && d.response.generatedSamples[0] && d.response.generatedSamples[0].video && d.response.generatedSamples[0].video.uri) return d.response.generatedSamples[0].video.uri;
      if (d.response && d.response.generatedSamples && d.response.generatedSamples[0] && d.response.generatedSamples[0].uri) return d.response.generatedSamples[0].uri;
      if (d.predictions && d.predictions[0] && d.predictions[0].video && d.predictions[0].video.uri) return d.predictions[0].video.uri;
      if (d.predictions && d.predictions[0] && d.predictions[0].uri) return d.predictions[0].uri;
      if (d.response && d.response.predictions && d.response.predictions[0] && d.response.predictions[0].video && d.response.predictions[0].video.uri) return d.response.predictions[0].video.uri;
      if (d.response && d.response.predictions && d.response.predictions[0] && d.response.predictions[0].uri) return d.response.predictions[0].uri;
      const str = JSON.stringify(d);
      const m = str.match(/"uri"\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/);
      if (m) return m[1];
      return '';
    };

    // Recursive setTimeout (NOT setInterval) so a slow poll request can never
    // overlap with the next tick.
    const tick = async () => {
      if (stopped) return;
      pollCount++;

      if (pollCount > maxPolls) {
        stopped = true;
        const text = progressBubble.querySelector && progressBubble.querySelector('.video-progress-text');
        if (text) text.textContent = `Clip ${clipNum} timed out.`;
        if (progressBubble._text !== undefined) progressBubble._text = `Clip ${clipNum} timed out.`;
        resolve({ url: null, status: 'timeout' });
        return;
      }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${apiKey}`;
        const resp = await fetchWithTimeout(url, { timeoutMs: 20000 });
        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          if (resp.status === 429) { consecutiveErrors = 0; setTimeout(tick, nextDelay()); return; }
          consecutiveErrors++;
          if (consecutiveErrors < 3) { setTimeout(tick, nextDelay()); return; }
          stopped = true;
          resolve({ url: null, status: 'transient' });
          return;
        }
        consecutiveErrors = 0;

        if (!data.done) {
          const pct = (data.metadata && data.metadata.percentComplete) || Math.min(pollCount * 5, 90);
          const text = progressBubble.querySelector && progressBubble.querySelector('.video-progress-text');
          if (text) text.textContent = `Clip ${clipNum}/${totalClips}: Rendering... ${pct}%`;
          if (progressBubble._text !== undefined) progressBubble._text = `Clip ${clipNum}/${totalClips}: Rendering... ${pct}%`;
          setTimeout(tick, nextDelay());
          return;
        }

        stopped = true;
        if (typeof console !== 'undefined') console.log('[SnapToAI Video] Clip done raw:', JSON.stringify(data).substring(0, 800));

        if (data.error) {
          const errMsg = (data.error.message || '').toLowerCase();
          if (errMsg.includes('safety') || errMsg.includes('filter') || errMsg.includes('blocked') ||
              errMsg.includes('policy') || errMsg.includes('person') || errMsg.includes('face')) {
            resolve({ url: null, status: 'safety_blocked' });
            return;
          }
          if (errMsg.includes('quota') || errMsg.includes('rate') || errMsg.includes('exceeded') ||
              errMsg.includes('resource')) {
            resolve({ url: null, status: 'rate_limit' });
            return;
          }
          resolve({ url: null, status: 'job_error' });
          return;
        }

        let videoUri = extractUri(data);

        if (!videoUri) {
          // Veo sometimes marks done=true but video propagation lags by a few
          // seconds. Re-poll up to 5 times before giving up.
          const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${apiKey}`;
          for (let attempt = 1; attempt <= 5 && !videoUri; attempt++) {
            if (stopped && attempt > 1) break;
            await new Promise(r => setTimeout(r, attempt <= 2 ? 3000 : 5000));
            try {
              const r2 = await fetchWithTimeout(pollUrl, { timeoutMs: 20000 });
              if (!r2.ok) continue;
              const d2 = await r2.json().catch(() => ({}));
              if (!d2.done) continue;
              if (d2.error) break;
              if (typeof console !== 'undefined') console.log(`[SnapToAI Video] no_uri re-poll ${attempt}:`, JSON.stringify(d2).substring(0, 400));
              videoUri = extractUri(d2);
            } catch (_) { if (_.name === 'AbortError') break; }
          }
        }

        if (videoUri) {
          const authedUrl = `${videoUri}${videoUri.includes('?') ? '&' : '?'}key=${apiKey}`;
          resolve({ url: authedUrl, status: 'success' });
        } else {
          resolve({ url: null, status: 'no_uri' });
        }
      } catch (err) {
        if (typeof console !== 'undefined') console.log(`[SnapToAI Video] Poll error clip ${clipNum}:`, err.message);
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          stopped = true;
          resolve({ url: null, status: 'transient' });
          return;
        }
        setTimeout(tick, nextDelay());
      }
    };
    // First poll fires after FAST_POLL_MS (5s) so users get a quick update.
    setTimeout(tick, FAST_POLL_MS);
  });
}

// ---------------------------------------------------------------------------
// fetchClipsWithAbort — pre-fetch phase of stitchVideos.
// Downloads all clip URLs into Blobs before the MediaRecorder starts so that
// CDN latency cannot stretch the recorded timeline.  Checks stitchCtx stop
// flags between every fetch so a Stop button press aborts immediately.
//
// @param {string[]}  videoUrls  — clip URLs to fetch in order
// @param {object}    stitchCtx  — shared context; must have .userStopped and
//                                 .aborted booleans (written by caller / timeout)
// @returns {Promise<Blob[]>}    — resolves with an array of Blobs in order
// @throws  Error('User stopped') if a stop flag fires between fetches
// Source: stitchVideos inner IIFE ~L4353 in ai-chat.js
// ---------------------------------------------------------------------------
async function fetchClipsWithAbort(videoUrls, stitchCtx) {
  const fetchAbort = new AbortController();
  stitchCtx._fetchAbort = fetchAbort;
  const blobs = [];
  for (const url of videoUrls) {
    if (stitchCtx.userStopped || stitchCtx.aborted) {
      fetchAbort.abort();
      throw new Error('User stopped');
    }
    const resp = await fetch(url, { signal: fetchAbort.signal });
    if (!resp.ok) throw new Error(`Failed to fetch clip: ${resp.status}`);
    blobs.push(await resp.blob());
  }
  return blobs;
}

// ---------------------------------------------------------------------------
// createSingleVideoPoller — factory for the single-clip poller used by
// pollVideoStatus in ai-chat.js.  Encapsulates the abort/concurrency guard:
// calling the returned function a second time cancels any in-flight poll from
// the first call so stale fetches can never write to a newer bubble.
//
// @param {function} [fetchFn=fetchWithTimeout]  injected for testing
// @returns {function(operationId, apiKey, progressBubble): void}
// ---------------------------------------------------------------------------
function createSingleVideoPoller(fetchFn) {
  var _fetchFn = fetchFn || fetchWithTimeout;
  var _abort = null;
  var _activeTimer = null;

  return function poll(operationId, apiKey, progressBubble) {
    if (_activeTimer) { clearTimeout(_activeTimer); _activeTimer = null; }
    if (_abort) { _abort.abort(); }
    var abortCtrl = new AbortController();
    _abort = abortCtrl;

    var stopped = false;
    var pollCount = 0;
    var maxPolls = 40;
    var FAST_POLL_MS = 5000;
    var SLOW_POLL_MS = 15000;
    var FAST_POLL_COUNT = 6;
    var nextDelay = function() { return pollCount < FAST_POLL_COUNT ? FAST_POLL_MS : SLOW_POLL_MS; };

    var tick = function() {
      if (stopped || abortCtrl.signal.aborted) return;
      pollCount++;
      if (pollCount > maxPolls) { stopped = true; return; }

      var url = 'https://generativelanguage.googleapis.com/v1beta/' + operationId + '?key=' + apiKey;
      _fetchFn(url, { signal: abortCtrl.signal, timeoutMs: 20000 })
        .then(function(resp) { return resp.json().then(function(data) { return { resp: resp, data: data }; }); })
        .then(function(result) {
          if (stopped || abortCtrl.signal.aborted) return;
          var resp = result.resp;
          var data = result.data;
          if (!resp.ok) {
            _activeTimer = setTimeout(tick, nextDelay());
            return;
          }
          if (!data.done) {
            var pct = (data.metadata && data.metadata.percentComplete) || Math.min(pollCount * 5, 90);
            progressBubble.lastPct = pct;
            progressBubble.updatedBy = operationId;
            _activeTimer = setTimeout(tick, nextDelay());
          } else {
            stopped = true;
            progressBubble.done = true;
            progressBubble.updatedBy = operationId;
          }
        })
        .catch(function(err) {
          if (err.name === 'AbortError') return;
          if (stopped || abortCtrl.signal.aborted) return;
          _activeTimer = setTimeout(tick, nextDelay());
        });
    };
    _activeTimer = setTimeout(tick, FAST_POLL_MS);
  };
}

// ---------------------------------------------------------------------------
// Node.js export (used by Jest; harmless in browser where module is undefined)
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fetchWithTimeout, pollVideoStatusAsync, fetchClipsWithAbort, createSingleVideoPoller };
}
