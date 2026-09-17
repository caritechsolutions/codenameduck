import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CanvasEditor from '../editor/CanvasEditor.jsx';
import ZonePanel from '../editor/ZonePanel.jsx';
import EditorToolbar from '../editor/EditorToolbar.jsx';
import PageNavigator from '../editor/PageNavigator.jsx';
import { ToastProvider } from '../components/ui.jsx';
import { upgradeLayout } from '../editor/geometry.js';

// v1 input on purpose: the editor works on the upgraded (pages) document
const DOC = upgradeLayout({ schema: 1, canvas: { w: 1920, h: 1080, background: '#000' },
  zones: [{ id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 }, { id: 'welcome', type: 'text', x: 80, y: 60, w: 800, h: 90, text: 'Hi {{room}}', style: { fontSize: 48 } }],
  keys: {}, screens: [{ id: 'home', zones: ['tv', 'welcome'] }, { id: 'fullscreen', zones: ['tv'] }] });

function Harness({ initial = DOC }) {
  const [doc, setDoc] = React.useState(initial);
  const [sel, setSel] = React.useState([]);
  const [pageId, setPageId] = React.useState('home');
  return <ToastProvider>
    <PageNavigator doc={doc} pageId={pageId} onSelect={(p) => { setPageId(p); setSel([]); }} onChange={setDoc} />
    <EditorToolbar doc={doc} selectedIds={sel} onChange={setDoc} onSelect={setSel} pageId={pageId} canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}} />
    <CanvasEditor doc={doc} onChange={setDoc} selectedIds={sel} onSelect={setSel} pageId={pageId} width={960} />
    <ZonePanel doc={doc} selectedIds={sel} onChange={setDoc} onSelect={setSel} pageId={pageId} />
    <pre data-testid="json">{JSON.stringify(doc)}</pre>
  </ToastProvider>;
}
const docOf = () => JSON.parse(screen.getByTestId('json').textContent);
const down = (el, x, y) => { fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1 }); };
const up = (x, y) => fireEvent.pointerUp(window, { clientX: x, clientY: y });

