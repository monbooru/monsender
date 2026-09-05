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
    network_unreachable: 'could not reach the site',
    download_failed: 'download failed',
    mapping_failed: 'could not map metadata',
    file_too_large: 'file too large',
    hash_mismatch: 'the file changed while downloading',
    monbooru_unreachable: 'monbooru unreachable',
    monbooru_rejected: 'monbooru rejected the upload',
    canceled: 'canceled',
    // Refusals of a monbooru-driven replace or lookup, which share the queue.
    already_exists: 'that file is already another image',
    wrong_type: 'monbooru does not take this file type',
    hash_not_found: 'no match for that hash',
    ptr_unavailable: 'the tag repository is unavailable',
    ptr_account_required: 'the tag repository needs an account',
    ptr_banned: 'the tag repository refused this account',
    ptr_syncing: 'the tag repository is still syncing'
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

  // One enqueue result -> a { kind, text, tone } line. A network failure and a
  // 401 get their own kinds so no caller has to inspect the raw result.
  function enqueueOutcome(result) {
    if (result.networkError || result.status === 0) {
      return { kind: 'down', text: 'monloader unreachable', tone: 'error' };
    }
    if (result.status === 401) {
      return { kind: 'rejected', text: 'monloader rejected the token', tone: 'error' };
    }
    if (result.status === 200) return singleOutcome(result.data);
    if (result.status === 202) return singleOutcome(null); // wait timed out: the job is queued
    return { kind: 'failed', text: 'send failed (HTTP ' + result.status + ')', tone: 'error' };
  }

  // The whole kind vocabulary, as the action badge colors it: the job kinds
  // above, the two transport kinds, and the send gate's 'unsupported'.
  const BADGE_COLOR = {
    created: '#22aa44', queued: '#5c6bc0',
    duplicate: '#6a6a82', skipped: '#6a6a82', canceled: '#6a6a82', done: '#6a6a82',
    failed: '#cc3333', unsupported: '#cc3333', down: '#cc3333', rejected: '#cc3333'
  };

  function badgeColor(kind) { return BADGE_COLOR[kind] || BADGE_COLOR.queued; }

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

  // One line for a queue job in any state, which singleOutcome alone cannot
  // give: it reads a settled job, and lets `created` win over `failed`, which
  // hides a partial's failures. A running or queued job says so with its
  // progress, and a partial spells its counts out.
  function jobLine(job) {
    const j = job || {};
    if (j.status === 'running' || j.status === 'queued') {
      const p = runningProgress(j);
      return { kind: j.status, text: p ? j.status + ' ' + p : j.status, tone: 'accent' };
    }
    if (j.status === 'partial') {
      return { kind: 'partial', text: queueSummary(j) || 'partial', tone: 'warning' };
    }
    return singleOutcome(j);
  }

  // The terse counts a queue row shows beside its status: nothing while it is
  // queued, live progress while it runs, the outcome counts once it settles.
  function jobCounts(job) {
    const j = job || {};
    if (j.status === 'queued') return '';
    if (j.status === 'running') return runningProgress(j);
    return queueSummary(j);
  }

  // monloader's summary counts, in the order a row shows them. Both the row
  // text and the series sum read this, so they cannot drift apart. The
  // queue carries monbooru-driven jobs too (metadata, lookup, replace,
  // ptr_lookup), so the set is the whole documented contract rather than
  // the outcomes a monsender-initiated download produces.
  const COUNT_LABELS = {
    created: 'new', duplicate: 'dup', enriched: 'enrich', replaced: 'replace',
    matched: 'match', skipped: 'skip', archived: 'archived', failed: 'fail', canceled: 'cancel'
  };

  // Terse per-row counts for a finished queue job: every nonzero outcome,
  // so an all-skipped or partly-canceled job is not blank. A key monloader
  // adds later still shows, under its own name, rather than vanishing until
  // the label table catches up. `archived` is a subset of `skipped`, so it
  // only prints when it is the whole of it - or when there is no `skipped`
  // beside it to be part of.
  function queueSummary(job) {
    const s = (job && job.summary) || {};
    let keys = Object.keys(s).filter((k) => k !== 'total' && typeof s[k] === 'number' && s[k] > 0);
    if (s.skipped !== undefined && s.archived !== s.skipped) keys = keys.filter((k) => k !== 'archived');
    keys.sort((a, b) => order(a) - order(b));
    return keys.map((k) => s[k] + ' ' + (COUNT_LABELS[k] || k)).join(' ');
  }

  // Documented keys lead in their table order; anything newer trails.
  const COUNT_ORDER = Object.keys(COUNT_LABELS);
  const order = (k) => (COUNT_ORDER.includes(k) ? COUNT_ORDER.indexOf(k) : COUNT_ORDER.length);

  function addSummary(a, b) {
    const out = {};
    const keys = new Set([...Object.keys(COUNT_LABELS), 'total',
      ...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) out[k] = ((a && a[k]) || 0) + ((b && b[k]) || 0);
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

  // Map the connectivity probe to monloader's dot states. A monloader with no
  // token configured answers 503 api_disabled on every authed endpoint, which
  // is the state a user sits in between saving the URL and pairing: it is
  // reachable, so neither "connected" nor "unreachable" is true of it.
  function connState(healthResult, authedResult) {
    if (!healthResult || healthResult.networkError || healthResult.status === 0) return 'down';
    if (authedResult && authedResult.status === 401) return 'rejected';
    if (authedResult && authedResult.status === 503
        && authedResult.data && authedResult.data.code === 'api_disabled') return 'unpaired';
    if (healthResult.ok) return 'ok';
    return 'down';
  }

  return { ERROR_PHRASES, singleOutcome, enqueueOutcome, jobLine, jobCounts, badgeColor, runningProgress, queueSummary, groupSeries, connState };
});
