(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).sites = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  // Exact host or subdomain, never a substring: e621.net.evil.example
  // must not pass. The example names one host; mirrors come from hosts.
  function matchHost(sites, url) {
    const host = hostOf(url);
    if (!host) return false;
    const list = Array.isArray(sites) ? sites : (sites && sites.sites) || [];
    const covers = (h) => !!h && (host === h || host.endsWith('.' + h));
    return list.some((s) =>
      covers(hostOf(s && s.example)) ||
      ((s && s.hosts) || []).some((h) => covers(String(h).replace(/^www\./, ''))));
  }

  const TTL_MS = 5 * 60 * 1000;
  // A warm copy only: the list lives in storage.session, as the MV3
  // worker is torn down between gestures and the popup dies on close.
  let listCache = null;

  async function readCache() {
    if (listCache) return listCache;
    try { listCache = await ns().storage.getSitesCache(); } catch (e) { /* no extension storage */ }
    return listCache;
  }

  // Not ?q=: that filters by extractor category, so a host query misses.
  async function fetchSites(cfg) {
    const baseUrl = (cfg && cfg.baseUrl) || '';
    const now = Date.now();
    const cached = await readCache();
    if (cached && cached.baseUrl === baseUrl && now - cached.at < TTL_MS) return cached.sites;
    const r = await ns().api.listSites(cfg);
    const data = (r && r.ok && r.data) || {};
    const sites = Array.isArray(data) ? data : (data.sites || []);
    // Empty is not cached: a transient failure would blind sends for the TTL.
    if (sites.length) {
      listCache = { baseUrl, at: now, sites };
      try { await ns().storage.setSitesCache(listCache); } catch (e) { /* no extension storage */ }
    }
    return sites;
  }

  async function sendKind(cfg, url) {
    if (ns().urls.isImageUrl(url)) return 'image';
    if (!hostOf(url)) return 'unsupported';
    const list = await fetchSites(cfg);
    if (!list.length) return 'blind';
    return matchHost(list, url) ? 'supported' : 'unknown';
  }

  // Exported for the tests, which need the module cache reset between cases.
  async function clearCache() {
    listCache = null;
    try { await ns().storage.setSitesCache(null); } catch (e) { /* no extension storage */ }
  }

  return { hostOf, matchHost, sendKind, clearCache };
});
