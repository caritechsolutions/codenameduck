import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { editableZoneIds, ghostZoneIds, moveZoneOrder } from '../editor/geometry.js';

const DOC = { schema: 2, canvas: { w: 1920, h: 1080, background: '#000' },
  zones: [
    { id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 },
    { id: 'clock', type: 'clock', x: 1600, y: 980, w: 240, h: 60 },
    { id: 'welcome', type: 'text', x: 80, y: 60, w: 800, h: 90, text: 'Hi {{room}}' },
    { id: 'btn', type: 'button', x: 80, y: 400, w: 300, h: 80, label: 'Info', action: { type: 'goto_page', page: 'info' } },
    { id: 'infotext', type: 'html', x: 100, y: 100, w: 1000, h: 500, html: '<h1>Info</h1>' },
    { id: 'infoimg', type: 'image', x: 1200, y: 100, w: 600, h: 400, src: '' },
    { id: 'osd', type: 'banner', x: 200, y: 900, w: 1500, h: 100 },
  ],
  pages: [{ id: 'home', name: 'Home', zones: ['tv', 'clock', 'welcome', 'btn'], inherit: true }, { id: 'info', name: 'Hotel info', zones: ['infotext', 'infoimg'], inherit: true }],
  home: 'home', keys: {}, focus: { color: '#ffd166', width: 6, radius: 12 }, back_on_home: 'none' };

function fakeApi({ role = 'superadmin', licences = [] } = {}) {
  const me = { user: { id: 1, username: 'admin', role, tenant_id: role === 'superadmin' ? null : 1 }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: {} } };
  const state = { calls: [], layout: { id: 1, name: 'Room', version: 3, json: DOC }, licences, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', default_layout_id: null, default_lineup_id: null, settings: { netflix_hotel_id: '' } } };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const path = url.replace(/^\/api\/admin/, '').split('?')[0];
    const method = init.method || 'GET'; const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    state.calls.push([method, path, body]);
    if (path === '/me') return json(200, me);
    if (path === '/layouts/1' && method === 'GET') return json(200, state.layout);
    if (path === '/licences' && method === 'GET') return json(200, { licences: state.licences, known_ids: ['netflix', 'amazon', 'airplay', 'googlecast'] });
    if (path === '/licences' && method === 'POST') {
      const out = { added: [], replaced: [], errors: [] };
      for (const f of body.files) {
        const id = f.app_id || (/^netflix/i.test(f.filename) ? 'netflix' : /^google\s*cast/i.test(f.filename) ? 'googlecast' : null);
        if (!id) { out.errors.push(`${f.filename}: cannot tell which app this licence is for`); continue; }
        const row = { id: state.licences.length + 1, app_id: id, filename: f.filename, tail: f.content.trim().slice(-6), uploaded_at: new Date().toISOString() };
        const ex = state.licences.find((l) => l.app_id === id);
        if (ex) { Object.assign(ex, row, { id: ex.id }); out.replaced.push(ex); } else { state.licences.push(row); out.added.push(row); }
      }
      return json(out.added.length || out.replaced.length ? 200 : 400, { ...out, licences: state.licences });
    }
    const m = /^\/licences\/(\d+)$/.exec(path);
    if (m && method === 'PATCH') { const l = state.licences.find((x) => x.id === Number(m[1])); l.app_id = body.app_id; return json(200, l); }
    if (m && method === 'DELETE') { state.licences = state.licences.filter((x) => x.id !== Number(m[1])); return json(200, { ok: true }); }
    if (path === '/tenant' && method === 'GET') return json(200, state.tenant);
    if (path === '/tenant' && method === 'PATCH') { state.tenant = { ...state.tenant, ...body, settings: { ...state.tenant.settings, ...(body.settings || {}) } }; return json(200, state.tenant); }
    if (path === '/sets') return json(200, []);
    if (path === '/apps') return json(200, []);
    if (['/groups', '/media', '/layouts', '/lineups', '/assets', '/tenants'].includes(path)) return json(200, []);
    return json(404, { error: 'not found ' + path });
  });
  return state;
}
const renderAt = (p) => render(<MemoryRouter initialEntries={[p]}><App /></MemoryRouter>);
const zone = (id) => document.querySelector(`[data-zone="${id}"]`);
const press = (id) => { fireEvent.pointerDown(zone(id), { clientX: 10, clientY: 10, pointerId: 1 }); fireEvent.pointerUp(window, { clientX: 10, clientY: 10 }); };
const selectedIds = () => Array.from(document.querySelectorAll('[data-zone][data-selected="1"]')).map((e) => e.getAttribute('data-zone'));

