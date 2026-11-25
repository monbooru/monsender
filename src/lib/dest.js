(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).dest = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Where the popup's and the panel's sends go: a gallery and a folder,
  // kept in storage until emptied. Empty leaves the choice to monloader,
  // which takes the site's own, then its defaults, field by field; the
  // blanks say which, for the page the send comes from.

  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  async function mount(container, cfg, pageUrl) {
    const { api, storage, folderPicker, sites } = ns();
    const doc = container.ownerDocument;
    const saved = await storage.getDestination();
    let dest = Object.assign({}, saved);

    // As /api/v1/defaults answers; activeGallery stands in for an empty
    // default gallery, which is monbooru's active one.
    let defaults = { gallery: '', folder: '', sites: [] };
    let activeGallery = '';
    let category = '';

    // Where an empty field sends: the page's site's own, then the default.
    function fallback(field) {
      const site = category ? defaults.sites.find((s) => s.name === category) : null;
      if (site && site[field]) return { from: category, value: site[field] };
      return { from: 'default', value: field === 'gallery' ? defaults.gallery || activeGallery : defaults.folder };
    }
    function blankLabel(field) {
      const f = fallback(field);
      return f.value ? '(' + f.from + ': ' + f.value + ')' : '(default)';
    }

    const galleryRow = doc.createElement('div');
    galleryRow.className = 'dest-gallery';
    const glabel = doc.createElement('label');
    glabel.className = 'small muted';
    glabel.textContent = 'gallery';
    glabel.htmlFor = 'dest-gallery';
    const select = doc.createElement('select');
    select.id = 'dest-gallery';
    galleryRow.append(glabel, select);
    container.appendChild(galleryRow);

    // The folders listed are those of the gallery the send goes to: the
    // one picked, or the one an empty field sends to.
    const listed = () => dest.gallery || fallback('gallery').value;

    const picker = folderPicker.mount(container, {
      id: 'dest-folder',
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
      first.textContent = blankLabel('gallery');
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
      picker.setBlank(blankLabel('folder'));
      relist();
    }

    select.addEventListener('change', () => {
      dest.gallery = select.value;
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
      // The send options for this destination.
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
