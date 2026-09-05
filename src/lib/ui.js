(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).ui = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;
  function ns() { return G.ML; }

  // The pieces every extension page needs, in one place so the popup, the side
  // panel, and the options page cannot drift apart.

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
    down: 'unreachable'
  };

  function connLabel(state) { return CONN_LABEL[state] || CONN_LABEL.down; }

  // Reachability plus one authed call, since monloader may require a token we
  // do not hold. The health body rides along for the version line.
  async function probe(cfg) {
    const health = await ns().api.health(cfg);
    const authed = await ns().api.listQueue(cfg, { limit: 1 });
    const state = ns().outcome.connState(health, authed);
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

  return { $, setConn, connLabel, probe, onActivate, setActionEnabled, openQueue };
});