describe('B3c page isolation in the editor', () => {
  beforeEach(() => { fakeApi(); });

  it('geometry: editable vs ghost per page; z-order stays within the page', () => {
    expect(editableZoneIds(DOC, 'home')).toEqual(['tv', 'clock', 'welcome', 'btn', 'osd']);
    expect(ghostZoneIds(DOC, 'home')).toEqual([]);
    expect(editableZoneIds(DOC, 'info')).toEqual(['infotext', 'infoimg']);
    expect(ghostZoneIds(DOC, 'info')).toEqual(['tv', 'clock', 'osd']);
    const noInherit = { ...DOC, pages: DOC.pages.map((p) => (p.id === 'info' ? { ...p, inherit: false } : p)) };
    expect(ghostZoneIds(noInherit, 'info')).toEqual([]);
    // bring infotext to front on the info page: it only passes infoimg, zones of other pages keep their slots
    const d = moveZoneOrder(DOC, 'infotext', 'front', 'info');
    expect(d.zones.map((z) => z.id)).toEqual(['tv', 'clock', 'welcome', 'btn', 'infoimg', 'infotext', 'osd']);
    expect(moveZoneOrder(DOC, 'infoimg', 'front', 'info')).toBe(DOC);   // already last among its page's zones
    expect(moveZoneOrder(DOC, 'btn', 1, 'home').zones.map((z) => z.id)).toEqual(['tv', 'clock', 'welcome', 'osd', 'infotext', 'infoimg', 'btn']);
  });

  it('with two pages, a zone on page B is not drawn and cannot be selected while page A is active; inherited globals are non-selectable ghosts', async () => {
    renderAt('/layouts/1');
    await screen.findByLabelText('Layout canvas');
    // page A (home) active: page B's zones are not on the canvas at all
    expect(zone('infotext')).toBeNull(); expect(zone('infoimg')).toBeNull();
    expect(zone('btn')).toBeTruthy(); expect(zone('osd').getAttribute('data-ghost')).toBe('0');
    press('btn');
    expect(selectedIds()).toEqual(['btn']);
    // switch to page B: the selection is dropped, home-only zones vanish, globals become ghosts
    fireEvent.click(screen.getByLabelText('page Hotel info'));
    expect(selectedIds()).toEqual([]);
    expect(zone('btn')).toBeNull(); expect(zone('welcome')).toBeNull();
    expect(zone('infotext')).toBeTruthy();
    for (const id of ['tv', 'clock', 'osd']) {
      expect(zone(id).getAttribute('data-ghost')).toBe('1');
      expect(zone(id).className).toMatch(/ghost/);
      expect(zone(id).textContent).toMatch(/inherited from Home/);
    }
    // a ghost cannot be selected; a page zone can
    press('clock');
    expect(selectedIds()).toEqual([]);
    expect(screen.getByText('Nothing selected')).toBeTruthy();
    press('infotext');
    expect(selectedIds()).toEqual(['infotext']);
    expect(screen.getByLabelText('Zone id').value).toBe('infotext');
    // shift-click a ghost adds nothing
    fireEvent.pointerDown(zone('tv'), { clientX: 10, clientY: 10, pointerId: 1, shiftKey: true }); fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    expect(selectedIds()).toEqual(['infotext']);
    // arrow nudge moves only the page zone; the ghost keeps its geometry
    fireEvent.keyDown(screen.getByLabelText('Layout canvas'), { key: 'ArrowRight', shiftKey: true });
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    const d = JSON.parse(screen.getByLabelText('Layout JSON').value);
    expect(d.zones.find((z) => z.id === 'infotext').x).toBe(108);
    expect(d.zones.find((z) => z.id === 'tv').x).toBe(640);
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
    // back on home the page-B zones are gone again and home zones are editable
    fireEvent.click(screen.getByLabelText('page Home'));
    expect(zone('infotext')).toBeNull();
    press('clock');
    expect(selectedIds()).toEqual(['clock']);
  });

  it('marquee on empty canvas selects only this page\'s zones', async () => {
    renderAt('/layouts/1');
    const canvas = await screen.findByLabelText('Layout canvas');
    // jsdom: the editor falls back to its minimum width (420 - 32 = 388 px for a 1920 canvas →
    // scale ≈ 0.202) and puts the canvas at 0,0; (12,8)-(186,105) ≈ canvas (60,40)-(920,520)
    fireEvent.pointerDown(canvas, { clientX: 12, clientY: 8, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 186, clientY: 105 });
    expect(screen.getByTestId('marquee')).toBeTruthy();
    fireEvent.pointerUp(window, { clientX: 186, clientY: 105 });
    expect(selectedIds().sort()).toEqual(['btn', 'tv', 'welcome']);
    expect(screen.getByText('3 selected')).toBeTruthy();
    // a plain click on empty canvas clears
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, pointerId: 3 });
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });
    expect(selectedIds()).toEqual([]);
    // on page B the same marquee catches only infotext (ghost tv is not selectable)
    fireEvent.click(screen.getByLabelText('page Hotel info'));
    fireEvent.pointerDown(canvas, { clientX: 12, clientY: 8, pointerId: 4 });
    fireEvent.pointerMove(window, { clientX: 186, clientY: 105 });
    fireEvent.pointerUp(window, { clientX: 186, clientY: 105 });
    expect(selectedIds()).toEqual(['infotext']);
  });
});

