import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import ZONE_TYPES from '../../../shared/zone-types.json';
import { PALETTE, newZone } from '../editor/geometry.js';

const APPS = [
  { id: 1, app_id: 'netflix', title: 'Netflix', icon_url: '/usr/palm/x.png', type: 'native', name_override: null, icon_override: null, name: 'Netflix', icon: null, models: ['43UM670H0UA'], raw: { id: 'netflix', title: 'Netflix' }, set_count: 2, group_ids: [1], first_seen: new Date().toISOString(), last_seen: new Date().toISOString() },
  { id: 2, app_id: 'youtube.leanback.v4', title: 'YouTube', icon_url: null, type: 'web', name_override: null, icon_override: null, name: 'YouTube', icon: null, models: ['43UM670H0UA', '55US662H'], raw: { id: 'youtube.leanback.v4' }, set_count: 3, group_ids: [], first_seen: new Date().toISOString(), last_seen: new Date().toISOString() },
];
const GROUPS = [{ id: 1, name: 'Rooms', set_count: 4, layout_id: null }, { id: 2, name: 'Lobby', set_count: 1, layout_id: null }];
const DOC = { schema: 1, canvas: { w: 1920, h: 1080, background: '#000' }, zones: [{ id: 'apps', type: 'apps', x: 80, y: 820, w: 1760, h: 220, layout: 'row', style: { tileSize: 200 } }, { id: 'menu', type: 'menu', x: 80, y: 100, w: 400, h: 300, items: [{ label: 'Go', action: 'launch_app', app_id: 'netflix' }] }], keys: {}, screens: [{ id: 'home', zones: ['apps', 'menu'] }] };

function fakeApi() {
  const me = { user: { id: 1, username: 'admin', role: 'superadmin', tenant_id: null }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: {} } };
  const state = { calls: [], apps: APPS.map((a) => ({ ...a })) };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const path = url.replace(/^\/api\/admin/, '').split('?')[0];
    const method = init.method || 'GET'; const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    state.calls.push([method, path, body]);
    if (path === '/me') return json(200, me);
    if (path === '/apps' && method === 'GET') return json(200, state.apps);
    if (path.startsWith('/apps/') && method === 'PATCH') { const a = state.apps.find((x) => x.id === Number(path.split('/')[2])); a.name_override = body.name_override || null; a.icon_override = body.icon_override || null; a.name = a.name_override || a.title; a.icon = a.icon_override; return json(200, a); }
    if (path.startsWith('/apps/') && method === 'DELETE') { state.apps = state.apps.filter((x) => x.id !== Number(path.split('/')[2])); return json(200, { ok: true }); }
    if (/^\/groups\/\d+\/apps$/.test(path) && method === 'PUT') return json(200, { ok: true, app_ids: body.app_ids, pushed: 1 });
    if (path === '/groups') return json(200, GROUPS);
    if (path === '/layouts/1') return json(200, { id: 1, name: 'L', version: 1, json: DOC });
    if (['/sets', '/media', '/layouts', '/lineups'].includes(path)) return json(200, []);
    return json(404, { error: 'not found ' + path });
  });
  return state;
}
const renderAt = (p) => render(<MemoryRouter initialEntries={[p]}><App /></MemoryRouter>);

