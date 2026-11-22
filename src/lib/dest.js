(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).dest = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Where the popup's and the panel's sends go: a gallery and a folder,
  // kept in storage until emptied. Empty leaves the choice to monloader,
  // which takes the site's own, then its defaults.

  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  function blankLabel(name) { return name ? '(default: ' + name + ')' : '(default)'; }

  async function mount(container, cfg) {
    const { api, storage, folderPicker } = ns();
    const doc = container.ownerDocument;
    const saved = await storage.getDestination();
    let dest = Object.assign({}, saved);

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
    // one picked, or monloader's default.
    let defaultGallery = '';
    const listed = () => dest.gallery || defaultGallery;

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

    function fillGalleries(names, def) {
      select.textContent = '';
      const first = doc.createElement('option');
      first.value = '';
      first.textContent = blankLabel(def);
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

    select.addEventListener('change', () => {
      dest.gallery = select.value;
      storage.setDestination({ gallery: dest.gallery });
      picker.reset();
    });

    // The popup and the panel can be open at once: a pick in one shows in
    // the other. The view being typed in has focus and skips the echoes of
    // its own writes, which could land behind a newer keystroke.
    function follow(changes) {
      const next = changes.destination && changes.destination.newValue;
      if (!next || doc.hasFocus()) return;
      if (next.gallery !== dest.gallery) {
        dest.gallery = next.gallery;
        fillGalleries(names, defaultGallery);
        picker.reset();
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
      defaultGallery = (d.ok && d.data && d.data.gallery) || (active ? active.name : '');
      names = galleries.map((x) => x.name);
      fillGalleries(names, defaultGallery);
      picker.setBlank(blankLabel(d.ok && d.data ? d.data.folder : ''));
    }
    fillGalleries(names, defaultGallery);
    loadLists();

    return {
      // The send options for this destination.
      options: () => ({ gallery: dest.gallery, folder: picker.value() }),
      unmount() {
        browser.storage.onChanged.removeListener(follow);
        container.textContent = '';
      }
    };
  }

  return { mount };
});
