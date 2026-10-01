(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).render = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  // Scanned strings are page-controlled and this page is privileged:
  // setAttribute and textContent only, never innerHTML.

  function shortUrl(u) {
    try {
      const x = new URL(u);
      return x.hostname.replace(/^www\./, '') + '/.../' + (fileName(u) || x.hostname);
    } catch (e) { return String(u).slice(0, 64); }
  }

  function fileExt(u) {
    const m = /\.([a-z0-9]{2,5})$/i.exec(fileName(u));
    return m ? m[1].toLowerCase() : '';
  }

  // Decoded, as a person names the file; an escape that does not decode is
  // shown as sent.
  function fileName(u) {
    let last;
    try { last = new URL(u).pathname.split('/').filter(Boolean).pop() || ''; } catch (e) { return ''; }
    try { return decodeURIComponent(last); } catch (e) { return last; }
  }

  function trimName(name, max) {
    const s = String(name);
    max = max || 28;
    if (s.length <= max) return s;
    const dot = s.lastIndexOf('.');
    const ext = (dot > 0 && s.length - dot <= 6) ? s.slice(dot) : '';
    return s.slice(0, max - ext.length - 3) + '...' + ext;
  }

  // Widths a CDN puts in the URL: .../1500x0/... or photo-1500x1000.jpg.
  function urlWidth(u) {
    const s = String(u);
    const m = /\/(\d{3,5})x\d{1,5}\//.exec(s) || /[-_](\d{3,5})x\d{1,5}\.[a-z]/i.exec(s);
    return m ? +m[1] : 0;
  }

  function placeholderText(url, kind) {
    return trimName(fileName(url)) || (kind === 'video' ? 'video' : 'image');
  }

  // The narrowest variant, so a big gallery does not pull every original.
  function previewUrl(item) {
    let best = null;
    for (const v of item.variants || []) if (v.w && (!best || v.w < best.w)) best = v;
    return best ? best.url : item.url;
  }

  // A <video> ignores loading="lazy", so its src waits until it scrolls in.
  function whenVisible(doc, el, fn) {
    const IO = doc.defaultView && doc.defaultView.IntersectionObserver;
    if (!IO) { fn(); return; }
    const io = new IO((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
    });
    io.observe(el);
  }

  function fillNoPreview(doc, thumb, url, kind, failed) {
    thumb.textContent = '';
    thumb.classList.add('noimg');
    if (failed) {
      thumb.classList.add('failed');
      const note = doc.createElement('div');
      note.className = 'phnote';
      note.textContent = 'preview failed';
      thumb.appendChild(note);
    }
    const name = doc.createElement('div');
    name.className = 'phname';
    name.textContent = placeholderText(url, kind);
    thumb.appendChild(name);
  }

  function imageCard(doc, item, opts) {
    opts = opts || {};
    const card = doc.createElement('div');
    card.className = 'card';

    const label = doc.createElement('label');
    label.className = 'cardlabel';

    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'pick';
    cb.setAttribute('data-url', item.url);
    cb.value = item.url;

    let ext = fileExt(item.url);
    let dim = null;
    function showDims(w, h) {
      const bits = [];
      if (w && h) bits.push(w + '\u00d7' + h);
      if (ext) bits.push(ext);
      if (!bits.length && !dim) return;
      if (!dim) { dim = doc.createElement('div'); dim.className = 'dim'; label.appendChild(dim); }
      dim.textContent = bits.join(' \u00b7 ');
    }

    const thumb = doc.createElement('div');
    thumb.className = 'thumb';
    let activeSize = null;
    let activeUrl = item.url;
    let shownUrl = null;
    function onLoad(w, h) {
      // A thumbnail of another resolution says nothing about the picked file.
      if (shownUrl !== activeUrl) return;
      showDims(w, h);
      if (activeSize && w) activeSize.textContent = w + 'w';
    }

    // Rebuilt, not repointed: a failed load already swapped in the placeholder.
    // A placeholder names activeUrl, not url: the file the card will send.
    function fillThumb(url) {
      shownUrl = url;
      if (!opts.previews) { fillNoPreview(doc, thumb, activeUrl, item.kind, false); return; }
      thumb.textContent = '';
      thumb.classList.remove('noimg', 'failed');
      const video = item.kind === 'video';
      const el = doc.createElement(video ? 'video' : 'img');
      if (video) {
        el.muted = true;
        el.setAttribute('preload', 'metadata');
      } else {
        el.setAttribute('loading', 'lazy');
        el.setAttribute('referrerpolicy', 'no-referrer');
        el.setAttribute('alt', '');
        el.addEventListener('load', () => onLoad(el.naturalWidth, el.naturalHeight));
      }
      el.addEventListener('error', () => fillNoPreview(doc, thumb, activeUrl, item.kind, true));
      thumb.appendChild(el);
      if (video) whenVisible(doc, el, () => el.setAttribute('src', url));
      else el.setAttribute('src', url);
    }
    fillThumb(previewUrl(item));

    const meta = doc.createElement('div');
    meta.className = 'meta nowrap';
    meta.textContent = shortUrl(item.url);
    meta.title = item.url;

    label.appendChild(cb);
    label.appendChild(thumb);
    label.appendChild(meta);
    showDims(item.w, item.h);
    card.appendChild(label);

    // Outside the label, or a click on a token would toggle the pick.
    if (item.variants && item.variants.length > 1) {
      const sizes = doc.createElement('div');
      sizes.className = 'sizes';
      const tokens = item.variants.map((v) => {
        const t = doc.createElement('span');
        t.className = 'size';
        t.setAttribute('data-url', v.url);
        t.setAttribute('role', 'button');
        t.setAttribute('tabindex', '0');
        const w = v.w || urlWidth(v.url);
        t.textContent = w ? w + 'w' : 'src';
        sizes.appendChild(t);
        return t;
      });
      const activate = (t) => {
        tokens.forEach((x) => x.classList.toggle('active', x === t));
        activeSize = t;
        const u = t.getAttribute('data-url');
        cb.setAttribute('data-url', u);
        cb.value = u;
        ext = fileExt(u);
        activeUrl = u;
        // Only a load can supply the new size; previews off never loads.
        showDims(0, 0);
        fillThumb(u);
      };
      tokens.forEach((t) => ns().ui.onActivate(t, () => activate(t)));
      const def = tokens.find((t) => t.getAttribute('data-url') === item.url) || tokens[0];
      def.classList.add('active');
      activeSize = def;
      card.appendChild(sizes);
    }
    return card;
  }

  return { imageCard };
});
