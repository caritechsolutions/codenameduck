import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import TEMPLATES from '../../../shared/layout-templates.json';

const DOC = { schema: 1, canvas: { w: 1920, h: 1080, background: '#000' },
  zones: [
    { id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 },
    { id: 'welcome', type: 'text', x: 80, y: 60, w: 800, h: 90, text: 'Hi {{room}}, {{guest_first}}', style: { fontSize: 48 } },
    { id: 'chlist', type: 'channel_list', x: 80, y: 240, w: 480, h: 400, style: { fontSize: 28, highlight: '#ffd166' } },
    { id: 'menu', type: 'menu', x: 80, y: 700, w: 480, h: 200, items: [{ label: 'Watch TV', action: 'fullscreen_tv' }, { label: 'Info', action: 'show_page', page: 'info' }] },
    { id: 'info', type: 'html', x: 200, y: 200, w: 1500, h: 600, hidden: true, html: '<h1>{{hotel}} info</h1>' },
  ],
  keys: {}, screens: [{ id: 'home', zones: ['tv', 'welcome', 'chlist', 'menu'] }, { id: 'fullscreen', zones: ['tv'] }] };

function fakeApi({ doc = DOC } = {}) {
  const me = { user: { id: 1, username: 'admin', role: 'superadmin', tenant_id: null }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: {} } };
  const state = { calls: [], layout: { id: 1, name: 'Room', version: 3, json: doc, updated_at: new Date().toISOString() } };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const path = url.replace(/^\/api\/admin/, '').split('?')[0];
    const method = init.method || 'GET'; const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    state.calls.push([method, path, body]);
    if (path === '/me') return json(200, me);
    if (path === '/layouts/1' && method === 'GET') return json(200, state.layout);
    if (path === '/layouts/1' && method === 'PUT') { state.layout = { ...state.layout, name: body.name, json: body.json, version: state.layout.version + 1, pushed: 1 }; return json(200, state.layout); }
    if (path === '/layouts' && method === 'GET') return json(200, [{ ...state.layout, group_count: 0, override_count: 0 }]);
    if (path === '/layouts' && method === 'POST') return json(201, { id: 9, name: body.name, version: 1, json: (TEMPLATES.find((t) => t.id === body.template) || TEMPLATES[0]).json });
    if (path === '/layouts/9') return json(200, { id: 9, name: 'New', version: 1, json: TEMPLATES[2].json });
    if (path === '/layout-templates') return json(200, TEMPLATES);
    if (['/groups', '/sets', '/media', '/lineups'].includes(path)) return json(200, []);
    if (path === '/apps') return json(404, { error: 'not yet' });
    return json(404, { error: 'not found ' + path });
  });
  return state;
}
const renderAt = (p) => render(<MemoryRouter initialEntries={[p]}><App /></MemoryRouter>);
const jsonDoc = () => { fireEvent.click(screen.getByRole('tab', { name: 'Advanced' })); const d = JSON.parse(screen.getByLabelText('Layout JSON').value); fireEvent.click(screen.getByRole('tab', { name: 'Canvas' })); return d; };

