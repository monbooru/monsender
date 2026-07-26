(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).send = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Shared "read settings -> enqueue -> interpret" used by the background
  // (keyboard command, context menu) and the popup. Depends on the other lib
  // modules through the ML namespace (assembled in the browser by the script
  // tags / importScripts; set on globalThis in node tests).
  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  async function settings() { return ns().storage.getSettings(); }
  function cfgOf(s) { return { baseUrl: s.baseUrl, token: s.token }; }

  async function isConfigured() {
    const s = await settings();
    return !!s.baseUrl;
  }

  // One enqueue result -> a { kind, text, tone } line. A network failure and a
  // 401 get their own kinds so no caller has to inspect the raw result.
  function outcomeOf(result) {
    if (result.networkError || result.status === 0) {
      return { kind: 'down', text: 'monloader unreachable', tone: 'error' };
    }
    if (result.status === 401) {
      return { kind: 'rejected', text: 'monloader rejected the token', tone: 'error' };
    }
    if (result.status === 200) return ns().outcome.singleOutcome(result.data);
    if (result.status === 202) return ns().outcome.singleOutcome(null); // wait timed out: the job is queued
    return { kind: 'failed', text: 'send failed (HTTP ' + result.status + ')', tone: 'error' };
  }

  // Send one URL and wait for the outcome. Returns
  // { configured, result, job, jobId, outcome }.
  async function sendOne(url, opts) {
    opts = opts || {};
    const s = await settings();
    if (!s.baseUrl) return { configured: false };
    const wait = opts.wait != null ? opts.wait : s.waitSeconds;
    const result = await ns().api.enqueue(cfgOf(s), url, { wait, options: opts.options });
    const job = result.status === 200 ? result.data : null;
    const jobId = job ? job.id : (result.data && result.data.job_id);
    return { configured: true, result, job, jobId, outcome: outcomeOf(result) };
  }

  // Send a selection, sequentially. Runs the same mapping as sendOne, so a
  // rejected token reads as one rather than as N anonymous failures. Returns
  // { configured, ids, failed, outcome }, outcome being the first failure's
  // line and null when everything landed.
  async function sendMany(urls, opts) {
    opts = opts || {};
    const s = await settings();
    if (!s.baseUrl) return { configured: false };
    const ids = [];
    let outcome = null;
    await ns().api.enqueueBatch(cfgOf(s), urls, {
      options: opts.options,
      onEach: (u, r) => {
        const id = r.data && (r.data.job_id || r.data.id);
        if (id) ids.push(id);
        else if (!outcome) outcome = outcomeOf(r);
      }
    });
    return { configured: true, ids, failed: urls.length - ids.length, outcome };
  }

  return { cfgOf, isConfigured, sendOne, sendMany };
});
