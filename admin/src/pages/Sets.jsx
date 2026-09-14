import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, patch, del, post } from '../api.js';
import { useAsync, Drawer, Confirm, Field, Status, Empty, useToast } from '../components/ui.jsx';
import { timeAgo, fmtDate, fmtUptime } from '../util.js';
import SetCommands from '../components/SetCommands.jsx';
import BulkBar from '../components/BulkBar.jsx';

export default function Sets() {
  const { id } = useParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const sets = useAsync(() => get('/sets'), []);
  const groups = useAsync(() => get('/groups'), []);
  const layouts = useAsync(() => get('/layouts'), []);
  const lineups = useAsync(() => get('/lineups'), []);
  const [checked, setChecked] = useState([]);
  useEffect(() => { const t = setInterval(sets.reload, 10000); return () => clearInterval(t); }, [sets.reload]);

  const rows = useMemo(() => {
    let r = sets.data || [];
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((x) => [x.serial, x.room_number, x.model, x.group_name, x.ip, x.notes, x.firmware_version].some((v) => v && String(v).toLowerCase().includes(s)));
    if (filter === 'online') r = r.filter((x) => x.online);
    if (filter === 'offline') r = r.filter((x) => !x.online);
    if (filter === 'unassigned') r = r.filter((x) => !x.room_number || !x.group_id);
    return r;
  }, [sets.data, q, filter]);

  const selected = id && sets.data ? sets.data.find((x) => String(x.id) === String(id)) : null;

  return (
    <>
      <div className="topbar">
        <h1>Sets <span className="muted small">{sets.data ? `${rows.length} of ${sets.data.length}` : ''}</span></h1>
        <div className="actions">
          <input className="search" placeholder="Search serial, room, model, IP…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All</option><option value="online">Online</option><option value="offline">Offline</option><option value="unassigned">Unassigned</option>
          </select>
          <button onClick={sets.reload}>Refresh</button>
        </div>
      </div>
      {sets.error && <div className="error">{sets.error.message}</div>}
      {checked.length > 0 && <BulkBar ids={checked} onDone={() => { setChecked([]); sets.reload(); }} />}
      <div className="card" style={{ padding: 0 }}>
        {sets.data && rows.length === 0 ? <Empty>{sets.data.length ? 'No sets match.' : 'No sets yet. A TV registers itself the first time it loads the app.'}</Empty> : (
          <table>
            <thead><tr><th style={{ width: 30 }}><input type="checkbox" aria-label="select all" checked={rows.length > 0 && rows.every((r) => checked.includes(r.id))} onChange={(e) => setChecked(e.target.checked ? rows.map((r) => r.id) : [])} /></th><th>Status</th><th>Room</th><th>Serial</th><th>Model</th><th>Group</th><th>API</th><th>Firmware</th><th>IP</th><th>Last seen</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={'clickable' + (selected && selected.id === s.id ? ' selected' : '')} onClick={() => nav(`/sets/${s.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`select ${s.serial}`} checked={checked.includes(s.id)} onChange={(e) => setChecked(e.target.checked ? [...checked, s.id] : checked.filter((x) => x !== s.id))} /></td>
                  <td><Status online={s.online} ws={s.ws} /></td>
                  <td>{s.room_number ? <b>{s.room_number}</b> : <span className="pill warn">no room</span>}</td>
                  <td className="mono">{s.serial}</td>
                  <td>{s.model || '—'}</td>
                  <td>{s.group_name || <span className="pill warn">no group</span>}</td>
                  <td>{s.api ? s.api.toUpperCase() : '—'}{s.idpn ? <span className="muted small"> IDPN {s.idpn}</span> : null}</td>
                  <td className="small">{s.firmware_version || '—'}</td>
                  <td className="mono small">{s.ip || '—'}</td>
                  <td className="muted small">{timeAgo(s.last_seen)}</td>
                </tr>))}
            </tbody>
          </table>)}
      </div>
      {id && sets.data && !selected && <Drawer title="Set not found" onClose={() => nav('/sets')}><Empty>This set no longer exists.</Empty></Drawer>}
      {selected && <SetDrawer key={selected.id} set={selected} groups={groups.data || []} layouts={layouts.data || []} lineups={lineups.data || []}
        onClose={() => nav('/sets')} onChanged={(s) => sets.setData(sets.data.map((x) => (x.id === s.id ? { ...x, ...s } : x)))}
        onDeleted={() => { sets.setData(sets.data.filter((x) => x.id !== selected.id)); nav('/sets'); }} />}
    </>
  );
}

function SetDrawer({ set, groups, layouts, lineups, onClose, onChanged, onDeleted }) {
  const toast = useToast();
  const [form, setForm] = useState({ room_number: set.room_number || '', group_id: set.group_id || '', layout_override_id: set.layout_override_id || '', lineup_override_id: set.lineup_override_id || '', notes: set.notes || '' });
  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadDetail = useCallback(() => get(`/sets/${set.id}`).then(setDetail, () => {}), [set.id]);
  useEffect(() => { loadDetail(); const t = setInterval(loadDetail, 5000); return () => clearInterval(t); }, [loadDetail]);

  const dirty = form.room_number !== (set.room_number || '') || String(form.group_id) !== String(set.group_id || '') ||
    String(form.layout_override_id) !== String(set.layout_override_id || '') || String(form.lineup_override_id) !== String(set.lineup_override_id || '') || form.notes !== (set.notes || '');

  async function save() {
    setSaving(true);
    try {
      const body = { room_number: form.room_number || null, group_id: form.group_id ? Number(form.group_id) : null,
        layout_override_id: form.layout_override_id ? Number(form.layout_override_id) : null, lineup_override_id: form.lineup_override_id ? Number(form.lineup_override_id) : null, notes: form.notes || null };
      const s = await patch(`/sets/${set.id}`, body);
      onChanged(s); toast('Saved' + (body.room_number !== set.room_number ? ' — room number pushed to the TV' : ''));
      loadDetail();
    } catch (e) { toast(e.message, 'bad'); } finally { setSaving(false); }
  }
  async function remove() {
    try { await del(`/sets/${set.id}`); toast(`Deleted ${set.serial}`); onDeleted(); } catch (e) { toast(e.message, 'bad'); }
  }
  const live = detail || set;
  return (
    <Drawer title={set.room_number ? `Room ${set.room_number}` : 'Unassigned set'} subtitle={`${set.model || 'unknown model'} · ${set.serial}`} onClose={onClose}>
      <div className="inline" style={{ marginBottom: 10 }}><Status online={live.online} ws={live.ws} /><span className="muted small">· last seen {timeAgo(live.last_seen)}</span></div>
      <dl className="kv">
        <dt>Serial</dt><dd className="mono">{set.serial}</dd>
        <dt>Model</dt><dd>{set.model || '—'}</dd>
        <dt>Platform</dt><dd>{set.api ? set.api.toUpperCase() : '—'}{set.idpn ? ` · IDPN ${set.idpn}` : ''}{set.webos_version ? ` · webOS ${set.webos_version}` : ''}</dd>
        <dt>Firmware</dt><dd>{set.firmware_version || '—'}{set.platform_version ? <span className="muted"> · platform {set.platform_version}</span> : null}</dd>
        <dt>App build</dt><dd className="mono small">{live.app_version || '—'}</dd>
        <dt>IP / MAC</dt><dd className="mono small">{set.ip || '—'}{set.mac ? ` · ${set.mac}` : ''}</dd>
        <dt>Room on TV</dt><dd>{set.reported_room ? <>{set.reported_room}{set.reported_room_is_factory && <span className="pill" style={{ marginLeft: 6 }}>factory default</span>}</> : '—'}</dd>
        <dt>Power / uptime</dt><dd>{live.power_mode || '—'} · {fmtUptime(live.uptime_s)}</dd>
        <dt>Channel / volume</dt><dd>{live.channel || '—'} · {live.volume == null ? '—' : live.volume}{live.muted ? ' (muted)' : ''}</dd>
        <dt>First seen</dt><dd>{fmtDate(set.first_seen)}</dd>
      </dl>

      <div className="section">
        <h3>Assignment</h3>
        <div className="row">
          <Field label="Room number"><input value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} placeholder="e.g. 204" /></Field>
          <Field label="Group"><select value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
            <option value="">— none —</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        </div>
        <div className="row">
          <Field label="Layout override" hint="Empty = group's layout."><select value={form.layout_override_id} onChange={(e) => setForm({ ...form, layout_override_id: e.target.value })}>
            <option value="">— group layout —</option>{layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Lineup override" hint="Empty = group's lineup."><select value={form.lineup_override_id} onChange={(e) => setForm({ ...form, lineup_override_id: e.target.value })}>
            <option value="">— group lineup —</option>{lineups.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        </div>
        <Field label="Notes"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="actions"><button className="primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
          {detail && detail.layout && <span className="muted small">showing layout: <b>{detail.layout.name}</b>{detail.layout.builtin ? ' (built-in)' : ''}</span>}</div>
      </div>

      <SetCommands set={live} detail={detail} onDone={loadDetail} />

      <div className="section">
        <h3>Recent events</h3>
        {detail && detail.events.length ? <table><tbody>{detail.events.slice(0, 12).map((e) => <tr key={e.id}><td className="muted small" style={{ whiteSpace: 'nowrap' }}>{timeAgo(e.created_at)}</td><td><span className="pill">{e.type}</span></td><td className="small mono">{e.payload ? JSON.stringify(e.payload).slice(0, 80) : ''}</td></tr>)}</tbody></table> : <div className="muted small">No events.</div>}
      </div>

      <div className="section">
        <h3>Danger zone</h3>
        <button className="danger" onClick={() => setConfirm(true)}>Delete this set</button>
        <div className="muted small" style={{ marginTop: 6 }}>Removes the set and its history. If the TV is still running it will register again as unassigned.</div>
      </div>
      {confirm && <Confirm title="Delete set" text={`Delete ${set.serial}${set.room_number ? ` (room ${set.room_number})` : ''}? This cannot be undone.`} onConfirm={remove} onClose={() => setConfirm(false)} />}
    </Drawer>
  );
}
