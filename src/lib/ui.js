(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).ui = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  const $ = (id) => document.getElementById(id);

  function setConn(state, label) {
    const el = $('conn');
    el.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'dot dot-' + state;
    const txt = document.createElement('span');
    txt.textContent = ' ' + label;
    el.appendChild(dot);
    el.appendChild(txt);
  }

  const CONN_LABEL = {
    ok: 'connected',
    rejected: 'token rejected',
    unpaired: 'not paired yet',
    setup: 'setup not finished',
    down: 'unreachable'
  };

  function connLabel(state) { return CONN_LABEL[state] || CONN_LABEL.down; }

  // Plus one authed call: /health answers without a token, so alone it
  // cannot tell a rejected or missing one.
  async function probe(cfg) {
    const health = await ns().api.health(cfg);
    const authed = await ns().api.listQueue(cfg, { limit: 1 });
    const state = ns().outcome.connState(health, authed, !!cfg.token);
    return { state, label: connLabel(state), health };
  }

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
    browser.tabs.create({ url: cfg.baseUrl + '/queue' }).catch(() => { /* a convenience link: a refusal has nowhere to show */ });
    if (closeAfter) window.close();
  }

  return { $, setConn, connLabel, probe, onActivate, setActionEnabled, openQueue };
});
