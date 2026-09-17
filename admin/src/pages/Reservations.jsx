import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, patch, del } from '../api.js';
import { useAsync, Modal, Confirm, Field, Empty, useToast } from '../components/ui.jsx';
import { timeAgo } from '../util.js';

// Rooms & reservations (Phase 3 Part C). Calendar: rooms down, days across, bars from check-in
// to check-out; click a bar to edit, an empty cell to add. List: search/sort/status plus
// arrivals/departures today. The server keeps the occupancy rule and the scheduler.
const DAY = 86400000;
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY);
const STATUS_LABEL = { booked: 'booked', checked_in: 'checked in', checked_out: 'checked out', cancelled: 'cancelled' };
const LANGS = ['', 'en', 'nl', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'tr', 'ar', 'zh', 'ja'];
const fmtDay = (s) => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
const fmtMonth = (s) => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

export default function Reservations() {
  const toast = useToast();
  const pmsSettings = useAsync(() => get('/pms/settings'), []);
  const today = (pmsSettings.data && pmsSettings.data.today) || iso(new Date());
  const groups = useAsync(() => get('/groups'), []);
  const [tab, setTab] = useState('calendar');
  const [group, setGroup] = useState('');
  const [span, setSpan] = useState(7);
  const [start, setStart] = useState(null);
  const from = start || addDays(today, -1);
  const to = addDays(from, span - 1);
  const rooms = useAsync(() => get(`/rooms?date=${today}${group ? '&group_id=' + group : ''}`), [today, group]);
  const list = useAsync(() => get(`/reservations?from=${from}&to=${to}${group ? '&group_id=' + group : ''}`), [from, to, group]);
  const [editing, setEditing] = useState(null);   // null | {} new | reservation
  const reload = () => { rooms.reload(); list.reload(); };

  const exportUrl = `/api/admin/reservations/export?from=${from}&to=${to}`;
  return (
    <>
      <div className="topbar"><h1>Rooms &amp; reservations</h1>
        <div className="actions">
          <Link className="btn" to="/rooms/import">Import…</Link>
          <a className="btn" href={exportUrl} download>Export CSV</a>
          <button className="primary" onClick={() => setEditing({ checkin_date: today, checkout_date: addDays(today, 1) })}>New reservation</button>
        </div></div>
      <p className="muted small">The platform is the PMS: a room is occupied on a day when a reservation spans it. Guests are checked in at {pmsSettings.data ? pmsSettings.data.checkin_time : '14:00'} and out at {pmsSettings.data ? pmsSettings.data.checkout_time : '11:00'} ({pmsSettings.data ? pmsSettings.data.timezone : 'tenant time'}, <Link to="/settings">Settings</Link>); the TVs in the room get the guest's name at check-in and a checkout (LG wipes the apps) at check-out.</p>
      <div className="inline" style={{ marginBottom: 10, gap: 12 }}>
        <div className="editor-tabs" role="tablist">
          {[['calendar', 'Calendar'], ['list', 'List'], ['arrivals', 'Arrivals today'], ['departures', 'Departures today']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filter by group"><option value="">all groups</option>{(groups.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      </div>
      {tab === 'calendar' && <Calendar rooms={rooms.data || []} reservations={list.data || []} from={from} span={span} today={today}
        onNav={(n) => setStart(addDays(from, n))} onToday={() => setStart(null)} onSpan={(n) => setSpan(n)}
        onPick={(r) => setEditing(r)} onAdd={(room, date) => setEditing({ room_number: room, checkin_date: date, checkout_date: addDays(date, 1) })} />}
      {tab !== 'calendar' && <ListView mode={tab} today={today} group={group} onPick={(r) => setEditing(r)} refreshKey={list.data} />}
      {editing && <ReservationModal res={editing} rooms={rooms.data || []} today={today} onClose={() => setEditing(null)} onChanged={() => { setEditing(null); reload(); }} toast={toast} />}
    </>
  );
}

function Calendar({ rooms, reservations, from, span, today, onNav, onToday, onSpan, onPick, onAdd }) {
  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(from, i)), [from, span]);
  const to = days[days.length - 1];
  const roomList = useMemo(() => {
    const set = new Map(rooms.map((r) => [r.room_number, r]));
    for (const r of reservations) if (!set.has(r.room_number)) set.set(r.room_number, { room_number: r.room_number, sets: 0 });
    return Array.from(set.values()).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  }, [rooms, reservations]);
  const cols = `120px repeat(${span}, minmax(${span > 14 ? 34 : 90}px, 1fr))`;
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="inline">
          <button className="sm" onClick={() => onNav(-span)} aria-label="Previous period">‹</button>
          <button className="sm" onClick={onToday}>Today</button>
          <button className="sm" onClick={() => onNav(span)} aria-label="Next period">›</button>
          <b style={{ marginLeft: 8 }}>{fmtMonth(from)}{fmtMonth(from) !== fmtMonth(to) ? ' – ' + fmtMonth(to) : ''}</b>
        </div>
        <div className="segmented" role="group" aria-label="Calendar span"><button className={span === 7 ? 'active' : ''} onClick={() => onSpan(7)}>Week</button><button className={span === 30 ? 'active' : ''} onClick={() => onSpan(30)}>Month</button></div>
      </div>
      {roomList.length === 0 ? <Empty>No rooms yet. Rooms appear when a set gets a room number or when you add a reservation.</Empty> : (
        <div className="cal" style={{ gridTemplateColumns: cols }} data-testid="calendar">
          <div className="cal-head cal-corner">Room</div>
          {days.map((d) => <div key={d} className={'cal-head' + (d === today ? ' today' : '')}>{span > 14 ? d.slice(-2) : fmtDay(d)}</div>)}
          {roomList.map((room, ri) => {
            const row = ri + 2;
            const bars = reservations.filter((r) => r.room_number === room.room_number && r.status !== 'cancelled' && r.checkin_date <= to && r.checkout_date > from);
            return (
              <React.Fragment key={room.room_number}>
                <div className="cal-room" style={{ gridRow: row }}><b>{room.room_number}</b>{room.group_name && <div className="muted small">{room.group_name}</div>}{room.sets > 0 && <div className="muted small">{room.sets} set{room.sets > 1 ? 's' : ''}</div>}</div>
                {days.map((d, di) => <button key={d} type="button" className={'cal-cell' + (d === today ? ' today' : '')} style={{ gridRow: row, gridColumn: di + 2 }} aria-label={`add reservation room ${room.room_number} on ${d}`} data-testid="cal-cell" data-room={room.room_number} data-date={d} onClick={() => onAdd(room.room_number, d)} />)}
                {bars.map((r) => {
                  const s = Math.max(0, daysBetween(from, r.checkin_date)), e = Math.min(span, daysBetween(from, r.checkout_date));
                  return <button key={r.id} type="button" className={`cal-bar st-${r.status}${r.vip ? ' vip' : ''}${r.checkin_date < from ? ' cut-l' : ''}${r.checkout_date > to ? ' cut-r' : ''}`} style={{ gridRow: row, gridColumn: `${s + 2} / ${e + 2}` }}
                    title={`${r.guest} · ${r.checkin_date} → ${r.checkout_date} · ${STATUS_LABEL[r.status]}`} data-testid="cal-bar" data-id={r.id} onClick={() => onPick(r)}>{r.vip ? '★ ' : ''}{r.guest || '(no name)'}</button>;
                })}
              </React.Fragment>);
          })}
        </div>)}
      <div className="muted small" style={{ marginTop: 8 }}><span className="pill st-booked">booked</span> <span className="pill st-checked_in">checked in</span> <span className="pill st-checked_out">checked out</span> · click a bar to edit, an empty day to add.</div>
    </div>
  );
}

