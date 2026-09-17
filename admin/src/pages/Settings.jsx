import React, { useContext, useEffect, useState } from 'react';
import { get, patch, post, del, api } from '../api.js';
import { useAsync, Field, useToast } from '../components/ui.jsx';
import { SessionCtx } from '../App.jsx';
import { timeAgo } from '../util.js';
import { uploadMedia } from '../components/MediaPicker.jsx';
import { Link } from 'react-router-dom';

export default function Settings() {
  const toast = useToast();
  const session = useContext(SessionCtx);
  const tenant = useAsync(() => get('/tenant'), []);
  const layouts = useAsync(() => get('/layouts'), []);
  const lineups = useAsync(() => get('/lineups'), []);
  const assets = useAsync(() => get('/assets'), []);
  const [f, setF] = useState(null);
  const [weather, setWeather] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!tenant.data) return;
    const s = tenant.data.settings || {};
    setF({ display_name: tenant.data.display_name, default_layout_id: tenant.data.default_layout_id || '', default_lineup_id: tenant.data.default_lineup_id || '',
      timezone: s.timezone || '', lat: (s.weather && s.weather.lat) ?? '', lon: (s.weather && s.weather.lon) ?? '', units: (s.weather && s.weather.units) || 'metric',
      checkout_message: s.checkout_message || '', netflix_hotel_id: s.netflix_hotel_id || '', checkin_time: s.checkin_time || '14:00', checkout_time: s.checkout_time || '11:00' });
  }, [tenant.data]);
  if (!f) return <div className="muted">Loading…</div>;

  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      const t = await patch('/tenant', { display_name: f.display_name, default_layout_id: f.default_layout_id ? Number(f.default_layout_id) : null, default_lineup_id: f.default_lineup_id ? Number(f.default_lineup_id) : null,
        settings: { timezone: f.timezone, weather: { lat: f.lat === '' ? null : Number(f.lat), lon: f.lon === '' ? null : Number(f.lon), units: f.units }, checkout_message: f.checkout_message, netflix_hotel_id: f.netflix_hotel_id.trim(), checkin_time: f.checkin_time, checkout_time: f.checkout_time } });
      tenant.setData(t); session.refresh(); toast('Settings saved · pushed to online sets');
    } catch (err) { toast(err.message, 'bad'); } finally { setSaving(false); }
  }
  async function checkWeather() { try { setWeather(await get('/weather')); } catch (err) { toast(err.message, 'bad'); } }
  async function uploadLogo(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const j = await uploadMedia(file, { asLogo: true });
      toast(`Logo set to ${j.name} · pushed to online sets`); tenant.reload(); session.refresh();
    } catch (err) { toast(err.message, 'bad'); }
    e.target.value = '';
  }
  async function removeAsset(a) { try { await del(`/assets/${a.name}`); assets.reload(); } catch (err) { toast(err.message, 'bad'); } }
  const logo = tenant.data.settings && tenant.data.settings.logo_url;
  return (
    <>
      <div className="topbar"><h1>Tenant settings</h1><span className="muted small">{tenant.data.hostname}</span></div>
      <div className="grid2">
        <form className="card" onSubmit={save}>
          <h2>Hotel</h2>
          <Field label="Hotel name (shown as {{hotel}} on the TV)"><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} aria-label="Hotel name" /></Field>
          <div className="row">
            <Field label="Default layout (sets without a group)"><select value={f.default_layout_id} onChange={(e) => setF({ ...f, default_layout_id: e.target.value })}><option value="">— built-in "not assigned" screen —</option>{(layouts.data || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            <Field label="Default lineup"><select value={f.default_lineup_id} onChange={(e) => setF({ ...f, default_lineup_id: e.target.value })}><option value="">— none —</option>{(lineups.data || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          </div>
          <div className="row">
            <Field label="Time zone (IANA, drives check-in/out times)"><input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} placeholder="Europe/Amsterdam" aria-label="Time zone" /></Field>
            <Field label="Check-in time"><input type="time" value={f.checkin_time} onChange={(e) => setF({ ...f, checkin_time: e.target.value })} aria-label="Check-in time" /></Field>
            <Field label="Check-out time"><input type="time" value={f.checkout_time} onChange={(e) => setF({ ...f, checkout_time: e.target.value })} aria-label="Check-out time" /></Field>
          </div>
          <Field label="Checkout message (shown on the TV after checkout)" hint="Guests are checked in/out automatically at these times (Rooms page); the TVs get the guest's name at check-in and a checkout at check-out."><input value={f.checkout_message} onChange={(e) => setF({ ...f, checkout_message: e.target.value })} placeholder="Thank you for staying with us" /></Field>
          <Field label="Netflix hotel id" hint="Required before Netflix can be enabled for this hotel. Any code that identifies this one property to LG/Netflix (e.g. the billing id); letters, digits, _ . - only. Sent with every Netflix launch (docs/lg/netflix.md)."><input value={f.netflix_hotel_id} onChange={(e) => setF({ ...f, netflix_hotel_id: e.target.value })} aria-label="Netflix hotel id" placeholder="e.g. CARI-HOTELDEMO-001" /></Field>
          <h2 style={{ marginTop: 16 }}>Weather</h2>
          <div className="row">
            <Field label="Latitude"><input value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} placeholder="51.5" aria-label="Latitude" /></Field>
            <Field label="Longitude"><input value={f.lon} onChange={(e) => setF({ ...f, lon: e.target.value })} placeholder="4.2" aria-label="Longitude" /></Field>
            <Field label="Units"><select value={f.units} onChange={(e) => setF({ ...f, units: e.target.value })}><option value="metric">°C</option><option value="imperial">°F</option></select></Field>
          </div>
          <div className="actions"><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button><button type="button" onClick={checkWeather}>Check weather now</button>
            {weather && <span className="small">{weather.ok ? `${weather.icon} ${weather.temp_c}°C / ${weather.temp_f}°F · ${weather.text} · wind ${weather.wind_kmh} km/h` : <span className="error">{weather.reason}</span>}</span>}</div>
          <p className="muted small" style={{ marginTop: 8 }}>Weather comes from Open-Meteo (no key) fetched by the server every 15 minutes; the TVs never talk to the internet.</p>
        </form>
        <div>
          <div className="card">
            <h2>Logo</h2>
            <div className="inline" style={{ gap: 16 }}>
              {logo ? <img src={logo + '?t=' + Date.now()} alt="logo" style={{ maxHeight: 80, maxWidth: 240, background: '#0b1a2a', padding: 6, borderRadius: 6 }} /> : <span className="muted">No logo uploaded.</span>}
              <label className="btn">Upload logo<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={uploadLogo} aria-label="Upload logo" /></label>
            </div>
            <p className="muted small">The logo is stored in the <Link to="/media">Media library</Link> (any library image can be made the logo there). Use it in layouts as an image zone with src <code>{'{{logo}}'}</code>.</p>
          </div>
          <PmsKeyCard toast={toast} />
          {(assets.data || []).length > 0 && <div className="card" style={{ marginTop: 12 }}>
            <h2>Legacy assets</h2>
            <p className="muted small">Files uploaded before the Media library existed. They keep working; new uploads go to <Link to="/media">Media</Link>.</p>
            {(
              <table><tbody>{assets.data.map((a) => (
                <tr key={a.name}><td style={{ width: 70 }}><img src={a.url} alt="" style={{ height: 36, maxWidth: 60, objectFit: 'contain' }} /></td>
                  <td><code className="small">{a.url}</code><div className="muted small">{Math.round(a.bytes / 1024)} kB · {timeAgo(a.mtime)}</div></td>
                  <td style={{ textAlign: 'right' }}><button className="sm danger" onClick={() => removeAsset(a)}>Delete</button></td></tr>))}</tbody></table>)}
          </div>}
        </div>
      </div>
    </>
  );
}

