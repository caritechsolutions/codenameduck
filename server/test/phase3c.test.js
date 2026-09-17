'use strict';
// Phase 3 Part C: local PMS — reservations with the occupancy rule, the minute scheduler
// (tenant-local check-in/out times), guest variables + vacant layout for the sets, import with
// column mapping (CSV + XLSX), and the external API with a per-tenant key.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const WebSocket = require('ws');
const { startServer } = require('../testlib/helpers');
const { parseDate, guessMapping, parseCsvRows } = require('../src/pms');
const { readXlsx } = require('../src/xlsx');

test('parseDate + mapping guess + csv delimiter detection', () => {
  assert.equal(parseDate('17/09/2026'), '2026-09-17');
  assert.equal(parseDate('09/17/2026'), '2026-09-17', 'auto falls back to month-first when day-first is impossible');
  assert.equal(parseDate('01/02/2026'), '2026-02-01', 'ambiguous auto = day first');
  assert.equal(parseDate('01/02/2026', 'MM/DD/YYYY'), '2026-01-02');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate(46282), '2026-09-17', 'excel serial');
  assert.equal(parseDate('46282', 'excel'), '2026-09-17');
  assert.equal(parseDate('2026-09-17T15:00:00Z'), '2026-09-17');
  assert.equal(parseDate('31.12.26', 'DD.MM.YYYY'), '2026-12-31');
  assert.equal(parseDate('', 'auto'), null);
  assert.deepEqual(guessMapping(['Room No', 'First name', 'Surname', 'Arrival', 'Departure', 'Notes']), { room: 0, first_name: 1, last_name: 2, checkin: 3, checkout: 4, notes: 5 });
  assert.deepEqual(parseCsvRows('a\tb\n1\t"x\ty"\n').rows, [['a', 'b'], ['1', 'x\ty']]);
});

