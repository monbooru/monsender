(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).storage = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Settings live in storage.local only. The token is a secret and must never
  // go to storage.sync (which uploads to a browser account).
  const DEFAULTS = {
    baseUrl: '',
    token: '',
    waitSeconds: 20,
    scanCap: 100,
    minImageSize: 64,
    previews: true
  };

  const RING_MAX = 200;

  function area() { return browser.storage.local; }

  function withDefaults(s) {
    return Object.assign({}, DEFAULTS, s || {});
  }

  async function getSettings() {
    const r = await area().get('settings');
    return withDefaults(r.settings);
  }

  async function setSettings(patch) {
    const cur = await getSettings();
    const next = Object.assign({}, cur, patch);
    await area().set({ settings: next });
    return next;
  }

  // Bounded ring of job ids this browser enqueued, so the queue view can flag
  // "mine". storage.local persists across worker restarts; this is loose
  // "recent", not a strict session.
  async function getRecentJobIds() {
    const r = await area().get('recentJobIds');
    return Array.isArray(r.recentJobIds) ? r.recentJobIds : [];
  }

  async function addRecentJobIds(ids) {
    const add = (Array.isArray(ids) ? ids : [ids]).filter((x) => x != null);
    const cur = await getRecentJobIds();
    const next = [...add, ...cur].slice(0, RING_MAX);
    await area().set({ recentJobIds: next });
    return next;
  }

  // The scan handoff popup -> side panel. Uses storage.session when available
  // (cleared on browser close) and falls back to local when it is missing.
  function sessionArea() {
    return (browser.storage && browser.storage.session) ? browser.storage.session : browser.storage.local;
  }
  async function setScan(data) { await sessionArea().set({ lastScan: data }); }
  async function getScan() {
    const r = await sessionArea().get('lastScan');
    return r.lastScan || null;
  }

  // The gallery-dl site list. It is the largest response the extension fetches
  // and most gestures consult it, so it outlives the module that holds it: the
  // MV3 worker is torn down between gestures and the popup dies on close.
  async function setSitesCache(v) { await sessionArea().set({ sitesCache: v }); }
  async function getSitesCache() {
    const r = await sessionArea().get('sitesCache');
    return r.sitesCache || null;
  }

  return {
    getSettings, setSettings, getRecentJobIds, addRecentJobIds,
    setScan, getScan, setSitesCache, getSitesCache
  };
});
