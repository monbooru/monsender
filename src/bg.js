'use strict';
// Firefox's event page has no importScripts; its background.scripts loads
// these libs instead.
if (typeof importScripts === 'function') {
  importScripts(
    'lib/browser.js',
    'lib/storage.js', 'lib/api.js', 'lib/outcome.js', 'lib/urls.js',
    'lib/sites.js', 'lib/scan-core.js', 'lib/send.js'
  );
}

const ML = self.ML;

// The running count lives in the badge text. "!" marks a send that queued
// nothing and goes after the count, which the next send counts on from.
async function setBadge(kind, queued) {
  try {
    await browser.action.setBadgeBackgroundColor({ color: ML.outcome.badgeColor(kind) });
    const cur = parseInt(await browser.action.getBadgeText({}), 10) || 0;
    await browser.action.setBadgeText({ text: queued ? String(cur + queued) : (cur || '') + '!' });
  } catch (e) { /* action API unavailable */ }
}

// The badge count and the job-id ring are read, then written: two sends
// landing together would each read before the other wrote, and lose one.
let writes = Promise.resolve();
function inTurn(fn) {
  const run = writes.then(fn);
  writes = run.catch(() => { /* a failed write must not hold up the next */ });
  return run;
}

async function recordSend(out) {
  if (!out || !out.configured) return out;
  await inTurn(async () => {
    if (out.jobId) {
      try { await ML.storage.addRecentJobIds([out.jobId]); } catch (e) { /* the ring is a nicety */ }
    }
    await setBadge(out.outcome.kind, out.jobId ? 1 : 0);
    try { await browser.action.setTitle({ title: out.outcome.text }); } catch (e) { /* action API unavailable */ }
  });
  return out;
}

async function sendUrl(url, opts) {
  if (!url) return;
  const out = await ML.send.sendOne(url, opts);
  if (!out.configured) {
    try { await browser.runtime.openOptionsPage(); } catch (e) { /* nothing else to offer */ }
    return;
  }
  return recordSend(out);
}

async function reportUnsupported() {
  await inTurn(async () => {
    await setBadge('unsupported', 0);
    try { await browser.action.setTitle({ title: 'not a supported site or image' }); } catch (e) { /* action API unavailable */ }
  });
}

// Only a positively unsupported URL is refused; monloader judges the rest.
async function sendPage(url) {
  if (!url) return;
  const s = await ML.storage.getSettings();
  if (s.baseUrl && (await ML.sites.sendKind(ML.send.cfgOf(s), url)) === 'unsupported') {
    return reportUnsupported();
  }
  return sendUrl(url);
}

// activeTab exposes the URL during a gesture, so no tabs permission is
// needed; a refused query reads as no tab.
async function activeTab() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (e) { return null; }
}

async function sendActiveTab() {
  const tab = await activeTab();
  if (tab && tab.url) return sendPage(tab.url);
  return reportUnsupported();
}
browser.commands.onCommand.addListener((cmd) => { if (cmd === 'send-page') sendActiveTab(); });

async function scanActiveTab() {
  const tab = await activeTab();
  const s = await ML.storage.getSettings();
  let fin = { items: [], total: 0, shown: 0, truncated: false };
  // No tab to read is a scan that could not run: the panel the popup just
  // opened must not go on showing the last page's.
  let blocked = !tab;
  let incomplete = false;
  if (tab) {
    try {
      const res = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['lib/urls.js', 'lib/scan-core.js', 'lib/scan-run.js']
      });
      const raw = JSON.parse((res && res[0] && res[0].result) || '{}');
      incomplete = !!raw.incomplete;
      fin = ML.scanCore.finalize(raw.items || [], { cap: s.scanCap, minSize: s.minImageSize });
    } catch (e) {
      // Injection refused: a browser page, the add-on store, a PDF viewer.
      blocked = true;
    }
  }
  // Stamped, since storage reports a change only when a value differs, and a
  // rescan of an unchanged page must still reach the panel.
  await ML.storage.setScan({
    url: tab ? tab.url : '',
    items: fin.items, total: fin.total, shown: fin.shown, truncated: fin.truncated,
    incomplete, blocked, previews: s.previews, at: Date.now()
  });
}
browser.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'scan') scanActiveTab();
  else if (msg.type === 'queued') inTurn(() => setBadge('queued', msg.count || 0));
});