test('reservations: validation, overlap rule, same-day turnover, edits, cancel, list filters, rooms, export', async (t) => {
  const s = await startServer({ now: () => new Date('2026-09-18T10:00:00Z') }); t.after(s.close);
  const { cookie } = await s.login();
  const post = (b) => s.call('POST', '/api/admin/reservations', { cookie, body: b });
  const a = await post({ room_number: '101', first_name: 'Jane', last_name: 'Doe', checkin_date: '2026-09-20', checkout_date: '2026-09-23', lang: 'EN', vip: true });
  assert.equal(a.status, 201, a.text); assert.equal(a.json.status, 'booked'); assert.equal(a.json.nights, 3); assert.equal(a.json.lang, 'en'); assert.equal(a.json.vip, true); assert.equal(a.json.guest, 'Jane Doe');
  const ov = await post({ room_number: '101', last_name: 'Smith', checkin_date: '2026-09-22', checkout_date: '2026-09-25' });
  assert.equal(ov.status, 400); assert.match(ov.json.error, /already has Jane Doe from 2026-09-20 to 2026-09-23 \(reservation #1\)/);
  const b = await post({ room_number: '101', last_name: 'Smith', checkin_date: '2026-09-23', checkout_date: '2026-09-25' });
  assert.equal(b.status, 201, 'same-day turnover is allowed');
  assert.equal((await post({ room_number: '101', last_name: 'X', checkin_date: '2026-09-23', checkout_date: '2026-09-23' })).status, 400, 'zero nights');
  assert.match((await post({ room_number: '101', last_name: 'X', checkin_date: '20/09/2026', checkout_date: '2026-09-21' })).json.error, /YYYY-MM-DD/);
  assert.match((await post({ room_number: '', last_name: 'X', checkin_date: '2026-09-20', checkout_date: '2026-09-21' })).json.error, /room is required/);
  assert.match((await post({ room_number: '7', checkin_date: '2026-09-20', checkout_date: '2026-09-21' })).json.error, /guest name/);
  // moving A onto B is refused; a harmless edit is fine and does not trip on itself
  assert.equal((await s.call('PATCH', `/api/admin/reservations/${a.json.id}`, { cookie, body: { checkout_date: '2026-09-24' } })).status, 400);
  const ed = await s.call('PATCH', `/api/admin/reservations/${a.json.id}`, { cookie, body: { notes: 'late arrival', first_name: 'Janet' } });
  assert.equal(ed.status, 200); assert.equal(ed.json.notes, 'late arrival'); assert.equal(ed.json.first_name, 'Janet'); assert.equal(ed.json.checkout_date, '2026-09-23');
  // cancel B: it no longer blocks
  const c = await s.call('DELETE', `/api/admin/reservations/${b.json.id}`, { cookie });
  assert.equal(c.json.status, 'cancelled');
  assert.equal((await s.call('PATCH', `/api/admin/reservations/${a.json.id}`, { cookie, body: { checkout_date: '2026-09-24' } })).status, 200);
  assert.equal((await s.call('PATCH', `/api/admin/reservations/${b.json.id}`, { cookie, body: { notes: 'x' } })).status, 409, 'cancelled is frozen');
  await post({ room_number: '102', first_name: 'Ola', last_name: 'Nordmann', checkin_date: '2026-09-18', checkout_date: '2026-09-20' });
  // list filters
  const all = (await s.call('GET', '/api/admin/reservations', { cookie })).json;
  assert.equal(all.length, 3);
  assert.deepEqual((await s.call('GET', '/api/admin/reservations?status=booked', { cookie })).json.map((r) => r.room_number), ['102', '101']);
  assert.deepEqual((await s.call('GET', '/api/admin/reservations?from=2026-09-21&to=2026-09-21', { cookie })).json.map((r) => r.id), [a.json.id]);
  assert.deepEqual((await s.call('GET', '/api/admin/reservations?arrivals=2026-09-18', { cookie })).json.map((r) => r.room_number), ['102']);
  assert.deepEqual((await s.call('GET', '/api/admin/reservations?departures=2026-09-24', { cookie })).json.map((r) => r.id), [a.json.id]);
  assert.deepEqual((await s.call('GET', '/api/admin/reservations?q=nordm', { cookie })).json.map((r) => r.last_name), ['Nordmann']);
  assert.deepEqual((await s.call('GET', '/api/admin/reservations?q=Janet%20Doe', { cookie })).json.map((r) => r.id), [a.json.id]);
  // rooms on a date: known from sets (factory rooms ignored) and from reservations
  await s.registerSet('S1', { room_number: '101' });
  await s.registerSet('S2', { room_number: '[TV]S2' });
  const rooms = (await s.call('GET', '/api/admin/rooms?date=2026-09-21', { cookie })).json;
  assert.deepEqual(rooms.map((r) => [r.room_number, r.sets, r.occupied, r.checked_in, r.reservation && r.reservation.id]), [['101', 1, true, false, a.json.id], ['102', 0, false, false, null]]);
  const today = (await s.call('GET', '/api/admin/rooms', { cookie })).json;   // 2026-09-18 → Ola arrives
  assert.equal(today.find((r) => r.room_number === '102').arriving, true);
  // export
  const csv = await s.call('GET', '/api/admin/reservations/export?from=2026-09-01&to=2026-09-30', { cookie });
  assert.equal(csv.status, 200); assert.match(csv.headers['content-type'], /text\/csv/);
  const lines = csv.text.trim().split('\r\n');
  assert.equal(lines[0], 'id,room,first_name,last_name,checkin_date,checkout_date,nights,lang,vip,status,source,notes,created_at');
  assert.equal(lines.length, 4); assert.match(lines[2], /^1,101,Janet,Doe,2026-09-20,2026-09-24,4,en,1,booked,manual,late arrival,/);
  const logs = (await s.call('GET', '/api/admin/pms/log', { cookie })).json;
  assert.deepEqual(logs.slice(0, 3).map((l) => l.event), ['created', 'updated', 'cancelled']);
  assert.equal(logs[1].payload.changes.checkout_date[1], '2026-09-24');
});

test('scheduler: local check-in/out times, guest variables pushed live, welcome popup, checkout command, vacant layout, expiry', async (t) => {
  let clock = new Date('2026-09-20T11:59:00Z');   // 13:59 in Amsterdam (CEST)
  const s = await startServer({ now: () => clock }); t.after(s.close);
  const { cookie } = await s.login();
  await s.call('PATCH', '/api/admin/tenant', { cookie, body: { settings: { timezone: 'Europe/Amsterdam', checkin_time: '14:00', checkout_time: '11:00', checkout_message: 'Bye!' } } });
  assert.equal((await s.call('PATCH', '/api/admin/tenant', { cookie, body: { settings: { checkin_time: '25:00' } } })).status, 400);
  assert.equal((await s.call('PATCH', '/api/admin/tenant', { cookie, body: { settings: { timezone: 'Mars/Olympus' } } })).status, 400);
  const L = (await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Rooms', json: { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [{ id: 'w', type: 'text', x: 0, y: 0, w: 800, h: 80, text: 'Welcome {{guest_first}} · {{nights}} nights until {{checkout_date}}' }], pages: [{ id: 'home', name: 'Home', zones: ['w'] }], home: 'home' } } })).json;
  const V = (await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Vacant', json: { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [{ id: 't', type: 'text', x: 0, y: 0, w: 800, h: 80, text: 'Room {{room}}' }], pages: [{ id: 'home', name: 'Home', zones: ['t'] }], home: 'home' } } })).json;
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'Std' } })).json;
  await s.call('PUT', `/api/admin/groups/${g.id}/layout`, { cookie, body: { layout_id: L.id } });
  const gp = await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { vacant_layout_id: V.id, welcome_popup_s: 8 } });
  assert.equal(gp.status, 200, gp.text); assert.equal(gp.json.vacant_layout_id, V.id); assert.equal(gp.json.welcome_popup_s, 8);
  assert.equal((await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { welcome_popup_s: 9999 } })).status, 400);
  assert.equal((await s.call('GET', '/api/admin/groups', { cookie })).json[0].vacant_layout_name, 'Vacant');
  const reg = await s.registerSet('S1');
  await s.call('PATCH', `/api/admin/sets/${reg.json.set_id}`, { cookie, body: { room_number: '101', group_id: g.id } });
  const poll = () => s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`).then((r) => r.json);
  let st = await poll();
  assert.equal(st.layout.name, 'Vacant', 'vacant room → vacant layout'); assert.equal(st.context.guest, ''); assert.equal(st.context.occupied, false); assert.equal(st.context.room, '101');
  const res = (await s.call('POST', '/api/admin/reservations', { cookie, body: { room_number: '101', first_name: 'Jane', last_name: 'Doe', checkin_date: '2026-09-20', checkout_date: '2026-09-22', lang: 'nl' } })).json;
  assert.equal(res.status, 'booked');
  // WS to watch the push
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${reg.json.set_id}&token=${reg.json.token}`, { headers: { Host: 'hoteldemo.caritech.net' } });
  const msgs = []; ws.on('message', (m) => msgs.push(JSON.parse(m.toString())));
  await new Promise((r) => ws.once('open', r)); await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(s.pms.tick(), { checkins: 0, checkouts: 0, expired: 0 }, '13:59 local: not yet');
  assert.equal((await poll()).context.guest, '');
  clock = new Date('2026-09-20T12:00:00Z');   // 14:00 local
  assert.deepEqual(s.pms.tick(), { checkins: 1, checkouts: 0, expired: 0 });
  assert.deepEqual(s.pms.tick(), { checkins: 0, checkouts: 0, expired: 0 }, 'idempotent');
  st = await poll();
  assert.equal(st.layout.name, 'Rooms'); assert.equal(st.context.guest, 'Jane Doe'); assert.equal(st.context.guest_first, 'Jane'); assert.equal(st.context.guest_last, 'Doe');
  assert.equal(st.context.nights, '2'); assert.equal(st.context.checkin_date, '2026-09-20'); assert.equal(st.context.checkout_date, '2026-09-22'); assert.equal(st.context.guest_lang, 'nl'); assert.equal(st.context.occupied, true);
  await new Promise((r) => setTimeout(r, 150));
  const push = msgs.filter((m) => m.type === 'layout').pop();
  assert.ok(push && push.context.guest === 'Jane Doe' && push.layout.name === 'Rooms', 'layout+context pushed over WS at check-in');
  const welcome = msgs.find((m) => m.type === 'command' && m.command.type === 'message');
  assert.ok(welcome, 'welcome popup command delivered'); assert.deepEqual(welcome.command.payload, { text: 'Welcome Jane Doe', ttl_s: 8 });
  const r1 = (await s.call('GET', `/api/admin/reservations/${res.id}`, { cookie })).json;
  assert.equal(r1.status, 'checked_in'); assert.ok(r1.checked_in_at);
  const rooms = (await s.call('GET', '/api/admin/rooms', { cookie })).json;
  assert.equal(rooms[0].checked_in, true); assert.equal(rooms[0].current.id, res.id);
  // editing the checked-in guest's name reaches the set immediately
  await s.call('PATCH', `/api/admin/reservations/${res.id}`, { cookie, body: { last_name: 'Doe-Smith' } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(msgs.filter((m) => m.type === 'layout').pop().context.guest, 'Jane Doe-Smith');
  // a booked no-show whose stay ends today is expired at check-out time, never checked in
  await s.call('POST', '/api/admin/reservations', { cookie, body: { room_number: '105', last_name: 'Ghost', checkin_date: '2026-09-19', checkout_date: '2026-09-22' } });
  clock = new Date('2026-09-22T08:59:00Z');   // 10:59 local on the check-out day
  assert.deepEqual(s.pms.tick(), { checkins: 1, checkouts: 0, expired: 0 }, 'the no-show is still checked in on its arrival-day catch-up (dates say occupied)');
  clock = new Date('2026-09-22T09:00:00Z');   // 11:00 local
  const out = s.pms.tick();
  assert.equal(out.checkouts, 2);
  st = await poll();
  assert.equal(st.layout.name, 'Vacant'); assert.equal(st.context.guest, ''); assert.equal(st.context.occupied, false);
  await new Promise((r) => setTimeout(r, 150));
  const co = msgs.find((m) => m.type === 'command' && m.command.type === 'checkout');
  assert.ok(co, 'checkout command delivered to the room set'); assert.deepEqual(co.command.payload, { message: 'Bye!' });
  assert.equal((await s.call('GET', `/api/admin/reservations/${res.id}`, { cookie })).json.status, 'checked_out');
  // expiry path: booked, dates passed, never arrived
  await s.call('POST', '/api/admin/reservations', { cookie, body: { room_number: '106', last_name: 'Late', checkin_date: '2026-09-23', checkout_date: '2026-09-24' } });
  clock = new Date('2026-09-25T12:00:00Z');
  assert.deepEqual(s.pms.tick(), { checkins: 0, checkouts: 0, expired: 1 });
  const log = (await s.call('GET', '/api/admin/pms/log', { cookie })).json;
  assert.ok(log.some((l) => l.event === 'expired' && l.source === 'scheduler'));
  assert.ok(log.some((l) => l.event === 'checked_in' && l.source === 'scheduler'));
  assert.ok(s.logs.some((l) => /pms hoteldemo: check-in room 101 Jane Doe \(scheduler\)/.test(l)));
  ws.close();
});

