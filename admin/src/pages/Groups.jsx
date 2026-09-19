import React, { useState } from 'react';
import { get, post, patch, del, put } from '../api.js';
import { useAsync, Modal, Confirm, Field, Empty, useToast } from '../components/ui.jsx';

export default function Groups() {
  const toast = useToast();
  const groups = useAsync(() => get('/groups'), []);
  const layouts = useAsync(() => get('/layouts'), []);
  const [editing, setEditing] = useState(null);   // null | {} (new) | group
  const [removing, setRemoving] = useState(null);

  async function assign(g, layoutId) {
    try {
      const r = await put(`/groups/${g.id}/layout`, { layout_id: layoutId ? Number(layoutId) : null });
      toast(layoutId ? `Layout assigned · pushed to ${r.pushed} online set(s)` : 'Layout unassigned');
      groups.reload();
    } catch (e) { toast(e.message, 'bad'); }
  }
  async function powerMode(g, value) {
    try { await patch(`/groups/${g.id}`, { instant_power: value === '' ? null : Number(value) }); toast(value !== '' ? `set_property instant_power="${value}" queued for the sets in ${g.name} — watch each set's commands list` : 'Power mode left to the sets'); groups.reload(); }
    catch (e) { toast(e.message, 'bad'); }
  }
  async function option(g, body, msg) {
    try { await patch(`/groups/${g.id}`, body); toast(msg); groups.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function save(form) {
    try {
      if (editing.id) await patch(`/groups/${editing.id}`, form); else await post('/groups', form);
      toast('Saved'); setEditing(null); groups.reload();
    } catch (e) { toast(e.message, 'bad'); }
  }
  async function remove() {
    try { await del(`/groups/${removing.id}`); toast('Group deleted'); setRemoving(null); groups.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  return (
    <>
      <div className="topbar"><h1>Groups</h1><div className="actions"><button className="primary" onClick={() => setEditing({})}>New group</button></div></div>
      <p className="muted small">Sets are placed in groups; each group gets one layout and one channel lineup. Changing a group's layout pushes it to every online set in the group immediately. The vacant layout (optional) replaces it while the room has no checked-in guest; the welcome popup greets the guest at check-in.</p>
      <div className="card" style={{ padding: 0 }}>
        {groups.data && groups.data.length === 0 ? <Empty>No groups yet. Create one, e.g. "Standard rooms".</Empty> : (
          <table>
            <thead><tr><th>Name</th><th>Description</th><th className="num">Sets</th><th>Layout</th><th>Vacant layout</th><th>Welcome popup</th><th>Instant On</th><th>Hide TV's own OSD</th><th></th></tr></thead>
            <tbody>{(groups.data || []).map((g) => (
              <tr key={g.id}>
                <td><b>{g.name}</b></td>
                <td className="muted">{g.description || ''}</td>
                <td className="num">{g.set_count}</td>
                <td><select value={g.layout_id || ''} onChange={(e) => assign(g, e.target.value)} style={{ maxWidth: 260 }}>
                  <option value="">— tenant default —</option>{(layouts.data || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></td>
                <td><select value={g.vacant_layout_id || ''} onChange={(e) => option(g, { vacant_layout_id: e.target.value || null }, e.target.value ? 'Vacant layout set · shown while a room has no checked-in guest' : 'Vacant rooms show the normal layout with blank guest variables')} aria-label={`vacant layout ${g.name}`} style={{ maxWidth: 220 }} title="Shown on a set while its room has no checked-in guest">
                  <option value="">— same layout, blank variables —</option>{(layouts.data || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></td>
                <td><select value={String(g.welcome_popup_s || 0)} onChange={(e) => option(g, { welcome_popup_s: Number(e.target.value) }, Number(e.target.value) ? `Welcome popup for ${e.target.value} s at check-in` : 'No welcome popup')} aria-label={`welcome popup ${g.name}`} title="Popup “Welcome <guest>” on the room’s sets at check-in">
                  <option value="0">none</option><option value="5">5 s</option><option value="10">10 s</option><option value="20">20 s</option><option value="30">30 s</option><option value="60">60 s</option></select></td>
                <td><select value={g.instant_power == null ? '' : String(g.instant_power)} onChange={(e) => powerMode(g, e.target.value)} aria-label={`power mode ${g.name}`} title="Writes the LG property instant_power on every set in the group">
                  <option value="">— leave as is —</option>
                  <option value="2">Instant On (2)</option>
                  <option value="1">Instant On with update-on-off (1, slower)</option>
                  <option value="10">Always On (10)</option>
                  <option value="0">Off (0)</option>
                </select></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <select value={g.hide_tv_osd || 'banner'} onChange={(e) => option(g, { hide_tv_osd: e.target.value }, e.target.value === 'off' ? 'TV OSD left alone' : e.target.value === 'osd_lock' ? 'Banner setting + osd_lock while the portal is in front · applied at the next boot / layout push' : 'Installer Menu 107 BANNER_SELECT written at boot · applied at the next boot / layout push')} aria-label={`hide tv osd ${g.name}`} title="LG's own channel-change banner appears over the portal at boot. banner = Installer Menu item 107 BANNER_SELECT; osd_lock = banner + property osd_lock=1 while the portal is in front (released for apps)">
                    <option value="off">off</option>
                    <option value="banner">banner (107)</option>
                    <option value="osd_lock">banner + osd_lock</option>
                  </select>
                  {(g.hide_tv_osd || 'banner') !== 'off' && <select value={String(g.banner_select == null ? 1 : g.banner_select)} onChange={(e) => option(g, { banner_select: Number(e.target.value) }, `BANNER_SELECT=${e.target.value} at the next boot`)} aria-label={`banner select ${g.name}`} title="Value written to Installer Menu item 107 (LG: “selects the type of banner displayed during channel change (0/1)”) — flip it if the banner is still there" style={{ marginLeft: 4 }}>
                    <option value="1">=1</option><option value="0">=0</option>
                  </select>}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><button className="sm" onClick={() => setEditing(g)}>Edit</button> <button className="sm danger" onClick={() => setRemoving(g)}>Delete</button></td>
              </tr>))}</tbody>
          </table>)}
      </div>
      {editing && <GroupModal group={editing} onSave={save} onClose={() => setEditing(null)} />}
      {removing && <Confirm title="Delete group" text={`Delete "${removing.name}"? Its ${removing.set_count} set(s) become ungrouped.`} onConfirm={remove} onClose={() => setRemoving(null)} />}
    </>
  );
}

function GroupModal({ group, onSave, onClose }) {
  const [name, setName] = useState(group.name || '');
  const [description, setDescription] = useState(group.description || '');
  return (
    <Modal title={group.id ? 'Edit group' : 'New group'} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), description })}>Save</button></>}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    </Modal>
  );
}
