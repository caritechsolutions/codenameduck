import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, del } from '../api.js';
import { useAsync, Field, useToast } from '../components/ui.jsx';

// Import reservations from a CSV/XLSX exported by another system (Part C): upload → map columns
// (with a saved profile) → preview with per-row validation → import the valid rows → download the
// skipped-rows report.
const FIELD_LABELS = { room: 'Room *', first_name: 'First name', last_name: 'Last name (or full name)', checkin: 'Check-in *', checkout: 'Check-out *', lang: 'Language', notes: 'Notes', vip: 'VIP' };
const FORMAT_LABELS = { auto: 'Detect (ISO, Excel, day-first, month-first)', 'YYYY-MM-DD': '2026-09-17 (ISO)', 'DD/MM/YYYY': '17/09/2026', 'MM/DD/YYYY': '09/17/2026 (US)', 'DD.MM.YYYY': '17.09.2026', 'DD-MM-YYYY': '17-09-2026', 'YYYY/MM/DD': '2026/09/17', excel: 'Excel serial number' };

function readBase64(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '').split(',').pop()); r.onerror = () => reject(new Error(`cannot read ${file.name}`)); r.readAsDataURL(file); });
}
function download(name, text) {
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); } catch { /* jsdom */ }
}

export default function ImportReservations() {
  const toast = useToast();
  const settings = useAsync(() => get('/pms/settings'), []);
  const profiles = useAsync(() => get('/import-profiles'), []);
  const [file, setFile] = useState(null);       // {name, headers, rows, total, truncated, kind}
  const [mapping, setMapping] = useState({});
  const [format, setFormat] = useState('auto');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [profileName, setProfileName] = useState('');
  const fields = (settings.data && settings.data.fields) || Object.keys(FIELD_LABELS);
  const formats = (settings.data && settings.data.date_formats) || Object.keys(FORMAT_LABELS);

  async function upload(f) {
    if (!f) return;
    setBusy(true); setPreview(null); setResult(null);
    try {
      const parsed = await post('/import/parse', { filename: f.name, content_base64: await readBase64(f) });
      setFile({ name: f.name, ...parsed });
      setMapping(parsed.guess || {});
      toast(`${parsed.total} row(s) read from ${f.name}`);
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function runPreview() {
    setBusy(true); setResult(null);
    try { setPreview(await post('/import/preview', { rows: file.rows, mapping, date_format: format })); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function commit() {
    setBusy(true);
    try { const r = await post('/import/commit', { rows: file.rows, mapping, date_format: format }); setResult(r); setPreview(null); toast(`${r.imported} reservation(s) imported, ${r.skipped.length} skipped`); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  async function report() {
    try {
      const res = await fetch('/api/admin/import/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skipped: result.skipped, headers: file.headers }) });
      download('skipped-rows.csv', await res.text());
    } catch (e) { toast(e.message, 'bad'); }
  }
  async function saveProfile() {
    try { await post('/import-profiles', { name: profileName, mapping, date_format: format }); toast(`Profile “${profileName}” saved`); setProfileName(''); profiles.reload(); }
    catch (e) { toast(e.message, 'bad'); }
  }
  function applyProfile(id) {
    const p = (profiles.data || []).find((x) => String(x.id) === String(id));
    if (!p) return;
    setMapping(p.mapping || {}); setFormat(p.date_format || 'auto'); setPreview(null); toast(`Profile “${p.name}” applied`);
  }
  async function removeProfile(id) { try { await del(`/import-profiles/${id}`); profiles.reload(); } catch (e) { toast(e.message, 'bad'); } }
  const mapped = (f) => mapping[f] != null && mapping[f] !== '';
  const ready = file && mapped('room') && mapped('checkin') && mapped('checkout') && (mapped('first_name') || mapped('last_name'));
  return (
    <>
      <div className="topbar"><h1>Import reservations</h1><Link className="btn" to="/rooms">← Rooms</Link></div>
      <p className="muted small">Upload the export from your booking system (CSV or Excel .xlsx). Map its columns to room, names and dates, pick the date format, preview, then import. Rows that fail (bad date, no room, overlap with an existing stay) are skipped and listed in a report you can download. The mapping can be saved as a named profile for next time.</p>
      <div className="card">
        <h2>1 · File</h2>
        <div className="inline"><label className="btn">Choose CSV / XLSX<input type="file" accept=".csv,.txt,.xlsx,text/csv" style={{ display: 'none' }} aria-label="Import file" onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} /></label>
          {file && <span className="small">{file.name} · {file.total} row(s){file.truncated ? ' (first 5000 shown)' : ''} · {file.kind.toUpperCase()}</span>}{busy && <span className="muted small">working…</span>}</div>
        {file && <table className="small" style={{ marginTop: 10 }}><thead><tr>{file.headers.map((h, i) => <th key={i}>{h || <i className="muted">col {i + 1}</i>}</th>)}</tr></thead>
          <tbody>{file.rows.slice(0, 5).map((r, i) => <tr key={i}>{file.headers.map((_, j) => <td key={j} className="mono">{String(r[j] ?? '')}</td>)}</tr>)}</tbody></table>}
      </div>
      {file && <div className="card" style={{ marginTop: 12 }}>
        <h2>2 · Columns</h2>
        <div className="grid2">
          <div>
            {fields.map((f) => <Field key={f} label={FIELD_LABELS[f] || f}>
              <select value={mapping[f] == null ? '' : String(mapping[f])} onChange={(e) => { setMapping({ ...mapping, [f]: e.target.value === '' ? undefined : Number(e.target.value) }); setPreview(null); }} aria-label={`column for ${f}`}>
                <option value="">— not imported —</option>{file.headers.map((h, i) => <option key={i} value={i}>{h || `column ${i + 1}`}</option>)}
              </select></Field>)}
          </div>
          <div>
            <Field label="Date format" hint="How the check-in/out columns are written."><select value={format} onChange={(e) => { setFormat(e.target.value); setPreview(null); }} aria-label="Date format">{formats.map((k) => <option key={k} value={k}>{FORMAT_LABELS[k] || k}</option>)}</select></Field>
            <Field label="Mapping profile" hint="Save this mapping under a name for one-click re-import.">
              <div className="inline"><select onChange={(e) => { applyProfile(e.target.value); e.target.value = ''; }} defaultValue="" aria-label="Load profile"><option value="">load…</option>{(profiles.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="profile name" aria-label="Profile name" style={{ width: 160 }} /><button className="sm" disabled={!profileName.trim() || !ready} onClick={saveProfile}>Save profile</button></div>
              {(profiles.data || []).length > 0 && <div className="small" style={{ marginTop: 6 }}>{profiles.data.map((p) => <span key={p.id} className="pill" style={{ marginRight: 6 }}>{p.name} <button className="link" onClick={() => removeProfile(p.id)} aria-label={`delete profile ${p.name}`}>✕</button></span>)}</div>}
            </Field>
            <div className="actions"><button className="primary" disabled={!ready || busy} onClick={runPreview}>Preview</button>{!ready && <span className="muted small">map room, check-in, check-out and a name column first</span>}</div>
          </div>
        </div>
      </div>}
      {preview && <div className="card" style={{ marginTop: 12 }}>
        <h2>3 · Preview</h2>
        <p className="small"><span className="pill ok">{preview.ok} ok</span> <span className={'pill ' + (preview.bad ? 'bad' : '')}>{preview.bad} with problems</span> — problem rows are skipped on import.</p>
        <table className="small"><thead><tr><th>#</th><th>Room</th><th>Guest</th><th>Check-in</th><th>Check-out</th><th>Lang</th><th>Problem</th></tr></thead>
          <tbody>{preview.rows.slice(0, 200).map((r) => <tr key={r.index} className={r.errors.length ? 'bad-row' : ''} data-testid="preview-row" data-ok={r.errors.length ? '0' : '1'}>
            <td className="muted">{r.index + 1}</td><td>{r.value.room_number}</td><td>{[r.value.first_name, r.value.last_name].filter(Boolean).join(' ')}</td><td>{r.value.checkin_date}</td><td>{r.value.checkout_date}</td><td>{r.value.lang || ''}</td>
            <td className={r.errors.length ? 'error' : 'muted'}>{r.errors.join('; ') || 'ok'}</td></tr>)}</tbody></table>
        {preview.rows.length > 200 && <p className="muted small">Showing the first 200 of {preview.rows.length} rows.</p>}
        <div className="actions" style={{ marginTop: 10 }}><button className="primary" disabled={!preview.ok || busy} onClick={commit}>Import {preview.ok} reservation(s)</button></div>
      </div>}
      {result && <div className="card" style={{ marginTop: 12 }}>
        <h2>4 · Done</h2>
        <p><b>{result.imported}</b> reservation(s) imported, <b>{result.skipped.length}</b> skipped. <Link to="/rooms">Open the calendar</Link>.</p>
        {result.skipped.length > 0 && <>
          <div className="actions"><button onClick={report}>Download report of skipped rows</button></div>
          <table className="small" style={{ marginTop: 8 }}><thead><tr><th>Row</th><th>Reason</th></tr></thead><tbody>{result.skipped.slice(0, 100).map((s) => <tr key={s.row}><td>{s.row}</td><td className="error">{s.reason}</td></tr>)}</tbody></table>
        </>}
      </div>}
    </>
  );
}
