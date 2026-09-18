'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer } = require('../testlib/helpers');
const { normalizeAuth } = require('../src/apps');

const LIST = { list: [{ id: 'netflix', title: 'Netflix' }, { id: 'youtube.leanback.v4', title: 'YouTube' }, { id: 'amazon', title: 'Prime Video' }] };

test('normalizeAuth reads the usual register/status shapes', () => {
  assert.deepEqual(normalizeAuth({ id: 'netflix', status: 'unregistered' }), { activated: false, status: 'unregistered' });
  assert.deepEqual(normalizeAuth({ status: 'registered' }), { activated: true, status: 'registered' });
  assert.deepEqual(normalizeAuth({ auth: 'authorized' }), { activated: true, status: 'authorized' });
  assert.deepEqual(normalizeAuth({ auth_status: 'not_registered' }), { activated: false, status: 'not_registered' });
  assert.deepEqual(normalizeAuth({ registered: false }), { activated: false, status: 'registered=false' });
  assert.deepEqual(normalizeAuth({ result: 'pending' }), { activated: null, status: 'pending' });
  assert.deepEqual(normalizeAuth('ok'), { activated: true, status: 'ok' });
  assert.deepEqual(normalizeAuth({ error: 'timeout' }), { activated: null, status: null });
  assert.deepEqual(normalizeAuth(null), { activated: null, status: null });
  // 43UM670H0UA (2026-09-18): auth boolean + auth_status words
  assert.deepEqual(normalizeAuth({ id: 'netflix', auth: true, auth_status: 'authSuccess' }), { activated: true, status: 'authSuccess' });
  assert.deepEqual(normalizeAuth({ id: 'netflix', auth: true }), { activated: true, status: 'auth=true' });
  assert.deepEqual(normalizeAuth({ id: 'netflix', auth: false, auth_status: 'authFail' }), { activated: false, status: 'authFail' });
  assert.deepEqual(normalizeAuth({ auth_status: 'authSuccess' }), { activated: true, status: 'authSuccess' });
  assert.deepEqual(normalizeAuth({ auth_status: 'notRequired' }), { activated: true, status: 'notRequired' });
  assert.deepEqual(normalizeAuth({ error: 'IDCAP_RESULT_FAILURE' }), { activated: null, status: null });
});

