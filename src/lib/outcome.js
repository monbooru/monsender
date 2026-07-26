(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).outcome = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // monloader's stable error_code vocabulary -> short actionable phrases.
  // Never invent codes.
  const ERROR_PHRASES = {
    unsupported_url: 'not a supported site (no extractor)',
    auth_required: 'needs login/cookies for this site (set in monloader)',
    blocked: 'blocked by bot protection',
    rate_limited: 'rate limited, try later',
    download_failed: 'download failed',
    mapping_failed: 'could not map metadata',
    file_too_large: 'file too large',
    monbooru_unreachable: 'monbooru unreachable',
    monbooru_rejected: 'monbooru rejected the upload',
    canceled: 'canceled'
  };

  function errorPhrase(code) {
    return ERROR_PHRASES[code] || code || 'failed';
  }

  function firstItemField(job, field) {
    const hit = ((job && job.items) || []).find((it) => it && it[field]);
    return hit ? hit[field] : null;
  }

  // Map a resolved single-send job to one line. job === null means
  // the wait timed out (202): the caller shows "queued" and polls.
  function singleOutcome(job) {
    if (!job) return { kind: 'queued', text: 'queued', tone: 'accent' };
    const s = job.summary || {};
    if ((s.total === 0 || !s.total) && job.error_code && !(s.created || s.duplicate || s.skipped)) {
      return { kind: 'failed', text: 'failed - ' + errorPhrase(job.error_code), tone: 'error' };
    }
    if ((s.created || 0) >= 1) {
      if (job.capped) return { kind: 'created', text: 'added, more available', tone: 'warning' };
      const id = firstItemField(job, 'monbooru_id');
      return { kind: 'created', text: id ? 'added -> monbooru #' + id : 'added', tone: 'success' };
    }
    if ((s.duplicate || 0) >= 1) return { kind: 'duplicate', text: 'already in your library', tone: 'dim' };
    if ((s.skipped || 0) >= 1) return { kind: 'skipped', text: 'already fetched (archive)', tone: 'dim' };
    if ((s.failed || 0) >= 1) {
      const code = firstItemField(job, 'error_code') || job.error_code;
      return { kind: 'failed', text: 'failed - ' + errorPhrase(code), tone: 'error' };
    }
    if ((s.canceled || 0) >= 1) return { kind: 'canceled', text: 'canceled', tone: 'dim' };
    return { kind: 'done', text: 'nothing to add', tone: 'dim' };
  }

  // Live progress for a running job, derived from the per-item status the queue
  // exposes. The download pass is the slow part and advances each item to
  // `downloaded` as its file lands, so count items that have left `pending`
  // (downloaded, pushed, or terminally skipped/failed) rather than only the
  // fully-finished ones, which would sit at 0 through the whole download.
  // Empty until the resolve pass has populated the item list.
  function runningProgress(job) {
    const items = (job && job.items) || [];
    if (!items.length) return '';
    const moved = items.filter((it) => it && it.status && it.status !== 'pending').length;
    return moved + '/' + items.length;
  }

  // monloader's summary counts, in the order a row shows them. Both the row
  // text and the series sum read this, so they cannot drift apart.
  const COUNT_LABELS = { created: 'new', duplicate: 'dup', skipped: 'skip', failed: 'fail', canceled: 'cancel' };

  // Terse per-row counts for a finished queue job: every nonzero outcome,
  // so an all-skipped or partly-canceled job is not blank.
  function queueSummary(job) {
    const s = (job && job.summary) || {};
    return Object.keys(COUNT_LABELS).filter((k) => s[k]).map((k) => s[k] + ' ' + COUNT_LABELS[k]).join(' ');
  }

  function addSummary(a, b) {
    const out = {};
    for (const k of [...Object.keys(COUNT_LABELS), 'total']) out[k] = ((a && a[k]) || 0) + ((b && b[k]) || 0);
    return out;
  }

  // Collapse a continue-series (a capped search and its continuations, which
  // share `root`) into one entry: the newest window leads (the list is
  // newest-first), with counts summed across the windows and the member ids so
  // a row can act on the whole series. A standalone job is its own series.
  function groupSeries(jobs) {
    const groups = [];
    const at = new Map();
    for (const j of jobs || []) {
      const root = j.root || j.id;
      if (at.has(root)) {
        const g = groups[at.get(root)];
        g.summary = addSummary(g.summary, j.summary);
        g.members.push(j.id);
      } else {
        at.set(root, groups.length);
        groups.push(Object.assign({}, j, { summary: addSummary({}, j.summary), members: [j.id] }));
      }
    }
    return groups;
  }

  // Map the connectivity probe to monloader's dot states.
  function connState(healthResult, authedResult) {
    if (!healthResult || healthResult.networkError || healthResult.status === 0) return 'down';
    if (authedResult && authedResult.status === 401) return 'rejected';
    if (healthResult.ok) return 'ok';
    return 'down';
  }

  return { ERROR_PHRASES, errorPhrase, singleOutcome, runningProgress, queueSummary, groupSeries, connState };
});
