'use strict';
(function () {
  const { storage, api, urls, ui } = self.ML;
  const $ = ui.$;
  let lastSavedUrl = '';

  function setFlash(msg, cls) {
    const f = $('flash');
    f.textContent = msg || '';
    f.className = msg ? 'flash ' + cls : '';
  }

  function clampInt(v, lo, hi, dflt) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  const normalizeUrl = urls.normalizeUrl;
  const sleep = api.sleep;

  // Each input's own min and max are its range, so options.html is the one
  // place a range is written.
  const NUMBERS = [['wait', 'waitSeconds', 20], ['scanCap', 'scanCap', 100], ['minSize', 'minImageSize', 64]];

  // The token itself is never echoed back, only whether one is held.
  function setTokenState(has) {
    $('tokenState').textContent = has ? 'token: set' : 'token: not set';
  }

  async function load() {
    const s = await storage.getSettings();
    $('baseUrl').value = s.baseUrl;
    for (const [id, key] of NUMBERS) $(id).value = s[key];
    $('previews').checked = s.previews;
    setTokenState(!!s.token);
    lastSavedUrl = s.baseUrl;
  }

  function readForm() {
    const patch = { previews: $('previews').checked };
    let adjusted = false;
    for (const [id, key, dflt] of NUMBERS) {
      const el = $(id);
      const typed = el.value.trim();
      patch[key] = clampInt(typed, Number(el.min), Number(el.max), dflt);
      el.value = patch[key];
      if (el.value !== typed) adjusted = true;
    }
    return { patch, adjusted };
  }

  // The token belongs to the saved URL; an unsaved one is probed without it.
  async function cfgFromForm() {
    const s = await storage.getSettings();
    const baseUrl = normalizeUrl($('baseUrl').value) || s.baseUrl;
    return { baseUrl, token: baseUrl === s.baseUrl ? s.token : '' };
  }

  function urlFromForm() {
    const url = normalizeUrl($('baseUrl').value);
    $('baseUrl').value = url;
    if (!url) { setFlash('set a monloader URL first', 'flash-err'); return ''; }
    if (!urls.isReachableBase(url)) { setFlash('not a valid URL', 'flash-err'); return ''; }
    return url;
  }

  async function save() {
    const url = urlFromForm();
    if (!url) return;
    // A pairing still waiting would restore its own URL on approval.
    if (pairing && pairing.url !== url) pairing.canceled = true;

    const { patch, adjusted } = readForm();
    patch.baseUrl = url;
    // A new URL drops the token: it belongs to the instance that issued it.
    let cleared = false;
    if (lastSavedUrl && lastSavedUrl !== url) {
      const cur = await storage.getSettings();
      if (cur.token) {
        patch.token = '';
        cleared = true;
        api.pairRemove({ baseUrl: lastSavedUrl, token: cur.token });
      }
    }
    const saved = await storage.setSettings(patch);
    lastSavedUrl = saved.baseUrl;
    setTokenState(!!saved.token);
    setFlash('saved'
      + (cleared ? '; URL changed, cleared the stored token' : '')
      + (adjusted ? '; some values were brought into range' : ''), 'flash-ok');
    test();
  }

  let pairing = null;

  async function connect() {
    if (pairing) { pairing.canceled = true; return; }
    const url = urlFromForm();
    if (!url) return;

    const job = pairing = { canceled: false, url };
    $('connect').textContent = 'cancel pairing';
    try {
      setFlash('requesting pairing...', 'flash-warn');
      const cfg = { baseUrl: url };
      const r = await api.pair(cfg);
      if (!r.ok || !(r.data && r.data.request_id)) {
        setFlash((r.data && r.data.error) || (r.networkError ? 'monloader unreachable' : 'pairing request failed'), 'flash-err');
        return;
      }
      setFlash('approve the request in monloader (settings -> pairing), waiting...', 'flash-warn');
      const id = r.data.request_id;
      for (let i = 0; i < 60; i++) {
        await sleep(1500);
        if (job.canceled) { setFlash('pairing canceled', 'flash-warn'); return; }
        const st = await api.pairStatus(cfg, id);
        if (st.status === 404) { setFlash('pairing request expired; connect again', 'flash-err'); return; }
        if (!st.ok || !st.data) continue;
        if (st.data.status === 'approved' && st.data.token) {
          const saved = await storage.setSettings({ baseUrl: url, token: st.data.token });
          lastSavedUrl = saved.baseUrl;
          setTokenState(!!saved.token);
          setFlash('paired with monloader', 'flash-ok');
          test();
          return;
        }
        if (st.data.status === 'denied') { setFlash('pairing was denied in monloader', 'flash-err'); return; }
      }
      setFlash('timed out waiting for approval; try again', 'flash-err');
    } finally {
      pairing = null;
      $('connect').textContent = 'connect to monloader';
    }
  }

  async function test() {
    const cfg = await cfgFromForm();
    if (!cfg.baseUrl) { ui.setConn('down', 'no URL'); return; }
    ui.setConn('checking', 'checking');
    const { state, label, health } = await ui.probe(cfg);
    if (state !== 'ok') { ui.setConn(state, label); return; }
    const v = (health.data && health.data.version) || '?';
    const g = (health.data && health.data.gallerydl_version) || '?';
    ui.setConn('ok', 'monloader ' + v + ' / gallery-dl ' + g);
  }

  $('save').addEventListener('click', save);
  $('test').addEventListener('click', test);
  $('connect').addEventListener('click', connect);

  load().then(test);
})();
