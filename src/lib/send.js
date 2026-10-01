(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).send = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  function cfgOf(s) { return { baseUrl: s.baseUrl, token: s.token }; }

  async function sendOne(url, opts) {
    opts = opts || {};
    const s = await ns().storage.getSettings();
    if (!s.baseUrl) return { configured: false };
    const wait = opts.wait != null ? opts.wait : s.waitSeconds;
    const result = await ns().api.enqueue(cfgOf(s), url, { wait, options: opts.options });
    const job = result.status === 200 ? result.data : null;
    const jobId = job ? job.id : (result.data && result.data.job_id);
    return { configured: true, result, job, jobId, outcome: ns().outcome.enqueueOutcome(result, !!s.token) };
  }

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
        if (!outcome) outcome = ns().outcome.enqueueOutcome(r, !!s.token);
      }
    });
    return { configured: true, ids, failedUrls, failed: failedUrls.length, outcome };
  }

  return { cfgOf, sendOne, sendMany };
});
