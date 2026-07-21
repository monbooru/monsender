'use strict';
// Service worker (Chrome) / event page (Firefox). On Chrome the libs are pulled
// in with importScripts; on Firefox they are listed ahead of bg.js in
// background.scripts (build.js BG_SCRIPTS), so importScripts is undefined here
// and the guard is a no-op. Keep this list in sync with BG_SCRIPTS.
if (typeof importScripts === 'function') {
  try {
    importScripts(
      'vendor/browser-polyfill.js',
      'lib/storage.js', 'lib/api.js', 'lib/outcome.js', 'lib/urls.js',
      'lib/sites.js', 'lib/scan-core.js', 'lib/send.js'
    );
  } catch (e) { /* already loaded */ }
}

const ML = self.ML;

// Action badge after a send made without the popup. Text is the running count
// of items queued since the popup was last opened (the popup clears it), or "!"
// when nothing was queued so a skip/failure is still visible. Color carries the
// outcome kind.
const BADGE_COLOR = {
  created: '#22aa44',
  duplicate: '#6a6a82', skipped: '#6a6a82', canceled: '#6a6a82', done: '#6a6a82',
  failed: '#cc3333', unsupported: '#cc3333', down: '#cc3333', rejected: '#cc3333'
};
async function setBadge(kind, queued) {
  try {
    const cur = parseInt(await browser.action.getBadgeText({}), 10) || 0;
    const n = cur + (queued || 0);
    await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR[kind] || '#5c6bc0' });
    await browser.action.setBadgeText({ text: n > 0 ? String(n) : '!' });
  } catch (e) { /* action API unavailable */ }
}

async function sendUrl(url) {
  if (!url) return;
  if (!(await ML.send.isConfigured())) {
    try { await browser.runtime.openOptionsPage(); } catch (e) {}
    return;
  }
  const out = await ML.send.sendOne(url);
  if (out && out.configured) {
    if (out.jobId) {
      try { await ML.storage.addRecentJobIds([out.jobId]); } catch (e) {}
    }
    await setBadge(out.outcome.kind, out.jobId ? 1 : 0);
    await ML.storage.setLastResult(out.outcome);
    try { await browser.action.setTitle({ title: out.outcome.text }); } catch (e) {}
  }
  return out;
}

// The page-send paths (keyboard command, "send current page") gate on the same
// classification as the popup: when the URL is positively unsupported there is
// nothing for gallery-dl to fetch, so report that instead of enqueuing it. An
// undecidable result (the sites list could not be fetched) still sends, leaving
// monloader the authority. The pointed-image send is never gated.
async function sendPage(url) {
  if (!url) return;
  const s = await ML.storage.getSettings();
  if (s.baseUrl && (await ML.sites.sendKind({ baseUrl: s.baseUrl, token: s.token }, url)) === 'unsupported') {
    const out = { kind: 'unsupported', text: 'not a supported site or image', tone: 'warning' };
    await ML.storage.setLastResult(out);
    await setBadge(out.kind, 0);
    try { await browser.action.setTitle({ title: out.text }); } catch (e) {}
    return;
  }
  return sendUrl(url);
}

// Keyboard command: send the active tab. The command is a user
// gesture, so activeTab grants this tab's URL without the tabs permission.
async function sendActiveTab() {
  let tab;
  try { [tab] = await browser.tabs.query({ active: true, currentWindow: true }); } catch (e) {}
  if (tab && tab.url) await sendPage(tab.url);
}
browser.commands.onCommand.addListener((cmd) => { if (cmd === 'send-page') sendActiveTab(); });

// Page scan. The popup opens the chooser panel and messages here; the
// scan runs in the background so it survives the popup closing (opening the
// Firefox sidebar dismisses the popup). The panel reads the result from storage.
async function scanActiveTab() {
  let tab;
  try { [tab] = await browser.tabs.query({ active: true, currentWindow: true }); } catch (e) {}
  if (!tab) return;
  const s = await ML.storage.getSettings();
  let fin = { items: [], total: 0, shown: 0, truncated: false };
  try {
    const res = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/urls.js', 'lib/scan-core.js', 'lib/scan-run.js']
    });
    const raw = JSON.parse((res && res[0] && res[0].result) || '[]');
    fin = ML.scanCore.finalize(raw, { cap: s.scanCap, minSize: s.minImageSize });
  } catch (e) { /* restricted page or no access; store an empty scan */ }
  await ML.storage.setScan({
    tabId: tab.id, url: tab.url,
    items: fin.items, total: fin.total, shown: fin.shown, truncated: fin.truncated,
    previews: s.previews, at: Date.now()
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
const MENU = { send: 'ml-send' };

function createMenus() {
  try {
    browser.contextMenus.create({ id: MENU.send, title: 'Send to monloader', contexts: ['image', 'video'] });
  } catch (e) {}
}
function setupMenus() {
  Promise.resolve()
    .then(() => browser.contextMenus.removeAll())
    .then(createMenus)
    .catch(createMenus);
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
  return info.srcUrl;
}

// The context menu exposes only the rendered srcUrl, so a responsive image
// yields its downscaled variant. Look up the clicked image's largest srcset
// candidate in the page, under the gesture's activeTab grant; fall back to the
// rendered URL on any miss.
async function largestForSrc(tabId, frameId, srcUrl) {
  try {
    const [res] = await browser.scripting.executeScript({
      target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
      args: [srcUrl],
      func: (target) => {
        const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch (e) { return null; } };
        for (const img of document.querySelectorAll('img')) {
          if (img.currentSrc !== target && img.src !== target) continue;
          // a srcset entry wider than the displayed image, else the full src
          let best = null, bv = img.naturalWidth || 0;
          for (const part of (img.srcset || '').split(',')) {
            const seg = part.trim().split(/\s+/);
            const m = /^(\d+)w$/.exec(seg[1] || '');
            if (seg[0] && m && +m[1] > bv) { bv = +m[1]; best = seg[0]; }
          }
          const pick = best || img.src;
          return pick ? abs(pick) : null;
        }
        return null;
      }
    });
    const up = res && res.result;
    return (typeof up === 'string' && /^https?:/i.test(up)) ? up : srcUrl;
  } catch (e) { return srcUrl; }
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU.send) return;
  const s = await ML.storage.getSettings();
  let target = await resolveMenuTarget({ baseUrl: s.baseUrl, token: s.token }, info);
  if (s.baseUrl && tab && target === info.srcUrl) target = await largestForSrc(tab.id, info.frameId, info.srcUrl);
  await sendUrl(target);
});
