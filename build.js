'use strict';

const fs = require('fs');
const path = require('path');
const { zipDir } = require('./tools/pack.js');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const TARGETS = ['chrome', 'firefox'];

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
      // Firefox defaults this to true; the sidebar opens only on a scan.
      open_at_install: false
    };
    m.browser_specific_settings = {

      gecko: {
        id: 'monsender@leqwin',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'], optional: [] }
      }
    };
    // The web-ext KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION warning on
    // data_collection_permissions is accepted: AMO wants the declaration.
  } else {
    throw new Error('unknown target: ' + target);
  }
  return m;
}

function build(target, version) {
  const dest = path.join(DIST, target);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
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
