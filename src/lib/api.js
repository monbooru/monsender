(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).api = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // The bearer token leaves the extension from this module only.

  function base(cfg) { return String((cfg && cfg.baseUrl) || '').replace(/\/+$/, ''); }

  function headers(cfg, hasBody) {
    const h = {};
    if (hasBody) h['Content-Type'] = 'application/json';
    if (cfg && cfg.token) h['Authorization'] = 'Bearer ' + cfg.token;
    return h;
  }

  // ?wait bounds the job, not the socket, so a silent monloader would
  // hang a call. Must stay above the 60 s ?wait cap.
  const TIMEOUT_MS = 75000;

  // Never throws: a network failure comes back as status 0 with networkError.
  async function req(url, init) {
    let res;
    try {
      res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(TIMEOUT_MS) }, init));
    } catch (e) {
      return { ok: false, status: 0, networkError: true, error: String((e && e.message) || e), data: null, headers: null };
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty / non-JSON body */ }
    return { ok: res.ok, status: res.status, data, headers: res.headers };
  }

  function call(cfg, method, path) {
    return req(base(cfg) + path, { method, headers: headers(cfg, false) });
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function enqueue(cfg, url, opts) {
    opts = opts || {};
    const wait = opts.wait > 0 ? '?wait=' + opts.wait : '';
    const body = { url };
    const o = opts.options && cleanOptions(opts.options);
    if (o && Object.keys(o).length) body.options = o;
    return req(base(cfg) + '/api/v1/queue' + wait, {
      method: 'POST', headers: headers(cfg, true), body: JSON.stringify(body)
    });
  }

  function cleanOptions(o) {
    const out = {};
    if (o.maxItems) out.max_items = Number(o.maxItems);
    // monloader refuses a whole send whose page_url is not http(s).
    if (o.pageUrl && /^https?:/i.test(o.pageUrl)) out.page_url = o.pageUrl;
    return out;
  }

  // Sequential with a gap, so a big page does not burst monloader.
  async function enqueueBatch(cfg, urls, opts) {
    opts = opts || {};
    const gap = opts.gapMs == null ? 120 : opts.gapMs;
    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const r = await enqueue(cfg, urls[i], { options: opts.options });
      results.push(r);
      if (opts.onEach) opts.onEach(urls[i], r);
      if (gap && i < urls.length - 1) await sleep(gap);
    }
    return results;
  }

  async function listQueue(cfg, opts) {
    opts = opts || {};
    const p = new URLSearchParams();
    p.set('limit', String(opts.limit || 20));
    if (opts.page > 1) p.set('page', String(opts.page));
    return req(base(cfg) + '/api/v1/queue?' + p.toString(), { headers: headers(cfg, false) });
  }

  const getJob = (cfg, id) => call(cfg, 'GET', '/api/v1/queue/' + id);
  const retry = (cfg, id, force) => call(cfg, 'POST', '/api/v1/queue/' + id + '/retry' + (force ? '?force=1' : ''));
  const continueJob = (cfg, id) => call(cfg, 'POST', '/api/v1/queue/' + id + '/continue');
  const continueAll = (cfg, id) => call(cfg, 'POST', '/api/v1/queue/' + id + '/continue-all');
  const remove = (cfg, id) => call(cfg, 'DELETE', '/api/v1/queue/' + id);
  const pause = (cfg) => call(cfg, 'POST', '/api/v1/queue/pause');
  const resume = (cfg) => call(cfg, 'POST', '/api/v1/queue/resume');
  const pairRemove = (cfg) => call(cfg, 'POST', '/api/v1/pair/remove');

  async function health(cfg) {
    return req(base(cfg) + '/health', { headers: {} });
  }

  async function listSites(cfg, q) {
    const p = q ? '?q=' + encodeURIComponent(q) : '';
    return req(base(cfg) + '/api/v1/sites' + p, { headers: headers(cfg, false) });
  }

  // No token: obtaining one is the point.
  async function pair(cfg) {
    return req(base(cfg) + '/api/v1/pair/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'monsender', requested_scopes: ['read', 'write'] })
    });
  }

  // monloader hands the token out once, on the first read after approval.
  async function pairStatus(cfg, id) {
    return req(base(cfg) + '/api/v1/pair/status?id=' + encodeURIComponent(id), { headers: {} });
  }

  return { enqueue, enqueueBatch, listQueue, getJob, retry, continueJob, continueAll, remove, pause, resume, health, listSites, pair, pairStatus, pairRemove, sleep };
});
