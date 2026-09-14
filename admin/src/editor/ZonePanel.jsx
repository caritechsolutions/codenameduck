import React, { useState } from 'react';
import { Field } from '../components/ui.jsx';
import { ZONE_TYPES, ACTIONS, KEY_NAMES, updateZone, renameZone, removeZone, moveZoneOrder, duplicateZone, toggleZoneInScreen, addScreen, removeScreen } from './geometry.js';

const num = (v) => (v === '' || v == null ? undefined : Number(v));

function StyleFields({ style = {}, onChange, fields }) {
  const set = (k, v) => onChange({ ...style, [k]: v === '' || v === undefined ? undefined : v });
  return (
    <div className="grid2">
      {fields.includes('fontSize') && <Field label="Font size"><input type="number" value={style.fontSize ?? ''} onChange={(e) => set('fontSize', num(e.target.value))} aria-label="Font size" /></Field>}
      {fields.includes('color') && <Field label="Color"><ColorInput value={style.color || '#ffffff'} onChange={(v) => set('color', v)} /></Field>}
      {fields.includes('background') && <Field label="Background"><input value={style.background ?? ''} onChange={(e) => set('background', e.target.value)} placeholder="rgba(0,0,0,0.4) or #123456" /></Field>}
      {fields.includes('highlight') && <Field label="Highlight"><ColorInput value={style.highlight || '#ffd166'} onChange={(v) => set('highlight', v)} /></Field>}
      {fields.includes('align') && <Field label="Align"><select value={style.align || 'left'} onChange={(e) => set('align', e.target.value)}><option>left</option><option>center</option><option>right</option></select></Field>}
      {fields.includes('fontWeight') && <Field label="Weight"><select value={style.fontWeight || 'normal'} onChange={(e) => set('fontWeight', e.target.value)}><option>normal</option><option>bold</option></select></Field>}
      {fields.includes('padding') && <Field label="Padding"><input type="number" value={style.padding ?? ''} onChange={(e) => set('padding', num(e.target.value))} /></Field>}
      {fields.includes('borderRadius') && <Field label="Corner radius"><input type="number" value={style.borderRadius ?? ''} onChange={(e) => set('borderRadius', num(e.target.value))} /></Field>}
      {fields.includes('opacity') && <Field label="Opacity"><input type="number" step="0.05" min="0" max="1" value={style.opacity ?? ''} onChange={(e) => set('opacity', num(e.target.value))} /></Field>}
    </div>
  );
}
function ColorInput({ value, onChange }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  return <div className="inline"><input type="color" value={hex} onChange={(e) => onChange(e.target.value)} style={{ width: 44, padding: 2 }} /><input value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}

function ListEditor({ items, onChange, fields, addLabel }) {
  const set = (i, k, v) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const move = (i, d) => { const a = items.slice(); const [x] = a.splice(i, 1); a.splice(i + d, 0, x); onChange(a); };
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="list-row">
          {fields.map((f) => f.options
            ? <select key={f.key} value={it[f.key] || ''} onChange={(e) => set(i, f.key, e.target.value)} aria-label={f.label}>{f.options.map((o) => <option key={o} value={o}>{o || '—'}</option>)}</select>
            : (f.when ? f.when(it) : true) ? <input key={f.key} value={it[f.key] || ''} placeholder={f.label} onChange={(e) => set(i, f.key, e.target.value)} aria-label={f.label} /> : null)}
          <button className="sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="up">↑</button>
          <button className="sm ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="down">↓</button>
          <button className="sm ghost danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="remove">✕</button>
        </div>))}
      <button className="sm" onClick={() => onChange([...items, {}])}>{addLabel}</button>
    </div>
  );
}

