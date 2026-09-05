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

  function cfgOf(s) { return { baseUrl: s.baseUrl, token: s.token }; }

  async function isConfigured() {
    const s = await ns().storage.getSettings();
    return !!s.baseUrl;
  }

  // Send one URL and wait for the outcome. Returns
  // { configured, result, job, jobId, outcome }.
  async function sendOne(url, opts) {
    opts = opts || {};
    const s = await ns().storage.getSettings();
    if (!s.baseUrl) return { configured: false };
    const wait = opts.wait != null ? opts.wait : s.waitSeconds;
    const result = await ns().api.enqueue(cfgOf(s), url, { wait, options: opts.options });
    const job = result.status === 200 ? result.data : null;
    const jobId = job ? job.id : (result.data && result.data.job_id);
    return { configured: true, result, job, jobId, outcome: ns().outcome.enqueueOutcome(result) };
  }

  // Send a selection, sequentially. Runs the same mapping as sendOne, so a
  // rejected token reads as one rather than as N anonymous failures. Returns
  // { configured, ids, failedUrls, failed, outcome }; outcome is the first
  // failure's line and null when everything landed. failedUrls names them, so
  // a caller can offer a retry of exactly those.
  async function sendMany(urls, opts) {
    opts = opts || {};
    const s = await ns().storage.getSettings();
    if (!s.baseUrl) return { configured: false };
    const ids = [];
    const failedUrls = [];
    let outcome = null;
    await ns().api.enqueueBatch(cfgOf(s), urls, {
      options: opts.options,
      onEach: (u, r) => {
        const id = r.data && (r.data.job_id || r.data.id);
        if (id) { ids.push(id); return; }
        failedUrls.push(u);
        if (!outcome) outcome = ns().outcome.enqueueOutcome(r);
      }
    });
    return { configured: true, ids, failedUrls, failed: failedUrls.length, outcome };
  }

  return { cfgOf, isConfigured, sendOne, sendMany };
});
