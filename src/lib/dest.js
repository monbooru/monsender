(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).dest = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  async function mount(container, cfg, pageUrl) {
    const { api, storage, folderPicker, sites } = ns();
    const doc = container.ownerDocument;
    const saved = await storage.getDestination();
    let dest = Object.assign({}, saved);

    let defaults = { gallery: '', folder: '', sites: [] };
    // An empty default gallery is monbooru's active one.
    let activeGallery = '';
    let category = '';

    function fallback(field) {
      const site = category ? defaults.sites.find((s) => s.name === category) : null;
      if (site && site[field]) return { from: category, value: site[field] };
      return { from: 'default', value: field === 'gallery' ? defaults.gallery || activeGallery : defaults.folder };
    }
    function blank(field) {
      const f = fallback(field);
      return f.value ? { text: '(' + f.value + ')', title: f.from + ': ' + f.value } : { text: '(default)', title: '' };
    }

    const span = (text) => {
      const s = doc.createElement('span');
      s.className = 'muted small';
      s.textContent = text;
      return s;
    };
    const select = doc.createElement('select');
    select.id = 'dest-gallery';
    select.setAttribute('aria-label', 'gallery');

    const listed = () => dest.gallery || fallback('gallery').value;

    const picker = folderPicker.mount(container, {
      id: 'dest-folder',
      lead: [span('to'), select, span('/')],
      value: dest.folder,
      load: async (path, page) => {
        const r = await api.listFolders(cfg, listed(), path, page);
        return r.ok && r.data ? { total: r.data.total, results: r.data.results } : null;
      },
      search: async (q) => {
        const r = await api.searchFolders(cfg, listed(), q, 10);
        return r.ok && r.data ? r.data.results : null;
      },
      onChange: (folder) => { dest.folder = folder; storage.setDestination({ folder }); }
    });

    function fillGalleries() {
      select.textContent = '';
      const first = doc.createElement('option');
      first.value = '';
      const b = blank('gallery');
      first.textContent = b.text;
      first.title = b.title;
      select.appendChild(first);
      // A gallery kept from an earlier pick stays offered, even one
      // monloader no longer lists, so the field shows what a send uses.
      const all = names.includes(dest.gallery) || !dest.gallery ? names : [...names, dest.gallery];
      for (const n of all) {
        const o = doc.createElement('option');
        o.value = n;
        o.textContent = n;
        select.appendChild(o);
      }
      select.value = dest.gallery;
      select.title = dest.gallery ? '' : b.title;
    }

    let names = [];

    // The tree and suggestions read again only when the gallery they list
    // moved: a pick, another view's pick, or a page of another site.
    let shownGallery = listed();
    function relist() {
      if (listed() === shownGallery) return;
      shownGallery = listed();
      picker.reset();
    }

    function refresh() {
      fillGalleries();
      const b = blank('folder');
      picker.setBlank(b.text, b.title);
      relist();
    }

    select.addEventListener('change', () => {
      dest.gallery = select.value;
      select.title = dest.gallery ? '' : select.options[0].title;
      storage.setDestination({ gallery: dest.gallery });
      relist();
    });

    // The popup and the panel can be open at once: a pick in one shows in
    // the other. The view being typed in has focus and skips the echoes of
    // its own writes, which could land behind a newer keystroke.
    function follow(changes) {
      const next = changes.destination && changes.destination.newValue;
      if (!next || doc.hasFocus()) return;
      if (next.gallery !== dest.gallery) {
        dest.gallery = next.gallery;
        fillGalleries();
        relist();
      }
      if (next.folder !== picker.value()) picker.setValue(next.folder);
      dest.folder = next.folder;
    }
    browser.storage.onChanged.addListener(follow);

    // In the background: a send needs only the fields, and monloader can
    // take its time asking monbooru. Without the lists (an older monloader,
    // or none reached) the fields still take typing.
    async function loadLists() {
      const [g, d] = await Promise.all([api.listGalleries(cfg), api.defaults(cfg)]);
      const galleries = g.ok && g.data && Array.isArray(g.data.galleries) ? g.data.galleries : [];
      const active = galleries.find((x) => x.active);
      activeGallery = active ? active.name : '';
      if (d.ok && d.data) {
        defaults = {
          gallery: d.data.gallery || '',
          folder: d.data.folder || '',
          sites: Array.isArray(d.data.sites) ? d.data.sites : []
        };
      }
      names = galleries.map((x) => x.name);
      refresh();
    }

    // A slower lookup for an older page must not land over a newer one.
    let pageSeq = 0;
    async function setPage(url) {
      const seq = ++pageSeq;
      let c = '';
      try { c = await sites.categoryFor(cfg, url); } catch (e) { /* no site list: the defaults stand */ }
      if (seq !== pageSeq) return;
      category = c;
      refresh();
    }

    fillGalleries();
    loadLists();
    setPage(pageUrl);

    return {
      options: () => ({ gallery: dest.gallery, folder: picker.value() }),
      // The panel's scan can move to another page while it stays open.
      setPage,
      unmount() {
        browser.storage.onChanged.removeListener(follow);
        container.textContent = '';
      }
    };
  }

  return { mount };
});
