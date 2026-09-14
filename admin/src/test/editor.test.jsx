import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CanvasEditor from '../editor/CanvasEditor.jsx';
import ZonePanel from '../editor/ZonePanel.jsx';

const DOC = { schema: 1, canvas: { w: 1920, h: 1080, background: '#000' },
  zones: [{ id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 }, { id: 'welcome', type: 'text', x: 80, y: 60, w: 800, h: 90, text: 'Hi {{room}}', style: { fontSize: 48 } }],
  keys: {}, screens: [{ id: 'home', zones: ['tv', 'welcome'] }, { id: 'fullscreen', zones: ['tv'] }] };

function Harness({ initial = DOC }) {
  const [doc, setDoc] = React.useState(initial);
  const [sel, setSel] = React.useState(null);
  const [screenId, setScreenId] = React.useState('home');
  return <>
    <CanvasEditor doc={doc} onChange={setDoc} selectedId={sel} onSelect={setSel} screenId={screenId} width={960} />
    <ZonePanel doc={doc} selectedId={sel} onChange={setDoc} onSelect={setSel} screenId={screenId} setScreenId={setScreenId} />
    <pre data-testid="json">{JSON.stringify(doc)}</pre>
  </>;
}
const docOf = () => JSON.parse(screen.getByTestId('json').textContent);

describe('canvas editor', () => {
  it('renders zones at scale and selects on pointer down', () => {
    render(<Harness />);
    const tv = document.querySelector('[data-zone="tv"]');
    expect(tv.style.left).toBe('320px'); // 640 * 0.5
    expect(tv.style.width).toBe('600px');
    fireEvent.pointerDown(tv, { clientX: 400, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 400, clientY: 200 });
    expect(document.querySelectorAll('.handle').length).toBe(8);
    expect(screen.getByLabelText('X').value).toBe('640');
  });
  it('drag moves with snapping; resize handle grows; arrows nudge; panel edits x', () => {
    render(<Harness />);
    const w = document.querySelector('[data-zone="welcome"]');
    fireEvent.pointerDown(w, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 133, clientY: 108 });   // +66,+16 canvas px → snapped
    fireEvent.pointerUp(window, { clientX: 133, clientY: 108 });
    let z = docOf().zones.find((x) => x.id === 'welcome');
    expect([z.x, z.y]).toEqual([150, 80]);
    const se = document.querySelector('.handle.h-se');
    fireEvent.pointerDown(se, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 550, clientY: 520 });   // +100,+40
    fireEvent.pointerUp(window, { clientX: 550, clientY: 520 });
    z = docOf().zones.find((x) => x.id === 'welcome');
    expect([z.w, z.h]).toEqual([900, 130]);
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight', shiftKey: true });
    expect(docOf().zones.find((x) => x.id === 'welcome').x).toBe(160);
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '200' } });
    expect(docOf().zones.find((x) => x.id === 'welcome').x).toBe(200);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Welcome {{guest}}' } });
    expect(docOf().zones.find((x) => x.id === 'welcome').text).toBe('Welcome {{guest}}');
  });
  it('video resize keeps 16:9; screen toggle; delete; canvas panel edits keys', () => {
    render(<Harness />);
    const tv = document.querySelector('[data-zone="tv"]');
    fireEvent.pointerDown(tv, { clientX: 0, clientY: 0, pointerId: 1 }); fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    const e = document.querySelector('.handle.h-e');
    fireEvent.pointerDown(e, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: -300, clientY: 0 });   // w 1200 → 600 → h 337.5→338
    fireEvent.pointerUp(window, { clientX: -300, clientY: 0 });
    let z = docOf().zones.find((x) => x.id === 'tv');
    expect(z.w).toBe(600); expect(Math.abs(z.h - 338) <= 1).toBe(true);
    fireEvent.click(screen.getByLabelText(/visible on screen "home"/));
    expect(docOf().screens[0].zones).toEqual(['welcome']);
    fireEvent.click(screen.getByText('Delete'));
    expect(docOf().zones.map((x) => x.id)).toEqual(['welcome']);
    expect(docOf().screens[1].zones).toEqual([]);
    // canvas panel now: map PORTAL key
    fireEvent.change(screen.getByLabelText('key PORTAL'), { target: { value: 'toggle_menu' } });
    expect(docOf().keys.PORTAL).toBe('toggle_menu');
    fireEvent.change(screen.getByLabelText('New screen id'), { target: { value: 'info' } });
    fireEvent.click(screen.getByText('Add'));
    expect(docOf().screens.map((s) => s.id)).toEqual(['home', 'fullscreen', 'info']);
  });
});
