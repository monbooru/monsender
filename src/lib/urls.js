(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).urls = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Runs in the page: injected into the active tab under activeTab, so it
  // reaches nothing privileged - no storage, no api, no token.

  // Only what monbooru ingests: monloader declines an svg or bmp link
  // before downloading, so neither counts as a sendable file.
  const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|jxl)$/i;
  function isImageUrl(url) {
    try {
      const u = new URL(url);
      return /^https?:$/i.test(u.protocol) && IMAGE_EXT.test(u.pathname);
    } catch (e) { return false; }
  }

  function normalizeUrl(u) {
    u = (u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u.replace(/\/+$/, '');
  }

  function isReachableBase(u) {
    try { return !!new URL(u).host; } catch (e) { return false; }
  }

  return { isImageUrl, normalizeUrl, isReachableBase };
});
