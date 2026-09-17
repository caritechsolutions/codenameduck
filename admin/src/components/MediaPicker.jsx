import React, { useEffect, useRef, useState } from 'react';
import { get } from '../api.js';
import { Modal, useToast } from './ui.jsx';

// Upload one file to the media library. Raw body + X-Filename (URI-encoded); ?as=logo makes it
// the tenant logo. Returns the API row.
export async function uploadMedia(file, { asLogo = false } = {}) {
  const r = await fetch(`/api/admin/media${asLogo ? '?as=logo' : ''}`, { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name || '') }, body: file });
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = { error: text }; }
  if (!r.ok) throw new Error((j && j.error) || `upload failed (${r.status})`);
  return j;
}

export const ACCEPT_IMAGES = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
export const ACCEPT_ALL = ACCEPT_IMAGES + ',video/mp4';

export function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB'; }

// One tile of the library grid. Videos show a film glyph, images their thumbnail.
export function MediaTile({ item, selected, onClick, children, dim }) {
  return (
    <div className={'media-tile' + (selected ? ' selected' : '')} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined} aria-label={item.name} data-testid="media-tile">
      <div className="media-thumb">
        {item.kind === 'video' ? <span className="media-glyph" aria-hidden>▶</span>
          : <img src={item.thumb_url || item.url} alt="" loading="lazy" />}
      </div>
      <div className="media-meta">
        <div className="media-name" title={item.name}>{item.name}</div>
        <div className="muted small">{item.kind === 'video' ? 'MP4' : item.ext.toUpperCase()}{item.width ? ` · ${item.width}×${item.height}` : ''}{dim === false ? '' : ` · ${fmtBytes(item.bytes)}`}</div>
      </div>
      {children}
    </div>
  );
}

// Modal picker. kind = 'image' | 'video' | 'all'. onPick(url, item). Upload straight from the
// picker, or type a URL.
export default function MediaPicker({ kind = 'image', title = 'Choose an image', onPick, onClose, allowLogo = true, allowUrl = true }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const load = () => get('/media').then(setItems, () => setItems([]));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const visible = (items || []).filter((m) => (kind === 'all' || m.kind === kind) && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
  async function upload(e) {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      let last = null;
      for (const f of files) last = await uploadMedia(f);
      await load();
      if (files.length === 1 && last) onPick(last.url, last);
      else toast(`Uploaded ${files.length} files`);
    } catch (err) { toast(err.message, 'bad'); } finally { setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose} footer={<>
      {allowUrl && <div className="inline" style={{ flex: 1 }}><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste an image URL" aria-label="Media URL" style={{ flex: 1 }} />
        <button disabled={!url.trim()} onClick={() => onPick(url.trim(), null)}>Use URL</button></div>}
      <button onClick={onClose}>Cancel</button>
    </>}>
      <div className="media-picker">
        <div className="inline" style={{ marginBottom: 10 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library" aria-label="Search media" style={{ flex: 1 }} />
          <label className={'btn' + (busy ? ' disabled' : '')}>{busy ? 'Uploading…' : 'Upload'}<input ref={fileRef} type="file" multiple accept={kind === 'video' ? 'video/mp4' : kind === 'all' ? ACCEPT_ALL : ACCEPT_IMAGES} style={{ display: 'none' }} onChange={upload} disabled={busy} aria-label="Upload file" /></label>
        </div>
        {items === null ? <div className="muted">Loading…</div> : (
          <div className="media-grid picker">
            {allowLogo && kind !== 'video' && <div className="media-tile" role="button" tabIndex={0} onClick={() => onPick('{{logo}}', null)} onKeyDown={(e) => { if (e.key === 'Enter') onPick('{{logo}}', null); }} aria-label="Tenant logo">
              <div className="media-thumb"><span className="media-glyph" aria-hidden>{'{{ }}'}</span></div>
              <div className="media-meta"><div className="media-name">Tenant logo</div><div className="muted small">{'{{logo}}'} from Settings</div></div>
            </div>}
            {visible.map((m) => <MediaTile key={m.id} item={m} onClick={() => onPick(m.url, m)} dim={false} />)}
            {visible.length === 0 && <div className="muted small" style={{ gridColumn: '1 / -1' }}>{items.length ? 'Nothing matches.' : 'The library is empty — upload a file.'}</div>}
          </div>)}
      </div>
    </Modal>
  );
}
