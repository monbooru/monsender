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

  // The page scan. Detection adapted from ushiro's content.js, made
  // page-wide and returning data (collect runs in the page via
  // scripting.executeScript; finalize is pure and runs in the caller). The
  // injection model is load-bearing: no standing content script.

  // srcset candidates as { url, w } (w is the Nw descriptor, 0 if none).
  function srcsetCands(srcset) {
    return String(srcset).split(',').map((s) => {
      const p = s.trim().split(/\s+/);
      const m = /^(\d+)w$/.exec(p[1] || '');
      return { url: p[0], w: m ? +m[1] : 0 };
    }).filter((c) => c.url);
  }

  // Every distinct resolution the element advertises (srcset entries + src), so
  // the chooser can offer a smaller one. The largest stays the default
  // (bestCand). A media element's <source> children describe the same image or
  // video, so they ride along here instead of becoming cards of their own -
  // an <img> takes its <picture> siblings, a <video> its own children.
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

  // The largest variant the element offers: a candidate wider than the rendered
  // image, else the full src, else what the browser loaded. The descriptor
  // width rides along because it describes a different file than the one the
  // page rendered and measured.
  function bestCand(n) {
    const cands = variantsOf(n);
    let best = null, bv = n.naturalWidth || 0;
    for (const c of cands) if (c.w > bv) { bv = c.w; best = c; }
    // A <video> carries its file on its <source> children, so src and
    // currentSrc are both empty until the browser has picked one.
    return best || { url: n.src || n.currentSrc || (cands[0] && cands[0].url), w: 0 };
  }

  // A pathological page can hold an enormous DOM; cap how many elements the
  // walk visits so the per-element getComputedStyle cannot stall the page. The
  // bound is far above any real gallery.
  const MAX_VISIT = 30000;

  // Walk the document (and shadow roots), collecting candidate image URLs as
  // absolute strings. Returns { items, incomplete }: incomplete says the walk
  // hit maxVisit, so the list describes part of the page. doc/win are passed
  // explicitly so this is testable under jsdom and self-contained when
  // injected.
  function collect(doc, win, opts) {
    const maxVisit = (opts && opts.maxVisit) || MAX_VISIT;
    const out = [];
    const seen = new Set();
    const baseURI = doc.baseURI;

    function toAbs(raw, isData) {
      if (!raw) return null;
      const t = String(raw).trim();
      if (!t || t.startsWith('blob:')) return null;
      if (isData || t.startsWith('data:')) return t;
      try { return new win.URL(t, baseURI).href; } catch (e) { return null; }
    }

    function add(raw, isData, tag, w, h, variants, dw) {
      const t = toAbs(raw, isData);
      if (!t || seen.has(t)) return;
      seen.add(t);
      const item = { url: t, tag: tag || '', w: w || 0, h: h || 0 };
      if (dw) item.dw = dw;
      if (variants) {
        const vs = [], vseen = new Set();
        for (const v of variants) {
          const u = toAbs(v.url, false);
          if (!u || vseen.has(u)) continue;
          vseen.add(u);
          vs.push({ url: u, w: v.w || 0 });
        }
        if (vs.length > 1) item.variants = vs;
      }
      out.push(item);
    }

    function visit(n) {
      const nn = n.nodeName && n.nodeName.toUpperCase();
      // A <source> belongs to the <picture> or <video> around it (variantsOf
      // folds them in), so a card each would multiply the same file.
      const inMedia = nn === 'SOURCE' && n.parentNode && MEDIA_PARENT[n.parentNode.nodeName];
      if (!inMedia && (nn === 'IMG' || nn === 'SOURCE' || nn === 'VIDEO' || nn === 'PICTURE')) {
        // One card per element, defaulting to the largest variant; the other
        // resolutions ride along so the chooser can offer a smaller one.
        const c = bestCand(n);
        add(c.url, false, nn,
          n.naturalWidth || n.videoWidth || n.width, n.naturalHeight || n.videoHeight || n.height,
          variantsOf(n), c.w);
        if (n.poster) add(n.poster, false, 'IMG');
      } else if (nn === 'A') {
        if (n.href && ns().urls.isImageUrl(n.href)) add(n.href, false, 'A');
      }
      try {
        const cs = win.getComputedStyle(n);
        const bg = cs && cs.backgroundImage;
        if (bg && bg !== 'none') {
          const m = /url\((['"]?)(.+?)\1\)/.exec(bg);
          if (m && m[2]) add(m[2], m[2].startsWith('data:'), nn);
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

  // The two containers monbooru takes as video, told apart from images because
  // the chooser previews them differently.
  const VIDEO_EXT = /\.(mp4|webm)(\?|#|$)/i;
  // Media monloader recognizes but monbooru will not take, so the download is
  // declined before it starts: offering one would promise a send that cannot
  // land. A URL carrying no extension is not judged here - a CDN image often
  // has none, and monloader is the authority on those.
  const DECLINED_EXT = /\.(svg|avif|bmp|tiff?|heic|heif|m4v|mov|mkv|avi|ogv)(\?|#|$)/i;

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

  // The resolutions to offer for one item: fetchable, deduped, the default
  // (largest) first then widest down. Null when there is no real choice.
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

  // Dedupe, keep the http(s) files monloader can actually land in monbooru
  // (a data: URL has nothing to fetch; a declined container has nowhere to go),
  // cap.
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
      // Drop icons/trackers when the size is known. A lazy page ships a 1x1
      // placeholder in src and the real image in srcset, so a measured size
      // describes a different file than the chosen URL; its advertised width
      // is then the only size that says anything about what will be sent.
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