describe('canvas editor', () => {
  it('upgraded document: one home page, fullscreen screen dropped', () => {
    expect(DOC.schema).toBe(2);
    expect(DOC.pages.map((p) => p.id)).toEqual(['home']);
  });
  it('renders zones at scale and selects on pointer down', () => {
    render(<Harness />);
    const tv = document.querySelector('[data-zone="tv"]');
    expect(tv.style.left).toBe('320px'); // 640 * 0.5
    expect(tv.style.width).toBe('600px');
    down(tv, 400, 200); up(400, 200);
    expect(document.querySelectorAll('.handle').length).toBe(8);
    expect(screen.getByLabelText('X').value).toBe('640');
  });
  it('drag snaps to 8 px and to guides; resize handle grows; arrows nudge; panel edits x', () => {
    render(<Harness />);
    const w = document.querySelector('[data-zone="welcome"]');
    down(w, 100, 100); up(100, 100);   // a plain click selects but never moves/snaps
    expect(docOf().zones.find((x) => x.id === 'welcome')).toMatchObject({ x: 80, y: 60 });
    down(w, 100, 100);
    fireEvent.pointerMove(window, { clientX: 133, clientY: 108 });   // +66,+16 canvas px → 146,76 → grid 144,80; nothing to guide against
    expect(document.querySelector('.guide')).toBeNull();
    up(133, 108);
    let z = docOf().zones.find((x) => x.id === 'welcome');
    expect([z.x, z.y]).toEqual([144, 80]);
    down(w, 100, 100);
    fireEvent.pointerMove(window, { clientX: 349, clientY: 100 });   // +498 → 642 → grid 640 = tv's left edge → guide
    expect(document.querySelector('.guide-x')).toBeTruthy();
    up(349, 100);
    z = docOf().zones.find((x) => x.id === 'welcome');
    expect([z.x, z.y]).toEqual([640, 80]);
    const se = document.querySelector('.handle.h-se');
    down(se, 500, 500);
    fireEvent.pointerMove(window, { clientX: 550, clientY: 520 });   // +100,+40 → 900→904, 130→128
    up(550, 520);
    z = docOf().zones.find((x) => x.id === 'welcome');
    expect([z.w, z.h]).toEqual([904, 128]);
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight', shiftKey: true });
    expect(docOf().zones.find((x) => x.id === 'welcome').x).toBe(648);
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowDown' });
    expect(docOf().zones.find((x) => x.id === 'welcome').y).toBe(81);
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '200' } });
    expect(docOf().zones.find((x) => x.id === 'welcome').x).toBe(200);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Welcome {{guest}}' } });
    expect(docOf().zones.find((x) => x.id === 'welcome').text).toBe('Welcome {{guest}}');
  });
  it('video resize keeps 16:9; page toggle; toolbar delete; layout panel edits keys; navigator adds a page', () => {
    render(<Harness />);
    const tv = document.querySelector('[data-zone="tv"]');
    down(tv, 0, 0); up(0, 0);
    const e = document.querySelector('.handle.h-e');
    down(e, 0, 0);
    fireEvent.pointerMove(window, { clientX: -300, clientY: 0 });   // w 1200 → 600 → h 337.5→338
    up(-300, 0);
    let z = docOf().zones.find((x) => x.id === 'tv');
    expect(z.w).toBe(600); expect(Math.abs(z.h - 338) <= 1).toBe(true);
    fireEvent.click(screen.getByLabelText(/on page "Home"/));
    expect(docOf().pages[0].zones).toEqual(['welcome']);
    fireEvent.click(screen.getByLabelText('Delete (Del)'));
    expect(docOf().zones.map((x) => x.id)).toEqual(['welcome']);
    // layout panel now: map PORTAL to full-screen TV (v2 action object)
    fireEvent.change(screen.getByLabelText('key PORTAL'), { target: { value: 'fullscreen_tv' } });
    expect(docOf().keys.PORTAL).toEqual({ type: 'fullscreen_tv' });
    fireEvent.change(screen.getByLabelText('key RED'), { target: { value: 'tune' } });
    fireEvent.change(screen.getByLabelText('channel #'), { target: { value: '7' } });
    expect(docOf().keys.RED).toEqual({ type: 'tune', number: 7 });
    // navigator: add a page and switch to it
    fireEvent.click(screen.getByLabelText('Add page'));
    fireEvent.change(screen.getByLabelText('New page name'), { target: { value: 'Hotel info' } });
    fireEvent.keyDown(screen.getByLabelText('New page name'), { key: 'Enter' });
    expect(docOf().pages.map((s) => s.id)).toEqual(['home', 'hotel-info']);
    expect(screen.getByLabelText('page Hotel info').getAttribute('aria-current')).toBe('page');
    expect(screen.getByLabelText('Page name').value).toBe('Hotel info');
  });
  it('multi-select with shift, drag moves both, align + lock from the toolbar', () => {
    render(<Harness />);
    const tv = document.querySelector('[data-zone="tv"]');
    const w = document.querySelector('[data-zone="welcome"]');
    down(tv, 400, 200); up(400, 200);
    fireEvent.pointerDown(w, { clientX: 100, clientY: 100, pointerId: 1, shiftKey: true }); up(100, 100);
    expect(document.querySelectorAll('[data-selected="1"]').length).toBe(2);
    expect(document.querySelectorAll('.handle').length).toBe(0);   // no handles with 2 selected
    expect(screen.getByText('2 zones selected')).toBeTruthy();
    down(w, 100, 100);
    fireEvent.pointerMove(window, { clientX: 100, clientY: 150 });
    up(100, 150);
    let d = docOf();
    const wy = d.zones.find((x) => x.id === 'welcome').y, ty = d.zones.find((x) => x.id === 'tv').y;
    expect(wy - 60).toBe(ty - 120);   // both moved by the same delta
    expect(wy).toBeGreaterThan(60);
    fireEvent.click(screen.getByLabelText('Align left edges'));
    d = docOf();
    expect(d.zones.map((x) => x.x)).toEqual([80, 80]);
    fireEvent.click(screen.getByLabelText('Lock (no move/resize)'));
    expect(docOf().zones.every((x) => x.locked)).toBe(true);
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight', shiftKey: true });
    expect(docOf().zones.map((x) => x.x)).toEqual([80, 80]);
    fireEvent.click(screen.getByLabelText('Unlock'));
    expect(docOf().zones.some((x) => x.locked)).toBe(false);
  });
});
