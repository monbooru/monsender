'use strict';
(function () {
  const { storage, perms, api, outcome, urls } = self.ML;
  const $ = (id) => document.getElementById(id);
  let lastSavedUrl = '';

  function setFlash(msg, cls) {
    const f = $('flash');
    f.textContent = msg || '';
    f.className = msg ? 'flash ' + cls : '';
  }

  function setConn(state, label) {
    const c = $('conn');
    c.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'dot dot-' + state;
    const txt = document.createElement('span');
    txt.textContent = ' ' + label;
    c.appendChild(dot);
    c.appendChild(txt);
  }

  function clampInt(v, lo, hi, dflt) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  const normalizeUrl = urls.normalizeUrl;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function load() {
    const s = await storage.getSettings();
    $('baseUrl').value = s.baseUrl;
    $('wait').value = s.waitSeconds;
    $('scanCap').value = s.scanCap;
    $('minSize').value = s.minImageSize;
    $('previews').checked = s.previews;
    lastSavedUrl = s.baseUrl;
  }

  function readForm() {
    const patch = {
      waitSeconds: clampInt($('wait').value, 0, 60, 20),
      scanCap: clampInt($('scanCap').value, 1, 1000, 100),
      minImageSize: clampInt($('minSize').value, 0, 4000, 64),
      previews: $('previews').checked
    };
    return patch;
  }

  async function cfgFromForm() {
    const s = await storage.getSettings();
    return {
      baseUrl: normalizeUrl($('baseUrl').value) || s.baseUrl,
      token: s.token
    };
  }

  async function save() {
    const url = normalizeUrl($('baseUrl').value);
    $('baseUrl').value = url;
    if (!url) { setFlash('set a monloader URL first', 'flash-err'); return; }

    let granted = true;
    try {
      const oldUrl = lastSavedUrl && lastSavedUrl !== url ? lastSavedUrl : null;
      granted = await perms.syncOrigin(url, oldUrl);
    } catch (e) { granted = false; }
    if (!granted) {
      setFlash('host access for ' + url + ' was not granted; monloader cannot be reached until you allow it', 'flash-warn');
    }

    const patch = readForm();
    patch.baseUrl = url;
    // A token is bound to the instance that issued it; a changed URL drops the
    // stored token so the old key is never sent to a different monloader.
    const urlChanged = !!(lastSavedUrl && lastSavedUrl !== url);
    if (urlChanged) {
      const cur = await storage.getSettings();
      if (cur.token) patch.token = '';
    }
    const saved = await storage.setSettings(patch);
    lastSavedUrl = saved.baseUrl;
    if (granted) setFlash(urlChanged && !saved.token ? 'saved; URL changed, cleared the stored token' : 'saved', 'flash-ok');
    // Always refresh the dot: when the grant was denied, test() short-circuits
    // to the "allow host access" state instead of leaving a stale indicator.
    test();
  }

  // connect pairs with monloader without copying keys: it requests a pairing,
  // the operator approves in monloader, and the issued token is stored here.
  async function connect() {
    const url = normalizeUrl($('baseUrl').value);
    $('baseUrl').value = url;
    if (!url) { setFlash('set a monloader URL first', 'flash-err'); return; }
    let granted = false;
    try {
      const oldUrl = lastSavedUrl && lastSavedUrl !== url ? lastSavedUrl : null;
      granted = await perms.syncOrigin(url, oldUrl);
    } catch (e) { granted = false; }
    if (!granted) { setFlash('host access for ' + url + ' was not granted', 'flash-warn'); return; }

    setFlash('requesting pairing...', 'flash-warn');
    const cfg = { baseUrl: url };
    const r = await api.pair(cfg);
    if (!r.ok || !(r.data && r.data.request_id)) {
      setFlash((r.data && r.data.error) || (r.networkError ? 'monloader unreachable' : 'pairing request failed'), 'flash-err');
      return;
    }
    setFlash('approve the request in monloader (settings -> monsender), waiting...', 'flash-warn');
    const id = r.data.request_id;
    for (let i = 0; i < 60; i++) {
      await sleep(1500);
      const st = await api.pairStatus(cfg, id);
      if (!st.ok || !st.data) continue;
      if (st.data.status === 'approved' && st.data.token) {
        const saved = await storage.setSettings({ baseUrl: url, token: st.data.token });
        lastSavedUrl = saved.baseUrl;
        setFlash('paired with monloader', 'flash-ok');
        test();
        return;
      }
      if (st.data.status === 'denied') { setFlash('pairing was denied in monloader', 'flash-err'); return; }
      if (st.data.status === 'expired') { setFlash('pairing request expired; try again', 'flash-err'); return; }
    }
    setFlash('timed out waiting for approval; try again', 'flash-err');
  }

  async function test() {
    const cfg = await cfgFromForm();
    if (!cfg.baseUrl) { setConn('down', 'no URL'); return; }
    setConn('checking', 'checking');
    try {
      if (!(await perms.hasOrigin(cfg.baseUrl))) { setConn('down', 'allow host access (save first)'); return; }
    } catch (e) { /* fall through */ }
    const h = await api.health(cfg);
    // Always probe the authed endpoint - monloader may require a token we lack.
    const authed = await api.listQueue(cfg, { limit: 1 });
    const state = outcome.connState(h, authed);
    if (state === 'ok') {
      const v = (h.data && h.data.version) || '?';
      const g = (h.data && h.data.gallerydl_version) || '?';
      setConn('ok', 'monloader ' + v + ' / gallery-dl ' + g);
    } else if (state === 'rejected') {
      setConn('rejected', 'token rejected');
    } else {
      setConn('down', 'unreachable');
    }
  }

  $('save').addEventListener('click', save);
  $('test').addEventListener('click', test);
  $('connect').addEventListener('click', connect);

  // Scripts are at the end of <body>, so the DOM above exists. Init now.
  load().then(test);
})();
