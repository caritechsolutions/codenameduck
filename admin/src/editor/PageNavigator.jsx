import React, { useState } from 'react';
import { pagesOf, homePageId, addPage, renamePage, removePage, duplicatePage, movePage, setHomePage } from './geometry.js';

// Left-hand page navigator: list, add, rename (double-click or ✎), duplicate, delete, set as
// home, drag to reorder. Selecting a page edits that page's canvas.
export default function PageNavigator({ doc, pageId, onSelect, onChange }) {
  const pages = pagesOf(doc);
  const home = homePageId(doc);
  const [adding, setAdding] = useState(null);      // string while the add input is open
  const [editing, setEditing] = useState(null);    // { id, name }
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);

  const add = () => { if (!adding || !adding.trim()) { setAdding(null); return; } const r = addPage(doc, adding); onChange(r.doc); onSelect(r.page.id); setAdding(null); };
  const commitRename = () => { if (editing) { onChange(renamePage(doc, editing.id, editing.name)); setEditing(null); } };
  const drop = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOver(null); return; }
    const to = pages.findIndex((p) => p.id === targetId);
    onChange(movePage(doc, dragId, to));
    setDragId(null); setOver(null);
  };
  return (
    <div className="pagenav" aria-label="Pages">
      <div className="pal-title"><span>Pages</span><button className="sm ghost" onClick={() => setAdding('')} aria-label="Add page" title="Add page">＋</button></div>
      {pages.map((p, i) => (
        <div key={p.id} className={'page-row' + (p.id === pageId ? ' active' : '') + (over === p.id ? ' dragover' : '')} role="button" tabIndex={0} aria-label={`page ${p.name || p.id}`} aria-current={p.id === pageId ? 'page' : undefined}
          draggable onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/page-id', p.id); } catch { /* jsdom */ } }}
          onDragOver={(e) => { e.preventDefault(); if (over !== p.id) setOver(p.id); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); drop(p.id); }} onDragEnd={() => { setDragId(null); setOver(null); }}
          onClick={() => onSelect(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(p.id); }} onDoubleClick={() => setEditing({ id: p.id, name: p.name || p.id })}>
          {p.id === home ? <span className="home-star" title="Home page (shown at boot)" aria-label="home page">★</span> : <span style={{ width: 12 }} />}
          {editing && editing.id === p.id
            ? <input autoFocus value={editing.name} aria-label="Rename page" onClick={(e) => e.stopPropagation()} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(null); }} style={{ flex: 1, padding: '2px 6px' }} />
            : <span className="pname" title={p.id}>{p.name || p.id}<small>{p.zones.length}</small></span>}
          <span className="pact">
            <button title="Rename" aria-label={`rename page ${p.id}`} onClick={(e) => { e.stopPropagation(); setEditing({ id: p.id, name: p.name || p.id }); }}>✎</button>
            <button title="Duplicate" aria-label={`duplicate page ${p.id}`} onClick={(e) => { e.stopPropagation(); const r = duplicatePage(doc, p.id); onChange(r.doc); if (r.page) onSelect(r.page.id); }}>⧉</button>
            {p.id !== home && <button title="Set as home page" aria-label={`set home ${p.id}`} onClick={(e) => { e.stopPropagation(); onChange(setHomePage(doc, p.id)); }}>☆</button>}
            {i > 0 && <button title="Move up" aria-label={`move up ${p.id}`} onClick={(e) => { e.stopPropagation(); onChange(movePage(doc, p.id, i - 1)); }}>↑</button>}
            {i < pages.length - 1 && <button title="Move down" aria-label={`move down ${p.id}`} onClick={(e) => { e.stopPropagation(); onChange(movePage(doc, p.id, i + 1)); }}>↓</button>}
            {p.id !== home && pages.length > 1 && <button className="danger" title="Delete page" aria-label={`delete page ${p.id}`} onClick={(e) => { e.stopPropagation(); const next = removePage(doc, p.id); onChange(next); if (pageId === p.id) onSelect(homePageId(next)); }}>✕</button>}
          </span>
        </div>))}
      {adding !== null && <div className="inline" style={{ marginTop: 6 }}>
        <input autoFocus value={adding} placeholder="Page name" aria-label="New page name" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(null); }} style={{ flex: 1 }} />
        <button className="sm" disabled={!adding.trim()} onClick={add}>Add</button>
      </div>}
      <div className="muted small" style={{ padding: '6px 4px 0' }}>★ home = shown at boot. Drag to reorder. Full-screen TV is an action, not a page.</div>
    </div>
  );
}
