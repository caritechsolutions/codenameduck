'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('../testlib/helpers');
const { validateLayout, layoutTemplates, templateLayout, starterLayout } = require('../src/layout');
const TEMPLATES = require('../../shared/layout-templates.json');
const FONTS = require('../../shared/fonts.json');

test('layout templates: four starters that validate, exposed to the admin, used by POST /layouts', async (t) => {
  assert.equal(TEMPLATES.length, 4);
  assert.deepEqual(TEMPLATES.map((x) => x.id), ['classic', 'fullscreen', 'welcome', 'info']);
  for (const tpl of TEMPLATES) {
    const r = validateLayout(tpl.json);
    assert.deepEqual(r.errors, [], `${tpl.id}: ${r.errors.join('; ')}`);
    assert.ok(tpl.json.zones.some((z) => z.type === 'video'), `${tpl.id} has a video zone`);
    assert.ok(tpl.json.screens.some((s) => s.id === 'fullscreen'), `${tpl.id} has a fullscreen screen`);
    // every screen references known zones and every menu action targets something that exists
    const ids = new Set(tpl.json.zones.map((z) => z.id));
    for (const z of tpl.json.zones.filter((x) => x.type === 'menu')) for (const it of z.items) {
      if (it.action === 'show_page') assert.ok(ids.has(it.page) && tpl.json.zones.find((x) => x.id === it.page).hidden, `${tpl.id}: page ${it.page}`);
      if (it.action === 'show_screen') assert.ok(tpl.json.screens.some((s) => s.id === it.screen), `${tpl.id}: screen ${it.screen}`);
    }
    // fonts used by templates are bundled
    for (const z of tpl.json.zones) if (z.style && z.style.fontFamily) assert.ok(FONTS.some((f) => f.family === z.style.fontFamily), `${tpl.id}: font ${z.style.fontFamily}`);
  }
  assert.equal(starterLayout('X').name, 'X');
  assert.equal(templateLayout('nope'), null);
  assert.equal(layoutTemplates().length, 4);

  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const list = await s.call('GET', '/api/admin/layout-templates', { cookie });
  assert.equal(list.status, 200); assert.deepEqual(list.json.map((x) => x.id), ['classic', 'fullscreen', 'welcome', 'info']);
  assert.ok(list.json[0].json.zones.length > 3);
  const made = await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Lobby', template: 'welcome' } });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.json.name, 'Lobby');
  assert.ok(made.json.json.zones.some((z) => z.id === 'greeting'), 'welcome template zones');
  assert.equal((await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Bad', template: 'nope' } })).status, 400);
  const plain = await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Plain' } });
  assert.equal(plain.status, 201); assert.ok(plain.json.json.zones.some((z) => z.id === 'menu'), 'default = classic');
});

test('bundled fonts: every family in shared/fonts.json has its woff2 and an @font-face rule', () => {
  const dir = path.resolve(__dirname, '../../tv-app/fonts');
  const css = fs.readFileSync(path.join(dir, 'fonts.css'), 'utf8');
  for (const f of FONTS) {
    if (!f.family) continue;
    const files = f.files ? f.files.map((x) => x.file) : [f.file];
    for (const file of files) assert.ok(fs.existsSync(path.join(dir, file)), `${file} exists`);
    assert.ok(css.includes(`font-family:"${f.family}"`), `@font-face for ${f.family}`);
  }
  assert.ok(fs.existsSync(path.join(dir, 'LICENSES.txt')));
  assert.ok(fs.existsSync(path.resolve(__dirname, '../../shared/zones.css')));
});
