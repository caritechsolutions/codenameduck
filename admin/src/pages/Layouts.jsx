import React, { useState, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post, del, patch } from '../api.js';
import { useAsync, Modal, Confirm, Field, Empty, useToast } from '../components/ui.jsx';
import { fmtDate } from '../util.js';
import { SessionCtx } from '../App.jsx';
import LayoutThumb from '../editor/LayoutThumb.jsx';

export default function Layouts() {
  const toast = useToast();
  const nav = useNavigate();
  const session = useContext(SessionCtx);
  const layouts = useAsync(() => get('/layouts'), []);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState(null);

  async function create(name, template) {
    try { const l = await post('/layouts', { name, template }); setCreating(false); nav(`/layouts/${l.id}`); } catch (e) { toast(e.message, 'bad'); }
  }
  async function duplicate(l) {
    try { const c = await post(`/layouts/${l.id}/duplicate`); toast(`Created "${c.name}"`); layouts.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function remove() {
    try { await del(`/layouts/${removing.id}`); toast('Layout deleted'); setRemoving(null); layouts.reload(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function setDefault(l) {
    try { await patch('/tenant', { default_layout_id: l ? l.id : null }); toast(l ? `"${l.name}" is now the default for ungrouped sets` : 'Default cleared'); layouts.reload(); session.refresh(); } catch (e) { toast(e.message, 'bad'); }
  }
  return (
    <>
      <div className="topbar"><h1>Layouts</h1><div className="actions"><button className="primary" onClick={() => setCreating(true)}>New layout</button></div></div>
      <p className="muted small">A layout is what a TV draws: zones (live TV, text, images, channel list, clock, …) on a 1920×1080 canvas. Saving a layout publishes it to every online set that uses it — no xait version bump.</p>
      <div className="card" style={{ padding: 0 }}>
        {layouts.data && layouts.data.length === 0 ? <Empty>No layouts yet. Sets without a layout show the built-in "not yet assigned" screen.</Empty> : (
          <table>
            <thead><tr><th></th><th>Name</th><th className="num">Version</th><th>Used by</th><th>Updated</th><th></th></tr></thead>
            <tbody>{(layouts.data || []).map((l) => (
              <tr key={l.id}>
                <td style={{ width: 130 }}><Link to={`/layouts/${l.id}`}><LayoutThumb doc={l.json} width={120} /></Link></td>
                <td><Link to={`/layouts/${l.id}`}><b>{l.name}</b></Link>{l.is_default && <span className="pill accent" style={{ marginLeft: 8 }}>tenant default</span>}</td>
                <td className="num">v{l.version}</td>
                <td className="muted">{l.group_count} group(s){l.override_count ? `, ${l.override_count} set override(s)` : ''}</td>
                <td className="muted">{fmtDate(l.updated_at)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="sm" onClick={() => nav(`/layouts/${l.id}`)}>Edit</button>{' '}
                  <button className="sm" onClick={() => duplicate(l)}>Duplicate</button>{' '}
                  {l.is_default ? <button className="sm" onClick={() => setDefault(null)}>Clear default</button> : <button className="sm" onClick={() => setDefault(l)}>Make default</button>}{' '}
                  <button className="sm danger" onClick={() => setRemoving(l)}>Delete</button>
                </td>
              </tr>))}</tbody>
          </table>)}
      </div>
      {creating && <NewLayoutModal onCreate={create} onClose={() => setCreating(false)} />}
      {removing && <Confirm title="Delete layout" text={`Delete "${removing.name}"? Groups using it fall back to the tenant default.`} onConfirm={remove} onClose={() => setRemoving(null)} />}
    </>
  );
}

function NewLayoutModal({ onCreate, onClose }) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('classic');
  const templates = useAsync(() => get('/layout-templates'), []);
  return (
    <Modal title="New layout" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim()} onClick={() => onCreate(name.trim(), template)}>Create</button></>}>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Standard room" aria-label="Layout name" /></Field>
      <Field label="Start from a template">
        <div className="template-grid" role="radiogroup" aria-label="Template">
          {(templates.data || []).map((t) => (
            <label key={t.id} className={'template-card' + (template === t.id ? ' active' : '')}>
              <input type="radio" name="template" value={t.id} checked={template === t.id} onChange={() => setTemplate(t.id)} aria-label={t.name} />
              <LayoutThumb doc={t.json} width={150} />
              <b>{t.name}</b><span className="muted small">{t.description}</span>
            </label>))}
          {templates.data && templates.data.length === 0 && <span className="muted small">No templates.</span>}
        </div>
      </Field>
    </Modal>
  );
}
