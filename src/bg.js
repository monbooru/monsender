'use strict';
// Service worker (Chrome) / event page (Firefox). On Chrome the libs are pulled
// in with importScripts; on Firefox they are listed ahead of bg.js in
// background.scripts (build.js BG_SCRIPTS), so importScripts is undefined here
// and the guard is a no-op. Keep this list in sync with BG_SCRIPTS.
if (typeof importScripts === 'function') {
  importScripts(
    'lib/browser.js',
    'lib/storage.js', 'lib/api.js', 'lib/outcome.js', 'lib/urls.js',
    'lib/sites.js', 'lib/scan-core.js', 'lib/send.js'
  );
}

const ML = self.ML;

// Action badge after a send made without the popup. Text is the running count
// of items queued since the popup was last opened (the popup clears it), or
// "!" when the send queued nothing, so a skip or a failure shows whatever the
// count already stood at. Color carries the outcome kind.
async function setBadge(kind, queued) {
  try {
    await browser.action.setBadgeBackgroundColor({ color: ML.outcome.badgeColor(kind) });
    if (!queued) return browser.action.setBadgeText({ text: '!' });
    const cur = parseInt(await browser.action.getBadgeText({}), 10) || 0;
    await browser.action.setBadgeText({ text: String(cur + queued) });
  } catch (e) { /* action API unavailable */ }
}

// Badge, "mine" ring, and action title for a settled send. Split out of sendUrl
// so a send whose fate is still open records only once its branch resolves.
async function recordSend(out) {
  if (!out || !out.configured) return out;
  if (out.jobId) {
    try { await ML.storage.addRecentJobIds([out.jobId]); } catch (e) { /* the ring is a nicety */ }
  }
  await setBadge(out.outcome.kind, out.jobId ? 1 : 0);
  try { await browser.action.setTitle({ title: out.outcome.text }); } catch (e) { /* action API unavailable */ }
  return out;
}

async function sendUrl(url, opts) {
  if (!url) return;
  if (!(await ML.send.isConfigured())) {
    try { await browser.runtime.openOptionsPage(); } catch (e) { /* nothing else to offer */ }
    return;
  }
  return recordSend(await ML.send.sendOne(url, opts));
}

// Nothing for gallery-dl to fetch: report it rather than enqueuing.
async function reportUnsupported() {
  await setBadge('unsupported', 0);
  try { await browser.action.setTitle({ title: 'not a supported site or image' }); } catch (e) { /* action API unavailable */ }
}

// The page-send paths (keyboard command, "send current page") gate on the same
// classification as the popup. An undecidable result (the sites list could not
// be fetched) still sends, leaving monloader the authority. The pointed-image
// send is never gated.
async function sendPage(url) {
  if (!url) return;
  const s = await ML.storage.getSettings();
  if (s.baseUrl && (await ML.sites.sendKind(ML.send.cfgOf(s), url)) === 'unsupported') {
    return reportUnsupported();
  }
  return sendUrl(url);
}

// The tab a gesture is about. activeTab grants this tab's URL for that
// gesture without the tabs permission; a window with nothing in it, or a
// refused query, yields null and each caller says what that means.
async function activeTab() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (e) { return null; }
}

// Keyboard command: send the active tab. A browser page or the add-on store
// yields no URL at all; report that rather than leaving the shortcut looking
// broken.
async function sendActiveTab() {
  const tab = await activeTab();
  if (tab && tab.url) return sendPage(tab.url);
  return reportUnsupported();
}
browser.commands.onCommand.addListener((cmd) => { if (cmd === 'send-page') sendActiveTab(); });

// Page scan. The popup opens the chooser panel and messages here; the
// scan runs in the background so it survives the popup closing (opening the
// Firefox sidebar dismisses the popup). The panel reads the result from storage.
async function scanActiveTab() {
  // Without a tab there is nothing to scan; the panel keeps the last result.
  const tab = await activeTab();
  if (!tab) return;
  const s = await ML.storage.getSettings();
  let fin = { items: [], total: 0, shown: 0, truncated: false };
  let blocked = false;
  let incomplete = false;
  try {
    const res = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/urls.js', 'lib/scan-core.js', 'lib/scan-run.js']
    });
    const raw = JSON.parse((res && res[0] && res[0].result) || '{}');
    incomplete = !!raw.incomplete;
    fin = ML.scanCore.finalize(raw.items || [], { cap: s.scanCap, minSize: s.minImageSize });
  } catch (e) {
    // Injection refused (a browser page, the add-on store, a PDF viewer). The
    // scan never ran, which is a different answer from an image-free page.
    blocked = true;
  }
  await ML.storage.setScan({
    url: tab.url,
    items: fin.items, total: fin.total, shown: fin.shown, truncated: fin.truncated,
    incomplete, blocked, previews: s.previews
  });
}
browser.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'scan') scanActiveTab();
  else if (msg.type === 'queued') setBadge('queued', msg.count || 0);
});

