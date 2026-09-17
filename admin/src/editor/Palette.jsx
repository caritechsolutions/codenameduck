import React from 'react';
import { PALETTE } from './geometry.js';

const GLYPH = { video: '▶', text: 'T', image: '▨', channel_list: '☰', menu: '≡', app_launcher: '⊞', clock: '◷', weather: '☀', banner: '▬', digits: '12', popup: '▭', html: '</>' };

// Left-hand zone palette: click adds at the default spot, drag onto the canvas adds where dropped.
export default function Palette({ onAdd }) {
  return (
    <div className="palette" aria-label="Zone palette">
      {PALETTE.map((g) => (
        <div key={g.group} className="pal-group">
          <div className="pal-title">{g.group}</div>
          {g.items.map(([type, label]) => (
            <div key={type} className="pal-item" draggable role="button" tabIndex={0} aria-label={`add ${label}`} data-type={type}
              onClick={() => onAdd(type)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(type); } }}
              onDragStart={(e) => { e.dataTransfer.setData('text/zone-type', type); e.dataTransfer.effectAllowed = 'copy'; }}>
              <span className="pal-glyph" aria-hidden>{GLYPH[type] || '▢'}</span><span>{label}</span>
            </div>))}
        </div>))}
      <div className="muted small" style={{ padding: '6px 8px' }}>Click to add, or drag onto the canvas.</div>
    </div>
  );
}
