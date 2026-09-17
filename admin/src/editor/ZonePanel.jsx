import React, { useState, useRef } from 'react';
import { Field } from '../components/ui.jsx';
import MediaPicker from '../components/MediaPicker.jsx';
import { ZONE_TYPES, PLACEMENT_TYPES, KEY_NAMES, VARIABLES, FONTS, SHADOW_OPTIONS, TYPE_LABELS, GLOBAL_TYPES, updateZone, renameZone, actionValue, parseActionValue, actionChoices, actionOf, actionFlat, pagesOf, pageById, homePageId, isOnPage, isInheritedOnPage, toggleZoneInPage, renamePage, setPageInherit } from './geometry.js';

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

// Action picker: none | pages | back | fullscreen_tv | tune(channel) | launch_app(app) | toggle(zone).
// `value` is any action spelling (nested object or flat menu item); onChange gets a v2 object or null.
export function ActionPicker({ doc, value, onChange, apps = [], zones = [], label = 'Action', exclude = [] }) {
  const a = actionOf(value);
  const ch = actionChoices(doc, apps);
  const v = actionValue(value);
  const set = (patch) => onChange({ ...(a || {}), ...patch });
  return (
    <div className="action-picker">
      <select value={v} onChange={(e) => onChange(parseActionValue(e.target.value, a))} aria-label={label}>
        <option value="">— none —</option>
        {ch.pages.length > 0 && <optgroup label="Pages">{ch.pages.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
        <optgroup label="Built-in">{ch.builtins.filter((b) => !exclude.includes(b.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
      </select>
      {a && a.type === 'tune' && <input type="number" min="1" value={a.number ?? ''} placeholder="channel number" onChange={(e) => set({ number: num(e.target.value) ?? null })} aria-label="channel #" />}
      {a && a.type === 'launch_app' && (apps.length
        ? <select value={a.app_id || ''} onChange={(e) => set({ app_id: e.target.value })} aria-label="app id"><option value="">— app —</option>{apps.map((x) => <option key={x.id} value={x.id}>{x.name || x.id}</option>)}{a.app_id && !apps.some((x) => x.id === a.app_id) && <option value={a.app_id}>{a.app_id}</option>}</select>
        : <input value={a.app_id || ''} placeholder="app id (e.g. netflix)" onChange={(e) => set({ app_id: e.target.value })} aria-label="app id" />)}
      {a && a.type === 'toggle' && <select value={a.zone || ''} onChange={(e) => set({ zone: e.target.value })} aria-label="toggle zone"><option value="">— zone —</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.id} ({z.type})</option>)}</select>}
    </div>
  );
}

// Text editor with a small toolbar: bold/italic/size/colour live in the style; variables are
// inserted at the caret; Enter is a line break (the renderer keeps white-space).
function TextEditor({ zone, setZ }) {
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

// Menu items: label + the same action picker as zones (stored flat on the item).
function MenuItems({ doc, items, onChange, apps = [] }) {
  const set = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const setAction = (i, a) => { const flat = actionFlat(a); onChange(items.map((it, j) => (j === i ? { label: it.label, ...Object.fromEntries(Object.entries(flat).filter(([, v]) => v !== undefined)) } : it))); };
  const move = (i, d) => { const a = items.slice(); const [x] = a.splice(i, 1); a.splice(i + d, 0, x); onChange(a); };
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="menu-item-row">
          <div className="list-row">
            <input value={it.label || ''} placeholder="Label" onChange={(e) => set(i, { label: e.target.value })} aria-label="Label" />
            <button className="sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="up">↑</button>
            <button className="sm ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="down">↓</button>
            <button className="sm ghost danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="remove">✕</button>
          </div>
          <ActionPicker doc={doc} value={it} onChange={(a) => setAction(i, a)} apps={apps} zones={doc.zones} label="Action" />
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

export default function ZonePanel({ doc, selectedIds = [], onChange, onSelect, pageId, errorsByZone = {}, apps = [] }) {
  const zone = selectedIds.length === 1 ? doc.zones.find((z) => z.id === selectedIds[0]) : null;
  const [picker, setPicker] = useState(null);   // 'image' | 'background' | 'icon'
  const canvas = doc.canvas || {};
  const setZ = (patch) => onChange(updateZone(doc, zone.id, patch));
  const setStyle = (style) => setZ({ style });
  const page = pageById(doc, pageId);
  const home = homePageId(doc);

  if (selectedIds.length > 1) {
    return <div className="panel"><h3>{selectedIds.length} zones selected</h3><p className="muted small">Use the toolbar to align, distribute, lock or delete them. Select one zone to edit its properties.</p></div>;
  }
  if (!zone) {
    const focus = doc.focus || {};
    const setFocus = (patch) => onChange({ ...doc, focus: { ...focus, ...patch } });
    return (
      <div className="panel">
        <h3>Layout</h3>
        <div className="grid2">
          <Field label="Background"><ColorInput label="Canvas background" value={canvas.background || '#0b1a2a'} onChange={(v) => onChange({ ...doc, canvas: { ...canvas, background: v } })} /></Field>
          <Field label="Background image"><div className="inline"><input value={canvas.backgroundImage || ''} onChange={(e) => onChange({ ...doc, canvas: { ...canvas, backgroundImage: e.target.value || null } })} placeholder="none" aria-label="Background image URL" style={{ flex: 1 }} /><button className="sm" onClick={() => setPicker('background')} aria-label="Choose background image">Library…</button></div></Field>
        </div>
        {picker === 'background' && <MediaPicker title="Choose a background image" allowLogo={false} onClose={() => setPicker(null)} onPick={(url) => { onChange({ ...doc, canvas: { ...canvas, backgroundImage: url || null } }); setPicker(null); }} />}
        <h3>Focus ring</h3>
        <div className="grid2">
          <Field label="Colour"><ColorInput label="Focus colour" value={focus.color || '#ffd166'} onChange={(v) => setFocus({ color: v })} /></Field>
          <Field label="Width"><Slider value={focus.width} onChange={(v) => setFocus({ width: v })} min={0} max={20} label="Focus width" fallback={6} /></Field>
          <Field label="Corner radius"><Slider value={focus.radius} onChange={(v) => setFocus({ radius: v })} min={0} max={60} label="Focus radius" fallback={12} /></Field>
          <Field label="BACK on the home page"><select value={doc.back_on_home || 'none'} onChange={(e) => onChange({ ...doc, back_on_home: e.target.value })} aria-label="BACK on home"><option value="none">does nothing</option><option value="fullscreen_tv">full-screen TV</option></select></Field>
        </div>
        {page && <>
          <h3>This page</h3>
          <div className="grid2">
            <Field label="Page name"><input value={page.name || ''} onChange={(e) => onChange(renamePage(doc, page.id, e.target.value))} aria-label="Page name" /></Field>
            <Field label="Page id"><input value={page.id} disabled aria-label="Page id" /></Field>
          </div>
          {page.id === home ? <p className="muted small">Home page: shown at boot. Its global zones (live TV, channel list, clock, OSD positions) are inherited by pages that ask for it.</p>
            : <label className="inline" style={{ color: 'var(--text)', fontSize: 13, marginBottom: 10 }}><input type="checkbox" checked={page.inherit !== false} onChange={(e) => onChange(setPageInherit(doc, page.id, e.target.checked))} aria-label="Inherit global zones from home" /> inherit global zones (TV, channel list, clock) from the home page</label>}
        </>}
        <h3 style={{ marginTop: 16 }}>Remote keys</h3>
        <p className="muted small">CH±, digits, INFO, arrows and OK are always handled by the renderer. PORTAL/GUIDE default to full-screen TV, BACK/EXIT to back.</p>
        {KEY_NAMES.map((k) => (
          <div key={k} className="list-row" style={{ alignItems: 'flex-start' }}>
            <span className="mono small" style={{ width: 70, paddingTop: 8 }}>{k}</span>
            <div style={{ flex: 1 }}><ActionPicker doc={doc} value={(doc.keys || {})[k]} onChange={(a) => { const keys = { ...(doc.keys || {}) }; if (a) keys[k] = a; else delete keys[k]; onChange({ ...doc, keys }); }} apps={apps} zones={doc.zones} label={`key ${k}`} /></div>
          </div>))}
      </div>
    );
  }

  const errs = errorsByZone[zone.id];
  const onThisPage = pageId ? isOnPage(doc, pageId, zone.id) : true;
  const inheritedHere = pageId ? isInheritedOnPage(doc, pageId, zone.id) : false;
  const canAct = ['text', 'image', 'button'].includes(zone.type);
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
        {pageId && <label className="inline" style={{ color: 'var(--text)', fontSize: 13 }}><input type="checkbox" checked={onThisPage} onChange={() => onChange(toggleZoneInPage(doc, pageId, zone.id))} /> on page "{page ? page.name || page.id : pageId}"{inheritedHere ? <span className="muted"> (inherited from home)</span> : null}</label>}
        <label className="inline" style={{ color: 'var(--text)', fontSize: 13 }}><input type="checkbox" checked={!!zone.locked} onChange={(e) => setZ({ locked: e.target.checked || undefined })} /> locked</label>
        {GLOBAL_TYPES.includes(zone.type) && <span className="muted small">global zone: placed on home it follows to inheriting pages</span>}
      </div>}
      {canAct && <Field label="Action (OK on the remote)" hint={zone.type === 'button' ? 'Buttons are focusable; the arrow keys move between focusable zones.' : 'With an action this zone becomes focusable on the TV.'}>
        <ActionPicker doc={doc} value={zone.action} onChange={(a) => setZ({ action: a || undefined })} apps={apps} zones={doc.zones.filter((z) => z.id !== zone.id)} />
      </Field>}

      {zone.type === 'text' && <>
        <TextEditor zone={zone} setZ={setZ} />
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'fontWeight', 'align', 'valign', 'color', 'background', 'padding', 'borderRadius', 'opacity', 'shadow']} />
      </>}
      {zone.type === 'button' && <>
        <div className="grid2">
          <Field label="Label"><input value={zone.label || ''} onChange={(e) => setZ({ label: e.target.value })} aria-label="Button label" /></Field>
          <Field label="Icon"><div className="inline"><input value={zone.icon || ''} onChange={(e) => setZ({ icon: e.target.value || undefined })} placeholder="none" aria-label="Button icon URL" style={{ flex: 1 }} /><button className="sm" onClick={() => setPicker('icon')} aria-label="Choose icon">Library…</button></div></Field>
        </div>
        {picker === 'icon' && <MediaPicker title="Choose an icon" allowLogo={false} onClose={() => setPicker(null)} onPick={(url) => { setZ({ icon: url }); setPicker(null); }} />}
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'fontWeight', 'color', 'background', 'padding', 'borderRadius', 'opacity']} />
        <h3>When focused</h3>
        <div className="grid2">
          <Field label="Background"><ColorInput label="Focused background" value={(zone.focusStyle || {}).background || ''} onChange={(v) => setZ({ focusStyle: { ...(zone.focusStyle || {}), background: v || undefined } })} /></Field>
          <Field label="Colour"><ColorInput label="Focused colour" value={(zone.focusStyle || {}).color || ''} onChange={(v) => setZ({ focusStyle: { ...(zone.focusStyle || {}), color: v || undefined } })} /></Field>
        </div>
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
        <p className="muted small">The TV tuner draws inside this rectangle. Resizing keeps 16:9 unless Alt is held. The full-screen TV action expands it to the whole canvas.</p>
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
        <Field label="HTML" hint="Variables like {{hotel}} work here too. Put it on its own page for an info screen."><textarea className="code" style={{ minHeight: 160 }} value={zone.html || ''} onChange={(e) => setZ({ html: e.target.value })} aria-label="HTML" /></Field>
        <StyleFields style={zone.style} onChange={setStyle} fields={['fontFamily', 'fontSize', 'color', 'background', 'padding', 'borderRadius', 'opacity']} />
      </>}
      {PLACEMENT_TYPES.includes(zone.type) && <>
        <p className="muted small">{zone.type === 'banner' ? 'Where the INFO / channel-change banner appears (number, name, clock).' : zone.type === 'digits' ? 'Where typed channel digits appear.' : 'Where one-off message commands pop up.'} Shown on every page; delete the zone to use the default position.</p>
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