test('activation: status per set hides un-activated apps from that set only; admin sees badges; tokens register on the sets', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  await s.call('PATCH', '/api/admin/tenant', { cookie, body: { settings: { netflix_hotel_id: 'HOTEL-1' } } });
  // A reports Netflix unregistered, B reports everything registered, C (HCAP-like) reports no status
  const a = await s.registerSet('A', { apps: LIST, apps_status: { netflix: { id: 'netflix', status: 'unregistered' }, 'youtube.leanback.v4': { status: 'registered' }, amazon: { status: 'registered' } } });
  const b = await s.registerSet('B', { apps: LIST, apps_status: { netflix: { status: 'registered' }, 'youtube.leanback.v4': { status: 'registered' }, amazon: { status: 'registered' } } });
  const c = await s.registerSet('C', { apps: LIST, api: 'hcap' });
  let list = (await s.call('GET', '/api/admin/apps', { cookie })).json;
  const nf = list.find((x) => x.app_id === 'netflix'), yt = list.find((x) => x.app_id === 'youtube.leanback.v4');
  assert.equal(nf.activation, 'partial'); assert.equal(nf.activated_sets, 1); assert.equal(nf.unactivated_sets, 1); assert.equal(nf.reported_sets, 2);
  assert.equal(yt.activation, 'activated'); assert.equal(yt.reported_sets, 2);
  assert.ok(['registered', 'unregistered'].includes(nf.auth_status));
  // enable all three for a group with all sets
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'G' } })).json;
  for (const st of [a, b, c]) await s.call('PATCH', `/api/admin/sets/${st.json.set_id}`, { cookie, body: { group_id: g.id } });
  await s.call('PUT', `/api/admin/groups/${g.id}/apps`, { cookie, body: { app_ids: list.map((x) => x.id) } });
  const pollA = await s.call('GET', `/api/tv/poll?set_id=${a.json.set_id}&token=${a.json.token}`);
  assert.equal(pollA.json.activation, null, 'no licences, no account number → nothing to ask');
  assert.deepEqual(pollA.json.apps.map((x) => x.id).sort(), ['amazon', 'youtube.leanback.v4'], 'A: Netflix hidden until activated');
  const pollB = await s.call('GET', `/api/tv/poll?set_id=${b.json.set_id}&token=${b.json.token}`);
  assert.equal(pollB.json.apps.length, 3, 'B: everything activated');
  const pollC = await s.call('GET', `/api/tv/poll?set_id=${c.json.set_id}&token=${c.json.token}`);
  assert.equal(pollC.json.apps.length, 3, 'C: unknown status counts as activated');

  // activation: tokens come from the superadmin licence store (B3c); tenants only add an account number
  assert.equal((await s.call('POST', '/api/admin/apps/activation/run', { cookie, body: {} })).status, 400, 'nothing configured yet');
  const lic = await s.call('POST', '/api/admin/licences', { cookie, body: { files: [{ filename: 'NETFLIX_caritech.lic', content: 'TkZYLTEyMy1uZXRmbGl4LXRva2Vu\n' }] } });
  assert.equal(lic.status, 200, lic.text); assert.equal(lic.json.added[0].app_id, 'netflix');
  const pollA2 = await s.call('GET', `/api/tv/poll?set_id=${a.json.set_id}&token=${a.json.token}`);
  assert.deepEqual((pollA2.json.activation || {}).status_ids, ['netflix'], 'the set asks register/status for the licensed ids only: ' + pollA2.status + ' ' + pollA2.text.slice(0, 200));
  const saved = await s.call('PUT', '/api/admin/apps/activation', { cookie, body: { accountNumber: '' } });
  assert.equal(saved.status, 200); assert.deepEqual(saved.json.config, { accountNumber: '', licensed: ['netflix'] });
  const cfg = (await s.call('GET', '/api/admin/apps/activation', { cookie })).json;
  assert.deepEqual(cfg.config.licensed, ['netflix']); assert.deepEqual(cfg.results, []);
  const run = await s.call('POST', '/api/admin/apps/activation/run', { cookie, body: { group_id: g.id } });
  assert.equal(run.status, 200); assert.equal(run.json.queued, 3);
  const cmdsA = (await s.call('GET', `/api/admin/sets/${a.json.set_id}`, { cookie })).json.commands;
  const reg = cmdsA.find((x) => x.type === 'register_apps');
  assert.ok(reg, 'register_apps queued'); assert.deepEqual(reg.payload, { tokenList: [{ id: 'netflix', token: 'TkZYLTEyMy1uZXRmbGl4LXRva2Vu' }], status_ids: ['netflix'] });
  assert.equal((await s.call('POST', '/api/admin/apps/activation/run', { cookie, body: {} })).json.queued, 3);
  assert.equal((await s.call('GET', `/api/admin/sets/${a.json.set_id}`, { cookie })).json.commands.filter((x) => x.type === 'register_apps' && x.status === 'queued').length, 1, 'deduped while queued');
  // over WS: A reports the registration result and fresh status → Netflix appears in A's apps push
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${a.json.set_id}&token=${a.json.token}`, { headers: { Host: 'hoteldemo.caritech.net' } });
  const msgs = []; ws.on('message', (m) => msgs.push(JSON.parse(m.toString())));
  await new Promise((r) => ws.once('open', r));
  await new Promise((r) => setTimeout(r, 100));
  ws.send(JSON.stringify({ type: 'event', name: 'apps_registration', payload: { ok: true, result: { id: 'netflix', tokenResult: 'success' }, results: [{ id: 'netflix', tokenResult: 'success', ok: true }] } }));
  ws.send(JSON.stringify({ type: 'event', name: 'apps_status', payload: { status: { netflix: { status: 'registered' } } } }));
  await new Promise((r) => setTimeout(r, 200));
  const push = msgs.filter((m) => m.type === 'apps').pop();
  assert.ok(push, 'apps re-pushed after the status report'); assert.deepEqual(push.apps.map((x) => x.id).sort(), ['amazon', 'netflix', 'youtube.leanback.v4']);
  const after = (await s.call('GET', '/api/admin/apps/activation', { cookie })).json;
  assert.equal(after.results.length, 1); assert.equal(after.results[0].ok, true); assert.equal(after.results[0].serial, 'A');
  list = (await s.call('GET', '/api/admin/apps', { cookie })).json;
  assert.equal(list.find((x) => x.app_id === 'netflix').activation, 'activated');
  // A registering again does not get another register_apps (it succeeded)
  const a2 = await s.registerSet('A', { apps: LIST });
  assert.ok(!a2.json.commands.some((x) => x.type === 'register_apps' && x.id !== reg.id), 'no new registration for a set that succeeded');
  // a brand-new set gets the registration at its first register — only when its own
  // register/status says a licensed app is not authorised, and only that app's token (B3d)
  const d = await s.registerSet('D', { apps: LIST, apps_status: { netflix: { status: 'unregistered' }, amazon: { status: 'registered' } } });
  const dReg = d.json.commands.find((x) => x.type === 'register_apps');
  assert.ok(dReg, 'queued for the unauthorised app'); assert.deepEqual(dReg.payload.tokenList.map((x) => x.id), ['netflix']);
  const e = await s.registerSet('E', { apps: LIST, apps_status: { netflix: { status: 'registered' } } });
  assert.ok(!e.json.commands.some((x) => x.type === 'register_apps'), 'authorised set: nothing queued');
  const e2 = await s.registerSet('E2', { apps: LIST });
  assert.ok(!e2.json.commands.some((x) => x.type === 'register_apps'), 'no status at all (HCAP-like): nothing queued — absence is never a reason');
  const dEvents = (await s.call('GET', `/api/admin/sets/${d.json.set_id}`, { cookie })).json.events;
  const reason = dEvents.find((x) => x.type === 'tv_apps_registration_reason');
  assert.ok(reason); assert.equal(reason.payload.trigger, 'server_register'); assert.deepEqual(reason.payload.sending, ['netflix']);

  // LG answers "fail" for a token: the licence is marked (model, message) and left out of every payload until edited
  await s.call('POST', '/api/admin/licences', { cookie, body: { files: [{ filename: 'AirPlay_caritech.lic', content: 'QUlSUExBWS10b2tlbi0xMjM0NTY3OA==' }] } });
  assert.deepEqual((await s.call('GET', '/api/admin/apps/activation', { cookie })).json.config.licensed, ['airplay', 'netflix']);
  ws.send(JSON.stringify({ type: 'event', name: 'apps_registration', payload: { ok: false, results: [{ id: 'airplay', tokenResult: 'fail', errorMessage: 'IDCAP_RESULT_FAILURE', ok: false }] } }));
  await new Promise((r) => setTimeout(r, 200));
  const lics = (await s.call('GET', '/api/admin/licences', { cookie })).json.licences;
  const ap = lics.find((l) => l.app_id === 'airplay');
  assert.deepEqual([ap.failed.model, ap.failed.message], ['43UM670H0UA', 'IDCAP_RESULT_FAILURE']);
  assert.deepEqual((await s.call('GET', '/api/admin/apps/activation', { cookie })).json.config.licensed, ['netflix'], 'failed licence not offered');
  assert.ok(s.logs.some((l) => /licences: airplay registration FAILED on 43UM670H0UA: IDCAP_RESULT_FAILURE/.test(l)));
  const renamed = await s.call('PATCH', `/api/admin/licences/${ap.id}`, { cookie, body: { app_id: 'com.apple.airplay' } });
  assert.equal(renamed.json.failed, null, 'editing the id clears the failure');
  assert.deepEqual((await s.call('GET', '/api/admin/apps/activation', { cookie })).json.config.licensed, ['com.apple.airplay', 'netflix']);
  await s.call('DELETE', `/api/admin/licences/${ap.id}`, { cookie });
  // an account number on top of the tokens; without any licence the payload is the account number alone
  const acc = await s.call('PUT', '/api/admin/apps/activation', { cookie, body: { accountNumber: 'ACC-9' } });
  assert.equal(acc.json.config.accountNumber, 'ACC-9');
  assert.deepEqual((await s.call('GET', `/api/tv/poll?set_id=${a2.json.set_id}&token=${a2.json.token}`)).json.activation.status_ids.sort(), ['amazon', 'netflix'], 'account number: the controlled apps are asked too (a2: A re-registered and got a new token)');
  const run2 = await s.call('POST', '/api/admin/apps/activation/run', { cookie, body: { set_ids: [b.json.set_id] } });
  assert.equal(run2.json.queued, 1);
  const cmdB = (await s.call('GET', `/api/admin/sets/${b.json.set_id}`, { cookie })).json.commands.find((x) => x.type === 'register_apps');
  assert.deepEqual(cmdB.payload, { tokenList: [{ id: 'netflix', token: 'TkZYLTEyMy1uZXRmbGl4LXRva2Vu' }], accountNumber: 'ACC-9', status_ids: ['netflix', 'amazon'] });
  await s.call('DELETE', `/api/admin/licences/${lic.json.added[0].id}`, { cookie });
  const run3 = await s.call('POST', '/api/admin/apps/activation/run', { cookie, body: { set_ids: [c.json.set_id] } });
  assert.equal(run3.json.queued, 1);
  assert.deepEqual((await s.call('GET', `/api/admin/sets/${c.json.set_id}`, { cookie })).json.commands.find((x) => x.type === 'register_apps').payload, { accountNumber: 'ACC-9', status_ids: ['netflix', 'amazon'] });
  ws.close();
});
