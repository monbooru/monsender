'use strict';
// Build the per-browser extension bundles from src/.
//
// Chrome and Firefox MV3 differ in three places: the
// background type, the side-panel mechanism, and the Firefox gecko id. The
// base manifest in src/manifest.json holds the common fields; buildManifest()
// applies the per-target patches. It is exported so the permission-audit test
// can check the generated manifests without a build.

const fs = require('fs');
const path = require('path');
const { zipDir } = require('./tools/pack.js');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const TARGETS = ['chrome', 'firefox'];

// The background's dependency list. Chrome's service worker pulls these in with
// importScripts inside bg.js; Firefox's event page has no importScripts, so the
// same list (alias first, bg.js last) is loaded via background.scripts. Keep
// this in sync with the importScripts call in src/bg.js.
const BG_SCRIPTS = [
  'lib/browser.js',
  'lib/storage.js', 'lib/api.js', 'lib/outcome.js', 'lib/urls.js',
  'lib/sites.js', 'lib/scan-core.js', 'lib/send.js',
  'bg.js'
];

function readVersion() {
  const v = fs.readFileSync(path.join(ROOT, 'VERSION.md'), 'utf8');
  return v.trim().replace(/^v/, '');
}

function buildManifest(target, version) {
  const base = path.join(SRC, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(base, 'utf8'));
  m.version = version;
  if (target === 'chrome') {
    m.permissions = [...m.permissions, 'sidePanel'];
    m.background = { service_worker: 'bg.js' };
    m.side_panel = { default_path: 'panel/panel.html' };
  } else if (target === 'firefox') {

    m.background = { scripts: BG_SCRIPTS };
    m.sidebar_action = {
      default_panel: 'panel/panel.html',
      default_title: 'monsender',
      default_icon: m.icons,
      // Do not pop the sidebar open on load; it opens only when the user scans
      // (Firefox defaults open_at_install to true).
      open_at_install: false
    };
    m.browser_specific_settings = {

      gecko: {
        id: 'monsender@leqwin',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'], optional: [] }
      }
    };
    // Lint note: web-ext reports one advisory warning
    // (KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION) because Firefox for
    // Android has not yet implemented data_collection_permissions. The
    // extension is desktop-oriented (sidebar/commands), and declaring no data
    // collection is the correct, AMO-forward choice; the warning is accepted.
  } else {
    throw new Error('unknown target: ' + target);
  }
  return m;
}

function build(target, version) {
  const dest = path.join(DIST, target);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // Copy the whole source tree, then overwrite the generated manifest.
  fs.cpSync(SRC, dest, { recursive: true });
  fs.writeFileSync(
    path.join(dest, 'manifest.json'),
    JSON.stringify(buildManifest(target, version), null, 2) + '\n'
  );
  return dest;
}

if (require.main === module) {
  const arg = process.argv[2];
  const targets = arg ? [arg] : TARGETS;
  const version = readVersion();
  for (const t of targets) {
    const dest = build(t, version);
    const ext = t === 'firefox' ? 'xpi' : 'zip';
    const out = path.join(DIST, `monsender-${t}-v${version}.${ext}`);
    const info = zipDir(dest, out);
    const rel = (p) => path.relative(ROOT, p);
    console.log(`built ${t} v${version} -> ${rel(dest)} ` +
      `(${info.files} files, ${rel(out)})`);
  }
}

module.exports = { buildManifest };
