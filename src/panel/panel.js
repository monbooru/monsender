'use strict';
(function () {
  const { storage, render, send, ui } = self.ML;
  const $ = ui.$;
  let cfg = { baseUrl: '', token: '' };
  let scan = null;

  async function init() {
    const s = await storage.getSettings();
    cfg = send.cfgOf(s);
    if (!cfg.baseUrl) {
      ui.setConn($('conn'), 'down', 'set monloader URL');
      $('scanhead').textContent = 'set your monloader URL in options';
      return;
    }
    refreshConn();
    watchScan();
    // Show the most recent scan immediately; watchScan swaps in a fresh one
    // when the background stores it (e.g. right after the popup's "scan page").
    scan = await storage.getScan();
    renderChooser();
  }

  // Re-render when the background stores a new scan, so re-scanning refreshes an
  // already-open panel instead of showing the previous results.
  function watchScan() {
    browser.storage.onChanged.addListener((changes) => {
      const sc = changes.lastScan && changes.lastScan.newValue;
      if (sc && Array.isArray(sc.items)) { scan = sc; renderChooser(); }
    });
  }

  async function refreshConn() {
    const { state, label } = await ui.probe(cfg);
    ui.setConn($('conn'), state, label);
  }

  function renderChooser() {
    const grid = $('grid');
    grid.textContent = '';
    const su = $('scanurl');
    if (scan && scan.url) {
      $('scanUrl').textContent = scan.url;
      $('scanUrl').title = scan.url;
      su.hidden = false;
    } else {
      su.hidden = true;
    }
    if (!scan || !scan.items || !scan.items.length) {
      $('scanhead').textContent = !scan ? 'no scan yet - start a scan from the popup'
        : (scan.blocked ? 'this page cannot be scanned' : 'no images found');
      updateSendBtn();
      return;
    }
    $('scanhead').textContent = 'scan: ' + scan.shown + (scan.truncated ? ' of ' + scan.total : '') + ' images';
    for (const item of scan.items) {
      const card = render.imageCard(document, item, { previews: scan.previews });
      const cb = card.querySelector('input.pick');
      if (cb) cb.addEventListener('change', updateSendBtn);
      grid.appendChild(card);
    }
    updateSendBtn();
  }

  function picked() {
    return Array.from(document.querySelectorAll('input.pick:checked')).map((c) => c.getAttribute('data-url'));
  }
  function allPicks() {
    return Array.from(document.querySelectorAll('input.pick'));
  }
  function setSact(id, on) { ui.setActionEnabled($(id), on); }
  function updateSendBtn() {
    const all = allPicks();
    const n = all.filter((c) => c.checked).length;
    $('sendSel').textContent = 'send selected (' + n + ')';
    $('sendSel').disabled = n === 0;
    setSact('selNone', n > 0);
    setSact('selAll', all.length > 0 && n < all.length);
  }
  function selectAll() {
    allPicks().forEach((c) => { c.checked = true; });
    updateSendBtn();
  }
  function clearSelection() {
    document.querySelectorAll('input.pick:checked').forEach((c) => { c.checked = false; });
    updateSendBtn();
  }
  async function sendSelected() {
    const urls = picked();
    if (!urls.length) return;
    $('sendSel').disabled = true;
    $('scanmsg').textContent = 'sending ' + urls.length + '...';
    // Scanned files carry the scanned page as their source.
    const r = await send.sendMany(urls, { options: { pageUrl: scan && scan.url } });
    if (!r.configured) { $('scanmsg').textContent = 'set monloader URL in options'; updateSendBtn(); return; }
    if (r.ids.length) await storage.addRecentJobIds(r.ids);
    // Counts alone leave a rejected token looking like N unexplained failures,
    // so carry the first mapped reason alongside them.
    const msg = r.failed
      ? 'sent ' + r.ids.length + ' of ' + urls.length + '; ' + r.failed + ' failed'
        + (r.outcome ? ' - ' + r.outcome.text : '')
      : 'sent ' + r.ids.length + ' to the queue';
    const tone = r.failed ? (r.ids.length ? 'warning' : 'error') : 'dim';
    $('scanmsg').textContent = msg;
    if (r.ids.length) browser.runtime.sendMessage({ type: 'queued', count: r.ids.length }).catch(() => {});
    // Keep failed picks selected so they can be re-sent; clear only a clean run.
    if (r.failed) updateSendBtn(); else clearSelection();
  }

  ui.onActivate($('brand'), () => ui.openQueue(cfg));
  ui.onActivate($('selAll'), selectAll);
  ui.onActivate($('selNone'), clearSelection);
  $('sendSel').addEventListener('click', sendSelected);
  init();
})();
