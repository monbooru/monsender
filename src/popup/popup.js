'use strict';
(function () {
  const { storage, api, outcome, perms, sites, send, ui } = self.ML;
  const $ = ui.$;
  let cfg = { baseUrl: '', token: '' };
  let activeUrl = '';
  let paused = false;
  // The resting result line; hovering a queue row shows that job's message and
  // reverts to this on leave.
  let baseResult = { text: '', tone: '' };

  const setConn = (state, label) => ui.setConn($('conn'), state, label);

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

  async function init() {
    const s = await storage.getSettings();
    cfg = send.cfgOf(s);
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
    // Without the optional host permission every fetch fails as a network
    // error, which reads as "monloader is down" when the fix is one click in
    // options.
    if (!(await perms.hasOrigin(cfg.baseUrl))) {
      setConn('down', 'host access not granted');
      $('hint').textContent = 'open options and save to allow access to ' + cfg.baseUrl;
      $('send').disabled = true;
      queueState('host access not granted');
      return;
    }
    setConn('checking', 'checking');
    hint();
    poll();
  }

  const HINT = {
    supported: 'booru - tags will be included',
    image: 'direct image - no tags',
    unsupported: 'not a supported site or image'
  };

  async function hint() {
    $('scan').disabled = !activeUrl;
    if (!activeUrl) { $('hint').textContent = ''; $('send').disabled = true; return; }
    let kind;
    try { kind = await sites.sendKind(cfg, activeUrl); } catch (e) { kind = 'unknown'; }
    // An undecidable kind ('unknown', 'blind') says nothing worth showing.
    $('hint').textContent = HINT[kind] || '';
    // Block the send only when sure it is unsendable; an undecidable result
    // (the sites list could not be fetched) leaves it enabled.
    $('send').disabled = kind === 'unsupported';
  }

  async function doSend() {
    if (!activeUrl) return;
    setResult('sending...', 'dim');
    const out = await send.sendOne(activeUrl);
    if (!out.configured) { setResult('set monloader URL in options', 'error'); return; }
    setResult(out.outcome.text, out.outcome.tone);
    baseResult = { text: out.outcome.text, tone: out.outcome.tone };
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

  // Chain each poll off the end of the last rather than on a fixed interval:
  // against a monloader that answers slowly, an interval stacks calls faster
  // than they come back.
  let pollTimer = null;

  async function poll() {
    clearTimeout(pollTimer);
    try {
      const r = await api.listQueue(cfg, { limit: 8 });
      const st = outcome.connState(r, r);
      setConn(st, ui.connLabel(st));
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
    } finally {
      pollTimer = setTimeout(poll, 2000);
    }
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
    ui.onActivate(s, fn);
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

  function setClearEnabled(on) { ui.setActionEnabled($('clearQueue'), on); }

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
      site.textContent = (j.site || sites.hostOf(j.url)) + (j.gallery ? ' / ' + j.gallery : '');
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
    setClearEnabled(false); // a long clear would otherwise take a second click
    const r = await api.listQueue(cfg, { limit: 200 });
    const done = (r.ok && r.data && Array.isArray(r.data.jobs)) ? r.data.jobs.filter(finished) : [];
    const prev = baseResult;
    for (let i = 0; i < done.length; i++) {
      // The poll rewrites the result line every 2 s, so progress has to be the
      // resting text rather than a one-shot message.
      baseResult = { text: 'clearing ' + (i + 1) + ' of ' + done.length + '...', tone: 'dim' };
      setResult(baseResult.text, baseResult.tone);
      try { await api.remove(cfg, done[i].id); } catch (e) {}
    }
    baseResult = prev;
    setResult(prev.text, prev.tone);
    poll();
  }

  $('send').addEventListener('click', doSend);
  $('scan').addEventListener('click', doScan);
  $('options').addEventListener('click', () => { browser.runtime.openOptionsPage(); window.close(); });
  $('pause').addEventListener('click', togglePause);
  ui.onActivate($('brand'), () => ui.openQueue(cfg, true));
  ui.onActivate($('clearQueue'), clearQueue);

  init();
})();
