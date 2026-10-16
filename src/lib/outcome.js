(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else (root.ML = root.ML || {}).outcome = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Keys are monloader's error_code values; never invent one. Exported for
  // the tests, which hold the table to monloader's whole vocabulary.
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

  function isArchiveSkip(s) {
    return !!s && (s.archived > 0 || (s.archived === undefined && s.skipped > 0));
  }

  function singleOutcome(job) {
    if (!job) return { kind: 'queued', text: 'queued', tone: 'accent' };
    const s = job.summary || {};
    if (!s.total && job.error_code && !(s.created || s.duplicate || s.skipped)) {
      return { kind: 'failed', text: 'failed - ' + errorPhrase(job.error_code), tone: 'error' };
    }
    if ((s.created || 0) >= 1) {
      if (job.capped) return { kind: 'created', text: 'added, more available', tone: 'warning' };
      const id = firstItemField(job, 'monbooru_id');
      return { kind: 'created', text: id ? 'added -> monbooru #' + id : 'added', tone: 'success' };
    }
    if ((s.duplicate || 0) >= 1) return { kind: 'duplicate', text: 'already in your library', tone: 'dim' };
    if (isArchiveSkip(s)) return { kind: 'skipped', text: 'already fetched (archive)', tone: 'dim' };
    if ((s.skipped || 0) >= 1) return { kind: 'skipped', text: ERROR_PHRASES.wrong_type, tone: 'dim' };
    if ((s.failed || 0) >= 1) {
      const code = firstItemField(job, 'error_code') || job.error_code;
      return { kind: 'failed', text: 'failed - ' + errorPhrase(code), tone: 'error' };
    }
    if ((s.canceled || 0) >= 1) return { kind: 'canceled', text: 'canceled', tone: 'dim' };
    return { kind: 'done', text: 'nothing to add', tone: 'dim' };
  }

  // monloader's codes for an enqueue it refuses outright.
  const REFUSALS = {
    monbooru_unconfigured: 'monloader has no monbooru set up',
    monbooru_paused: 'monloader\'s monbooru link is paused',
    api_disabled: 'not paired yet - connect to monloader in options',
    setup_required: 'monloader\'s first-run setup is not finished'
  };

  function enqueueOutcome(result, tokenHeld) {
    if (result.networkError || result.status === 0) {
      return { kind: 'down', text: 'monloader unreachable', tone: 'error' };
    }
    if (result.status === 401) {
      return tokenHeld ? { kind: 'rejected', text: 'monloader rejected the token', tone: 'error' }
        : { kind: 'failed', text: REFUSALS.api_disabled, tone: 'error' };
    }
    if (result.status === 200) return singleOutcome(result.data);
    if (result.status === 202) return singleOutcome(null);
    const refusal = REFUSALS[result.data && result.data.code];
    return { kind: 'failed', text: refusal || 'send failed (HTTP ' + result.status + ')', tone: 'error' };
  }

  const BADGE_COLOR = {
    created: '#22aa44', queued: '#5c6bc0',
    duplicate: '#8888a0', skipped: '#8888a0', canceled: '#8888a0', done: '#8888a0',
    failed: '#cc3333', unsupported: '#cc3333', down: '#cc3333', rejected: '#cc3333',
    partial: '#ffaa00', interrupted: '#ffaa00'
  };

  function badgeColor(kind) { return BADGE_COLOR[kind] || BADGE_COLOR.queued; }

  // Counts items past pending: the download pass moves each to
  // `downloaded` as it lands, while a finished count sits at 0 throughout.
  function runningProgress(job) {
    const items = (job && job.items) || [];
    if (!items.length) return '';
    const moved = items.filter((it) => it && it.status && it.status !== 'pending').length;
    return moved + '/' + items.length;
  }

  // Not singleOutcome alone: it lets `created` win over `failed`, hiding
  // a partial's failures.
  function jobLine(job) {
    const j = job || {};
    if (j.status === 'running' || j.status === 'queued') {
      const p = runningProgress(j);
      return { kind: j.status, text: p ? j.status + ' ' + p : j.status, tone: 'accent' };
    }
    if (j.status === 'partial') {
      return { kind: 'partial', text: queueSummary(j) || 'partial', tone: 'warning' };
    }
    if (j.status === 'interrupted' && !(j.summary && j.summary.total)) {
      return { kind: 'interrupted', text: 'interrupted - contents unknown', tone: 'warning' };
    }
    return singleOutcome(j);
  }

  function jobCounts(job) {
    const j = job || {};
    if (j.status === 'queued') return '';
    if (j.status === 'running') return runningProgress(j);
    return queueSummary(j);
  }

  // Key order is the order a row shows. The queue also carries
  // monbooru-driven jobs, so their outcomes are here too.
  const COUNT_LABELS = {
    created: 'new', duplicate: 'dup', enriched: 'enrich', replaced: 'replace',
    matched: 'match', skipped: 'skip', archived: 'archived', failed: 'fail', canceled: 'cancel'
  };

  // `archived` is part of `skipped`: it prints only when it is all of it
  // or `skipped` is absent. Unknown keys show under their own name.
  function queueSummary(job) {
    const s = (job && job.summary) || {};
    let keys = Object.keys(s).filter((k) => k !== 'total' && typeof s[k] === 'number' && s[k] > 0);
    if (s.skipped !== undefined && s.archived !== s.skipped) keys = keys.filter((k) => k !== 'archived');
    keys.sort((a, b) => order(a) - order(b));
    return keys.map((k) => s[k] + ' ' + (COUNT_LABELS[k] || k)).join(' ');
  }

  const COUNT_ORDER = Object.keys(COUNT_LABELS);
  const order = (k) => (COUNT_ORDER.includes(k) ? COUNT_ORDER.indexOf(k) : COUNT_ORDER.length);

  function addSummary(a, b) {
    const out = {};
    const keys = new Set([...Object.keys(COUNT_LABELS), 'total',
      ...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) out[k] = ((a && a[k]) || 0) + ((b && b[k]) || 0);
    return out;
  }

  // A capped search and its continuations share `root`. The list must be
  // newest-first so the newest window leads.
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

  // A monloader with no token set answers 503 api_disabled on every
  // authed call, and one with tokens answers 401 to a client holding none:
  // either way reachable, but not paired. A desktop monloader still in its
  // first-run setup answers 409 setup_required to every API call.
  function connState(healthResult, authedResult, tokenHeld) {
    if (!healthResult || healthResult.networkError || healthResult.status === 0) return 'down';
    if (authedResult && authedResult.status === 401) return tokenHeld ? 'rejected' : 'unpaired';
    if (authedResult && authedResult.status === 503
        && authedResult.data && authedResult.data.code === 'api_disabled') return 'unpaired';
    if (authedResult && authedResult.status === 409
        && authedResult.data && authedResult.data.code === 'setup_required') return 'setup';
    if (healthResult.ok) return 'ok';
    return 'down';
  }

  return { ERROR_PHRASES, isArchiveSkip, singleOutcome, enqueueOutcome, jobLine, jobCounts, badgeColor, runningProgress, queueSummary, groupSeries, connState };
});
