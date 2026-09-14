import React, { useEffect, useState, useContext } from 'react';
import { get, post, put, del, patch } from '../api.js';
import { useAsync, Modal, Confirm, Field, Empty, useToast } from '../components/ui.jsx';
import { describeParams } from '../components/ChannelForm.jsx';
import { SessionCtx } from '../App.jsx';
import { moveItem } from '../lineupUtil.js';

export default function Lineups() {
  const toast = useToast();
  const session = useContext(SessionCtx);
  const lineups = useAsync(() => get('/lineups'), []);
  const channels = useAsync(() => get('/channels'), []);
  const groups = useAsync(() => get('/groups'), []);
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState(null);

  useEffect(() => { if (!selectedId && lineups.data && lineups.data.length) setSelectedId(lineups.data[0].id); }, [lineups.data, selectedId]);

  async function create(name) {
    try { const l = await post('/lineups', { name }); setCreating(false); await lineups.reload(); setSelectedId(l.id); } catch (e) { toast(e.message, 'bad'); }
  }
  async function remove() {
    try { await del(`/lineups/${removing.id}`); toast('Lineup deleted'); setRemoving(null); setSelectedId(null); lineups.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function setDefault(l) {
    try { await patch('/tenant', { default_lineup_id: l ? l.id : null }); toast(l ? `"${l.name}" is the default lineup` : 'Default cleared'); lineups.reload(); session.refresh(); } catch (e) { toast(e.message, 'bad'); }
  }
  const selected = (lineups.data || []).find((l) => l.id === selectedId);
  return (
    <>
      <div className="topbar"><h1>Lineups</h1><div className="actions"><button className="primary" onClick={() => setCreating(true)}>New lineup</button></div></div>
      <p className="muted small">A lineup is the ordered channel list a group of TVs gets: CH+/CH− walk it in this order, number keys jump by channel number. Saving pushes the new list to every online set using it.</p>
      <div className="grid2" style={{ gridTemplateColumns: '260px 1fr' }}>
        <div className="card" style={{ padding: 0 }}>
          {lineups.data && lineups.data.length === 0 ? <Empty>No lineups yet.</Empty> : (
            <table><tbody>{(lineups.data || []).map((l) => (
              <tr key={l.id} className={'clickable' + (l.id === selectedId ? ' selected' : '')} onClick={() => setSelectedId(l.id)}>
                <td><b>{l.name}</b>{l.is_default && <span className="pill accent" style={{ marginLeft: 6 }}>default</span>}<div className="muted small">{l.item_count} channels · {l.group_count} group(s){l.override_count ? ` · ${l.override_count} override(s)` : ''}</div></td>
              </tr>))}</tbody></table>)}
        </div>
        <div>
          {selected ? <LineupEditor key={selected.id} lineup={selected} channels={channels.data || []} groups={groups.data || []}
            onChanged={() => { lineups.reload(); groups.reload(); }} onDelete={() => setRemoving(selected)} onDefault={() => setDefault(selected.is_default ? null : selected)} /> : <div className="card"><Empty>Select or create a lineup.</Empty></div>}
        </div>
      </div>
      {creating && <NameModal title="New lineup" onSave={create} onClose={() => setCreating(false)} />}
      {removing && <Confirm title="Delete lineup" text={`Delete "${removing.name}"? Groups using it fall back to the tenant default lineup.`} onConfirm={remove} onClose={() => setRemoving(null)} />}
    </>
  );
}

function LineupEditor({ lineup, channels, groups, onChanged, onDelete, onDefault }) {
  const toast = useToast();
  const detail = useAsync(() => get(`/lineups/${lineup.id}`), [lineup.id]);
  const [items, setItems] = useState(null);      // array of channel ids
  const [name, setName] = useState(lineup.name);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (detail.data) setItems(detail.data.items.map((c) => c.id)); }, [detail.data]);
  if (!detail.data || !items) return <div className="card muted">Loading…</div>;
  const byId = new Map(channels.map((c) => [c.id, c]));
  const available = channels.filter((c) => !items.includes(c.id));
  const dirty = name !== lineup.name || JSON.stringify(items) !== JSON.stringify(detail.data.items.map((c) => c.id));
  async function save() {
    setSaving(true);
    try { const r = await put(`/lineups/${lineup.id}`, { name, channel_ids: items }); toast(`Saved · pushed to ${r.pushed} online set(s)`); detail.setData(r); onChanged(); }
    catch (e) { toast(e.message, 'bad'); } finally { setSaving(false); }
  }
  async function assign(g, on) {
    try { const r = await put(`/groups/${g.id}/lineup`, { lineup_id: on ? lineup.id : null }); toast(`${on ? 'Assigned' : 'Unassigned'} · pushed to ${r.pushed} set(s)`); onChanged(); }
    catch (e) { toast(e.message, 'bad'); }
  }
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center' }}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="actions" style={{ flex: '0 0 auto', paddingBottom: 12 }}>
          <button className="primary" disabled={!dirty || saving || !name.trim()} onClick={save}>{saving ? 'Saving…' : 'Save & publish'}</button>
          <button onClick={onDefault}>{lineup.is_default ? 'Clear default' : 'Make default'}</button>
          <button className="danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
      <div className="grid2">
        <div>
          <h3>In this lineup ({items.length})</h3>
          {items.length === 0 ? <Empty>Add channels from the right.</Empty> : (
            <table><tbody>{items.map((id, i) => { const c = byId.get(id); if (!c) return null; return (
              <tr key={id}>
                <td className="num" style={{ width: 40 }}><b>{c.number}</b></td>
                <td>{c.name}<div className="muted small mono">{describeParams(c)}</div></td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="sm ghost" disabled={i === 0} onClick={() => setItems(moveItem(items, i, i - 1))} aria-label={`move ${c.number} up`}>↑</button>
                  <button className="sm ghost" disabled={i === items.length - 1} onClick={() => setItems(moveItem(items, i, i + 1))} aria-label={`move ${c.number} down`}>↓</button>
                  <button className="sm ghost danger" onClick={() => setItems(items.filter((x) => x !== id))} aria-label={`remove ${c.number}`}>✕</button>
                </td>
              </tr>); })}</tbody></table>)}
        </div>
        <div>
          <h3>Available channels ({available.length})</h3>
          {available.length === 0 ? <div className="muted small">{channels.length ? 'All channels are in this lineup.' : 'No channels defined yet — add them on the Channels page.'}</div> : (
            <table><tbody>{available.map((c) => (
              <tr key={c.id} style={c.enabled ? undefined : { opacity: .5 }}>
                <td className="num" style={{ width: 40 }}>{c.number}</td>
                <td>{c.name}{!c.enabled && <span className="pill" style={{ marginLeft: 6 }}>disabled</span>}</td>
                <td style={{ textAlign: 'right' }}><button className="sm" onClick={() => setItems([...items, c.id])} aria-label={`add ${c.number}`}>Add</button></td>
              </tr>))}</tbody></table>)}
          {available.length > 1 && <button className="sm" style={{ marginTop: 8 }} onClick={() => setItems([...items, ...available.map((c) => c.id)])}>Add all (by number)</button>}
        </div>
      </div>
      <div className="section">
        <h3>Assigned to groups</h3>
        {groups.length === 0 ? <div className="muted small">No groups yet.</div> : groups.map((g) => (
          <label key={g.id} className="inline" style={{ display: 'flex', marginBottom: 6, color: 'var(--text)', fontSize: 13 }}>
            <input type="checkbox" checked={g.lineup_id === lineup.id} onChange={(e) => assign(g, e.target.checked)} /> {g.name} <span className="muted">({g.set_count} sets{g.lineup_id && g.lineup_id !== lineup.id ? `, now: ${g.lineup_name}` : ''})</span>
          </label>))}
      </div>
    </div>
  );
}

function NameModal({ title, onSave, onClose }) {
  const [name, setName] = useState('');
  return <Modal title={title} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Create</button></>}>
    <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Standard lineup" /></Field>
  </Modal>;
}
