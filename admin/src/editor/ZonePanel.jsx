import React, { useState, useRef } from 'react';
import { Field } from '../components/ui.jsx';
import MediaPicker from '../components/MediaPicker.jsx';
import { ZONE_TYPES, PLACEMENT_TYPES, KEY_NAMES, VARIABLES, FONTS, SHADOW_OPTIONS, TYPE_LABELS, BUILTIN_ACTIONS, updateZone, renameZone, addScreen, removeScreen, actionValue, parseActionValue, actionChoices } from './geometry.js';

const num = (v) => (v === '' || v == null ? undefined : Number(v));

// ---------------------------------------------------------------- typed style controls
export function ColorInput({ value, onChange, label }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{3}$/i.test(value) ? '#' + value.slice(1).split('').map((c) => c + c).join('') : '#ffffff';
  return <div className="inline"><input type="color" value={hex} onChange={(e) => onChange(e.target.value)} style={{ width: 44, padding: 2, flex: 'none' }} aria-label={label ? label + ' swatch' : undefined} /><input value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder="#rrggbb or rgba(…)" /></div>;
}
function Slider({ value, onChange, min, max, step = 1, label, fallback }) {
  const v = value ?? fallback ?? min;
  return <div className="inline slider"><input type="range" min={min} max={max} step={step} value={v} onChange={(e) => onChange(Number(e.target.value))} aria-label={label + ' slider'} /><input type="number" min={min} max={max} step={step} value={value ?? ''} placeholder={String(fallback ?? '')} onChange={(e) => onChange(num(e.target.value))} aria-label={label} style={{ width: 70, flex: 'none' }} /></div>;
}
function Segmented({ value, onChange, options, label }) {
  return <div className="segmented" role="radiogroup" aria-label={label}>{options.map(([v, text, title]) => <button key={v} type="button" className={value === v ? 'active' : ''} role="radio" aria-checked={value === v} title={title || text} onClick={() => onChange(v)}>{text}</button>)}</div>;
}
export function FontPicker({ value, onChange }) {
  return <select value={value || ''} onChange={(e) => onChange(e.target.value || undefined)} aria-label="Font" style={{ fontFamily: value ? `"${value}", sans-serif` : undefined }}>
    {FONTS.map((f) => <option key={f.family} value={f.family} style={{ fontFamily: f.family ? `"${f.family}", sans-serif` : undefined }}>{f.label}</option>)}
  </select>;
}

