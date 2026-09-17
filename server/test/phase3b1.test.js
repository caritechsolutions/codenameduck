'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('../testlib/helpers');
const { sniffExt } = require('../src/media');

// 1x1 PNG, and a 64x36 PNG produced by sharp so width/height and the thumbnail can be checked.
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function png64x36() {
  const sharp = require('sharp');
  return sharp({ create: { width: 640, height: 360, channels: 3, background: '#336699' } }).png().toBuffer();
}
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#f00"/></svg>');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(24, 0)]);

test('media: sniffing accepts real images/mp4 and rejects other bytes', () => {
  assert.equal(sniffExt(PNG1), 'png');
  assert.equal(sniffExt(SVG), 'svg');
  assert.equal(sniffExt(MP4), 'mp4');
  assert.equal(sniffExt(Buffer.from('MZ' + 'x'.repeat(40))), null);
  assert.equal(sniffExt(Buffer.from('<html><body>hi</body></html>')), null);
});

test('media library: upload (raw + data_url), dimensions + thumbnail, rename, references, delete', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const big = await png64x36();

  // raw upload with a file name
  const up = await s.call('POST', '/api/admin/media', { cookie, raw: big, headers: { 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent('Lobby photo.PNG') } });
  assert.equal(up.status, 201, up.text);
  const m = up.json;
  assert.equal(m.kind, 'image'); assert.equal(m.ext, 'png'); assert.equal(m.name, 'Lobby photo');
  assert.equal(m.width, 640); assert.equal(m.height, 360);
  assert.match(m.url, /^\/procentric\/application\/media\/[0-9a-f-]{36}\.png$/);
  assert.match(m.thumb_url, /^\/procentric\/application\/media\/thumbs\/[0-9a-f-]{36}\.jpg$/);
  const dir = path.join(s.tenantsDir, 'hoteldemo/procentric/application/media');
  assert.ok(fs.existsSync(path.join(dir, `${m.uuid}.png`)), 'file written under the tenant media dir');
  const thumb = fs.readFileSync(path.join(dir, 'thumbs', `${m.uuid}.jpg`));
  assert.equal(sniffExt(thumb), 'jpg');
  const tmeta = await require('sharp')(thumb).metadata();
  assert.equal(tmeta.width, 320); assert.equal(tmeta.height, 180);

  // data_url upload, svg and mp4; a name that lies about its type is stored by its bytes
  const svg = await s.call('POST', '/api/admin/media', { cookie, body: { name: 'logo.svg', data_url: 'data:image/svg+xml;base64,' + SVG.toString('base64') } });
  assert.equal(svg.status, 201, svg.text); assert.equal(svg.json.ext, 'svg'); assert.equal(svg.json.width, 200); assert.equal(svg.json.height, 100);
  const mp4 = await s.call('POST', '/api/admin/media', { cookie, raw: MP4, headers: { 'Content-Type': 'video/mp4', 'X-Filename': 'clip.mp4' } });
  assert.equal(mp4.status, 201, mp4.text); assert.equal(mp4.json.kind, 'video'); assert.equal(mp4.json.thumb_url, null); assert.equal(mp4.json.width, null);
  const lie = await s.call('POST', '/api/admin/media', { cookie, raw: PNG1, headers: { 'Content-Type': 'image/jpeg', 'X-Filename': 'photo.jpg' } });
  assert.equal(lie.status, 201); assert.equal(lie.json.ext, 'png');
  // rejected: not an image, empty, too large
  assert.equal((await s.call('POST', '/api/admin/media', { cookie, raw: Buffer.from('MZ' + 'x'.repeat(100)), headers: { 'Content-Type': 'image/png', 'X-Filename': 'evil.png' } })).status, 400);
  assert.equal((await s.call('POST', '/api/admin/media', { cookie, body: {} })).status, 400);
  const huge = Buffer.concat([PNG1, Buffer.alloc(10 * 1024 * 1024)]);
  const tooBig = await s.call('POST', '/api/admin/media', { cookie, raw: huge, headers: { 'Content-Type': 'image/png' } });
  assert.ok(tooBig.status === 400 || tooBig.status === 413, `got ${tooBig.status}`);

  // list newest first
  const list = (await s.call('GET', '/api/admin/media', { cookie })).json;
  assert.equal(list.length, 4);
  assert.equal(list[list.length - 1].id, m.id);

  // rename
  const ren = await s.call('PATCH', `/api/admin/media/${m.id}`, { cookie, body: { name: '  Lobby (day)  ' } });
  assert.equal(ren.json.name, 'Lobby (day)');
  assert.equal((await s.call('PATCH', `/api/admin/media/${m.id}`, { cookie, body: { name: '' } })).status, 400);
  assert.equal((await s.call('PATCH', '/api/admin/media/9999', { cookie, body: { name: 'x' } })).status, 404);

  // delete is blocked while a layout or the logo uses the file, and names where
  const layout = await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Lobby', json: { schema: 1, canvas: { w: 1920, h: 1080, background: '#000', backgroundImage: svg.json.url }, screens: [{ id: 'home', zones: ['pic'] }], zones: [{ id: 'pic', type: 'image', x: 0, y: 0, w: 400, h: 300, src: m.url }] } } });
  assert.equal(layout.status, 201, layout.text);
  const blocked = await s.call('DELETE', `/api/admin/media/${m.id}`, { cookie });
  assert.equal(blocked.status, 409); assert.deepEqual(blocked.json.layouts.map((l) => l.name), ['Lobby']); assert.equal(blocked.json.logo, false);
  const refs = await s.call('GET', `/api/admin/media/${svg.json.id}/references`, { cookie });
  assert.deepEqual(refs.json.layouts.map((l) => l.name), ['Lobby']);
  await s.call('DELETE', `/api/admin/layouts/${layout.json.id}`, { cookie });
  const del = await s.call('DELETE', `/api/admin/media/${m.id}`, { cookie });
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(path.join(dir, `${m.uuid}.png`)) && !fs.existsSync(path.join(dir, 'thumbs', `${m.uuid}.jpg`)), 'file and thumb removed');
  assert.equal((await s.call('DELETE', `/api/admin/media/${m.id}`, { cookie })).status, 404);

  // logo through the library: settings.logo_url points at the media URL, TV context carries it,
  // and the file cannot be deleted while it is the logo
  const logo = await s.call('POST', '/api/admin/media?as=logo', { cookie, raw: big, headers: { 'Content-Type': 'image/png', 'X-Filename': 'hotel-logo.png' } });
  assert.equal(logo.status, 201);
  const tenant = (await s.call('GET', '/api/admin/tenant', { cookie })).json;
  assert.equal(tenant.settings.logo_url, logo.json.url);
  const reg = await s.registerSet('S1');
  assert.equal(reg.json.context.logo, logo.json.url);
  const blockedLogo = await s.call('DELETE', `/api/admin/media/${logo.json.id}`, { cookie });
  assert.equal(blockedLogo.status, 409); assert.equal(blockedLogo.json.logo, true);
  // a video cannot be the logo
  assert.equal((await s.call('POST', '/api/admin/media?as=logo', { cookie, raw: MP4, headers: { 'Content-Type': 'video/mp4' } })).status, 400);

  // tenant isolation: another tenant sees nothing and cannot touch the rows
  const other = await s.call('GET', '/api/admin/media', { cookie, host: 'other.test' });
  assert.equal(other.status, 404);   // unknown host → no tenant
});

test('media library: tenant admins only see their own tenant', async (t) => {
  const s = await startServer({ extraTenants: [['second', 'second.test']] }); t.after(s.close);
  const { cookie } = await s.login();
  const up = await s.call('POST', '/api/admin/media', { cookie, raw: PNG1, headers: { 'Content-Type': 'image/png', 'X-Filename': 'one.png' } });
  assert.equal(up.status, 201);
  const { cookie: c2 } = await s.login('admin', undefined, 'second.test');
  const list2 = (await s.call('GET', '/api/admin/media', { cookie: c2, host: 'second.test' })).json;
  assert.deepEqual(list2, []);
  assert.equal((await s.call('DELETE', `/api/admin/media/${up.json.id}`, { cookie: c2, host: 'second.test' })).status, 404);
  assert.equal((await s.call('PATCH', `/api/admin/media/${up.json.id}`, { cookie: c2, host: 'second.test', body: { name: 'x' } })).status, 404);
});