function ListView({ mode, today, group, onPick, refreshKey }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState(['checkin_date', 1]);
  const url = mode === 'arrivals' ? `/reservations?arrivals=${today}` : mode === 'departures' ? `/reservations?departures=${today}` : `/reservations?${status ? 'status=' + status + '&' : ''}${q ? 'q=' + encodeURIComponent(q) : ''}`;
  const data = useAsync(() => get(url + (group ? '&group_id=' + group : '')), [url, group, refreshKey]);
  const rows = useMemo(() => (data.data || []).slice().sort((a, b) => { const [k, dir] = sort; const x = a[k] == null ? '' : String(a[k]), y = b[k] == null ? '' : String(b[k]); return x.localeCompare(y, undefined, { numeric: true }) * dir; }), [data.data, sort]);
  const th = (k, l) => <th onClick={() => setSort([k, sort[0] === k ? -sort[1] : 1])} style={{ cursor: 'pointer' }} aria-sort={sort[0] === k ? (sort[1] > 0 ? 'ascending' : 'descending') : 'none'}>{l}{sort[0] === k ? (sort[1] > 0 ? ' ▲' : ' ▼') : ''}</th>;
  return (
    <div className="card" style={{ padding: 0 }}>
      {mode === 'list' && <div className="inline" style={{ padding: 10, gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, room, notes" aria-label="Search reservations" style={{ width: 260 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter"><option value="">any status</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="muted small">{rows.length} reservation(s)</span>
      </div>}
      {rows.length === 0 ? <Empty>{mode === 'arrivals' ? 'No arrivals today.' : mode === 'departures' ? 'No departures today.' : 'No reservations match.'}</Empty> : (
        <table>
          <thead><tr>{th('room_number', 'Room')}{th('last_name', 'Guest')}{th('checkin_date', 'Check-in')}{th('checkout_date', 'Check-out')}<th className="num">Nights</th>{th('status', 'Status')}<th>Source</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} data-testid="res-row" data-id={r.id}>
              <td><b>{r.room_number}</b></td>
              <td>{r.vip ? '★ ' : ''}{r.guest}{r.lang ? <span className="pill" style={{ marginLeft: 6 }}>{r.lang}</span> : null}{r.notes ? <div className="muted small">{r.notes}</div> : null}</td>
              <td>{r.checkin_date}</td><td>{r.checkout_date}</td><td className="num">{r.nights}</td>
              <td><span className={`pill st-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
              <td className="muted small">{r.source}<div>{timeAgo(r.updated_at)}</div></td>
              <td style={{ textAlign: 'right' }}><button className="sm" onClick={() => onPick(r)}>Open</button></td>
            </tr>))}</tbody>
        </table>)}
    </div>
  );
}

function ReservationModal({ res, rooms, today, onClose, onChanged, toast }) {
  const isNew = !res.id;
  const [f, setF] = useState({ room_number: res.room_number || '', first_name: res.first_name || '', last_name: res.last_name || '', checkin_date: res.checkin_date || today, checkout_date: res.checkout_date || addDays(today, 1), lang: res.lang || '', vip: !!res.vip, notes: res.notes || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(null);
  const frozen = !isNew && (res.status === 'checked_out' || res.status === 'cancelled');
  const nights = daysBetween(f.checkin_date, f.checkout_date);
  const set = (k, v) => setF({ ...f, [k]: v });
  async function run(fn, msg) {
    setBusy(true); setErr('');
    try { await fn(); if (msg) toast(msg); onChanged(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const save = () => run(async () => { if (isNew) await post('/reservations', f); else await patch(`/reservations/${res.id}`, f); }, isNew ? 'Reservation added' : 'Reservation saved');
  const checkin = () => run(() => post(`/reservations/${res.id}/checkin`), 'Checked in — the room’s TVs show the guest now');
  const checkout = () => run(() => post(`/reservations/${res.id}/checkout`), 'Checked out — checkout sent to the room’s TVs');
  const cancel = () => run(() => del(`/reservations/${res.id}`), 'Reservation cancelled');
  return (
    <Modal title={isNew ? 'New reservation' : `Reservation #${res.id} · ${STATUS_LABEL[res.status]}`} onClose={onClose} footer={<>
      {!isNew && !frozen && <button className="danger" disabled={busy} onClick={() => setConfirm('cancel')}>Cancel reservation</button>}
      {!isNew && res.status === 'booked' && <button disabled={busy} onClick={() => setConfirm('checkin')}>Check in now</button>}
      {!isNew && res.status === 'checked_in' && <button disabled={busy} onClick={() => setConfirm('checkout')}>Check out now</button>}
      <span style={{ flex: 1 }} />
      <button onClick={onClose}>Close</button>
      {!frozen && <button className="primary" disabled={busy || !f.room_number || (!f.first_name && !f.last_name) || nights < 1} onClick={save}>{isNew ? 'Add' : 'Save'}</button>}
    </>}>
      {err && <div className="error" role="alert" style={{ marginBottom: 8 }}>{err}</div>}
      {frozen && <p className="muted small">This reservation is {STATUS_LABEL[res.status]} and can no longer be edited.</p>}
      <div className="row">
        <Field label="Room"><input list="known-rooms" value={f.room_number} onChange={(e) => set('room_number', e.target.value)} aria-label="Room" disabled={frozen} autoFocus={isNew && !f.room_number} /><datalist id="known-rooms">{rooms.map((r) => <option key={r.room_number} value={r.room_number} />)}</datalist></Field>
        <Field label="Language"><select value={f.lang} onChange={(e) => set('lang', e.target.value)} aria-label="Language" disabled={frozen}>{LANGS.map((l) => <option key={l} value={l}>{l || '—'}</option>)}</select></Field>
        <Field label="VIP"><label className="inline"><input type="checkbox" checked={f.vip} onChange={(e) => set('vip', e.target.checked)} aria-label="VIP" disabled={frozen} /> VIP guest</label></Field>
      </div>
      <div className="row">
        <Field label="First name"><input value={f.first_name} onChange={(e) => set('first_name', e.target.value)} aria-label="First name" disabled={frozen} /></Field>
        <Field label="Last name"><input value={f.last_name} onChange={(e) => set('last_name', e.target.value)} aria-label="Last name" disabled={frozen} /></Field>
      </div>
      <div className="row">
        <Field label="Check-in date"><input type="date" value={f.checkin_date} onChange={(e) => set('checkin_date', e.target.value)} aria-label="Check-in date" disabled={frozen} /></Field>
        <Field label="Check-out date"><input type="date" value={f.checkout_date} onChange={(e) => set('checkout_date', e.target.value)} aria-label="Check-out date" disabled={frozen} /></Field>
        <Field label="Nights"><div style={{ padding: '6px 0' }}>{nights >= 1 ? nights : <span className="error">check-out must be after check-in</span>}</div></Field>
      </div>
      <Field label="Notes"><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} aria-label="Notes" rows={2} disabled={frozen} /></Field>
      {!isNew && <p className="muted small">Created {timeAgo(res.created_at)} ({res.source}){res.checked_in_at ? ` · checked in ${timeAgo(res.checked_in_at)}` : ''}{res.checked_out_at ? ` · checked out ${timeAgo(res.checked_out_at)}` : ''}.</p>}
      {confirm === 'cancel' && <Confirm title="Cancel this reservation?" text={res.status === 'checked_in' ? 'The guest is checked in: the room’s TVs get a checkout (guest data wiped) and go vacant.' : 'The room becomes free for these dates.'} confirmLabel="Cancel reservation" onConfirm={cancel} onClose={() => setConfirm(null)} />}
      {confirm === 'checkin' && <Confirm title="Check in now?" text={f.checkin_date > today ? `Arrival was planned for ${f.checkin_date}; the stay starts today instead.` : 'The room’s TVs show the guest immediately.'} confirmLabel="Check in" danger={false} onConfirm={checkin} onClose={() => setConfirm(null)} />}
      {confirm === 'checkout' && <Confirm title="Check out now?" text="The room’s TVs receive a checkout: LG wipes the guest’s app sign-ins, the renderer reloads and the room goes vacant." confirmLabel="Check out" onConfirm={checkout} onClose={() => setConfirm(null)} />}
    </Modal>
  );
}
