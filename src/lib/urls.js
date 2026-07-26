(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).urls = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Shared URL classifiers. The send gate (lib/sites.js) and the page scan
  // (lib/scan-core.js) both need "is this a direct image file?", but run in
  // separate load contexts (popup, background, injected page) that share no
  // other module - so the test lives here, loaded into each.

  // A direct link to an image file: http(s) whose path ends in a known image
  // extension. The query/fragment is ignored (a page is not an image because
  // its query happens to name one). Only the types monbooru ingests count -
  // monloader declines an svg, avif, or bmp media URL up front, so calling one
  // a sendable direct file would promise a send that cannot land.
  const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
  function isImageUrl(url) {
    try {
      const u = new URL(url);
      return /^https?:$/i.test(u.protocol) && IMAGE_EXT.test(u.pathname);
    } catch (e) { return false; }
  }

  // Settings input -> a clean base URL: trim, default the http(s) scheme, drop
  // any trailing slashes. Empty stays empty.
  function normalizeUrl(u) {
    u = (u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u.replace(/\/+$/, '');
  }

  // Normalizing only prefixes a scheme and trims slashes, so it happily returns
  // strings nothing can reach: "http://" and "http://not a url" both come back
  // and both throw in new URL(), which is where a saved base URL ends up.
  function isReachableBase(u) {
    try { return !!new URL(u).host; } catch (e) { return false; }
  }

  return { isImageUrl, normalizeUrl, isReachableBase };
});
