(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).storage = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // storage.local only: the token must never reach storage.sync, which
  // uploads to a browser account.
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

  async function getSettings() {
    const r = await area().get('settings');
    return Object.assign({}, DEFAULTS, r.settings);
  }

  // Where the popup's and the panel's sends go, kept until emptied; empty
  // fields leave the choice to monloader.
  const NO_DESTINATION = { gallery: '', folder: '' };

  // Job ids are numbered per instance, and galleries and folders are
  // another monloader's, so neither outlives a URL change.
  async function setSettings(patch) {
    const cur = await getSettings();
    const next = Object.assign({}, cur, patch);
    await area().set(next.baseUrl === cur.baseUrl ? { settings: next }
      : { settings: next, recentJobIds: [], destination: NO_DESTINATION });
    return next;
  }

  async function getDestination() {
    const r = await area().get('destination');
    return Object.assign({}, NO_DESTINATION, r.destination);
  }

  async function setDestination(patch) {
    const next = Object.assign(await getDestination(), patch);
    await area().set({ destination: next });
    return next;
  }

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

  function sessionArea() {
    return (browser.storage && browser.storage.session) ? browser.storage.session : browser.storage.local;
  }
  async function sessionGet(key) { return (await sessionArea().get(key))[key] || null; }
  async function setScan(data) { await sessionArea().set({ lastScan: data }); }
  const getScan = () => sessionGet('lastScan');
  async function setSitesCache(v) { await sessionArea().set({ sitesCache: v }); }
  const getSitesCache = () => sessionGet('sitesCache');

  return {
    getSettings, setSettings, getDestination, setDestination, getRecentJobIds, addRecentJobIds,
    setScan, getScan, setSitesCache, getSitesCache
  };
});
