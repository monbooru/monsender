'use strict';
(function () {
  const { storage, api, outcome, sites, send } = self.ML;
  const $ = (id) => document.getElementById(id);
  let cfg = { baseUrl: '', token: '' };
  let activeUrl = '';
  let paused = false;
  // The resting result line; hovering a queue row shows that job's message and
  // reverts to this on leave.
  let baseResult = { text: '', tone: '' };

  function setConn(state, label) {
    const c = $('conn');
    c.textContent = '';
    const d = document.createElement('span');
    d.className = 'dot dot-' + state;
    const t = document.createElement('span');
    t.textContent = ' ' + label;
    c.appendChild(d); c.appendChild(t);
  }
  function setResult(text, tone) {
    const r = $('result');
    r.textContent = text || '';
    r.title = text || ''; // result is single-line + ellipsized; show the full text on hover
    r.className = 'result' + (tone ? ' tone-' + tone : '');
  }

  // The pause button mirrors monloader's global hold: indigo while downloads
  // run, orange while held. It shows only when monloader is reachable.
  function setPause(isPaused) {
    paused = isPaused;
    const b = $('pause');
    b.hidden = false;
    b.classList.toggle('paused', isPaused);
    b.textContent = isPaused ? '\u25B6\uFE0E' : '\u23F8\uFE0E';
    b.setAttribute('aria-label', isPaused ? 'resume downloads' : 'pause downloads');
    b.title = isPaused ? 'downloads paused - click to resume' : 'pause new downloads';
  }
  function hidePause() { $('pause').hidden = true; }

  async function togglePause() {
    const b = $('pause');
    b.disabled = true;
    await (paused ? api.resume(cfg) : api.pause(cfg)).catch(() => {});
    b.disabled = false;
    poll();
  }

  function hostShort(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u || ''; }
  }

  async function init() {
    const s = await storage.getSettings();
    cfg = { baseUrl: s.baseUrl, token: s.token };
    // Clear the badge and the tooltip a no-popup send may have set. The result
    // line starts empty; a queue job's outcome shows only while its row is
    // hovered, or this popup's own send result.
    try { await browser.action.setTitle({ title: 'Send to monloader' }); } catch (e) {}
    try { await browser.action.setBadgeText({ text: '' }); } catch (e) {}
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      activeUrl = (tab && tab.url) || '';
    } catch (e) { /* no activeTab url */ }

    $('targetUrl').textContent = activeUrl || '(no page)';
    $('targetUrl').title = activeUrl;

    if (!cfg.baseUrl) {
      setConn('down', 'set monloader URL');
      $('hint').textContent = 'open options to set your monloader URL';
      $('send').disabled = true;
      $('scan').disabled = true;
      queueState('set a monloader URL in options');
      return;
    }
    refreshConn();
    hint();
    startPolling();
  }

  async function hint() {
    $('scan').disabled = !activeUrl;
    if (!activeUrl) { $('hint').textContent = ''; $('send').disabled = true; return; }
    let kind;
    try { kind = await sites.sendKind(cfg, activeUrl); } catch (e) { kind = 'unknown'; }
    if (kind === 'supported') $('hint').textContent = 'booru - tags will be included';
    else if (kind === 'image') $('hint').textContent = 'direct image - no tags';
    else if (kind === 'unsupported') $('hint').textContent = 'not a supported site or image';
    else $('hint').textContent = '';
    // Block the send only when sure it is unsendable; an undecidable result
    // (the sites list could not be fetched) leaves it enabled.
    $('send').disabled = kind === 'unsupported';
  }

  async function refreshConn() {
    setConn('checking', 'checking');
    const h = await api.health(cfg);
    // Always probe the authed endpoint - monloader may require a token we lack.
    const authed = await api.listQueue(cfg, { limit: 1 });
    const st = outcome.connState(h, authed);
    setConn(st, st === 'ok' ? 'connected' : (st === 'rejected' ? 'token rejected' : 'unreachable'));
  }

  async function doSend() {
    if (!activeUrl) return;
    setResult('sending...', 'dim');
    const out = await send.sendOne(activeUrl);
    if (!out.configured) { setResult('set monloader URL in options', 'error'); return; }
    setResult(out.outcome.text, out.outcome.tone);
    baseResult = { text: out.outcome.text, tone: out.outcome.tone };
    await storage.setLastResult(out.outcome);
    if (out.jobId) await storage.addRecentJobIds([out.jobId]);
    poll();
  }

  // Open the chooser panel and kick off a scan. The scan itself runs in the
  // background (bg.js): on Firefox sidebarAction.open() must fire synchronously
  // in this gesture and dismisses the popup, so the popup cannot finish an async
  // scan. Both calls below are synchronous dispatches, so they land in-gesture.
  // The panel reads the result from storage.
  async function doScan() {
    if (browser.sidebarAction && browser.sidebarAction.open) browser.sidebarAction.open().catch(() => {});
    browser.runtime.sendMessage({ type: 'scan' }).catch(() => {});
    // Chrome only; sidePanel is reached dynamically so the Firefox bundle never
    // statically references the Chrome-only API (web-ext UNSUPPORTED_API).
    const sp = globalThis.chrome && globalThis.chrome['sidePanel'];
    if (sp && sp.open) {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab) await sp.open({ tabId: tab.id });
      } catch (e) {}
    }
    window.close();
  }

  let pollTimer = null;
  function startPolling() { poll(); pollTimer = setInterval(poll, 2000); }

  async function poll() {
    const r = await api.listQueue(cfg, { limit: 8 });
    const st = outcome.connState(r, r);
    setConn(st, st === 'ok' ? 'connected' : (st === 'rejected' ? 'token rejected' : 'unreachable'));
    if (r.ok && r.data && Array.isArray(r.data.jobs)) {
      setPause(!!r.data.paused);
      const mine = new Set(await storage.getRecentJobIds());
      renderQueue(r.data.jobs, mine);
    } else {
      hidePause();
      queueState(st === 'rejected' ? 'monloader rejected the token' : 'cannot reach monloader');
    }
    // The row nodes are rebuilt each poll, so a row hovered across a rebuild
    // fires no mouseleave; revert the result line unless a row is still hovered.
    if (!document.querySelector('.qrow:hover')) setResult(baseResult.text, baseResult.tone);
  }

  function summaryText(j) {
    if (j.status === 'queued') return '';
    if (j.status === 'running') return outcome.runningProgress(j);
    return outcome.queueSummary(j);
  }

  // One-line message for a job, shown in the result line while its row is
  // hovered (the row otherwise shows only terse counts).
  function jobMessage(j) {
    if (j.status === 'running' || j.status === 'queued') {
      const p = outcome.runningProgress(j);
      return { text: p ? j.status + ' ' + p : j.status, tone: 'accent' };
    }
    // singleOutcome lets created win over failed, which hides a partial job's
    // failures, so spell out the counts for a partial.
    if (j.status === 'partial') return { text: outcome.queueSummary(j) || 'partial', tone: 'warning' };
    return outcome.singleOutcome(j);
  }

  function act(promise) { Promise.resolve(promise).catch(() => {}).then(poll); }

  // Queue actions render as clickable bracketed text ([retry] etc.), not buttons.
  function qact(label, title, fn) {
    const s = document.createElement('span');
    s.className = 'qact';
    s.textContent = '[' + label + ']';
    s.title = title;
    s.tabIndex = 0;
    s.setAttribute('role', 'button');
    s.addEventListener('click', fn);
    s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
    return s;
  }

  function qactions(j) {
    const a = document.createElement('div');
    a.className = 'qactions';
    if (j.status === 'running' || j.status === 'queued') {
      a.appendChild(qact('cancel', 'cancel this job', () => act(removeSeries(j))));
    } else {
      // A capped search only fetched its newest window; offer the next, or all.
      if (j.capped && j.status !== 'failed' && j.status !== 'canceled') {
        a.appendChild(qact('continue', 'fetch the next items past the cap', () => act(api.continueJob(cfg, j.id))));
        a.appendChild(qact('fetch all', 'keep fetching until the search runs out', () => act(api.continueAll(cfg, j.id))));
      }
      if (j.status !== 'succeeded') {
        a.appendChild(qact('retry', 'requeue, keeping the gallery-dl archive', () => act(api.retry(cfg, j.id, false))));
      }
      // A plain retry keeps the archive, so a skipped-archive item only
      // re-downloads when forced.
      if (j.summary && j.summary.skipped > 0) {
        a.appendChild(qact('force download', 're-download, ignoring the gallery-dl archive', () => act(api.retry(cfg, j.id, true))));
      }
    }
    return a;
  }

  // The cancel action acts on a whole collapsed series: monloader's per-job
  // DELETE cancels a running window and drops the rest, so loop it.
  function removeSeries(j) {
    return Promise.all((j.members || [j.id]).map((id) => api.remove(cfg, id)));
  }

  function queueState(msg) {
    const q = $('queue');
    q.textContent = '';
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = msg;
    q.appendChild(e);
    setClearEnabled(false);
  }

  function setClearEnabled(on) {
    const c = $('clearQueue');
    c.classList.toggle('disabled', !on);
    c.setAttribute('aria-disabled', String(!on));
  }

  function renderQueue(jobs, mine) {
    const groups = outcome.groupSeries(jobs);
    if (!groups.length) { queueState('queue is empty'); return; }
    const q = $('queue');
    q.textContent = '';
    for (const j of groups) {
      const row = document.createElement('div');
      row.className = 'qrow' + (j.members.some((id) => mine.has(id)) ? ' mine' : '');
      const line = document.createElement('div');
      line.className = 'qline';
      const st = document.createElement('span');
      st.className = 'qstatus st-' + j.status;
      st.textContent = j.status;
      const site = document.createElement('span');
      site.className = 'qsite';
      site.textContent = (j.site || hostShort(j.url)) + (j.gallery ? ' / ' + j.gallery : '');
      site.title = j.url || '';
      const sum = document.createElement('span');
      sum.className = 'qsum';
      sum.textContent = summaryText(j);
      line.appendChild(st); line.appendChild(site); line.appendChild(sum);
      row.appendChild(line);
      row.appendChild(qactions(j));
      row.addEventListener('mouseenter', () => { const m = jobMessage(j); setResult(m.text, m.tone); });
      row.addEventListener('mouseleave', () => setResult(baseResult.text, baseResult.tone));
      q.appendChild(row);
    }
    setClearEnabled(groups.some(finished));
  }

  function finished(j) { return ['succeeded', 'partial', 'failed', 'canceled'].indexOf(j.status) !== -1; }

  // Clear finished jobs from monloader's queue. The API has no bulk-clear, so
  // loop DELETE; running and queued jobs are left alone, matching monloader's
  // own queue "clear".
  async function clearQueue() {
    if ($('clearQueue').getAttribute('aria-disabled') === 'true') return;
    const r = await api.listQueue(cfg, { limit: 200 });
    if (!(r.ok && r.data && Array.isArray(r.data.jobs))) return;
    for (const j of r.data.jobs) { if (finished(j)) { try { await api.remove(cfg, j.id); } catch (e) {} } }
    poll();
  }

  function openQueue() {
    if (!cfg.baseUrl) return;
    browser.tabs.create({ url: cfg.baseUrl + '/queue' });
    window.close();
  }

  $('send').addEventListener('click', doSend);
  $('scan').addEventListener('click', doScan);
  $('options').addEventListener('click', () => { browser.runtime.openOptionsPage(); window.close(); });
  $('pause').addEventListener('click', togglePause);
  $('brand').addEventListener('click', openQueue);
  $('brand').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openQueue(); } });
  $('clearQueue').addEventListener('click', clearQueue);
  $('clearQueue').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clearQueue(); } });

  init();
})();
