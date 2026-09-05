(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).api = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // The monloader JSON API client. Stateless: every call takes a
  // cfg = { baseUrl, token }. The bearer token, when set, is sent only here.

  function base(cfg) { return String((cfg && cfg.baseUrl) || '').replace(/\/+$/, ''); }

  function headers(cfg, hasBody) {
    const h = {};
    if (hasBody) h['Content-Type'] = 'application/json';
    if (cfg && cfg.token) h['Authorization'] = 'Bearer ' + cfg.token;
    return h;
  }

  // A monloader that accepts the connection and never answers would otherwise
  // leave every call pending forever - the server-side ?wait bounds the job,
  // not the socket. Above the 60 s ceiling settings allow for ?wait.
  const TIMEOUT_MS = 75000;

  // Uniform result. A network failure (monloader unreachable) is status 0 with
  // networkError, never a throw, so callers branch on one shape.
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

  // Exported for the options pairing loop, which waits the same way.
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // enqueue: with wait>0 a 200 returns the resolved job; otherwise (or on a
  // timeout) a 202 returns { job_id }.
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

  // Only the keys monloader's enqueue accepts survive; an unknown or empty
  // option is dropped rather than sent.
  function cleanOptions(o) {
    const out = {};
    if (o.gallery) out.gallery = o.gallery;
    if (o.folder) out.folder = o.folder;
    const mi = o.maxItems || o.max_items;
    if (mi) out.max_items = Number(mi);
    const pu = o.pageUrl || o.page_url;
    if (pu) out.page_url = pu;
    return out;
  }

  // Send many urls sequentially with a small gap so a big page does not burst
  // monloader. onEach(url, result) is called per item.
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
    if (opts.status) p.set('status', opts.status);
    return req(base(cfg) + '/api/v1/queue?' + p.toString(), { headers: headers(cfg, false) });
  }

  async function retry(cfg, id, force) {
    return req(base(cfg) + '/api/v1/queue/' + id + '/retry' + (force ? '?force=1' : ''), {
      method: 'POST', headers: headers(cfg, false)
    });
  }

  async function continueJob(cfg, id) {
    return req(base(cfg) + '/api/v1/queue/' + id + '/continue', {
      method: 'POST', headers: headers(cfg, false)
    });
  }

  // Fetch every remaining window of a capped search in one go: monloader keeps
  // pulling the next window until the search runs short.
  async function continueAll(cfg, id) {
    return req(base(cfg) + '/api/v1/queue/' + id + '/continue-all', {
      method: 'POST', headers: headers(cfg, false)
    });
  }

  async function remove(cfg, id) {
    return req(base(cfg) + '/api/v1/queue/' + id, { method: 'DELETE', headers: headers(cfg, false) });
  }

  // pause/resume the global download hold. The paused state is read back from
  // listQueue's `paused`, so the popup needs no extra poll.
  async function pause(cfg) {
    return req(base(cfg) + '/api/v1/queue/pause', { method: 'POST', headers: headers(cfg, false) });
  }

  async function resume(cfg) {
    return req(base(cfg) + '/api/v1/queue/resume', { method: 'POST', headers: headers(cfg, false) });
  }

  async function health(cfg) {
    return req(base(cfg) + '/health', { headers: {} });
  }

  async function listSites(cfg, q) {
    const p = q ? '?q=' + encodeURIComponent(q) : '';
    return req(base(cfg) + '/api/v1/sites' + p, { headers: headers(cfg, false) });
  }

  // pair offers a pairing to monloader; the operator approves there. No token is
  // sent (obtaining one is the point). Returns { request_id } on success.
  async function pair(cfg) {
    return req(base(cfg) + '/api/v1/pair/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'monsender', requested_scopes: ['read', 'write'] })
    });
  }

  // pairStatus polls a pending request; once approved, data.token carries the
  // issued bearer token (delivered once).
  async function pairStatus(cfg, id) {
    return req(base(cfg) + '/api/v1/pair/status?id=' + encodeURIComponent(id), { headers: {} });
  }

  return { enqueue, enqueueBatch, listQueue, retry, continueJob, continueAll, remove, pause, resume, health, listSites, pair, pairStatus, sleep };
});
