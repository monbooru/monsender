(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).scanCore = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  // Runs in the page: injected into the active tab under activeTab, so it
  // reaches nothing privileged - no storage, no api, no token.

  // collect runs in the page; finalize is pure and runs in the caller.

  function srcsetCands(srcset) {
    return String(srcset).split(',').map((s) => {
      const p = s.trim().split(/\s+/);
      const m = /^(\d+)w$/.exec(p[1] || '');
      return { url: p[0], w: m ? +m[1] : 0 };
    }).filter((c) => c.url);
  }

  const MEDIA_PARENT = { PICTURE: 1, VIDEO: 1, AUDIO: 1 };

  function sourcesOf(el) {
    const out = [];
    for (const s of (el && el.children) || []) {
      if (s.nodeName !== 'SOURCE') continue;
      if (s.srcset) out.push(...srcsetCands(s.srcset));
      if (s.src) out.push({ url: s.src, w: 0 });
    }
    return out;
  }

  function variantsOf(n) {
    const cands = n.srcset ? srcsetCands(n.srcset) : [];
    if (n.src) cands.push({ url: n.src, w: 0 });
    if (n.currentSrc && n.currentSrc !== n.src) cands.push({ url: n.currentSrc, w: 0 });
    const p = n.parentNode;
    if (p && p.nodeName === 'PICTURE') cands.push(...sourcesOf(p));
    if (MEDIA_PARENT[n.nodeName]) cands.push(...sourcesOf(n));
    return cands;
  }

  function bestCand(n) {
    const cands = variantsOf(n);
    let best = null, bv = n.naturalWidth || 0;
    for (const c of cands) if (c.w > bv) { bv = c.w; best = c; }
    if (best) return best;
    // In a <picture> the img's src is the fallback for browsers without one,
    // not a larger original, so what it rendered wins.
    const shown = n.parentNode && n.parentNode.nodeName === 'PICTURE'
      ? n.currentSrc || n.src : n.src || n.currentSrc;
    // A <video>'s src and currentSrc stay empty until it picks a <source>.
    return { url: shown || (cands[0] && cands[0].url), w: 0 };
  }

  // Bounds getComputedStyle cost on a huge DOM; far above any real gallery.
  const MAX_VISIT = 30000;

  // Reaches the page only through doc and win, so jsdom can stand in for it.
  function collect(doc, win, opts) {
    const maxVisit = (opts && opts.maxVisit) || MAX_VISIT;
    const out = [];
    const seen = new Set();
    const baseURI = doc.baseURI;

    // A blob: or data: URL has nothing monloader could fetch, and a data: one
    // would carry its whole payload out of the page.
    function toAbs(raw) {
      if (!raw) return null;
      const t = String(raw).trim();
      if (!t || /^(blob|data):/i.test(t)) return null;
      try { return new win.URL(t, baseURI).href; } catch (e) { return null; }
    }

    function add(raw, tag, w, h, variants, dw) {
      const t = toAbs(raw);
      if (!t || seen.has(t)) return;
      seen.add(t);
      const item = { url: t, tag: tag || '', w: w || 0, h: h || 0 };
      if (dw) item.dw = dw;
      if (variants) {
        // The rendered source is listed again under its descriptor; the
        // descriptor's width is the one kept.
        const widths = new Map();
        for (const v of variants) {
          const u = toAbs(v.url);
          if (u) widths.set(u, Math.max(widths.get(u) || 0, v.w || 0));
        }
        if (widths.size > 1) item.variants = Array.from(widths, ([url, w]) => ({ url, w }));
      }
      out.push(item);
    }

    function visit(n) {
      const nn = n.nodeName && n.nodeName.toUpperCase();
      // A <source> folds into its <picture> or <video>, and a <picture> is its
      // img, which carries those sources: neither is a card of its own.
      const inMedia = nn === 'SOURCE' && n.parentNode && MEDIA_PARENT[n.parentNode.nodeName];
      if (!inMedia && (nn === 'IMG' || nn === 'SOURCE' || nn === 'VIDEO')) {
        const c = bestCand(n);
        add(c.url, nn,
          n.naturalWidth || n.videoWidth || n.width, n.naturalHeight || n.videoHeight || n.height,
          variantsOf(n), c.w);
        if (n.poster) add(n.poster, 'IMG');
      } else if (nn === 'A') {
        if (n.href && ns().urls.isImageUrl(n.href)) add(n.href, 'A');
      }
      try {
        const cs = win.getComputedStyle(n);
        const bg = cs && cs.backgroundImage;
        if (bg && bg !== 'none') {
          const m = /url\((['"]?)(.+?)\1\)/.exec(bg);
          if (m && m[2]) add(m[2], nn);
        }
      } catch (e) { /* computed style unavailable */ }
    }

    const q = [doc.body || doc.documentElement];
    let root, visited = 0;
    while ((root = q.shift())) {
      let it;
      try { it = doc.createNodeIterator(root, win.NodeFilter.SHOW_ELEMENT); } catch (e) { continue; }
      let n;
      while ((n = it.nextNode())) {
        if (++visited > maxVisit) return { items: out, incomplete: true };
        visit(n);
        if (n.shadowRoot) q.push(n.shadowRoot);
      }
    }
    return { items: out, incomplete: false };
  }

  const VIDEO_EXT = /\.(mp4|webm)(\?|#|$)/i;
  // monbooru will not take these, so monloader declines them up front.
  // An extensionless URL is left to monloader: CDN images often have none.
  const DECLINED_EXT = /\.(svg|bmp|tiff?|heic|heif|m4v|mov|mkv|avi|ogv)(\?|#|$)/i;

  function classify(url) {
    if (url.startsWith('data:')) return 'data';
    if (!/^https?:/i.test(url)) return 'other';
    if (VIDEO_EXT.test(url)) return 'video';
    if (DECLINED_EXT.test(url)) return 'declined';
    return 'http';
  }

  function fetchable(url) {
    const k = classify(url);
    return k === 'http' || k === 'video';
  }

  function pickVariants(list, primary) {
    const seen = new Set();
    const out = [];
    for (const v of list || []) {
      const u = v && v.url;
      if (!u || seen.has(u) || !fetchable(u)) continue;
      seen.add(u);
      out.push({ url: u, w: v.w || 0 });
    }
    if (out.length < 2) return null;
    out.sort((a, b) => (a.url === primary ? -1 : b.url === primary ? 1 : b.w - a.w));
    return out;
  }

  function finalize(raw, opts) {
    opts = opts || {};
    const cap = opts.cap || 100;
    const minSize = opts.minSize || 0;
    const seen = new Set();
    const all = [];
    for (const r of raw) {
      const url = r && r.url;
      if (!url || seen.has(url)) continue;
      const kind = classify(url);
      if (kind !== 'http' && kind !== 'video') continue;
      // A lazy page's measured size belongs to its 1x1 placeholder, so a
      // chosen srcset candidate is judged by its advertised width.
      if (minSize && (r.dw ? r.dw < minSize : (r.w && r.h && (r.w < minSize || r.h < minSize)))) continue;
      seen.add(url);
      const item = { url, tag: (r && r.tag) || '', kind, w: (r && r.w) || 0, h: (r && r.h) || 0 };
      const variants = pickVariants(r && r.variants, url);
      if (variants) item.variants = variants;
      all.push(item);
    }
    const items = all.slice(0, cap);
    return { items, total: all.length, shown: items.length, truncated: all.length > cap };
  }

  return { collect, finalize, bestCand };
});
