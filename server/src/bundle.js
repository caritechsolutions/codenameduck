'use strict';
// Part D: per-tenant app bundle for LG remote-deploy mode. app.zip = the deployed renderer files
// (index.html, app.<hash>.js, lib/, fonts/, zones.css, …) + the tenant's media library +
// state.json (a snapshot of everything /api/tv/register returns for the tenant). The xait
// versions are managed here: +1 (wrap at 65535) only when renderer files or media change —
// state.json is refreshed on every publish but never bumps (layouts are pushed live).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { zipBuffer } = require('./zip');
const { readZip } = require('./xlsx');
const { parseLayoutRow } = require('./layout');
const { tvOsdOf, TV_OSD_DEFAULT } = require('./state');
const { rowToApi: channelToApi } = require('./channels');

const RENDERER_FILE = /^(index\.html|probe\.html|app\.[0-9a-f]+\.js|version\.txt|zones\.css|lib\/.+|fonts\/.+)$/;
const SKIP_DIRS = new Set(['media', 'assets', 'thumbs']);
const MAX_VERSION = 65535;

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function walk(dir, base = '') {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...walk(path.join(dir, e.name), rel)); }
    else if (e.isFile()) out.push(rel);
  }
  return out;
}
function nextVersion(v) { const n = Number(v) || 0; return n >= MAX_VERSION ? 1 : n + 1; }
function xmlEscape(s) { return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
// Both xait forms (docs: remote-run = url to index.html; remote-deploy = url to app.zip +
// applicationStructure). Versions: both fields carry the same number.
function xaitXml({ hostname, version, mode }) {
  const v = Number(version) || 0;
  const url = `http://${hostname}/procentric/application/${mode === 'deploy' ? 'app.zip' : 'index.html'}`;
  const structure = mode === 'deploy' ? `
          <applicationStructure>
            <baseDirectory>/</baseDirectory>
            <classpathExtension>/</classpathExtension>
            <initialClass>index.html</initialClass>
          </applicationStructure>` : '';
  return `<XAIT>
  <versionNumber>${v}</versionNumber>
  <AbstractService>
    <svcName>CoopCentric</svcName>
    <svcId>0x1204</svcId>
    <isAutoSelect>true</isAutoSelect>
    <ApplicationList>
      <Application>
        <appName>CoopCentric</appName>
        <applicationIdentifier><orgId>1</orgId><appId>1</appId></applicationIdentifier>
        <applicationDescriptor>
          <type>Hcap-h</type>
          <controlCode>AUTOSTART</controlCode>
          <visibility>NOT_VISIBLE_USERS</visibility>
          <priority>255</priority>
          <version>${v}</version>
        </applicationDescriptor>
        <HcapDescriptor>
          <url>${xmlEscape(url)}</url>${structure}
        </HcapDescriptor>
      </Application>
    </ApplicationList>
  </AbstractService>
</XAIT>
`;
}
function xaitVersions(xml) {
  const a = /<versionNumber>\s*(\d+)\s*<\/versionNumber>/.exec(xml || ''), b = /<version>\s*(\d+)\s*<\/version>/.exec(xml || '');
  return { versionNumber: a ? Number(a[1]) : null, version: b ? Number(b[1]) : null, url: (/<url>\s*([^<\s]+)/.exec(xml || '') || [])[1] || null };
}

function createBundler({ db, tenantsDir, apps = null, state = null, publicHost = null, log = () => {} }) {
  const qTenant = db.prepare('SELECT * FROM tenants WHERE id = ?');
  const qLayouts = db.prepare('SELECT * FROM layouts WHERE tenant_id = ? ORDER BY id');
  const qLineups = db.prepare('SELECT id, name FROM lineups WHERE tenant_id = ? ORDER BY id');
  const qLineupItems = db.prepare(`SELECT c.* FROM lineup_items li JOIN channels c ON c.id = li.channel_id WHERE li.lineup_id = ? AND c.enabled = 1 ORDER BY li.position`);
  const qGroups = db.prepare(`SELECT g.*, la.layout_id, lu.lineup_id FROM groups g LEFT JOIN layout_assign la ON la.group_id = g.id LEFT JOIN lineup_assign lu ON lu.group_id = g.id WHERE g.tenant_id = ? ORDER BY g.id`);
  const qSets = db.prepare('SELECT id, serial, room_number, bundle_version, app_version FROM sets WHERE tenant_id = ?');
  const setBundle = db.prepare(`UPDATE tenants SET bundle_version = ?, bundle_hash = ?, bundle_build = ?, bundle_built_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`);
  const setMode = db.prepare('UPDATE tenants SET deploy_mode = ?, bundle_version = ? WHERE id = ?');

  const appDir = (tenant) => path.join(tenantsDir, tenant.name, 'procentric', 'application');
  const hostOf = (tenant) => (publicHost ? publicHost(tenant) : tenant.hostname);
  const settingsOf = (tenant) => { try { return JSON.parse(tenant.settings_json || '{}') || {}; } catch { return {}; } };

  // Files that go into the bundle (and into the content hash): renderer + media (not thumbs).
  function collect(tenant) {
    const dir = appDir(tenant);
    const files = [];
    for (const rel of walk(dir)) if (RENDERER_FILE.test(rel)) files.push(rel);
    const mediaDir = path.join(dir, 'media');
    for (const rel of walk(mediaDir)) files.push('media/' + rel);
    return files.sort().map((rel) => { const full = path.join(dir, rel); const st = fs.statSync(full); return { path: rel, full, bytes: st.size, sha: sha(fs.readFileSync(full)) }; });
  }
  function contentHash(files) { return sha(files.map((f) => `${f.path}:${f.sha}`).join('\n')); }
  function distBuild(tenant) { try { return fs.readFileSync(path.join(appDir(tenant), 'version.txt'), 'utf8').trim(); } catch { return null; } }

  // Everything a set could need when the server is unreachable. Per-set data (room, group) comes
  // from the set's own cache; this carries the tenant-wide pieces.
  function snapshot(tenant) {
    const t = qTenant.get(tenant.id) || tenant;
    const st = settingsOf(t);
    const layouts = {};
    for (const row of qLayouts.all(t.id)) { const doc = parseLayoutRow(row); if (doc) layouts[row.id] = doc; }
    const lineups = {};
    for (const lu of qLineups.all(t.id)) lineups[lu.id] = { id: lu.id, name: lu.name, channels: qLineupItems.all(lu.id).map(channelToApi) };
    const groups = qGroups.all(t.id).map((g) => ({ id: g.id, name: g.name, layout_id: g.layout_id || null, lineup_id: g.lineup_id || null, vacant_layout_id: g.vacant_layout_id || null,
      instant_power: g.instant_power == null ? null : g.instant_power, tv_osd: tvOsdOf(g), apps: apps ? apps.enabledFor(t, { group_id: g.id, id: null }) : [] }));
    const context = state ? state.context(t, { room_number: '', serial: '' }) : {};
    delete context.room; delete context.serial;
    return {
      schema: 1, tenant_host: hostOf(t), tenant_name: t.name, generated_at: new Date().toISOString(), state_version: t.state_version || 1,
      bundle: { version: t.bundle_version || 0, build: distBuild(t) },
      context, checkout_message: st.checkout_message || null, poll_interval_s: 60,
      default_layout_id: t.default_layout_id || null, default_lineup_id: t.default_lineup_id || null,
      tv_osd_default: { ...TV_OSD_DEFAULT },   // D4b: sets without a group
      layouts, lineups, groups,
      activation: apps ? apps.registerPayload(t) : null,
    };
  }
  function readManifest(tenant) { try { return JSON.parse(fs.readFileSync(path.join(appDir(tenant), 'bundle.manifest.json'), 'utf8')); } catch { return null; } }

  // Dry run: what would change if we published now.
  function diff(tenant) {
    const t = qTenant.get(tenant.id) || tenant;
    const files = collect(t);
    const manifest = readManifest(t);
    const before = new Map(((manifest && manifest.files) || []).map((f) => [f.path, f]));
    const after = new Map(files.map((f) => [f.path, f]));
    const added = [], removed = [], changed = [];
    for (const [p, f] of after) { if (!before.has(p)) added.push(p); else if (before.get(p).sha !== f.sha) changed.push(p); }
    for (const p of before.keys()) if (!after.has(p)) removed.push(p);
    const hash = contentHash(files);
    const snap = snapshot(t);
    const stateSha = sha(JSON.stringify({ ...snap, generated_at: null, bundle: null, state_version: null }));
    const zipExists = fs.existsSync(path.join(appDir(t), 'app.zip'));
    return { mode: t.deploy_mode || 'run', current_version: t.bundle_version || 0, next_version: !zipExists || !manifest || hash !== t.bundle_hash ? nextVersion(t.bundle_version) : (t.bundle_version || 0),
      bump: !zipExists || !manifest || hash !== t.bundle_hash, state_changed: !manifest || manifest.state_sha !== stateSha, added, removed, changed, unchanged: files.length - added.length - changed.length,
      files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), hash, build: distBuild(t), zip_exists: zipExists };
  }

  // Build app.zip + bundle.json, bump when the content changed, rewrite xait.xml for the mode.
  function publish(tenant, { force = false, by = null } = {}) {
    const t = qTenant.get(tenant.id) || tenant;
    const dir = appDir(t);
    if (!fs.existsSync(path.join(dir, 'index.html'))) { const e = new Error(`tenant ${t.name}: no renderer deployed in ${dir} (run coopcentric-tenant deploy)`); e.status = 409; throw e; }
    const d = diff(t);
    const version = d.bump || force ? nextVersion(t.bundle_version) : (t.bundle_version || 0);
    const snap = snapshot(t); snap.bundle.version = version;
    const stateSha = sha(JSON.stringify({ ...snap, generated_at: null, bundle: null, state_version: null }));
    const files = collect(t);
    const manifest = { version, hash: d.hash, build: d.build, built_at: new Date().toISOString(), by, state_sha: stateSha, mode: t.deploy_mode || 'run',
      files: files.map((f) => ({ path: f.path, bytes: f.bytes, sha: f.sha })) };
    const entries = files.map((f) => ({ path: f.path, data: fs.readFileSync(f.full) }));
    entries.push({ path: 'state.json', data: JSON.stringify(snap) });
    entries.push({ path: 'bundle.json', data: JSON.stringify({ version, hash: d.hash, build: d.build, built_at: manifest.built_at }) });
    const zip = zipBuffer(entries);
    const tmp = path.join(dir, `.app.zip.${process.pid}.tmp`);
    fs.writeFileSync(tmp, zip); fs.renameSync(tmp, path.join(dir, 'app.zip'));
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(snap));           // also served in run mode (offline fallback)
    fs.writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify({ version, hash: d.hash, build: d.build, built_at: manifest.built_at }));
    fs.writeFileSync(path.join(dir, 'bundle.manifest.json'), JSON.stringify(manifest));
    setBundle.run(version, d.hash, d.build, t.id);
    if ((t.deploy_mode || 'run') === 'deploy') writeXait(t, version, 'deploy');
    log(`bundle ${t.name}: v${version} ${d.bump || force ? 'PUBLISHED' : 'refreshed (state.json only, no version bump)'} — ${files.length} files, ${(zip.length / 1024).toFixed(0)} kB, build ${d.build || '?'}, mode ${t.deploy_mode || 'run'}${by ? ' by ' + by : ''}`);
    return { version, bumped: d.bump || force, files: files.length, bytes: zip.length, build: d.build, added: d.added, removed: d.removed, changed: d.changed, mode: t.deploy_mode || 'run' };
  }
  function readManifestPublic(tenant) { const m = readManifest(tenant); return m ? { version: m.version, build: m.build, built_at: m.built_at, files: m.files.length, hash: m.hash } : null; }
  function writeXait(tenant, version, mode) {
    const p = path.join(appDir(tenant), 'xait.xml');
    fs.writeFileSync(p, xaitXml({ hostname: tenant.hostname, version, mode }));
    log(`xait ${tenant.name}: ${mode} form, versionNumber/version ${version}, url …/${mode === 'deploy' ? 'app.zip' : 'index.html'}`);
  }
  // Switch the tenant between remote-run and remote-deploy. Deploy needs a bundle (published
  // here if missing). Back to run: the xait gets a higher version than the TVs hold so they
  // load the live index.html again.
  function changeMode(tenant, mode, { by = null } = {}) {
    if (!['run', 'deploy'].includes(mode)) { const e = new Error('mode must be run or deploy'); e.status = 400; throw e; }
    let t = qTenant.get(tenant.id) || tenant;
    if (mode === 'deploy') {
      setMode.run('deploy', t.bundle_version || 0, t.id); t = qTenant.get(t.id);
      const r = publish(t, { by });
      writeXait(t, r.version, 'deploy');
      return { mode, version: r.version, published: true };
    }
    const version = nextVersion(t.bundle_version);
    setMode.run('run', version, t.id);
    writeXait(qTenant.get(t.id), version, 'run');
    log(`deployment ${t.name}: back to remote-run (xait version ${version})${by ? ' by ' + by : ''}`);
    return { mode, version, published: false };
  }
  function status(tenant) {
    const t = qTenant.get(tenant.id) || tenant;
    const dir = appDir(t);
    let xait = null; try { xait = xaitVersions(fs.readFileSync(path.join(dir, 'xait.xml'), 'utf8')); } catch { /* none */ }
    let zipBytes = null; try { zipBytes = fs.statSync(path.join(dir, 'app.zip')).size; } catch { /* none */ }
    const sets = qSets.all(t.id);
    const pending = (t.deploy_mode || 'run') === 'deploy' ? sets.filter((s) => (s.bundle_version || 0) !== (t.bundle_version || 0)) : [];
    return { mode: t.deploy_mode || 'run', bundle_version: t.bundle_version || 0, bundle_hash: t.bundle_hash || null, bundle_build: t.bundle_build || null, bundle_built_at: t.bundle_built_at || null,
      zip_bytes: zipBytes, manifest: readManifestPublic(t), xait, deployed_build: distBuild(t), sets: sets.length, pending_sets: pending.map((s) => ({ id: s.id, serial: s.serial, room_number: s.room_number, bundle_version: s.bundle_version, app_version: s.app_version })) };
  }
  // Startup / after deploy: tenants in deploy mode get a fresh bundle when the content changed.
  function autoPublish() {
    const out = [];
    for (const t of db.prepare("SELECT * FROM tenants WHERE deploy_mode = 'deploy'").all()) {
      try { const d = diff(t); if (d.bump || d.state_changed) out.push({ tenant: t.name, ...publish(t, { by: 'startup' }) }); }
      catch (e) { log(`bundle ${t.name}: auto-publish failed: ${e.message}`); }
    }
    return out;
  }
  // Read back a bundle's entries (tests, diagnostics).
  function listZip(tenant) {
    const buf = fs.readFileSync(path.join(appDir(tenant), 'app.zip'));
    const get = readZip(buf);
    return get;
  }
  return { collect, snapshot, diff, publish, changeMode, status, autoPublish, listZip, xaitXml, xaitVersions, appDir };
}

module.exports = { createBundler, xaitXml, xaitVersions, nextVersion };
