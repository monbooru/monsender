(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).sites = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const urls = node ? require('./urls.js') : (self.ML && self.ML.urls);
  const api = node ? require('./api.js') : (self.ML && self.ML.api);
  const storage = node ? require('./storage.js') : (self.ML && self.ML.storage);

  // The "will tags come?" hint: is this URL a gallery-dl-supported
  // booru, or just a raw file? A hint only - the authoritative result is the
  // job outcome. Drives the post-vs-direct context-menu choice.

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  // Pure: does any supported site match this URL's host? `sites` may be the
  // array or the { sites: [...] } envelope. Match the host exactly or as a
  // subdomain of an entry's example host; a substring would let a look-alike
  // (e621.net.evil.example) pass.
  function matchHost(sites, url) {
    const host = hostOf(url);
    if (!host) return false;
    const list = Array.isArray(sites) ? sites : (sites && sites.sites) || [];
    return list.some((s) => {
      const exHost = hostOf(s && s.example);
      return !!exHost && (host === exHost || host.endsWith('.' + exHost));
    });
  }

  const TTL_MS = 5 * 60 * 1000;
  // Mirrors storage.session, which is where the list actually lives: a module
  // variable is cold on every gesture, since the worker is torn down between
  // them and the popup dies on close.
  let listCache = null; // { baseUrl, at, sites }

  async function readCache() {
    if (listCache) return listCache;
    try { listCache = await storage.getSitesCache(); } catch (e) { /* no extension storage */ }
    return listCache;
  }

  // monloader's GET /api/v1/sites?q= filters by extractor category, not by
  // host (and many booru categories are blank in the parse), so a host query
  // misses. Instead fetch the full list once, cache it, and match the host
  // against each entry's example URL locally (matchHost).
  async function fetchSites(cfg) {
    const baseUrl = (cfg && cfg.baseUrl) || '';
    const now = Date.now();
    const cached = await readCache();
    if (cached && cached.baseUrl === baseUrl && now - cached.at < TTL_MS) return cached.sites;
    const r = await api.listSites(cfg);
    const data = (r && r.ok && r.data) || {};
    const sites = Array.isArray(data) ? data : (data.sites || []);
    // A failed or empty fetch is not cached, so a transient miss does not stick
    // for the TTL and blind every send in that window.
    if (sites.length) {
      listCache = { baseUrl, at: now, sites };
      try { await storage.setSitesCache(listCache); } catch (e) { /* no extension storage */ }
    }
    return sites;
  }

  // Classify a URL for the send gate: 'image' (a direct file, no tags),
  // 'supported' (an example host matched, so tags come), 'unsupported' (no host
  // at all - nothing to enqueue), 'blind' (no sites list to consult), or
  // 'unknown' (a fetched list that just does not name the host). 'unknown' and
  // 'blind' are both undecidable, but callers treat them apart: an unlisted host
  // loses to the raw file, a blind one does not.
  async function sendKind(cfg, url) {
    if (urls.isImageUrl(url)) return 'image';
    if (!hostOf(url)) return 'unsupported';
    const list = await fetchSites(cfg);
    if (!list.length) return 'blind';
    return matchHost(list, url) ? 'supported' : 'unknown';
  }

  async function clearCache() {
    listCache = null;
    try { await storage.setSitesCache(null); } catch (e) { /* no extension storage */ }
  }

  return { hostOf, matchHost, sendKind, clearCache };
});
