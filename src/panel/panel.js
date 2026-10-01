'use strict';
(function () {
  const { storage, render, send, ui } = self.ML;
  const $ = ui.$;
  let cfg = { baseUrl: '', token: '' };
  let scan = null;

  async function init() {
    const s = await storage.getSettings();
    cfg = send.cfgOf(s);
    // Before the unconfigured return: on first run the URL is set later.
    watchScan();
    if (!cfg.baseUrl) {
      ui.setConn('down', 'set monloader URL');
      $('scanhead').textContent = 'set your monloader URL in options';
      return;
    }
    refreshConn();
    showStoredScan();
  }

  async function showStoredScan() {
    const stored = await storage.getScan();
    if (scan) return; // a fresher one landed while this read was in flight
    scan = stored;
    renderChooser();
  }

  // The panel stays open across pairing, URL changes and outages, so the dot
  // is probed again whenever one of those could have moved it.
  function watchScan() {
    browser.storage.onChanged.addListener((changes) => {
      const st = changes.settings && changes.settings.newValue;
      if (st && (st.baseUrl !== cfg.baseUrl || st.token !== cfg.token)) {
        const first = !cfg.baseUrl;
        cfg = send.cfgOf(st);
        refreshConn();
        if (first) showStoredScan();
      }
      const sc = changes.lastScan && changes.lastScan.newValue;
      if (sc && Array.isArray(sc.items)) { scan = sc; renderChooser(); refreshConn(); }
    });
  }

  async function refreshConn() {
    const { state, label } = await ui.probe(cfg);
    ui.setConn(state, label);
  }

  function setMsg(text, tone) {
    const m = $('scanmsg');
    m.textContent = text;
    m.className = 'small tone-' + tone;
  }

  function renderChooser() {
    const grid = $('grid');
    grid.textContent = '';
    if (!sending) setMsg('', 'dim');
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
  // Held for the whole batch: a pick toggled or a grid rebuilt mid-send would
  // otherwise re-arm it and start a second batch alongside the first.
  let sending = false;

  function updateSendBtn() {
    const all = allPicks();
    const n = all.filter((c) => c.checked).length;
    $('sendSel').textContent = 'send selected (' + n + ')';
    $('sendSel').disabled = sending || n === 0;
    ui.setActionEnabled($('selNone'), n > 0);
    ui.setActionEnabled($('selAll'), all.length > 0 && n < all.length);
  }
  function keepSelected(urls) {
    const keep = new Set(urls);
    allPicks().forEach((c) => { c.checked = keep.has(c.getAttribute('data-url')); });
    updateSendBtn();
  }
  async function sendSelected() {
    const urls = picked();
    if (!urls.length || sending) return;
    const from = scan;
    sending = true;
    updateSendBtn();
    setMsg('sending ' + urls.length + '...', 'dim');
    let r;
    try {
      r = await send.sendMany(urls, { options: { pageUrl: from && from.url } });
    } finally {
      sending = false;
    }
    if (!r.configured) { setMsg('set monloader URL in options', 'error'); updateSendBtn(); return; }
    if (r.ids.length) await storage.addRecentJobIds(r.ids);
    const msg = r.failed
      ? 'sent ' + r.ids.length + ' of ' + urls.length + '; ' + r.failed + ' failed'
        + (r.outcome ? ' - ' + r.outcome.text : '')
      : 'sent ' + r.ids.length + ' to the queue';
    setMsg(msg, r.failed ? (r.ids.length ? 'warning' : 'error') : 'dim');
    if (r.ids.length) browser.runtime.sendMessage({ type: 'queued', count: r.ids.length }).catch(() => { /* the badge is a nicety */ });
    // A rescan mid-send rebuilt the grid: its picks are not this batch's.
    if (scan === from) keepSelected(r.failedUrls || []);
    else updateSendBtn();
    refreshConn();
  }

  ui.onActivate($('brand'), () => ui.openQueue(cfg));
  ui.onActivate($('selAll'), () => keepSelected(allPicks().map((c) => c.getAttribute('data-url'))));
  ui.onActivate($('selNone'), () => keepSelected([]));
  $('sendSel').addEventListener('click', sendSelected);
  init();
})();