describe('B2 canvas editor', () => {
  let state;
  beforeEach(() => { state = fakeApi(); });

  it('new layout from a template', async () => {
    renderAt('/layouts');
    fireEvent.click(await screen.findByText('New layout'));
    const dlg = await screen.findByRole('dialog', { name: 'New layout' });
    expect(await within(dlg).findByLabelText('Welcome page with big photo')).toBeTruthy();
    expect(within(dlg).getAllByRole('radio').length).toBe(4);
    fireEvent.click(within(dlg).getByLabelText('Welcome page with big photo'));
    fireEvent.change(within(dlg).getByLabelText('Layout name'), { target: { value: 'Lobby suite' } });
    fireEvent.click(within(dlg).getByText('Create'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/layouts' && b.name === 'Lobby suite' && b.template === 'welcome')).toBe(true));
    expect(await screen.findByLabelText('Layout name')).toBeTruthy();   // navigated into the editor
    // every template validates on the client and has the video zone the renderer expects
    const { validateLayout } = await import('../layoutSchema.js');
    for (const t of TEMPLATES) { expect(validateLayout(t.json).errors).toEqual([]); expect(t.json.zones.some((z) => z.type === 'video')).toBe(true); }
  });

  it('palette adds, toolbar aligns, undo/redo, Ctrl-D, screens tabs', async () => {
    renderAt('/layouts/1');
    await screen.findByLabelText('Layout canvas');
    fireEvent.click(screen.getByLabelText('add Clock'));
    let d = jsonDoc();
    expect(d.zones.some((z) => z.type === 'clock')).toBe(true);
    expect(d.screens[0].zones).toContain('clock');
    // select welcome, align right → x 1120; undo → 80; redo → 1120
    fireEvent.pointerDown(document.querySelector('[data-zone="welcome"]'), { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByLabelText('Align to canvas right'));
    expect(jsonDoc().zones.find((z) => z.id === 'welcome').x).toBe(1120);
    fireEvent.click(screen.getByLabelText('Undo (Ctrl+Z)'));
    expect(jsonDoc().zones.find((z) => z.id === 'welcome').x).toBe(80);
    fireEvent.click(screen.getByLabelText('Redo (Ctrl+Shift+Z)'));
    expect(jsonDoc().zones.find((z) => z.id === 'welcome').x).toBe(1120);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(jsonDoc().zones.find((z) => z.id === 'welcome').x).toBe(80);
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(jsonDoc().zones.find((z) => z.id === 'welcome').x).toBe(1120);
    // Ctrl-D duplicates the selection (welcome → text)
    fireEvent.pointerDown(document.querySelector('[data-zone="welcome"]'), { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    d = jsonDoc();
    expect(d.zones.map((z) => z.id)).toContain('text');
    expect(d.zones.find((z) => z.id === 'text')).toMatchObject({ x: 1136, y: 76, text: 'Hi {{room}}, {{guest_first}}' });
    // screens: tabs switch, + screen adds
    fireEvent.click(screen.getByRole('tab', { name: /^fullscreen/ }));
    expect(document.querySelector('[data-zone="welcome"]').className).toMatch(/dim/);
    fireEvent.click(screen.getByText('+ screen'));
    fireEvent.change(screen.getByLabelText('New screen id'), { target: { value: 'dining' } });
    fireEvent.keyDown(screen.getByLabelText('New screen id'), { key: 'Enter' });
    expect(screen.getByRole('tab', { name: 'dining' })).toBeTruthy();
    expect(jsonDoc().screens.map((s) => s.id)).toEqual(['home', 'fullscreen', 'dining']);
    // save publishes the current doc
    fireEvent.click(screen.getByText('Save & publish'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PUT' && p === '/layouts/1' && b.json.screens.length === 3)).toBe(true));
  });

  it('typed properties: font picker, bold, variables menu, action picker with pages and screens', async () => {
    renderAt('/layouts/1');
    await screen.findByLabelText('Layout canvas');
    fireEvent.pointerDown(document.querySelector('[data-zone="welcome"]'), { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    fireEvent.change(screen.getByLabelText('Font'), { target: { value: 'Inter' } });
    fireEvent.click(screen.getByLabelText('Bold'));
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '64' } });
    fireEvent.change(screen.getByLabelText('Text shadow'), { target: { value: 'soft' } });
    fireEvent.change(screen.getByLabelText('Insert variable'), { target: { value: 'checkout_date' } });
    let z = jsonDoc().zones.find((x) => x.id === 'welcome');
    expect(z.style).toMatchObject({ fontFamily: 'Inter', fontWeight: 'bold', fontSize: 64, shadow: 'soft' });
    expect(z.text).toMatch(/\{\{checkout_date\}\}/);
    // menu action picker lists the hidden page and the other screen
    fireEvent.pointerDown(document.querySelector('[data-zone="menu"]'), { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    const actions = screen.getAllByLabelText('Action');
    expect(actions.length).toBe(2);
    const opts = Array.from(actions[0].querySelectorAll('option')).map((o) => o.value);
    expect(opts).toContain('show_page:info'); expect(opts).toContain('show_screen:fullscreen'); expect(opts).toContain('fullscreen_tv');
    expect(actions[1].value).toBe('show_page:info');
    fireEvent.change(actions[0], { target: { value: 'show_screen:fullscreen' } });
    z = jsonDoc().zones.find((x) => x.id === 'menu');
    expect(z.items[0]).toEqual({ label: 'Watch TV', action: 'show_screen', screen: 'fullscreen', page: undefined });
  });

  it('preview tab draws with the shared renderer code and sample data', async () => {
    renderAt('/layouts/1');
    await screen.findByLabelText('Layout canvas');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    const stage = document.querySelector('.tvstage');
    await waitFor(() => expect(stage.querySelector('#zone-welcome')).toBeTruthy());
    expect(stage.querySelector('#zone-welcome').textContent).toBe('Hi 214, Jane');
    expect(stage.querySelectorAll('#zone-chlist .chrow').length).toBeGreaterThan(3);
    expect(stage.querySelector('#zone-chlist .chrow.current').textContent).toContain('BBC Two');
    expect(stage.querySelector('#zone-menu .menuitem.focused').textContent).toBe('Watch TV');
    expect(stage.querySelector('#zone-tv .zone-video-placeholder')).toBeTruthy();
    expect(stage.querySelector('#zone-info')).toBeNull();   // hidden page not shown
    fireEvent.change(screen.getByLabelText('Preview page'), { target: { value: 'info' } });
    await waitFor(() => expect(stage.querySelector('#zone-info')).toBeTruthy());
    expect(stage.querySelector('#zone-info h1').textContent).toBe('Hotel Demo info');
    fireEvent.click(screen.getByRole('tab', { name: /^fullscreen/ }));
    await waitFor(() => expect(stage.querySelector('#zone-welcome')).toBeNull());
    expect(stage.querySelector('#zone-tv').style.width).toBe('1920px');
  });

  it('validation errors show inline on the zone and never block editing', async () => {
    state = fakeApi({ doc: { ...DOC, zones: [...DOC.zones, { id: 'odd', type: 'bogus', x: 0, y: 0, w: 100, h: 100 }], screens: [{ id: 'home', zones: ['tv', 'odd'] }] } });
    renderAt('/layouts/1');
    await screen.findByLabelText('Layout canvas');
    expect(screen.getByLabelText('errors on odd')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Save & publish').disabled).toBe(true);
    fireEvent.pointerDown(document.querySelector('[data-zone="odd"]'), { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 1, clientY: 1 });
    expect(screen.getByRole('status').textContent).toMatch(/unknown type "bogus"/);
    fireEvent.change(screen.getByLabelText('Zone type'), { target: { value: 'text' } });
    expect(screen.queryByLabelText('errors on odd')).toBeNull();
  });
});