describe('B3 apps', () => {
  let state;
  beforeEach(() => { state = fakeApi(); });

  it('apps zone is a shared zone type with palette entry and defaults', () => {
    expect(ZONE_TYPES).toContain('apps');
    expect(PALETTE.some((g) => g.items.some(([t]) => t === 'apps'))).toBe(true);
    expect(newZone({ zones: [], canvas: { w: 1920, h: 1080 } }, 'apps')).toMatchObject({ type: 'apps', layout: 'row', style: { tileSize: 200 } });
  });

  it('Apps page: matrix per group, edit override, forget', async () => {
    renderAt('/apps');
    expect(await screen.findByText('Netflix')).toBeTruthy();
    expect(screen.getByText('43UM670H0UA, 55US662H')).toBeTruthy();
    const nfRooms = screen.getByLabelText('Netflix in Rooms'), ytRooms = screen.getByLabelText('YouTube in Rooms');
    expect(nfRooms.checked).toBe(true); expect(ytRooms.checked).toBe(false);
    fireEvent.click(ytRooms);
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PUT' && p === '/groups/1/apps' && JSON.stringify(b.app_ids) === '[1,2]')).toBe(true));
    await waitFor(() => expect(screen.getByLabelText('YouTube in Rooms').checked).toBe(true));
    fireEvent.click(screen.getByLabelText('Netflix in Rooms'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PUT' && p === '/groups/1/apps' && JSON.stringify(b.app_ids) === '[2]')).toBe(true));
    // edit: display name + icon
    fireEvent.click(screen.getAllByText('Edit')[0]);
    const dlg = await screen.findByRole('dialog', { name: 'Edit Netflix' });
    fireEvent.change(within(dlg).getByLabelText('Display name'), { target: { value: 'Films' } });
    fireEvent.change(within(dlg).getByLabelText('Icon URL'), { target: { value: '/procentric/application/media/i.png' } });
    fireEvent.click(within(dlg).getByText('Save'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PATCH' && p === '/apps/1' && b.name_override === 'Films' && b.icon_override === '/procentric/application/media/i.png')).toBe(true));
    expect(await screen.findByText('Films')).toBeTruthy();
    expect(screen.getByText('LG title: Netflix')).toBeTruthy();
    // raw dialog shows what LG sent
    fireEvent.click(screen.getAllByText('Raw')[1]);
    const rawDlg = await screen.findByRole('dialog', { name: 'Raw entry for youtube.leanback.v4' });
    expect(rawDlg.textContent).toMatch(/"id": "youtube.leanback.v4"/);
    fireEvent.click(within(rawDlg).getByText('Close'));
    fireEvent.click(screen.getAllByText('Forget')[1]);
    await waitFor(() => expect(screen.queryByText('YouTube')).toBeNull());
  });

  it('editor: apps zone panel, action picker lists discovered apps, preview draws tiles', async () => {
    renderAt('/layouts/1');
    await screen.findByLabelText('Layout canvas');
    fireEvent.pointerDown(document.querySelector('[data-zone="apps"]'), { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    expect(screen.getByText(/apps enabled for the set's group/)).toBeTruthy();
    fireEvent.click(screen.getByText('grid'));
    fireEvent.change(screen.getByLabelText('Tile size'), { target: { value: '260' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    const d = JSON.parse(screen.getByLabelText('Layout JSON').value);
    expect(d.zones[0]).toMatchObject({ layout: 'grid', style: { tileSize: 260 } });
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
    // menu item: the app picker is a select fed by /apps
    fireEvent.pointerDown(document.querySelector('[data-zone="menu"]'), { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    const appSel = await screen.findByLabelText('app id');
    expect(appSel.tagName).toBe('SELECT');
    expect(Array.from(appSel.querySelectorAll('option')).map((o) => o.value)).toEqual(['', 'netflix', 'youtube.leanback.v4']);
    fireEvent.change(appSel, { target: { value: 'youtube.leanback.v4' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    expect(JSON.parse(screen.getByLabelText('Layout JSON').value).zones[1].items[0].app_id).toBe('youtube.leanback.v4');
    // preview: tiles for the discovered apps, first one focused
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    const stage = document.querySelector('.tvstage');
    await waitFor(() => expect(stage.querySelectorAll('#zone-apps .apptile').length).toBe(2));
    expect(stage.querySelector('#zone-apps').className).toMatch(/apps-grid/);
    expect(stage.querySelector('#zone-apps .apptile.focused .appname').textContent).toBe('Netflix');
    expect(stage.querySelector('#zone-apps .apptile').style.width).toBe('260px');
  });
});