export default function ZonePanel({ doc, selectedId, onChange, onSelect, screenId, setScreenId }) {
  const zone = doc.zones.find((z) => z.id === selectedId);
  const [newScreen, setNewScreen] = useState('');
  const canvas = doc.canvas || {};
  const setZ = (patch) => onChange(updateZone(doc, zone.id, patch));
  const setStyle = (style) => setZ({ style });

  if (!zone) {
    return (
      <div className="panel">
        <h3>Canvas</h3>
        <div className="grid2">
          <Field label="Background"><ColorInput value={canvas.background || '#0b1a2a'} onChange={(v) => onChange({ ...doc, canvas: { ...canvas, background: v } })} /></Field>
          <Field label="Background image URL"><input value={canvas.backgroundImage || ''} onChange={(e) => onChange({ ...doc, canvas: { ...canvas, backgroundImage: e.target.value || null } })} placeholder="/procentric/application/assets/bg.jpg" /></Field>
        </div>
        <h3>Screens</h3>
        <p className="muted small">A screen is a set of visible zones. The first screen is what the TV shows at boot; PORTAL toggles to "fullscreen" if it exists.</p>
        {(doc.screens || []).map((s) => (
          <div key={s.id} className="list-row" style={{ alignItems: 'center' }}>
            <button className={'sm' + (s.id === screenId ? ' primary' : '')} onClick={() => setScreenId(s.id)}>{s.id}</button>
            <span className="muted small" style={{ flex: 1 }}>{s.zones.length} zone(s)</span>
            {(doc.screens || []).length > 1 && <button className="sm ghost danger" onClick={() => { onChange(removeScreen(doc, s.id)); if (screenId === s.id) setScreenId(doc.screens[0].id); }} aria-label={`remove screen ${s.id}`}>✕</button>}
          </div>))}
        <div className="inline"><input value={newScreen} onChange={(e) => setNewScreen(e.target.value)} placeholder="new screen id (e.g. fullscreen)" aria-label="New screen id" /><button className="sm" disabled={!newScreen.trim()} onClick={() => { onChange(addScreen(doc, newScreen.trim())); setNewScreen(''); }}>Add</button></div>
        <h3 style={{ marginTop: 16 }}>Remote keys</h3>
        <p className="muted small">CH±, digits, INFO and UP/DOWN/OK are always handled by the renderer. Map the other keys to actions here.</p>
        {KEY_NAMES.map((k) => (
          <div key={k} className="list-row" style={{ alignItems: 'center' }}>
            <span className="mono small" style={{ width: 70 }}>{k}</span>
            <select value={(doc.keys || {})[k] || ''} onChange={(e) => { const keys = { ...(doc.keys || {}) }; if (e.target.value) keys[k] = e.target.value; else delete keys[k]; onChange({ ...doc, keys }); }} aria-label={`key ${k}`}>
              <option value="">— default —</option>{ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>))}
      </div>
    );
  }

  const idx = doc.zones.findIndex((z) => z.id === zone.id);
  const onThisScreen = !screenId || ((doc.screens || []).find((s) => s.id === screenId) || { zones: [] }).zones.includes(zone.id);
  return (
    <div className="panel">
      <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{zone.type} zone</h3>
        <div className="actions">
          <button className="sm" onClick={() => onChange(moveZoneOrder(doc, zone.id, -1))} disabled={idx === 0} title="send back">↧</button>
          <button className="sm" onClick={() => onChange(moveZoneOrder(doc, zone.id, 1))} disabled={idx === doc.zones.length - 1} title="bring forward">↥</button>
          <button className="sm" onClick={() => { const r = duplicateZone(doc, zone.id, screenId); onChange(r.doc); onSelect(r.zone.id); }}>Duplicate</button>
          <button className="sm danger" onClick={() => { onChange(removeZone(doc, zone.id)); onSelect(null); }}>Delete</button>
        </div>
      </div>
      <div className="grid2">
        <Field label="Zone id"><input value={zone.id} onChange={(e) => { const nid = e.target.value.replace(/[^\w-]/g, ''); const d = renameZone(doc, zone.id, nid); if (d !== doc) { onChange(d); onSelect(nid); } }} aria-label="Zone id" /></Field>
        <Field label="Type"><select value={zone.type} onChange={(e) => setZ({ type: e.target.value })} aria-label="Zone type">{ZONE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
      </div>
      <div className="grid4">
        {['x', 'y', 'w', 'h'].map((k) => <Field key={k} label={k.toUpperCase()}><input type="number" value={zone[k]} onChange={(e) => setZ({ [k]: Number(e.target.value) })} aria-label={k.toUpperCase()} /></Field>)}
      </div>
      {screenId && (doc.screens || []).length > 0 && (
        <label className="inline" style={{ color: 'var(--text)', fontSize: 13, marginBottom: 10 }}><input type="checkbox" checked={onThisScreen} onChange={() => onChange(toggleZoneInScreen(doc, screenId, zone.id))} /> visible on screen "{screenId}"</label>)}
      <label className="inline" style={{ color: 'var(--text)', fontSize: 13, marginBottom: 10, marginLeft: 14 }}><input type="checkbox" checked={!!zone.hidden} onChange={(e) => setZ({ hidden: e.target.checked || undefined })} /> hidden page (opened by a menu action)</label>

      {zone.type === 'text' && <>
        <Field label="Text" hint="{{hotel}} {{room}} {{guest}} are substituted on the TV."><textarea value={zone.text || ''} onChange={(e) => setZ({ text: e.target.value })} rows={3} aria-label="Text" /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontSize', 'color', 'background', 'align', 'fontWeight', 'padding', 'borderRadius', 'opacity']} />
      </>}
      {zone.type === 'image' && <>
        <Field label="Image URL" hint="Upload logos under Tenant settings; they live in /procentric/application/assets/."><input value={zone.src || ''} onChange={(e) => setZ({ src: e.target.value })} aria-label="Image URL" /></Field>
        <Field label="Fit"><select value={zone.fit || 'contain'} onChange={(e) => setZ({ fit: e.target.value })}><option>contain</option><option>cover</option><option>fill</option></select></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['background', 'borderRadius', 'opacity']} />
      </>}
      {zone.type === 'clock' && <>
        <Field label="Format" hint="HH:mm, HH:mm:ss, hh:mm a, DD/MM/YYYY HH:mm"><input value={zone.format || 'HH:mm'} onChange={(e) => setZ({ format: e.target.value })} aria-label="Clock format" /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontSize', 'color', 'background', 'align', 'fontWeight']} />
      </>}
      {zone.type === 'video' && <>
        <Field label="Start channel" hint="first, last (remembered on the set) or a channel number"><input value={zone.startChannel ?? 'first'} onChange={(e) => setZ({ startChannel: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} aria-label="Start channel" /></Field>
        <p className="muted small">The TV tuner draws inside this rectangle. Resizing keeps 16:9 unless Alt is held.</p>
      </>}
      {zone.type === 'channel_list' && <StyleFields style={zone.style} onChange={setStyle} fields={['fontSize', 'color', 'background', 'highlight', 'padding', 'borderRadius']} />}
      {zone.type === 'menu' && <>
        <Field label="Items">
          <ListEditor items={zone.items || []} onChange={(items) => setZ({ items })} addLabel="Add item"
            fields={[{ key: 'label', label: 'Label' }, { key: 'action', label: 'Action', options: ['', ...ACTIONS] }, { key: 'page', label: 'page id', when: (it) => it.action === 'show_page' }, { key: 'app_id', label: 'app id', when: (it) => it.action === 'launch_app' }, { key: 'number', label: 'channel #', when: (it) => it.action === 'tune' }]} />
        </Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontSize', 'color', 'background', 'highlight', 'padding', 'borderRadius']} />
      </>}
      {zone.type === 'app_launcher' && <>
        <Field label="Apps" hint="LG app ids, e.g. netflix, youtube.leanback.v4, amazon"><ListEditor items={zone.apps || []} onChange={(apps) => setZ({ apps })} addLabel="Add app" fields={[{ key: 'label', label: 'Label' }, { key: 'app_id', label: 'app id' }]} /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontSize', 'color', 'background', 'highlight']} />
      </>}
      {zone.type === 'html' && <>
        <Field label="HTML"><textarea className="code" style={{ minHeight: 160 }} value={zone.html || ''} onChange={(e) => setZ({ html: e.target.value })} aria-label="HTML" /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontSize', 'color', 'background', 'padding', 'borderRadius']} />
      </>}
      {zone.type === 'weather' && <>
        <Field label="Units"><select value={zone.units || 'metric'} onChange={(e) => setZ({ units: e.target.value })}><option value="metric">°C</option><option value="imperial">°F</option></select></Field>
        <p className="muted small">Location comes from Tenant settings (latitude/longitude).</p>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontSize', 'color', 'background', 'align']} />
      </>}
    </div>
  );
}
