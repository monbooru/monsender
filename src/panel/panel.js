'use strict';
(function () {
  const { storage, render, send, ui } = self.ML;
  const $ = ui.$;
  let cfg = { baseUrl: '', token: '' };
  let scan = null;

  async function init() {
    const s = await storage.getSettings();
    cfg = send.cfgOf(s);
    // Watch before the unconfigured exit: opening the panel, finding it needs
    // a URL, setting one and coming back is the ordinary first-run order, and
    // the panel has to pick up the settings and the scan that follow.
    watchScan();
    if (!cfg.baseUrl) {
      ui.setConn('down', 'set monloader URL');
      $('scanhead').textContent = 'set your monloader URL in options';
      return;
    }
    refreshConn();
    showStoredScan();
  }

  // Show the most recent scan immediately; watchScan swaps in a fresh one when
  // the background stores it (e.g. right after the popup's "scan page").
  async function showStoredScan() {
    const stored = await storage.getScan();
    if (scan) return; // a fresher one landed while this read was in flight
    scan = stored;
    renderChooser();
  }

  // Re-render when the background stores a new scan, so re-scanning refreshes an
  // already-open panel instead of showing the previous results.
  function watchScan() {
    browser.storage.onChanged.addListener((changes) => {
      const st = changes.settings && changes.settings.newValue;
      if (st && st.baseUrl && !cfg.baseUrl) { cfg = send.cfgOf(st); refreshConn(); showStoredScan(); }
      const sc = changes.lastScan && changes.lastScan.newValue;
      if (sc && Array.isArray(sc.items)) { scan = sc; renderChooser(); }
    });
  }

  async function refreshConn() {
    const { state, label } = await ui.probe(cfg);
    ui.setConn(state, label);
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
    $('scanhead').textContent = 'scan: ' + scan.shown + (scan.truncated ? ' of ' + scan.total : '') + ' images'
      + (scan.incomplete ? ' (page too large to scan fully)' : '');
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
  function updateSendBtn() {
    const all = allPicks();
    const n = all.filter((c) => c.checked).length;
    $('sendSel').textContent = 'send selected (' + n + ')';
    $('sendSel').disabled = n === 0;
    ui.setActionEnabled($('selNone'), n > 0);
    ui.setActionEnabled($('selAll'), all.length > 0 && n < all.length);
  }
  function selectAll() {
    allPicks().forEach((c) => { c.checked = true; });
    updateSendBtn();
  }
  function clearSelection() { keepSelected([]); }
  // Tick exactly these and nothing else.
  function keepSelected(urls) {
    const keep = new Set(urls);
    allPicks().forEach((c) => { c.checked = keep.has(c.getAttribute('data-url')); });
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
    // Leave exactly the failures ticked, so pressing send again retries those
    // instead of re-enqueuing what already landed.
    keepSelected(r.failedUrls || []);
  }

  ui.onActivate($('brand'), () => ui.openQueue(cfg));
  ui.onActivate($('selAll'), selectAll);
  ui.onActivate($('selNone'), clearSelection);
  $('sendSel').addEventListener('click', sendSelected);
  init();
})();