export function StyleFields({ style = {}, onChange, fields }) {
  const set = (k, v) => onChange({ ...style, [k]: v === '' || v === undefined ? undefined : v });
  const has = (k) => fields.includes(k);
  return (
    <div className="stylefields">
      {(has('fontFamily') || has('fontSize')) && <div className="grid2">
        {has('fontFamily') && <Field label="Font"><FontPicker value={style.fontFamily} onChange={(v) => set('fontFamily', v)} /></Field>}
        {has('fontSize') && <Field label="Size"><Slider value={style.fontSize} onChange={(v) => set('fontSize', v)} min={12} max={200} label="Font size" fallback={28} /></Field>}
      </div>}
      {(has('fontWeight') || has('align') || has('valign')) && <div className="inline" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        {has('fontWeight') && <div className="segmented" role="group" aria-label="Emphasis">
          <button type="button" className={style.fontWeight === 'bold' ? 'active' : ''} aria-pressed={style.fontWeight === 'bold'} title="Bold" aria-label="Bold" onClick={() => set('fontWeight', style.fontWeight === 'bold' ? undefined : 'bold')}><b>B</b></button>
          <button type="button" className={style.fontStyle === 'italic' ? 'active' : ''} aria-pressed={style.fontStyle === 'italic'} title="Italic" aria-label="Italic" onClick={() => set('fontStyle', style.fontStyle === 'italic' ? undefined : 'italic')}><i>I</i></button>
        </div>}
        {has('align') && <Segmented label="Text alignment" value={style.align || 'left'} onChange={(v) => set('align', v === 'left' ? undefined : v)} options={[['left', '⫷', 'Align left'], ['center', '☰', 'Centre'], ['right', '⫸', 'Align right']]} />}
        {has('valign') && <Segmented label="Vertical alignment" value={style.valign || 'top'} onChange={(v) => set('valign', v === 'top' ? undefined : v)} options={[['top', '⤒', 'Top'], ['middle', '⇳', 'Middle'], ['bottom', '⤓', 'Bottom']]} />}
      </div>}
      <div className="grid2">
        {has('color') && <Field label="Colour"><ColorInput label="Colour" value={style.color || '#ffffff'} onChange={(v) => set('color', v)} /></Field>}
        {has('background') && <Field label="Background"><ColorInput label="Background" value={style.background || ''} onChange={(v) => set('background', v)} /></Field>}
        {has('highlight') && <Field label="Highlight"><ColorInput label="Highlight" value={style.highlight || '#ffd166'} onChange={(v) => set('highlight', v)} /></Field>}
        {has('padding') && <Field label="Padding"><Slider value={style.padding} onChange={(v) => set('padding', v)} min={0} max={120} label="Padding" fallback={0} /></Field>}
        {has('borderRadius') && <Field label="Corner radius"><Slider value={style.borderRadius} onChange={(v) => set('borderRadius', v)} min={0} max={120} label="Corner radius" fallback={0} /></Field>}
        {has('opacity') && <Field label="Opacity"><Slider value={style.opacity} onChange={(v) => set('opacity', v)} min={0} max={1} step={0.05} label="Opacity" fallback={1} /></Field>}
        {has('shadow') && <Field label="Text shadow"><select value={style.shadow || ''} onChange={(e) => set('shadow', e.target.value || undefined)} aria-label="Text shadow">{SHADOW_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>}
      </div>
    </div>
  );
}

// Text editor with a small toolbar: bold/italic/size/colour live in the style; variables are
// inserted at the caret; Enter is a line break (the renderer keeps white-space).
function TextEditor({ zone, setZ, setStyle }) {
  const ref = useRef(null);
  const insert = (v) => {
    const el = ref.current; const text = zone.text || '';
    const s = el ? el.selectionStart : text.length, e = el ? el.selectionEnd : text.length;
    const next = text.slice(0, s) + `{{${v}}}` + text.slice(e);
    setZ({ text: next });
    if (el) requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + v.length + 4; });
  };
  return (
    <Field label="Text" hint="Enter = new line. Variables are filled in on the TV; {{time}} and {{date}} tick every minute.">
      <div className="inline" style={{ marginBottom: 6 }}>
        <select value="" onChange={(e) => { if (e.target.value) insert(e.target.value); }} aria-label="Insert variable" style={{ flex: 'none' }}>
          <option value="">Insert variable…</option>{VARIABLES.map((v) => <option key={v} value={v}>{`{{${v}}}`}</option>)}
        </select>
      </div>
      <textarea ref={ref} value={zone.text || ''} onChange={(e) => setZ({ text: e.target.value })} rows={4} aria-label="Text" style={{ fontFamily: zone.style && zone.style.fontFamily ? `"${zone.style.fontFamily}", sans-serif` : undefined, fontWeight: (zone.style && zone.style.fontWeight) || undefined, fontStyle: (zone.style && zone.style.fontStyle) || undefined }} />
    </Field>
  );
}

// Menu items with the action picker (pages, screens, apps, built-ins).
function MenuItems({ doc, items, onChange, apps = [] }) {
  const ch = actionChoices(doc, apps);
  const set = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i, d) => { const a = items.slice(); const [x] = a.splice(i, 1); a.splice(i + d, 0, x); onChange(a); };
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="menu-item-row">
          <div className="list-row">
            <input value={it.label || ''} placeholder="Label" onChange={(e) => set(i, { label: e.target.value })} aria-label="Label" />
            <select value={actionValue(it).startsWith('launch_app') ? 'launch_app' : actionValue(it)} onChange={(e) => set(i, parseActionValue(e.target.value))} aria-label="Action">
              <option value="">— action —</option>
              {ch.pages.length > 0 && <optgroup label="Pages">{ch.pages.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
              {ch.screens.length > 0 && <optgroup label="Screens">{ch.screens.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
              <optgroup label="Built-in">{BUILTIN_ACTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
            </select>
            <button className="sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="up">↑</button>
            <button className="sm ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="down">↓</button>
            <button className="sm ghost danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="remove">✕</button>
          </div>
          {it.action === 'launch_app' && <div className="list-row">{apps.length ? <select value={it.app_id || ''} onChange={(e) => set(i, { app_id: e.target.value })} aria-label="app id"><option value="">— app —</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}</select> : <input value={it.app_id || ''} placeholder="app id (e.g. netflix)" onChange={(e) => set(i, { app_id: e.target.value })} aria-label="app id" />}</div>}
          {it.action === 'tune' && <div className="list-row"><input type="number" value={it.number ?? ''} placeholder="channel number" onChange={(e) => set(i, { number: num(e.target.value) })} aria-label="channel #" /></div>}
        </div>))}
      <button className="sm" onClick={() => onChange([...items, { label: 'New item' }])}>Add item</button>
    </div>
  );
}

