(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).ui = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const api = node ? require('./api.js') : (self.ML && self.ML.api);
  const outcome = node ? require('./outcome.js') : (self.ML && self.ML.outcome);

  // The pieces every extension page needs. The popup, the side panel, and the
  // options page each carried their own copy of the connection indicator and
  // of these handlers, and the copies had begun to disagree.

  const $ = (id) => document.getElementById(id);

  function setConn(el, state, label) {
    el.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'dot dot-' + state;
    const txt = document.createElement('span');
    txt.textContent = ' ' + label;
    el.appendChild(dot);
    el.appendChild(txt);
  }

  function connLabel(state) {
    return state === 'ok' ? 'connected' : (state === 'rejected' ? 'token rejected' : 'unreachable');
  }

  // Reachability plus one authed call, since monloader may require a token we
  // do not hold. The health body rides along for the version line.
  async function probe(cfg) {
    const health = await api.health(cfg);
    const authed = await api.listQueue(cfg, { limit: 1 });
    const state = outcome.connState(health, authed);
    return { state, label: connLabel(state), health };
  }

  // Bracketed text acts as a button, so it answers the keyboard too. A control
  // marked aria-disabled ignores both.
  function onActivate(el, fn) {
    const go = () => { if (el.getAttribute('aria-disabled') !== 'true') fn(); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  }

  function setActionEnabled(el, on) {
    el.classList.toggle('disabled', !on);
    el.setAttribute('aria-disabled', String(!on));
  }

  function openQueue(cfg, closeAfter) {
    if (!cfg.baseUrl) return;
    browser.tabs.create({ url: cfg.baseUrl + '/queue' });
    if (closeAfter) window.close();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return { $, setConn, connLabel, probe, onActivate, setActionEnabled, openQueue, sleep };
});