test('manual check-in now (early arrival) and check-out now; frozen after check-out; room move pushes both rooms', async (t) => {
  let clock = new Date('2026-09-18T15:00:00Z');
  const s = await startServer({ now: () => clock }); t.after(s.close);
  const { cookie } = await s.login();
  const reg = await s.registerSet('S1'); await s.call('PATCH', `/api/admin/sets/${reg.json.set_id}`, { cookie, body: { room_number: '102' } });
  const poll = () => s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`).then((r) => r.json);
  const r = (await s.call('POST', '/api/admin/reservations', { cookie, body: { room_number: '102', first_name: 'Max', last_name: 'Muster', checkin_date: '2026-09-19', checkout_date: '2026-09-22' } })).json;
  // a guest still in the room until tomorrow blocks the early arrival
  const prev = (await s.call('POST', '/api/admin/reservations', { cookie, body: { room_number: '102', last_name: 'Prev', checkin_date: '2026-09-17', checkout_date: '2026-09-19' } })).json;
  await s.call('POST', `/api/admin/reservations/${prev.id}/checkin`, { cookie });
  const blocked = await s.call('POST', `/api/admin/reservations/${r.id}/checkin`, { cookie });
  assert.equal(blocked.status, 409); assert.match(blocked.json.error, /still occupied by Prev until 2026-09-19/);
  assert.equal((await poll()).context.guest, 'Prev');
  const pout = await s.call('POST', `/api/admin/reservations/${prev.id}/checkout`, { cookie });
  assert.equal(pout.json.status, 'checked_out'); assert.equal(pout.json.checkout_date, '2026-09-18', 'early departure shortens the stay to today');
  assert.equal((await poll()).context.guest, '');
  const ci = await s.call('POST', `/api/admin/reservations/${r.id}/checkin`, { cookie });
  assert.equal(ci.status, 200, ci.text); assert.equal(ci.json.status, 'checked_in'); assert.equal(ci.json.checkin_date, '2026-09-18', 'early arrival starts the stay today');
  assert.equal((await poll()).context.guest, 'Max Muster');
  // moving the guest to another room: the old room's set goes blank, the new one shows him
  const reg2 = await s.registerSet('S2'); await s.call('PATCH', `/api/admin/sets/${reg2.json.set_id}`, { cookie, body: { room_number: '103' } });
  const mv = await s.call('PATCH', `/api/admin/reservations/${r.id}`, { cookie, body: { room_number: '103' } });
  assert.equal(mv.status, 200);
  assert.equal((await poll()).context.guest, '');
  assert.equal((await s.call('GET', `/api/tv/poll?set_id=${reg2.json.set_id}&token=${reg2.json.token}`)).json.context.guest, 'Max Muster');
  clock = new Date('2026-09-20T09:00:00Z');
  const co = await s.call('POST', `/api/admin/reservations/${r.id}/checkout`, { cookie });
  assert.equal(co.json.status, 'checked_out'); assert.equal(co.json.checkout_date, '2026-09-20');
  const cmds = (await s.call('GET', `/api/admin/sets/${reg2.json.set_id}`, { cookie })).json.commands;
  assert.ok(cmds.some((c) => c.type === 'checkout'), 'checkout queued for the set in 103');
  assert.equal((await s.call('PATCH', `/api/admin/reservations/${r.id}`, { cookie, body: { notes: 'x' } })).status, 409);
  assert.equal((await s.call('POST', `/api/admin/reservations/${r.id}/checkin`, { cookie })).status, 409);
  // cancelling a checked-in guest checks him out (command queued)
  const r3 = (await s.call('POST', '/api/admin/reservations', { cookie, body: { room_number: '102', last_name: 'Quick', checkin_date: '2026-09-20', checkout_date: '2026-09-21' } })).json;
  await s.call('POST', `/api/admin/reservations/${r3.id}/checkin`, { cookie });
  assert.equal((await poll()).context.guest, 'Quick');
  const cx = await s.call('DELETE', `/api/admin/reservations/${r3.id}`, { cookie });
  assert.equal(cx.json.status, 'cancelled'); assert.equal((await poll()).context.guest, '');
  assert.ok((await s.call('GET', `/api/admin/sets/${reg.json.set_id}`, { cookie })).json.commands.some((c) => c.type === 'checkout'));
});

// Tiny STORE-only zip writer so the test can build a real .xlsx without a dependency.
function zipStore(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8'), n = Buffer.from(name), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, n, data); central.push(ch, n); off += lh.length + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length / 2, 8); eocd.writeUInt16LE(central.length / 2, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, eocd]);
}
function sampleXlsx() {
  return zipStore({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Res" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Zimmer</t></si><si><t>Name</t></si><si><t>Anreise</t></si><si><t>Abreise</t></si><si><r><t>Müller, </t></r><r><t>Hans</t></r></si><si><t>Bloggs Joe</t></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
      '<row r="2"><c r="A2"><v>201</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" s="1"><v>46285</v></c><c r="D2" s="2"><v>46288</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>202</t></is></c><c r="B3" t="s"><v>5</v></c><c r="C3"><v>46285</v></c><c r="D3" t="str"><v>2026-09-25</v></c></row>' +
      '</sheetData></worksheet>',
  });
}

test('import: parse CSV/XLSX, mapping guess, preview validation, commit with skipped report, dedupe, profiles', async (t) => {
  const s = await startServer({ now: () => new Date('2026-09-18T10:00:00Z') }); t.after(s.close);
  const { cookie } = await s.login();
  await s.call('POST', '/api/admin/reservations', { cookie, body: { room_number: '101', last_name: 'Existing', checkin_date: '2026-09-21', checkout_date: '2026-09-23' } });
  const csv = 'Kamer;Voornaam;Achternaam;Aankomst;Vertrek;Opmerking\r\n101;Jane;Doe;20/09/2026;21/09/2026;early\r\n101;Bad;Overlap;22/09/2026;24/09/2026;\r\n102;Ola;Nordmann;31/02/2026;22/09/2026;\r\n;No;Room;20/09/2026;22/09/2026;\r\n103;Twice;A;20/09/2026;22/09/2026;\r\n103;Twice;B;21/09/2026;23/09/2026;\r\n104;"Quote ""Q""";Ok;2026-09-20;2026-09-22;"multi\nline"\r\n';
  const parsed = await s.call('POST', '/api/admin/import/parse', { cookie, body: { filename: 'export.csv', content_base64: Buffer.from(csv).toString('base64') } });
  assert.equal(parsed.status, 200, parsed.text);
  assert.deepEqual(parsed.json.headers, ['Kamer', 'Voornaam', 'Achternaam', 'Aankomst', 'Vertrek', 'Opmerking']);
  assert.equal(parsed.json.total, 7); assert.equal(parsed.json.kind, 'csv');
  assert.deepEqual(parsed.json.guess, { room: 0, first_name: 1, last_name: 2, checkin: 3, checkout: 4, notes: 5 });
  assert.equal(parsed.json.rows[6][1], 'Quote "Q"'); assert.equal(parsed.json.rows[6][5], 'multi\nline');
  const mapping = parsed.json.guess;
  assert.match((await s.call('POST', '/api/admin/import/preview', { cookie, body: { rows: parsed.json.rows, mapping: { room: 0 }, date_format: 'auto' } })).json.error, /map a column to "checkin"/);
  const pv = await s.call('POST', '/api/admin/import/preview', { cookie, body: { rows: parsed.json.rows, mapping, date_format: 'DD/MM/YYYY' } });
  assert.equal(pv.status, 200, pv.text); assert.equal(pv.json.ok, 2); assert.equal(pv.json.bad, 5);
  const err = (i) => pv.json.rows[i].errors.join('; ');
  assert.equal(err(0), '');
  assert.match(err(1), /already has Existing/);
  assert.match(err(2), /bad check-in date "31\/02\/2026"/);
  assert.match(err(3), /room is required/);
  assert.equal(err(4), '');
  assert.match(err(5), /overlaps row 5 in this file/);
  assert.match(err(6), /bad check-in date "2026-09-20"/, 'strict format: ISO is rejected under DD/MM/YYYY');
  // auto format accepts both spellings
  const pv2 = (await s.call('POST', '/api/admin/import/preview', { cookie, body: { rows: parsed.json.rows, mapping, date_format: 'auto' } })).json;
  assert.equal(pv2.ok, 3);
  const done = await s.call('POST', '/api/admin/import/commit', { cookie, body: { rows: parsed.json.rows, mapping, date_format: 'auto' } });
  assert.equal(done.status, 200, done.text); assert.equal(done.json.imported, 3); assert.equal(done.json.skipped.length, 4);
  assert.deepEqual(done.json.skipped.map((x) => x.row), [2, 3, 4, 6]);
  assert.deepEqual(done.json.reservations.map((r) => [r.room_number, r.guest, r.source, r.notes]), [['101', 'Jane Doe', 'import', 'early'], ['103', 'Twice A', 'import', null], ['104', 'Quote "Q" Ok', 'import', 'multi\nline']]);
  const again = (await s.call('POST', '/api/admin/import/commit', { cookie, body: { rows: parsed.json.rows, mapping, date_format: 'auto' } })).json;
  assert.equal(again.imported, 0); assert.match(again.skipped[0].reason, /already imported \(reservation #/);
  const pv3 = (await s.call('POST', '/api/admin/import/preview', { cookie, body: { rows: parsed.json.rows, mapping, date_format: 'auto' } })).json;
  assert.match(pv3.rows[0].errors[0], /already imported/, 'the preview says so before committing');
  const report = await s.call('POST', '/api/admin/import/report', { cookie, body: { skipped: done.json.skipped, headers: parsed.json.headers } });
  assert.match(report.headers['content-type'], /text\/csv/);
  assert.equal(report.text.split('\r\n')[0], 'row,reason,Kamer,Voornaam,Achternaam,Aankomst,Vertrek,Opmerking');
  assert.match(report.text, /^2,room 101 already has Existing[^\n]*,101,Bad,Overlap/m);
  // profiles
  const prof = await s.call('POST', '/api/admin/import-profiles', { cookie, body: { name: 'Mews export', mapping, date_format: 'DD/MM/YYYY' } });
  assert.equal(prof.status, 200, prof.text); assert.equal(prof.json.name, 'Mews export'); assert.deepEqual(prof.json.mapping, mapping); assert.equal(prof.json.date_format, 'DD/MM/YYYY');
  await s.call('POST', '/api/admin/import-profiles', { cookie, body: { name: 'Mews export', mapping: { ...mapping, notes: undefined }, date_format: 'auto' } });
  const list = (await s.call('GET', '/api/admin/import-profiles', { cookie })).json;
  assert.equal(list.length, 1); assert.equal(list[0].date_format, 'auto'); assert.equal(list[0].mapping.notes, undefined, 'same name overwrites');
  assert.equal((await s.call('DELETE', `/api/admin/import-profiles/${list[0].id}`, { cookie })).status, 200);
  assert.equal((await s.call('GET', '/api/admin/import-profiles', { cookie })).json.length, 0);
  // XLSX: shared strings (rich text runs), inline strings, date-styled serials → ISO, plain serials stay numbers
  const rows = readXlsx(sampleXlsx());
  assert.deepEqual(rows, [['Zimmer', 'Name', 'Anreise', 'Abreise'], [201, 'Müller, Hans', '2026-09-20', '2026-09-23'], ['202', 'Bloggs Joe', 46285, '2026-09-25']]);
  const px = await s.call('POST', '/api/admin/import/parse', { cookie, body: { filename: 'res.xlsx', content_base64: sampleXlsx().toString('base64') } });
  assert.equal(px.status, 200, px.text); assert.equal(px.json.kind, 'xlsx');
  assert.deepEqual(px.json.guess, { room: 0, last_name: 1, checkin: 2, checkout: 3 });
  const pvx = (await s.call('POST', '/api/admin/import/preview', { cookie, body: { rows: px.json.rows, mapping: px.json.guess, date_format: 'auto' } })).json;
  assert.equal(pvx.bad, 0, JSON.stringify(pvx.rows));
  assert.deepEqual(pvx.rows.map((r) => [r.value.room_number, r.value.first_name, r.value.last_name, r.value.checkin_date, r.value.checkout_date]), [['201', 'Hans', 'Müller', '2026-09-20', '2026-09-23'], ['202', 'Bloggs', 'Joe', '2026-09-20', '2026-09-25']]);
  assert.equal((await s.call('POST', '/api/admin/import/parse', { cookie, body: { filename: 'x.xlsx', content_base64: Buffer.from('nope').toString('base64') } })).status, 400, 'not a zip → 400');
});

test('external PMS API: per-tenant key, 401 without it, idempotent create, status changes, rooms, log, revoke; tenant admin cannot see other tenants', async (t) => {
  const s = await startServer({ now: () => new Date('2026-09-18T10:00:00Z') }); t.after(s.close);
  const { cookie } = await s.login();
  assert.equal((await s.call('GET', '/api/admin/pms/settings', { cookie })).json.api_key, null);
  const k = (await s.call('POST', '/api/admin/pms/key', { cookie })).json;
  assert.match(k.key, /^ccpms_[A-Za-z0-9_-]{32}$/); assert.equal(k.prefix, k.key.slice(0, 12));
  const settings = (await s.call('GET', '/api/admin/pms/settings', { cookie })).json;
  assert.equal(settings.api_key.prefix, k.prefix); assert.equal(settings.checkin_time, '14:00'); assert.equal(settings.today, '2026-09-18');
  assert.ok(!JSON.stringify((await s.call('GET', '/api/admin/tenant', { cookie })).json).includes(k.key.slice(6)), 'the key never comes back');
  const api = (method, url, body, key = k.key) => s.call(method, url, { body, headers: key ? { Authorization: `Bearer ${key}` } : {} });
  assert.equal((await api('GET', '/api/pms/rooms', undefined, null)).status, 401);
  assert.equal((await api('GET', '/api/pms/rooms', undefined, 'ccpms_wrong')).status, 401);
  const c1 = await api('POST', '/api/pms/reservations', { room: '301', first_name: 'Api', last_name: 'Guest', checkin: '2026-09-18', checkout: '2026-09-20', lang: 'de' });
  assert.equal(c1.status, 201, c1.text); assert.equal(c1.json.source, 'api'); assert.equal(c1.json.room_number, '301');
  const c2 = await api('POST', '/api/pms/reservations', { room: '301', first_name: 'Api', last_name: 'Guest', checkin: '2026-09-18', checkout: '2026-09-20' });
  assert.equal(c2.status, 200); assert.equal(c2.json.id, c1.json.id, 'idempotent');
  assert.equal((await api('POST', '/api/pms/reservations', { room: '301', last_name: 'Other', checkin_date: '2026-09-19', checkout_date: '2026-09-21' })).status, 400);
  const xkey = await s.call('POST', '/api/pms/reservations', { body: { room: '302', last_name: 'H', checkin: '2026-09-18', checkout: '2026-09-19' }, headers: { 'X-Api-Key': k.key } });
  assert.equal(xkey.status, 201, 'X-Api-Key works too');
  const ci = await api('PATCH', `/api/pms/reservations/${c1.json.id}`, { status: 'checked_in' });
  assert.equal(ci.json.status, 'checked_in');
  const up = await api('PATCH', `/api/pms/reservations/${c1.json.id}`, { checkout: '2026-09-21', notes: 'extended' });
  assert.equal(up.status, 200, up.text); assert.equal(up.json.checkout_date, '2026-09-21');
  const rooms = (await api('GET', '/api/pms/rooms?date=2026-09-18')).json;
  assert.deepEqual(rooms.map((r) => [r.room_number, r.checked_in]), [['301', true], ['302', false]]);
  assert.equal((await api('GET', `/api/pms/reservations/${c1.json.id}`)).json.notes, 'extended');
  assert.equal((await api('PATCH', `/api/pms/reservations/${c1.json.id}`, { status: 'checked_out' })).json.status, 'checked_out');
  assert.equal((await api('PATCH', `/api/pms/reservations/${xkey.json.id}`, { status: 'cancelled' })).json.status, 'cancelled');
  const log = (await s.call('GET', '/api/admin/pms/log', { cookie })).json;
  assert.deepEqual(log.map((l) => l.source).filter((x) => x === 'api').length, 6);
  assert.ok(s.logs.some((l) => /pms api hoteldemo: create 301/.test(l)));
  await s.call('DELETE', '/api/admin/pms/key', { cookie });
  assert.equal((await api('GET', '/api/pms/rooms')).status, 401, 'revoked');
  assert.equal((await s.call('GET', '/api/admin/pms/settings', { cookie })).json.api_key, null);
});
