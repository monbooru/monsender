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

  // The token itself is never echoed back, only whether one is held.
  function setTokenState(has) {
    $('tokenState').textContent = has ? 'token: set' : 'token: not set';
  }

  async function load() {
    const s = await storage.getSettings();
    $('baseUrl').value = s.baseUrl;
    $('wait').value = s.waitSeconds;
    $('scanCap').value = s.scanCap;
    $('minSize').value = s.minImageSize;
    $('previews').checked = s.previews;
    setTokenState(!!s.token);
    lastSavedUrl = s.baseUrl;
  }

  // Read the numbers into range and put them back on screen, so the field and
  // the stored value never disagree: a scan cap typed as 99999 is saved as
  // 1000, and leaving 99999 in the box makes the truncation note look wrong.
  function readForm() {
    const typed = ['wait', 'scanCap', 'minSize'].map((id) => $(id).value.trim());
    const patch = {
      waitSeconds: clampInt($('wait').value, 0, 60, 20),
      scanCap: clampInt($('scanCap').value, 1, 1000, 100),
      minImageSize: clampInt($('minSize').value, 0, 4000, 64),
      previews: $('previews').checked
    };
    $('wait').value = patch.waitSeconds;
    $('scanCap').value = patch.scanCap;
    $('minSize').value = patch.minImageSize;
    const adjusted = ['wait', 'scanCap', 'minSize'].some((id, i) => $(id).value !== typed[i]);
    return { patch, adjusted };
  }

  // A token belongs to the instance that issued it, so a URL typed but not yet
  // saved gets the unauthenticated probe rather than that instance's key.
  async function cfgFromForm() {
    const s = await storage.getSettings();
    const baseUrl = normalizeUrl($('baseUrl').value) || s.baseUrl;
    return { baseUrl, token: baseUrl === s.baseUrl ? s.token : '' };
  }

  // The URL on screen, normalized in place, or '' with the reason flashed.
  // Both actions that reach monloader start here, so one rule decides what
  // counts as a URL worth trying.
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
    // A pairing stores the URL it started with, and the wait runs up to 90 s,
    // so an approval landing after the URL was changed here would put the old
    // one back. Saving anything else leaves the pairing alone.
    if (pairing && pairing.url !== url) pairing.canceled = true;

    const { patch, adjusted } = readForm();
    patch.baseUrl = url;
    // A token is bound to the instance that issued it; a changed URL drops the
    // stored token so the old key is never sent to a different monloader.
    let cleared = false;
    if (lastSavedUrl && lastSavedUrl !== url) {
      const cur = await storage.getSettings();
      if (cur.token) { patch.token = ''; cleared = true; }
    }
    const saved = await storage.setSettings(patch);
    lastSavedUrl = saved.baseUrl;
    setTokenState(!!saved.token);
    setFlash('saved'
      + (cleared ? '; URL changed, cleared the stored token' : '')
      + (adjusted ? '; some values were brought into range' : ''), 'flash-ok');
    test();
  }

  // connect pairs with monloader without copying keys: it requests a pairing,
  // the operator approves in monloader, and the issued token is stored here.
  // The wait runs up to 90 s, so the button becomes the way out of it: a second
  // click cancels rather than starting a second pairing racing the first.
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
        if (st.data.status === 'expired') { setFlash('pairing request expired; try again', 'flash-err'); return; }
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
    // Settings is where the versions belong, so it labels a good connection
    // with them rather than with the plain "connected" the other pages show.
    if (state !== 'ok') { ui.setConn(state, label); return; }
    const v = (health.data && health.data.version) || '?';
    const g = (health.data && health.data.gallerydl_version) || '?';
    ui.setConn('ok', 'monloader ' + v + ' / gallery-dl ' + g);
  }

  $('save').addEventListener('click', save);
  $('test').addEventListener('click', test);
  $('connect').addEventListener('click', connect);

  // Scripts are at the end of <body>, so the DOM above exists. Init now.
  load().then(test);
})();
