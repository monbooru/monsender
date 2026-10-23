(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).toast = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Runs in the page: injected into the active tab under activeTab, so it
  // reaches nothing privileged - no storage, no api, no token.

  // Built node by node, so no page string becomes markup. ui.css cannot
  // reach a shadow root, so monloader's palette tokens are copied here.
  const CSS =
    '.t{position:fixed;z-index:2147483647;background:#16161c;color:#e2e2e8;' +
    'border:1px solid #2a2a36;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;' +
    'padding:8px 10px 10px;white-space:nowrap;box-shadow:0 6px 24px rgba(0,0,0,.35)}' +
    '.r{display:flex;align-items:center;gap:8px}' +
    '.a{font:inherit;background:none;border:0;color:#9fa8da;' +
    'padding:0;cursor:pointer;white-space:nowrap}' +
    '.a:hover{text-decoration:underline}' +
    '.x{font:inherit;background:none;border:0;color:#8888a0;cursor:pointer;padding:0}' +
    '.l{position:absolute;left:0;bottom:0;height:2px;background:#5c6bc0;width:100%}';

  function show(target, ttl) {
    return new Promise((resolve) => {
      let anchor = null;
      for (const img of document.querySelectorAll('img')) {
        if (img.currentSrc === target || img.src === target) { anchor = img.getBoundingClientRect(); break; }
      }
      const host = document.createElement('div');
      // Closed, and deaf to synthetic clicks: page script must not be able to
      // make the choice for the user.
      const root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = CSS +
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
      // Positioned after insertion, once the box has a real size.
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
      act.addEventListener('click', (e) => { if (e.isTrusted) done('image'); });
      x.addEventListener('click', (e) => { if (e.isTrusted) done('dismiss'); });
    });
  }

  return { show };
});
