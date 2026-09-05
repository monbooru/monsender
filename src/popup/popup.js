'use strict';
(function () {
  const { storage, api, outcome, sites, send, ui } = self.ML;
  const $ = ui.$;
  let cfg = { baseUrl: '', token: '' };
  let activeUrl = '';
  let activeTabId = null;
  let paused = false;
  // The resting result line; hovering a queue row shows that job's message and
  // reverts to this on leave.
  let baseResult = { text: '', tone: '' };

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

  // What the queue area says when it has no jobs to show.
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

  async function hint() {
    $('scan').disabled = !activeUrl;
    if (!activeUrl) { $('hint').textContent = ''; $('send').disabled = true; return; }
    let kind;
    try { kind = await sites.sendKind(cfg, activeUrl); } catch (e) { kind = 'blind'; }
    // 'blind' means the sites list could not be consulted, which says nothing
    // about this page; 'unknown' means it was, and did not name the host.
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
  // scan. Every call below is a synchronous dispatch, so they all land
  // in-gesture - both engines refuse to open their panel otherwise, which is
  // why the tab id is the one init() kept rather than a fresh query. The panel
  // reads the result from storage.
  function doScan() {
    if (browser.sidebarAction && browser.sidebarAction.open) browser.sidebarAction.open().catch(() => {});
    browser.runtime.sendMessage({ type: 'scan' }).catch(() => {});
    // Chrome only; sidePanel is reached dynamically so the Firefox bundle never
    // statically references the Chrome-only API (web-ext UNSUPPORTED_API).
    const sp = globalThis.chrome && globalThis.chrome['sidePanel'];
    if (sp && sp.open && activeTabId != null) {
      try { sp.open({ tabId: activeTabId }).catch(() => {}); } catch (e) { /* refused: the user opens it */ }
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
      ui.setConn(st, ui.connLabel(st));
      if (r.ok && r.data && Array.isArray(r.data.jobs)) {
        setPause(!!r.data.paused);
        const mine = new Set(await storage.getRecentJobIds());
        renderQueue(r.data.jobs, mine);
      } else {
        hidePause();
        queueState(QUEUE_DOWN[st] || 'cannot reach monloader');
      }
      // A hovered row is showing its own message; leave it be until mouseleave.
      if (!document.querySelector('.qrow:hover')) setResult(baseResult.text, baseResult.tone);
    } finally {
      pollTimer = setTimeout(poll, 2000);
    }
  }

  // Queue actions render as clickable bracketed text ([retry] etc.), not
  // buttons. The queue only visibly changes on the next poll, so a second
  // click lands before there is anything to show for the first - and on a
  // capped row that costs a second window of downloads. The in-flight set is
  // keyed by row and label rather than held on the node, since a status change
  // rebuilds the action row under it.
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
      a.appendChild(qact(id, 'cancel', 'cancel this job', () => removeSeries(id)));
    } else {
      // A capped search only fetched its newest window; offer the next, or all.
      if (j.capped && j.status !== 'failed' && j.status !== 'canceled') {
        a.appendChild(qact(id, 'continue', 'fetch the next items past the cap', () => api.continueJob(cfg, id)));
        a.appendChild(qact(id, 'fetch all', 'keep fetching until the search runs out', () => api.continueAll(cfg, id)));
      }
      if (j.status !== 'succeeded') {
        a.appendChild(qact(id, 'retry', 'requeue, keeping the gallery-dl archive', () => api.retry(cfg, id, false)));
      }
      // A plain retry keeps the archive, so a skipped-archive item only
      // re-downloads when forced. `archived` is the archive half of
      // `skipped`, and the only half forcing can fetch again: gating on
      // `skipped` also catches skipped_unsupported, where the re-run costs
      // a booru a full refetch and skips the same items for the same
      // reason. `skipped` is the fallback for a monloader older than the
      // field.
      if (j.summary && (j.summary.archived > 0
          || (j.summary.archived === undefined && j.summary.skipped > 0))) {
        a.appendChild(qact(id, 'force download', 're-download, ignoring the gallery-dl archive', () => api.retry(cfg, id, true)));
      }
    }
    return a;
  }

  // The cancel action acts on a whole collapsed series: monloader's per-job
  // DELETE cancels a running window and drops the rest, so loop it. The member
  // list is read now, not when the row was built: a series can gain a window
  // between the two.
  function removeSeries(id) {
    const j = shown.get(String(id)) || { id, members: [id] };
    return Promise.all((j.members || [j.id]).map((m) => api.remove(cfg, m)));
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

  // The job behind each visible row, by id, refreshed every poll. The row's
  // handlers read it rather than closing over the job they were built from.
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
    // Only swap the actions when the set itself changes, so a focused or
    // in-flight control survives every poll that leaves the row's offer alone.
    const next = qactions(j);
    if (actionLabels(next) !== actionLabels(row.lastChild)) row.replaceChild(next, row.lastChild);
  }

  // Patch the rows in place rather than clearing #queue: a teardown every 2 s
  // takes the keyboard off a focused action, eats a click that spans it, and
  // swallows the mouseleave of a hovered row.
  function renderQueue(jobs, mine) {
    const groups = outcome.groupSeries(jobs);
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
      // Re-inserting a node blurs what is focused inside it, so move only a row
      // that is actually out of place.
      if (q.children[at] !== row) q.insertBefore(row, q.children[at] || null);
      at++;
    }
    for (const row of spare.values()) row.remove();
    setClearEnabled(groups.some(finished));
  }

  function finished(j) { return ['succeeded', 'partial', 'failed', 'canceled'].indexOf(j.status) !== -1; }

  // Clear every finished job in monloader's queue - not just the rows on
  // screen, which is why the control says so. The API has no bulk-clear, so
  // loop DELETE; running and queued jobs are left alone, matching monloader's
  // own queue "clear". The pass owns the control for its whole duration: the
  // poll recomputes the enabled state from the queue contents, and would
  // otherwise re-offer it mid-pass and let a second click run a concurrent one.
  let clearing = false;

  async function clearQueue() {
    clearing = true;
    setClearEnabled(false);
    const prev = baseResult;
    try {
      const r = await api.listQueue(cfg, { limit: 200 });
      const done = (r.ok && r.data && Array.isArray(r.data.jobs)) ? r.data.jobs.filter(finished) : [];
      for (let i = 0; i < done.length; i++) {
        // The poll rewrites the result line every 2 s, so progress has to be
        // the resting text rather than a one-shot message.
        baseResult = { text: 'clearing ' + (i + 1) + ' of ' + done.length + '...', tone: 'dim' };
        setResult(baseResult.text, baseResult.tone);
        try { await api.remove(cfg, done[i].id); } catch (e) { /* a job gone already is cleared */ }
      }
    } finally {
      // A send that landed during the pass wrote its own outcome; only our own
      // progress line is ours to take back.
      if (/^clearing /.test(baseResult.text)) baseResult = prev;
      setResult(baseResult.text, baseResult.tone);
      clearing = false;
      poll();
    }
  }

  $('send').addEventListener('click', doSend);
  $('scan').addEventListener('click', doScan);
  $('options').addEventListener('click', () => { browser.runtime.openOptionsPage(); window.close(); });
  $('pause').addEventListener('click', togglePause);
  ui.onActivate($('brand'), () => ui.openQueue(cfg, true));
  ui.onActivate($('clearQueue'), clearQueue);

  init();
})();