// Context menu: one entry on an image or video. It resolves the best target for
// the click - a supported linked post (tagged), else the supported page
// (tagged), else the raw file - so the click is always sendable.
async function setupMenus() {
  // A failing removeAll must not stop the entry being created.
  try { await browser.contextMenus.removeAll(); } catch (e) {}
  try {
    browser.contextMenus.create({ id: 'ml-send', title: 'Send to monloader', contexts: ['image', 'video'] });
  } catch (e) { /* a duplicate id on a re-run of onInstalled */ }
}
browser.runtime.onInstalled.addListener(setupMenus);
browser.runtime.onStartup.addListener(setupMenus);

// Prefer a linked post, then the page, over the raw file, which carries no tags.
// A file link ('image') and a positively unlisted host ('unknown') lose to the
// file; a 'blind' result (no sites list) does not - if the page is a booru its
// file is likely an unfetchable CDN link, and if not, monloader judges it. With
// monloader unset or nothing better pointed at, the raw file.
async function resolveMenuTarget(cfg, info) {
  if (cfg.baseUrl) {
    for (const cand of [info.linkUrl, info.pageUrl]) {
      if (!cand) continue;
      const kind = await ML.sites.sendKind(cfg, cand);
      if (kind === 'supported' || kind === 'blind') return cand;
    }
  }
  // A data: or blob: image has no URL monloader can fetch, and a data: body
  // would carry the whole payload over for a certain rejection.
  return /^https?:/i.test(info.srcUrl || '') ? info.srcUrl : null;
}

// The context menu exposes only the rendered srcUrl, so a responsive image
// yields its downscaled variant. Look the clicked image up in the page, under
// the gesture's activeTab grant, and apply the scan's own rule to it: the two
// paths would otherwise each carry a copy of it and drift. A func: body cannot
// close over module scope, so scan-core is injected by file first - both calls
// land in the same isolated world, so the namespace is there for the second.
// Fall back to the rendered URL on any miss.
async function largestForSrc(tabId, frameId, srcUrl) {
  const target = frameId != null ? { tabId, frameIds: [frameId] } : { tabId };
  try {
    await browser.scripting.executeScript({ target, files: ['lib/urls.js', 'lib/scan-core.js'] });
    const [res] = await browser.scripting.executeScript({
      target,
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
    const up = res && res.result;
    return (typeof up === 'string' && /^https?:/i.test(up)) ? up : srcUrl;
  } catch (e) { return srcUrl; }
}

// A short-lived toast next to the clicked image, offering to narrow a page
// send to the pointed file. Injected under the same gesture's activeTab grant
// like the scan: the module is loaded by file, then called, since a func: body
// cannot close over module scope.
const TOAST_MS = 6000;

async function toastForChoice(tabId, frameId, srcUrl) {
  const target = frameId != null ? { tabId, frameIds: [frameId] } : { tabId };
  try {
    await browser.scripting.executeScript({ target, files: ['lib/toast.js'] });
    const [res] = await browser.scripting.executeScript({
      target,
      args: [srcUrl, TOAST_MS],
      func: (url, ttl) => self.ML.toast.show(url, ttl)
    });
    return res && res.result;
  } catch (e) { return null; }
}

async function onMenuClick(info, tab) {
  if (info.menuItemId !== 'ml-send') return;
  const s = await ML.storage.getSettings();
  const cfg = ML.send.cfgOf(s);
  let target = await resolveMenuTarget(cfg, info);
  if (!target) return reportUnsupported();
  // A raw-file send carries the page it sat on, so monloader can record a
  // source a person can revisit instead of the bare file URL.
  const file = target === info.srcUrl;
  if (s.baseUrl && tab && file) target = await largestForSrc(tab.id, info.frameId, info.srcUrl);
  if (s.baseUrl && tab && !file && target === info.pageUrl && info.srcUrl) {
    // The page won but the pointer sat on an image. Send without ?wait so the
    // job id is in hand (and cancelable) while the toast is up; the badge and
    // the "mine" ring wait for the choice, so a canceled job never counts.
    const out = await ML.send.sendOne(target, { wait: 0 });
    if (!out || !out.jobId) return recordSend(out);
    if ((await toastForChoice(tab.id, info.frameId, info.srcUrl)) !== 'image') return recordSend(out);
    await ML.api.remove(cfg, out.jobId);
    const up = await largestForSrc(tab.id, info.frameId, info.srcUrl);
    await sendUrl(up, { options: { pageUrl: info.pageUrl } });
    return;
  }
  await sendUrl(target, file ? { options: { pageUrl: info.pageUrl } } : undefined);
}
browser.contextMenus.onClicked.addListener(onMenuClick);
