'use strict';
(function () {
  const { storage, api, outcome, sites, send, ui } = self.ML;
  const $ = ui.$;
  let cfg = { baseUrl: '', token: '' };
  let activeUrl = '';
  let activeTabId = null;
  let paused = false;
  let baseResult = { text: '', tone: '' };

  function setResult(text, tone) {
    const r = $('result');
    r.textContent = text || '';
    r.title = text || '';
    r.className = 'result' + (tone ? ' tone-' + tone : '');
  }

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
    await (paused ? api.resume(cfg) : api.pause(cfg));
    b.disabled = false;
    poll();
  }

  async function init() {
    const s = await storage.getSettings();
    cfg = send.cfgOf(s);
    try { await browser.action.setTitle({ title: 'Send to monloader' }); } catch (e) { /* action API unavailable */ }
    try { await browser.action.setBadgeText({ text: '' }); } catch (e) { /* as above */ }
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      activeUrl = (tab && tab.url) || '';
      activeTabId = tab ? tab.id : null;
    } catch (e) { /* no activeTab url */ }

    $('targetUrl').textContent = activeUrl || '(no page)';
    $('targetUrl').title = activeUrl;

    if (!cfg.baseUrl) {
      ui.setConn('down', 'set monloader URL');
      $('hint').textContent = 'open options to set your monloader URL';
      $('send').disabled = true;
      $('scan').disabled = true;
      queueState('set a monloader URL in options');
      return;
    }
    ui.setConn('checking', 'checking');
    hint();
    poll();
  }

  const QUEUE_DOWN = {
    rejected: 'monloader rejected the token',
    unpaired: 'not paired yet - connect to monloader in options'
  };

  const HINT = {
    supported: 'booru - tags will be included',
    image: 'direct image - no tags',
    unknown: 'not a known site - monloader will decide',
    unsupported: 'not a supported site or image'
  };

  // A ?wait send can take a minute, and a second click would enqueue the
  // page again.
  let sending = false;

  async function hint() {
    $('scan').disabled = !activeUrl;
    if (!activeUrl) { $('hint').textContent = ''; $('send').disabled = true; return; }
    let kind;
    try { kind = await sites.sendKind(cfg, activeUrl); } catch (e) { kind = 'blind'; }
    // 'blind' gets no hint: an unreadable list says nothing about this page.
    $('hint').textContent = HINT[kind] || '';
    // Only a positively unsendable page blocks the send.
    $('send').disabled = sending || kind === 'unsupported';
  }

  async function doSend() {
    if (!activeUrl || sending) return;
    sending = true;
    $('send').disabled = true;
    // The resting text while the send is out, so a poll repaints it.
    baseResult = { text: 'sending...', tone: 'dim' };
    setResult(baseResult.text, baseResult.tone);
    try {
      const out = await send.sendOne(activeUrl);
      baseResult = out.configured ? { text: out.outcome.text, tone: out.outcome.tone }
        : { text: 'set monloader URL in options', tone: 'error' };
      setResult(baseResult.text, baseResult.tone);
      if (out.jobId) await storage.addRecentJobIds([out.jobId]);
    } finally {
      sending = false;
      hint();
    }
    poll();
  }

  // Both engines open their panel only inside the gesture, so nothing
  // here may await, and the tab id is the one init() kept. Opening the
  // Firefox sidebar closes the popup, so the scan runs in the background.
  function doScan() {
    if (browser.sidebarAction && browser.sidebarAction.open) browser.sidebarAction.open().catch(() => { /* refused: the user opens it */ });
    browser.runtime.sendMessage({ type: 'scan' }).catch(() => { /* the popup closes next; nothing could show it */ });
    // Bracket access keeps web-ext's UNSUPPORTED_API off the Firefox build.
    const sp = globalThis.chrome && globalThis.chrome['sidePanel'];
    if (sp && sp.open && activeTabId != null) {
      try { sp.open({ tabId: activeTabId }).catch(() => { /* refused: the user opens it */ }); } catch (e) { /* as above */ }
    }
    window.close();
  }

  // Chained, not setInterval: a slow monloader would stack polls up.
  let pollTimer = null;

  const ROWS = 8;
  // A row sums every window of its series, so the page grows to the API's
  // 200 once a series runs past it or leaves fewer rows than the popup shows.
  let pageSize = ROWS;

  function cutShort(r) {
    const jobs = (r.ok && r.data && Array.isArray(r.data.jobs)) ? r.data.jobs : [];
    if (jobs.length < pageSize) return false;
    const groups = outcome.groupSeries(jobs);
    return groups.length < ROWS || groups.slice(0, ROWS).some((g) => !g.members.includes(rootOf(g)));
  }

  async function poll() {
    clearTimeout(pollTimer);
    try {
      let r = await api.listQueue(cfg, { limit: pageSize });
      if (pageSize < 200 && cutShort(r)) {
        pageSize = 200;
        r = await api.listQueue(cfg, { limit: pageSize });
      }
      const st = outcome.connState(r, r, !!cfg.token);
      ui.setConn(st, ui.connLabel(st));
      if (r.ok && r.data && Array.isArray(r.data.jobs)) {
        setPause(!!r.data.paused);
        const mine = new Set(await storage.getRecentJobIds());
        renderQueue(r.data.jobs, mine);
      } else {
        hidePause();
        queueState(QUEUE_DOWN[st] || 'cannot reach monloader');
      }
      if (!document.querySelector('.qrow:hover')) setResult(baseResult.text, baseResult.tone);
    } finally {
      pollTimer = setTimeout(poll, 2000);
    }
  }

  // A double click would cost a capped row a second window. Keyed by row and
  // label, not held on the node: a status change rebuilds the action row.
  const inFlight = new Set();

  function qact(id, label, title, request) {
    const key = id + ' ' + label;
    const s = document.createElement('span');
    s.className = 'qact';
    s.textContent = '[' + label + ']';
    s.title = title;
    s.tabIndex = 0;
    s.setAttribute('role', 'button');
    ui.setActionEnabled(s, !inFlight.has(key));
    ui.onActivate(s, async () => {
      inFlight.add(key);
      ui.setActionEnabled(s, false);
      try { await request(); } catch (e) { /* the next poll shows what landed */ }
      inFlight.delete(key);
      poll();
    });
    return s;
  }

  function qactions(j) {
    const a = document.createElement('div');
    a.className = 'qactions';
    const id = j.id;
    if (j.status === 'running' || j.status === 'queued') {
      a.appendChild(qact(id, 'cancel', 'cancel this job', () => cancelSeries(id)));
    } else {
      if (j.capped && j.status !== 'failed' && j.status !== 'canceled') {
        a.appendChild(qact(id, 'continue', 'fetch the next items past the cap', () => api.continueJob(cfg, id)));
        a.appendChild(qact(id, 'fetch all', 'keep fetching until the search runs out', () => api.continueAll(cfg, id)));
      }
      if (j.status !== 'succeeded') {
        a.appendChild(qact(id, 'retry', 'requeue, keeping the gallery-dl archive', () => api.retry(cfg, id, false)));
      }
      // Gated on `archived`, the only part of `skipped` that forcing can
      // fetch again: skipped_unsupported would refetch just to skip the same
      // items. A monloader without the field falls back to `skipped`.
      if (j.summary && (j.summary.archived > 0
          || (j.summary.archived === undefined && j.summary.skipped > 0))) {
        a.appendChild(qact(id, 'force download', 're-download, ignoring the gallery-dl archive', () => api.retry(cfg, id, true)));
      }
    }
    return a;
  }

  // monloader's DELETE acts on a whole series: sent to a live window it
  // cancels every live one and keeps the finished ones, sent to a finished
  // window it removes them all. A window can finish between the poll and
  // the click, so the series is read fresh and one of its live windows gets
  // the DELETE.
  async function cancelSeries(id) {
    const root = rootOf(shown.get(String(id)) || { id });
    const live = (await wholeQueue()).find((j) => rootOf(j) === root && !finished(j));
    if (live) await api.remove(cfg, live.id);
  }

  const rootOf = (j) => j.root || j.id;

  // A page holds at most 200 jobs.
  async function wholeQueue() {
    const jobs = [];
    for (let page = 1; ; page++) {
      const r = await api.listQueue(cfg, { limit: 200, page });
      if (!(r.ok && r.data && Array.isArray(r.data.jobs))) break;
      jobs.push(...r.data.jobs);
      if (r.data.jobs.length < 200 || jobs.length >= r.data.total) break;
    }
    return jobs;
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

  function setClearEnabled(on) { ui.setActionEnabled($('clearQueue'), on && !clearing); }

  // Row handlers read this, not a closed-over job: rows outlive their poll.
  let shown = new Map();

  function newRow(id) {
    const row = document.createElement('div');
    row.className = 'qrow';
    row.setAttribute('data-job', id);
    const line = document.createElement('div');
    line.className = 'qline';
    for (const cls of ['qstatus', 'qsite', 'qsum']) {
      const span = document.createElement('span');
      span.className = cls;
      line.appendChild(span);
    }
    row.appendChild(line);
    const acts = document.createElement('div');
    acts.className = 'qactions';
    row.appendChild(acts);
    row.addEventListener('mouseenter', () => {
      const m = outcome.jobLine(shown.get(String(id)));
      setResult(m.text, m.tone);
    });
    row.addEventListener('mouseleave', () => setResult(baseResult.text, baseResult.tone));
    return row;
  }

  const actionLabels = (el) => Array.from(el.querySelectorAll('.qact')).map((a) => a.textContent).join();

  function updateRow(row, j, mine) {
    row.className = 'qrow' + (j.members.some((id) => mine.has(id)) ? ' mine' : '');
    const [st, site, sum] = row.firstChild.children;
    st.className = 'qstatus st-' + j.status;
    st.textContent = j.status;
    site.textContent = (j.site || sites.hostOf(j.url)) + (j.gallery ? ' / ' + j.gallery : '');
    site.title = j.url || '';
    sum.textContent = outcome.jobCounts(j);
    // Swapped only when the offer changes, so a focused control survives.
    const next = qactions(j);
    if (actionLabels(next) !== actionLabels(row.lastChild)) row.replaceChild(next, row.lastChild);
  }

  // Patched in place: a rebuild every 2 s drops focus, eats a click in
  // progress and loses a hovered row's mouseleave.
  function renderQueue(jobs, mine) {
    const all = outcome.groupSeries(jobs);
    const groups = all.slice(0, ROWS);
    if (!groups.length) { queueState('queue is empty'); return; }
    const q = $('queue');
    if (q.firstChild && q.firstChild.className === 'empty') q.textContent = '';
    const spare = new Map();
    for (const row of q.querySelectorAll('.qrow')) spare.set(row.getAttribute('data-job'), row);

    shown = new Map(groups.map((j) => [String(j.id), j]));
    let at = 0;
    for (const j of groups) {
      const key = String(j.id);
      const row = spare.get(key) || newRow(j.id);
      spare.delete(key);
      updateRow(row, j, mine);
      // Re-inserting blurs a focused control, so only a misplaced row moves.
      if (q.children[at] !== row) q.insertBefore(row, q.children[at] || null);
      at++;
    }
    for (const row of spare.values()) row.remove();
    setClearEnabled(all.some(finished));
  }

  function finished(j) { return ['succeeded', 'partial', 'failed', 'canceled', 'interrupted'].indexOf(j.status) !== -1; }

  // The API has no bulk clear, and its DELETE removes a finished series
  // whole but cancels any window of it still live. So each finished series
  // gets one DELETE and a series with a live window is left alone. The flag
  // holds the control for the pass; a poll would re-offer it.
  let clearing = false;

  async function clearQueue() {
    clearing = true;
    setClearEnabled(false);
    const prev = baseResult;
    try {
      const jobs = await wholeQueue();
      const live = new Set(jobs.filter((j) => !finished(j)).map(rootOf));
      const done = new Map();
      for (const j of jobs) if (finished(j) && !live.has(rootOf(j))) done.set(rootOf(j), j.id);
      const ids = [...done.values()];
      for (let i = 0; i < ids.length; i++) {
        // Progress is the resting text: each poll repaints the line from it.
        baseResult = { text: 'clearing ' + (i + 1) + ' of ' + ids.length + '...', tone: 'dim' };
        setResult(baseResult.text, baseResult.tone);
        await api.remove(cfg, ids[i]);
      }
    } finally {
      // A send during the pass set its own outcome, which must stand.
      if (/^clearing /.test(baseResult.text)) baseResult = prev;
      setResult(baseResult.text, baseResult.tone);
      clearing = false;
      poll();
    }
  }

  $('send').addEventListener('click', doSend);
  $('scan').addEventListener('click', doScan);
  $('options').addEventListener('click', () => {
    browser.runtime.openOptionsPage().catch(() => { /* the popup closes next; nothing could show it */ });
    window.close();
  });
  $('pause').addEventListener('click', togglePause);
  ui.onActivate($('brand'), () => ui.openQueue(cfg, true));
  ui.onActivate($('clearQueue'), clearQueue);

  init();
})();
