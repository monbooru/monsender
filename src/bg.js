'use strict';
// Service worker (Chrome) / event page (Firefox). On Chrome the libs are pulled
// in with importScripts; on Firefox they are listed ahead of bg.js in
// background.scripts (build.js BG_SCRIPTS), so importScripts is undefined here
// and the guard is a no-op. Keep this list in sync with BG_SCRIPTS.
if (typeof importScripts === 'function') {
  importScripts(
    'vendor/browser-polyfill.js',
    'lib/storage.js', 'lib/api.js', 'lib/outcome.js', 'lib/urls.js',
    'lib/sites.js', 'lib/scan-core.js', 'lib/send.js'
  );
}

const ML = self.ML;

// Action badge after a send made without the popup. Text is the running count
// of items queued since the popup was last opened (the popup clears it), or "!"
// when nothing was queued so a skip/failure is still visible. Color carries the
// outcome kind.
const BADGE_COLOR = {
  created: '#22aa44', queued: '#5c6bc0',
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

// Badge, "mine" ring, and action title for a settled send. Split out of sendUrl
// so a send whose fate is still open records only once its branch resolves.
async function recordSend(out) {
  if (!out || !out.configured) return out;
  if (out.jobId) {
    try { await ML.storage.addRecentJobIds([out.jobId]); } catch (e) {}
  }
  await setBadge(out.outcome.kind, out.jobId ? 1 : 0);
  try { await browser.action.setTitle({ title: out.outcome.text }); } catch (e) {}
  return out;
}

async function sendUrl(url, opts) {
  if (!url) return;
  if (!(await ML.send.isConfigured())) {
    try { await browser.runtime.openOptionsPage(); } catch (e) {}
    return;
  }
  return recordSend(await ML.send.sendOne(url, opts));
}

// Nothing for gallery-dl to fetch: report it rather than enqueuing.
async function reportUnsupported() {
  await setBadge('unsupported', 0);
  try { await browser.action.setTitle({ title: 'not a supported site or image' }); } catch (e) {}
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
  let blocked = false;
  try {
    const res = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/urls.js', 'lib/scan-core.js', 'lib/scan-run.js']
    });
    const raw = JSON.parse((res && res[0] && res[0].result) || '[]');
    fin = ML.scanCore.finalize(raw, { cap: s.scanCap, minSize: s.minImageSize });
  } catch (e) {
    // Injection refused (a browser page, the add-on store, a PDF viewer). The
    // scan never ran, which is a different answer from an image-free page.
    blocked = true;
  }
  await ML.storage.setScan({
    tabId: tab.id, url: tab.url,
    items: fin.items, total: fin.total, shown: fin.shown, truncated: fin.truncated,
    blocked, previews: s.previews, at: Date.now()
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
  } catch (e) {}
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
          const pick = self.ML.scanCore.bestUrl(img);
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
// like the scan; renders into a shadow root, executes no page strings, and
// resolves 'image', 'dismiss', or null on timeout. The countdown bar is the
// only accent line so nothing static reads as remaining time.
const TOAST_MS = 6000;

async function toastForChoice(tabId, frameId, srcUrl) {
  try {
    const [res] = await browser.scripting.executeScript({
      target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
      args: [srcUrl, TOAST_MS],
      func: (target, ttl) => new Promise((resolve) => {
        let anchor = null;
        for (const img of document.querySelectorAll('img')) {
          if (img.currentSrc === target || img.src === target) { anchor = img.getBoundingClientRect(); break; }
        }
        const host = document.createElement('div');
        const root = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent =
          '.t{position:fixed;z-index:2147483647;background:#1b1d27;color:#c8cadb;' +
          'border:1px solid #2c2f3f;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;' +
          'padding:8px 10px 10px;white-space:nowrap;box-shadow:0 6px 24px rgba(0,0,0,.35)}' +
          '.r{display:flex;align-items:center;gap:8px}' +
          '.a{font:inherit;background:none;border:0;color:#aab2e8;' +
          'padding:0;cursor:pointer;white-space:nowrap}' +
          '.a:hover{text-decoration:underline}' +
          '.x{font:inherit;background:none;border:0;color:#6a6a82;cursor:pointer;padding:0}' +
          '.l{position:absolute;left:0;bottom:0;height:2px;background:#5c6bc0;width:100%}' +
          '.l.run{transition:width ' + ttl + 'ms linear;width:0}' +
          '@media (prefers-reduced-motion:reduce){.l.run{transition:none}}';
        const box = document.createElement('div');
        box.className = 't';
        const row = document.createElement('div'); row.className = 'r';
        const msg = document.createElement('span'); msg.textContent = 'sent the post page';
        const act = document.createElement('button'); act.className = 'a'; act.textContent = '[only this image]';
        const x = document.createElement('button'); x.className = 'x'; x.textContent = '[x]';
        x.setAttribute('aria-label', 'dismiss');
        const life = document.createElement('span'); life.className = 'l';
        row.append(msg, act, x); box.append(row, life);
        root.append(style, box);
        document.documentElement.appendChild(host);
        // Position after insertion so the box's real size is known. A large
        // image can sit mostly off-screen, so anchor to its visible part and
        // clamp into the viewport; an image scrolled fully out falls back to
        // the corner.
        let left = null, top = null;
        if (anchor) {
          const vl = Math.max(anchor.left, 0), vr = Math.min(anchor.right, innerWidth);
          const vt = Math.max(anchor.top, 0), vb = Math.min(anchor.bottom, innerHeight);
          if (vr > vl && vb > vt) { left = vl + 6; top = vb - box.offsetHeight - 6; }
        }
        if (left == null) {
          left = innerWidth - box.offsetWidth - 16;
          top = innerHeight - box.offsetHeight - 16;
        }
        box.style.left = Math.min(Math.max(8, left), innerWidth - box.offsetWidth - 8) + 'px';
        box.style.top = Math.min(Math.max(8, top), innerHeight - box.offsetHeight - 8) + 'px';
        requestAnimationFrame(() => life.classList.add('run'));
        const done = (v) => { clearTimeout(timer); host.remove(); resolve(v); };
        const timer = setTimeout(() => done(null), ttl);
        act.addEventListener('click', () => done('image'));
        x.addEventListener('click', () => done('dismiss'));
      })
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