// External PMS bridge key (Part C): shown once, stored hashed; docs/PMS-API.md has the calls.
function PmsKeyCard({ toast }) {
  const info = useAsync(() => get('/pms/settings'), []);
  const [key, setKey] = useState(null);
  async function generate() {
    try { const k = await post('/pms/key'); setKey(k.key); info.reload(); toast('New PMS API key generated — copy it now, it is not shown again'); } catch (e) { toast(e.message, 'bad'); }
  }
  async function revoke() { try { await del('/pms/key'); setKey(null); info.reload(); toast('PMS API key revoked'); } catch (e) { toast(e.message, 'bad'); } }
  const cur = info.data && info.data.api_key;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2>PMS API</h2>
      <p className="muted small">For a booking-system bridge later: <code>POST /api/pms/reservations</code>, <code>PATCH /api/pms/reservations/:id</code>, <code>GET /api/pms/rooms?date=</code> on this hostname with <code>Authorization: Bearer &lt;key&gt;</code>. Every write is logged. See <code>docs/PMS-API.md</code>.</p>
      {key && <div className="code small" style={{ marginBottom: 8, wordBreak: 'break-all' }} data-testid="pms-key">{key}</div>}
      <div className="inline">
        {cur ? <span className="small">Key <code>{cur.prefix}…</code> created {timeAgo(cur.created_at)}</span> : <span className="muted small">No key yet — the API answers 401.</span>}
        <button className="sm" onClick={generate}>{cur ? 'Regenerate key' : 'Generate key'}</button>
        {cur && <button className="sm danger" onClick={revoke}>Revoke</button>}
      </div>
    </div>
  );
}