function ListEditor({ items, onChange, fields, addLabel }) {
  const set = (i, k, v) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const move = (i, d) => { const a = items.slice(); const [x] = a.splice(i, 1); a.splice(i + d, 0, x); onChange(a); };
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="list-row">
          {fields.map((f) => <input key={f.key} value={it[f.key] || ''} placeholder={f.label} onChange={(e) => set(i, f.key, e.target.value)} aria-label={f.label} />)}
          <button className="sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="up">↑</button>
          <button className="sm ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="down">↓</button>
          <button className="sm ghost danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="remove">✕</button>
        </div>))}
      <button className="sm" onClick={() => onChange([...items, {}])}>{addLabel}</button>
    </div>
  );
}

export default function ZonePanel({ doc, selectedIds = [], onChange, onSelect, screenId, setScreenId, errorsByZone = {}, apps = [] }) {
  const zone = selectedIds.length === 1 ? doc.zones.find((z) => z.id === selectedIds[0]) : null;
  const [newScreen, setNewScreen] = useState('');
  const [picker, setPicker] = useState(null);   // 'image' | 'background'
  const canvas = doc.canvas || {};
  const setZ = (patch) => onChange(updateZone(doc, zone.id, patch));
  const setStyle = (style) => setZ({ style });

  if (selectedIds.length > 1) {
    return <div className="panel"><h3>{selectedIds.length} zones selected</h3><p className="muted small">Use the toolbar to align, distribute, lock or delete them. Select one zone to edit its properties.</p></div>;
  }
  if (!zone) {
    return (
      <div className="panel">
        <h3>Canvas</h3>
        <div className="grid2">
          <Field label="Background"><ColorInput label="Canvas background" value={canvas.background || '#0b1a2a'} onChange={(v) => onChange({ ...doc, canvas: { ...canvas, background: v } })} /></Field>
          <Field label="Background image"><div className="inline"><input value={canvas.backgroundImage || ''} onChange={(e) => onChange({ ...doc, canvas: { ...canvas, backgroundImage: e.target.value || null } })} placeholder="none" aria-label="Background image URL" style={{ flex: 1 }} /><button className="sm" onClick={() => setPicker('background')} aria-label="Choose background image">Library…</button></div></Field>
        </div>
        {picker === 'background' && <MediaPicker title="Choose a background image" allowLogo={false} onClose={() => setPicker(null)} onPick={(url) => { onChange({ ...doc, canvas: { ...canvas, backgroundImage: url || null } }); setPicker(null); }} />}
        <h3>Screens</h3>
        <p className="muted small">A screen is a set of visible zones. The first is what the TV shows at boot; PORTAL toggles to "fullscreen" if it exists. Pages are hidden zones a menu opens on top.</p>
        {(doc.screens || []).map((s) => (
          <div key={s.id} className="list-row" style={{ alignItems: 'center' }}>
            <button className={'sm' + (s.id === screenId ? ' primary' : '')} onClick={() => setScreenId(s.id)}>{s.id}</button>
            <span className="muted small" style={{ flex: 1 }}>{s.zones.length} zone(s)</span>
            {(doc.screens || []).length > 1 && <button className="sm ghost danger" onClick={() => { onChange(removeScreen(doc, s.id)); if (screenId === s.id) setScreenId(doc.screens[0].id); }} aria-label={`remove screen ${s.id}`}>✕</button>}
          </div>))}
        <div className="inline"><input value={newScreen} onChange={(e) => setNewScreen(e.target.value)} placeholder="new screen id (e.g. dining)" aria-label="New screen id" /><button className="sm" disabled={!newScreen.trim()} onClick={() => { onChange(addScreen(doc, newScreen.trim().replace(/[^\w-]/g, ''))); setNewScreen(''); }}>Add</button></div>
        <h3 style={{ marginTop: 16 }}>Remote keys</h3>
        <p className="muted small">CH±, digits, INFO and UP/DOWN/OK are always handled by the renderer. Map the other keys to actions here.</p>
        {KEY_NAMES.map((k) => (
          <div key={k} className="list-row" style={{ alignItems: 'center' }}>
            <span className="mono small" style={{ width: 70 }}>{k}</span>
            <select value={(doc.keys || {})[k] || ''} onChange={(e) => { const keys = { ...(doc.keys || {}) }; if (e.target.value) keys[k] = e.target.value; else delete keys[k]; onChange({ ...doc, keys }); }} aria-label={`key ${k}`}>
              <option value="">— default —</option>{BUILTIN_ACTIONS.filter((a) => !['tune', 'launch_app'].includes(a.value)).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>))}
      </div>
    );
  }

  const errs = errorsByZone[zone.id];
  const onThisScreen = !screenId || ((doc.screens || []).find((s) => s.id === screenId) || { zones: [] }).zones.includes(zone.id);
  return (
    <div className="panel">
      <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{TYPE_LABELS[zone.type] || zone.type}</h3>
        {zone.locked && <span className="pill">locked</span>}
      </div>
      {errs && <ul className="error small" role="status">{errs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <div className="grid2">
        <Field label="Zone id"><input value={zone.id} onChange={(e) => { const nid = e.target.value.replace(/[^\w-]/g, ''); const d = renameZone(doc, zone.id, nid); if (d !== doc) { onChange(d); onSelect([nid]); } }} aria-label="Zone id" /></Field>
        <Field label="Type"><select value={zone.type} onChange={(e) => setZ({ type: e.target.value })} aria-label="Zone type">{ZONE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}</select></Field>
      </div>
      <div className="grid4">
        {['x', 'y', 'w', 'h'].map((k) => <Field key={k} label={k.toUpperCase()}><input type="number" value={zone[k]} disabled={!!zone.locked} onChange={(e) => setZ({ [k]: Number(e.target.value) })} aria-label={k.toUpperCase()} /></Field>)}
      </div>
      {!PLACEMENT_TYPES.includes(zone.type) && <div className="inline" style={{ flexWrap: 'wrap', gap: 14, marginBottom: 10 }}>
        {screenId && (doc.screens || []).length > 0 && <label className="inline" style={{ color: 'var(--text)', fontSize: 13 }}><input type="checkbox" checked={onThisScreen} onChange={() => onChange({ ...doc, screens: doc.screens.map((s) => (s.id !== screenId ? s : s.zones.includes(zone.id) ? { ...s, zones: s.zones.filter((z) => z !== zone.id) } : { ...s, zones: [...s.zones, zone.id] })) })} /> visible on screen "{screenId}"</label>}
        <label className="inline" style={{ color: 'var(--text)', fontSize: 13 }}><input type="checkbox" checked={!!zone.hidden} onChange={(e) => setZ({ hidden: e.target.checked || undefined })} /> hidden page (opened by a menu action)</label>
        <label className="inline" style={{ color: 'var(--text)', fontSize: 13 }}><input type="checkbox" checked={!!zone.locked} onChange={(e) => setZ({ locked: e.target.checked || undefined })} /> locked</label>
      </div>}

      {zone.type === 'text' && <>
        <TextEditor zone={zone} setZ={setZ} setStyle={setStyle} />
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'fontWeight', 'align', 'valign', 'color', 'background', 'padding', 'borderRadius', 'opacity', 'shadow']} />
      </>}
      {zone.type === 'image' && <>
        <Field label="Image" hint="Pick from the Media library or paste a URL. {{logo}} = the hotel logo from Settings."><div className="inline"><input value={zone.src || ''} onChange={(e) => setZ({ src: e.target.value })} aria-label="Image URL" style={{ flex: 1 }} /><button className="sm" onClick={() => setPicker('image')} aria-label="Choose image">Library…</button></div></Field>
        {zone.src && !/\{\{/.test(zone.src) && <div className="media-inline-preview"><img src={zone.src} alt="" /></div>}
        {picker === 'image' && <MediaPicker onClose={() => setPicker(null)} onPick={(url) => { setZ({ src: url }); setPicker(null); }} />}
        <Field label="Fit"><Segmented label="Fit" value={zone.fit || 'contain'} onChange={(v) => setZ({ fit: v })} options={[['contain', 'contain'], ['cover', 'cover'], ['fill', 'stretch']]} /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['background', 'borderRadius', 'opacity']} />
      </>}
      {zone.type === 'clock' && <>
        <Field label="Format" hint="HH:mm, HH:mm:ss, hh:mm a, DD/MM/YYYY HH:mm"><input value={zone.format || 'HH:mm'} onChange={(e) => setZ({ format: e.target.value })} aria-label="Clock format" /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'fontWeight', 'align', 'color', 'background', 'padding', 'borderRadius', 'shadow']} />
      </>}
      {zone.type === 'video' && <>
        <Field label="Start channel" hint="first, last (remembered on the set) or a channel number"><input value={zone.startChannel ?? 'first'} onChange={(e) => setZ({ startChannel: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} aria-label="Start channel" /></Field>
        <p className="muted small">The TV tuner draws inside this rectangle. Resizing keeps 16:9 unless Alt is held. On the "fullscreen" screen it fills the canvas.</p>
      </>}
      {zone.type === 'channel_list' && <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'color', 'background', 'highlight', 'padding', 'borderRadius', 'opacity']} />}
      {zone.type === 'menu' && <>
        <Field label="Items"><MenuItems doc={doc} items={zone.items || []} onChange={(items) => setZ({ items })} apps={apps} /></Field>
        <Field label="Layout"><Segmented label="Menu layout" value={zone.layout || 'column'} onChange={(v) => setZ({ layout: v === 'column' ? undefined : v })} options={[['column', 'list'], ['row', 'row']]} /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'fontWeight', 'color', 'background', 'highlight', 'padding', 'borderRadius', 'opacity']} />
      </>}
      {zone.type === 'apps' && <>
        <p className="muted small">Shows the apps enabled for the set's group (Apps page) as tiles: icon + name, remote-navigable, OK launches. Nothing to configure per layout except the look.</p>
        <Field label="Layout"><Segmented label="Apps layout" value={zone.layout || 'row'} onChange={(v) => setZ({ layout: v })} options={[['row', 'one row'], ['grid', 'grid']]} /></Field>
        <Field label="Tile size"><Slider value={zone.style && zone.style.tileSize} onChange={(v) => setStyle({ ...(zone.style || {}), tileSize: v })} min={100} max={400} label="Tile size" fallback={200} /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'color', 'background', 'highlight', 'padding', 'borderRadius', 'opacity']} />
      </>}
      {zone.type === 'app_launcher' && <>
        <Field label="Apps" hint="LG app ids, e.g. netflix, youtube.leanback.v4, amazon"><ListEditor items={zone.apps || []} onChange={(apps) => setZ({ apps })} addLabel="Add app" fields={[{ key: 'label', label: 'Label' }, { key: 'app_id', label: 'app id' }]} /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'color', 'background', 'highlight', 'borderRadius']} />
      </>}
      {zone.type === 'html' && <>
        <Field label="HTML" hint="Variables like {{hotel}} work here too."><textarea className="code" style={{ minHeight: 160 }} value={zone.html || ''} onChange={(e) => setZ({ html: e.target.value })} aria-label="HTML" /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'color', 'background', 'padding', 'borderRadius', 'opacity']} />
      </>}
      {PLACEMENT_TYPES.includes(zone.type) && <>
        <p className="muted small">{zone.type === 'banner' ? 'Where the INFO / channel-change banner appears (number, name, clock).' : zone.type === 'digits' ? 'Where typed channel digits appear.' : 'Where one-off message commands pop up.'} Shown on every screen; delete the zone to use the default position.</p>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'fontWeight', 'align', 'color', 'background', 'padding', 'borderRadius', 'opacity']} />
      </>}
      {zone.type === 'weather' && <>
        <Field label="Units"><Segmented label="Units" value={zone.units || 'metric'} onChange={(v) => setZ({ units: v })} options={[['metric', '°C'], ['imperial', '°F']]} /></Field>
        <p className="muted small">Location comes from Settings (latitude/longitude).</p>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'align', 'color', 'background', 'borderRadius']} />
      </>}
    </div>
  );
}
