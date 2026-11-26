(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).folderPicker = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // opts.load(path, page) resolves { total, results } or null when the
  // folders cannot be listed; opts.search(q) resolves a list or null; every
  // result is { path, name, images, folders }. opts.lead are nodes put
  // ahead of the field on its row.

  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  const SUGGEST_DELAY_MS = 200;

  function abbrevCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function el(doc, tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function action(doc, text) {
    const a = el(doc, 'span', 'sact', text);
    a.setAttribute('role', 'button');
    a.tabIndex = 0;
    return a;
  }

  function trimSlashes(s) { return String(s || '').trim().replace(/^\/+|\/+$/g, ''); }

  function mount(container, opts) {
    const doc = container.ownerDocument;
    const { onActivate } = ns().ui;
    const box = el(doc, 'div', 'fpick');
    const line = el(doc, 'div', 'fpick-line');
    const input = el(doc, 'input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.id = opts.id || 'fpick-input';
    input.setAttribute('aria-label', opts.label || 'folder');
    input.value = opts.value || '';
    const browse = action(doc, '[browse]');
    browse.classList.add('small');
    line.append(...(opts.lead || []), input, browse);
    const suggest = el(doc, 'div', 'fpick-suggest');
    suggest.hidden = true;

    const panel = el(doc, 'div', 'fpick-panel');
    panel.hidden = true;
    const top = el(doc, 'ul', 'fpick-tree');
    const blank = row(doc, { path: '', name: '' }, false);
    top.appendChild(blank.li);
    const tree = el(doc, 'ul', 'fpick-tree');
    const newRow = el(doc, 'div', 'fpick-newrow');
    const newBtn = action(doc, '[+ new folder]');
    const newForm = el(doc, 'span', 'fpick-newform');
    newForm.hidden = true;
    const newUnder = el(doc, 'span', 'muted');
    const newName = el(doc, 'input', 'fpick-newname');
    newName.type = 'text';
    newName.placeholder = 'name';
    const newOk = action(doc, '[ok]');
    newForm.append(newUnder, newName, newOk);
    newRow.append(el(doc, 'span', 'fpick-spacer'), newBtn, newForm);
    panel.append(top, tree, newRow);

    box.append(line, suggest, panel);
    container.appendChild(box);

    // A slower answer to an older request must not land over a newer one.
    let searchSeq = 0;
    let treeSeq = 0;
    let typingTimer = null;

    let blankTitle = '';
    function setBlank(text, title) {
      input.placeholder = text;
      blank.name.textContent = text;
      blankTitle = blank.name.title = title || '';
      markActive();
    }
    setBlank(opts.blank || '(default)');

    function value() { return trimSlashes(input.value); }

    function markActive() {
      const v = value();
      input.title = v ? '' : blankTitle;
      box.querySelectorAll('.fpick-row').forEach((r) => r.classList.toggle('active', r.dataset.path === v));
    }

    function pick(path) {
      input.value = path;
      closeSuggest();
      markActive();
      if (opts.onChange) opts.onChange(value());
    }

    function closeSuggest() {
      suggest.hidden = true;
      suggest.textContent = '';
    }

    async function loadLevel(ul, path, page, seq) {
      const r = await opts.load(path, page);
      if (seq !== treeSeq) return;
      const last = ul.lastElementChild;
      if (page === 1) ul.textContent = '';
      else if (last && last.classList.contains('fpick-more')) last.remove();
      if (!r) {
        ul.appendChild(el(doc, 'li', 'fpick-note small muted', '(folders unavailable)'));
        return;
      }
      const v = value();
      for (const f of r.results || []) {
        const n = row(doc, f, f.folders > 0);
        ul.appendChild(n.li);
        if (n.kids && v.startsWith(f.path + '/')) toggle(n, true);
      }
      const shown = ul.childElementCount;
      if (shown < (r.total || 0)) {
        const li = el(doc, 'li', 'fpick-more');
        const more = action(doc, '[more]');
        more.className = 'fpick-morebtn small';
        more.title = (r.total - shown) + ' more';
        onActivate(more, () => loadLevel(ul, path, page + 1, seq));
        li.appendChild(more);
        ul.appendChild(li);
      }
      markActive();
    }

    function toggle(n, open) {
      n.kids.hidden = !open;
      n.toggle.textContent = open ? '▼' : '▶';
      if (open) { closeNewFolder(); loadLevel(n.kids, n.li.dataset.path, 1, treeSeq); }
    }

    function row(d, f, branch) {
      const li = el(d, 'li');
      li.dataset.path = f.path;
      const r = el(d, 'div', 'fpick-row');
      r.dataset.path = f.path;
      const t = branch ? action(d, '▶') : el(d, 'span', 'fpick-spacer');
      if (branch) t.className = 'fpick-toggle';
      const name = el(d, 'span', 'fpick-name', f.path ? f.name + '/' : '');
      if (f.path) name.title = f.path + '/';
      r.append(t, name);
      if (f.path) {
        const c = el(d, 'span', 'fpick-count', abbrevCount(f.images || 0));
        c.title = (f.images || 0) + ' images';
        r.appendChild(c);
      }
      li.appendChild(r);
      const n = { li, row: r, toggle: t, name, kids: null };
      if (branch) {
        n.kids = el(d, 'ul', 'fpick-tree fpick-kids');
        n.kids.hidden = true;
        li.appendChild(n.kids);
        onActivate(t, () => toggle(n, n.kids.hidden));
      }
      // The toggle sits in the row: opening a branch does not pick it.
      r.addEventListener('click', (e) => { if (!e.target.closest('.fpick-toggle')) pick(f.path); });
      return n;
    }

    // Every opening reloads, so a folder made or removed since shows.
    function openPanel(open) {
      panel.hidden = !open;
      browse.textContent = open ? '[close]' : '[browse]';
      if (open) {
        closeNewFolder();
        treeSeq++;
        loadLevel(tree, '', 1, treeSeq);
      }
    }

    function openNewFolder() {
      const under = value();
      newForm.dataset.under = under ? under + '/' : '';
      newUnder.textContent = newForm.dataset.under;
      const active = tree.querySelector('.fpick-row.active');
      if (active) active.after(newForm);
      newForm.hidden = false;
      newName.value = '';
      newName.focus();
    }

    // Back to its own row, also ahead of a reload that would take it along.
    function closeNewFolder() {
      newForm.hidden = true;
      newRow.appendChild(newForm);
    }

    function takeNewFolder() {
      const name = trimSlashes(newName.value);
      if (name) pick(newForm.dataset.under + name);
      closeNewFolder();
    }

    async function runSearch() {
      const q = value();
      const seq = ++searchSeq;
      if (!q) { closeSuggest(); return; }
      const found = await opts.search(q);
      if (seq !== searchSeq || doc.activeElement !== input) return;
      suggest.textContent = '';
      for (const f of found || []) {
        const b = el(doc, 'div', 'fpick-sug');
        b.dataset.path = f.path;
        b.append(el(doc, 'span', '', f.path + '/'), el(doc, 'span', 'fpick-count', abbrevCount(f.images || 0)));
        // mousedown, not click: the field's blur would close the list first.
        b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(f.path); });
        suggest.appendChild(b);
      }
      suggest.hidden = !suggest.childElementCount;
    }

    input.addEventListener('input', () => {
      markActive();
      if (opts.onChange) opts.onChange(value());
      clearTimeout(typingTimer);
      typingTimer = setTimeout(runSearch, SUGGEST_DELAY_MS);
    });
    input.addEventListener('keydown', (e) => {
      if (suggest.hidden) return;
      const items = Array.from(suggest.children);
      const focused = suggest.querySelector('.kbd-focused');
      let idx = items.indexOf(focused);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (focused) focused.classList.remove('kbd-focused');
        idx = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        items[idx].classList.add('kbd-focused');
        items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && focused) {
        e.preventDefault();
        pick(focused.dataset.path);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSuggest();
      }
    });
    input.addEventListener('blur', closeSuggest);
    onActivate(browse, () => openPanel(panel.hidden));
    onActivate(newBtn, openNewFolder);
    onActivate(newOk, takeNewFolder);
    newName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); takeNewFolder(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeNewFolder(); }
    });

    return {
      value,
      setBlank,
      // A value from elsewhere, another view's pick: no onChange for it.
      setValue(v) {
        input.value = v || '';
        markActive();
      },
      // Another gallery's folders: the open tree reads them now, a closed
      // one on its next opening.
      reset() {
        treeSeq++;
        tree.textContent = '';
        closeSuggest();
        if (!panel.hidden) loadLevel(tree, '', 1, treeSeq);
      }
    };
  }

  return { mount };
});