describe('B3c app licences (superadmin) and Netflix hotel id', () => {
  it('licences page: drop .lic files → upload, table shows app id / file / tail, edit id, replace, delete; tenant-admin has no nav entry', async () => {
    const state = fakeApi();
    renderAt('/licences');
    expect(await screen.findByText('No licences yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /App licences/ })).toBeTruthy();
    const drop = screen.getByTestId('licence-drop');
    const files = [new File(['TkZYLXRva2VuLWZvci1uZXRmbGl4LWFiYzEyMw==\n'], 'NETFLIX_caritech.lic', { type: 'text/plain' }), new File(['R0NBU1QtdG9rZW4tZm9yLWdvb2dsZWNhc3QteHl6OTg3'], 'GOOGLE CAST_caritech.lic', { type: 'text/plain' }), new File(['abc'], 'readme.txt')];
    fireEvent.drop(drop, { dataTransfer: { files } });
    const nf = await screen.findByLabelText('app id for NETFLIX_caritech.lic');
    expect(nf.value).toBe('netflix');
    const post = state.calls.find(([m, p]) => m === 'POST' && p === '/licences');
    expect(post[2].files.map((f) => f.filename)).toEqual(['NETFLIX_caritech.lic', 'GOOGLE CAST_caritech.lic', 'readme.txt']);
    expect(post[2].files[0].content).toBe('TkZYLXRva2VuLWZvci1uZXRmbGl4LWFiYzEyMw==\n');
    const row = nf.closest('tr');
    expect(within(row).getByText('…EyMw==')).toBeTruthy();
    expect(row.textContent).not.toMatch(/TkZYLXRva2Vu/);   // never the whole token
    expect(screen.getByLabelText('app id for GOOGLE CAST_caritech.lic').value).toBe('googlecast');
    // the guessed id is editable
    const gc = screen.getByLabelText('app id for GOOGLE CAST_caritech.lic');
    fireEvent.change(gc, { target: { value: 'com.google.cast' } });
    fireEvent.keyDown(gc, { key: 'Enter' });
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PATCH' && p === '/licences/2' && b.app_id === 'com.google.cast')).toBe(true));
    // replace keeps the app id: the hidden input posts with app_id set
    fireEvent.click(screen.getByLabelText('replace netflix'));
    fireEvent.change(screen.getByLabelText('Replacement licence file'), { target: { files: [new File(['bmV3LXRva2VuLTk5OTk5OQ=='], 'NETFLIX_new.lic')] } });
    await waitFor(() => expect(state.calls.filter(([m, p]) => m === 'POST' && p === '/licences').length).toBe(2));
    expect(state.calls.filter(([m, p]) => m === 'POST' && p === '/licences')[1][2].files[0]).toMatchObject({ filename: 'NETFLIX_new.lic', app_id: 'netflix' });
    await screen.findByText('…k5OQ==');
    // delete asks first
    fireEvent.click(screen.getByLabelText('delete netflix'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Delete'));
    await waitFor(() => expect(state.calls.some(([m, p]) => m === 'DELETE' && p === '/licences/1')).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText('app id for NETFLIX_new.lic')).toBeNull());
  });

  it('tenant-admin: no App licences entry and /licences redirects home', async () => {
    fakeApi({ role: 'tenant-admin' });
    renderAt('/licences');
    await screen.findByRole('link', { name: /Settings/ });
    expect(screen.queryByRole('link', { name: /App licences/ })).toBeNull();
    expect(screen.queryByTestId('licence-drop')).toBeNull();
  });

  it('settings: Netflix hotel id is saved with the tenant settings', async () => {
    const state = fakeApi();
    renderAt('/settings');
    const f = await screen.findByLabelText('Netflix hotel id');
    expect(f.value).toBe('');
    fireEvent.change(f, { target: { value: ' CARI-DEMO-001 ' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PATCH' && p === '/tenant' && b.settings.netflix_hotel_id === 'CARI-DEMO-001')).toBe(true));
  });
});
