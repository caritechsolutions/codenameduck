import React, { useRef, useState } from 'react';
import { get, post, patch, del } from '../api.js';
import { useAsync, useToast, Empty, Confirm } from '../components/ui.jsx';
import { timeAgo } from '../util.js';

// Superadmin → App licences (B3c). LG issues one .lic file per SI product (NETFLIX_*.lic,
// AMAZON_*.lic, AirPlay_*.lic, GOOGLE CAST_*.lic); each is a single base64 token. Tokens belong to
// the SI partner, so they are stored once for all tenants — encrypted at rest with
// /srv/coopcentric/data/secret.key — and every set registers them at boot when LG's
// application/register/status says it is not authorised. Only the last 6 characters are shown.
const HINT = { netflix: 'NETFLIX_*.lic', amazon: 'AMAZON_*.lic (STB-6500 / webOS 5.0 only)', airplay: 'AirPlay_*.lic — id is our guess, confirm against application/list', googlecast: 'GOOGLE CAST_*.lic — id is our guess, confirm against application/list' };

function readText(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = () => reject(new Error(`cannot read ${file.name}`)); r.readAsText(file); });
}

export default function Licences() {
  const toast = useToast();
  const data = useAsync(() => get('/licences'), []);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [ids, setIds] = useState({});           // {licence id: app id being edited}
  const replaceFor = useRef(null);              // app id the hidden "replace" file input is for
  const fileRef = useRef(null);

  async function upload(fileList, appId) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy(true);
    try {
      const payload = [];
      for (const f of files) payload.push({ filename: f.name, content: await readText(f), app_id: appId || undefined });
      const r = await post('/licences', { files: payload });
      const parts = [];
      if (r.added.length) parts.push(`added ${r.added.map((x) => x.app_id).join(', ')}`);
      if (r.replaced.length) parts.push(`replaced ${r.replaced.map((x) => x.app_id).join(', ')}`);
      if (parts.length) toast(`Licences ${parts.join(' · ')} — sets register them at their next boot`);
      (r.errors || []).forEach((e) => toast(e, 'bad'));
      data.setData({ ...(data.data || {}), licences: r.licences });
    } catch (e) { toast(e.message, 'bad'); (e.errors || []).forEach((x) => toast(x, 'bad')); } finally { setBusy(false); }
  }
  async function saveId(row) {
    const v = (ids[row.id] === undefined ? row.app_id : ids[row.id]).trim().toLowerCase();
    if (!v || v === row.app_id) { setIds({ ...ids, [row.id]: undefined }); return; }
    try { const r = await patch(`/licences/${row.id}`, { app_id: v }); data.setData({ ...data.data, licences: data.data.licences.map((x) => (x.id === r.id ? r : x)) }); toast(`Licence now registers as app id "${r.app_id}"`); setIds({ ...ids, [row.id]: undefined }); }
    catch (e) { toast(e.message, 'bad'); }
  }
  async function remove(row) {
    try { await del(`/licences/${row.id}`); data.setData({ ...data.data, licences: data.data.licences.filter((x) => x.id !== row.id) }); toast(`Licence for ${row.app_id} deleted`); }
    catch (e) { toast(e.message, 'bad'); } finally { setConfirm(null); }
  }
  const rows = (data.data && data.data.licences) || [];
  const known = (data.data && data.data.known_ids) || Object.keys(HINT);
  return (
    <>
      <div className="topbar"><h1>App licences</h1><span className="muted small">shared by all tenants</span></div>
      <p className="muted small">Drop the <code>.lic</code> files LG sent with the SI contract. Each file is one token; the app is recognised from the file name (NETFLIX_, AMAZON_, AirPlay_, GOOGLE CAST_). Tokens are stored encrypted (key in <code>/srv/coopcentric/data/secret.key</code>) and never shown again in full. Every set registers all stored tokens at boot when LG reports the app as not authorised; the <b>Register now</b> button on a tenant's Apps page uses the same store. Netflix additionally needs a <b>Netflix hotel id</b> in each tenant's Settings.</p>
      <div className={'lic-drop' + (drag ? ' drag' : '')} data-testid="licence-drop"
        onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer && e.dataTransfer.files); }}>
        <div><b>Drop .lic files here</b> or <label className="btn sm">choose files<input type="file" multiple accept=".lic,text/plain" style={{ display: 'none' }} aria-label="Choose licence files" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></label></div>
        <div className="muted small" style={{ marginTop: 6 }}>{busy ? 'Uploading…' : 'One file per app. Uploading a file for an app that already has a token replaces it.'}</div>
      </div>
      <div className="card" style={{ padding: 0, marginTop: 12 }}>
        {data.loading && !data.data ? <div className="muted" style={{ padding: 16 }}>Loading…</div> : rows.length === 0 ? <Empty>No licences yet.</Empty> : (
          <table className="lic-table">
            <thead><tr><th>App id (as LG names it)</th><th>File</th><th>Token</th><th>Uploaded</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} data-app={r.app_id}>
                <td>
                  <input list="lic-app-ids" value={ids[r.id] === undefined ? r.app_id : ids[r.id]} aria-label={`app id for ${r.filename}`}
                    onChange={(e) => setIds({ ...ids, [r.id]: e.target.value })} onBlur={() => saveId(r)} onKeyDown={(e) => { if (e.key === 'Enter') saveId(r); }} style={{ width: 160 }} />
                  {HINT[r.app_id] && <div className="muted small">{HINT[r.app_id]}</div>}
                </td>
                <td><code className="small">{r.filename}</code></td>
                <td><code className="small" title="only the last 6 characters are kept in the clear">…{r.tail}</code></td>
                <td className="muted small">{timeAgo(r.uploaded_at)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="sm" onClick={() => { replaceFor.current = r.app_id; fileRef.current && fileRef.current.click(); }} aria-label={`replace ${r.app_id}`}>Replace</button>{' '}
                  <button className="sm danger" onClick={() => setConfirm(r)} aria-label={`delete ${r.app_id}`}>Delete</button>
                </td>
              </tr>))}</tbody>
          </table>)}
        <datalist id="lic-app-ids">{known.map((k) => <option key={k} value={k} />)}</datalist>
        <input ref={fileRef} type="file" accept=".lic,text/plain" style={{ display: 'none' }} aria-label="Replacement licence file" onChange={(e) => { upload(e.target.files, replaceFor.current); e.target.value = ''; }} />
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Firewall for the sets (docs/TENANT-NETWORK-CHECKLIST.md): <code>*.pool.ntp.org</code> (TV time must be set) and <code>https://GR.lgtvsdp.com/rest/sdp/v13.0/initservices</code>; the service country must not be “Others”.</p>
      {confirm && <Confirm title={`Delete the ${confirm.app_id} licence?`} text="Sets keep whatever they already registered, but new or reset sets will no longer be able to activate this app." onConfirm={() => remove(confirm)} onClose={() => setConfirm(null)} />}
    </>
  );
}