async function setupMenus() {
  try { await browser.contextMenus.removeAll(); } catch (e) { /* a failing removeAll must not stop the entry being created */ }
  try {
    browser.contextMenus.create({ id: 'ml-send', title: 'Send to monloader', contexts: ['image', 'video'] });
  } catch (e) { /* a duplicate id on a re-run of onInstalled */ }
}
browser.runtime.onInstalled.addListener(setupMenus);
browser.runtime.onStartup.addListener(setupMenus);

// A tagged post or page beats the raw file, and so does a 'blind' one: on
// a booru the file is likely an unfetchable CDN link.
async function resolveMenuTarget(cfg, info) {
  if (cfg.baseUrl) {
    for (const cand of [info.linkUrl, info.pageUrl]) {
      if (!cand) continue;
      const kind = await ML.sites.sendKind(cfg, cand);
      if (kind === 'supported' || kind === 'blind') return cand;
    }
  }
  // Filtered here: a data: URL would carry its whole payload to a sure refusal.
  return /^https?:/i.test(info.srcUrl || '') ? info.srcUrl : null;
}

// A func: body cannot close over module scope, so the modules it calls are
// injected by file first, into the same isolated world.
async function injectThen(tabId, frameId, { files, args, func }) {
  const target = frameId != null ? { tabId, frameIds: [frameId] } : { tabId };
  await browser.scripting.executeScript({ target, files });
  const [res] = await browser.scripting.executeScript({ target, args, func });
  return res && res.result;
}

// srcUrl is the rendered, often downscaled, variant. Any failure falls
// back to srcUrl.
async function largestForSrc(tabId, frameId, srcUrl) {
  try {
    const up = await injectThen(tabId, frameId, {
      files: ['lib/urls.js', 'lib/scan-core.js'],
      args: [srcUrl],
      func: (want) => {
        for (const img of document.querySelectorAll('img')) {
          if (img.currentSrc !== want && img.src !== want) continue;
          const pick = self.ML.scanCore.bestCand(img).url;
          try { return pick ? new URL(pick, document.baseURI).href : null; } catch (e) { return null; }
        }
        return null;
      }
    });
    return (typeof up === 'string' && /^https?:/i.test(up)) ? up : srcUrl;
  } catch (e) { return srcUrl; }
}

const TOAST_MS = 6000;

// A toast that cannot be shown reads as one left alone: the page send stands.
async function toastForChoice(tabId, frameId, srcUrl) {
  try {
    return await injectThen(tabId, frameId, {
      files: ['lib/toast.js'],
      args: [srcUrl, TOAST_MS],
      func: (url, ttl) => self.ML.toast.show(url, ttl)
    });
  } catch (e) { return null; }
}

async function onMenuClick(info, tab) {
  if (info.menuItemId !== 'ml-send') return;
  const s = await ML.storage.getSettings();
  const cfg = ML.send.cfgOf(s);
  let target = await resolveMenuTarget(cfg, info);
  if (!target) return reportUnsupported();
  const file = target === info.srcUrl;
  if (s.baseUrl && tab && file) target = await largestForSrc(tab.id, info.frameId, info.srcUrl);
  if (s.baseUrl && tab && !file && target === info.pageUrl && /^https?:/i.test(info.srcUrl || '')) {
    // No ?wait, so the job id is in hand to cancel while the toast is up.
    // Recording waits for the choice, so a canceled job never counts.
    const out = await ML.send.sendOne(target, { wait: 0 });
    if (!out || !out.jobId) return recordSend(out);
    if ((await toastForChoice(tab.id, info.frameId, info.srcUrl)) !== 'image') return recordSend(out);
    // monloader's DELETE removes a finished job instead of canceling it, so
    // only a job still waiting or running is narrowed, and only a cancel
    // that took is followed by the file.
    const job = await ML.api.getJob(cfg, out.jobId);
    const settled = job.ok && job.data && job.data.status !== 'queued' && job.data.status !== 'running';
    if (settled) return recordSend(Object.assign({}, out, { outcome: ML.outcome.jobLine(job.data) }));
    if (!job.ok || !(await ML.api.remove(cfg, out.jobId)).ok) return recordSend(out);
    const up = await largestForSrc(tab.id, info.frameId, info.srcUrl);
    await sendUrl(up, { options: { pageUrl: info.pageUrl } });
    return;
  }
  await sendUrl(target, file ? { options: { pageUrl: info.pageUrl } } : undefined);
}
browser.contextMenus.onClicked.addListener(onMenuClick);
