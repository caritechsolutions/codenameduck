import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';

function fakeApi({ mode = 'run' } = {}) {
  const me = { user: { id: 1, username: 'admin', role: 'superadmin', tenant_id: null }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: {} } };
  const state = { calls: [], dep: { mode, bundle_version: 3, bundle_hash: 'abc', bundle_build: 'b1', bundle_built_at: new Date().toISOString(), zip_bytes: 2048000, manifest: null, xait: { versionNumber: 3, version: 3, url: 'http://h/procentric/application/app.zip' }, deployed_build: 'b1', sets: 2, pending_sets: [{ id: 8, serial: 'S8' }] } };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const path = url.replace(/^\/api\/admin/, '').split('?')[0];
    const method = init.method || 'GET'; const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    state.calls.push([method, path, body]);
    if (path === '/me') return json(200, me);
    if (path === '/deployment' && method === 'GET') return json(200, state.dep);
    if (path === '/deployment/diff') return json(200, { mode: state.dep.mode, current_version: 3, next_version: 4, bump: true, state_changed: true, added: ['media/new.png'], changed: ['zones.css'], removed: [], unchanged: 40, files: 42, bytes: 2100000, build: 'b2', zip_exists: true });
    if (path === '/deployment/publish') { state.dep = { ...state.dep, bundle_version: 4, deployed_build: 'b2', bundle_build: 'b2', pending_sets: [{ id: 7 }, { id: 8 }] }; return json(200, { version: 4, bumped: true, files: 42, bytes: 2100000, status: state.dep }); }
    if (path === '/deployment/mode') { state.dep = { ...state.dep, mode: body.mode }; return json(200, { mode: body.mode, version: 5, status: state.dep }); }
    if (path === '/tenant') return json(200, { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', default_layout_id: null, default_lineup_id: null, settings: {} });
    if (path === '/pms/settings') return json(200, { timezone: 'UTC', checkin_time: '14:00', checkout_time: '11:00', today: '2026-09-18', api_key: null, fields: [], date_formats: [] });
    if (path === '/sets') return json(200, [
      { id: 7, serial: 'S7', room_number: '101', model: 'M', online: true, ws: true, last_seen: new Date().toISOString(), api: 'idcap', firmware_version: '1', app_version: 'abc1234-202609181200', bundle_version: 3, origin: 'file://' },
      { id: 8, serial: 'S8', room_number: '102', model: 'M', online: true, ws: false, last_seen: new Date().toISOString(), api: 'idcap', firmware_version: '1', app_version: 'zzz9999-202609171200', bundle_version: 2, origin: 'http://h' }]);
    if (['/groups', '/layouts', '/lineups', '/assets', '/media'].includes(path)) return json(200, []);
    return json(404, { error: 'not found ' + path });
  });
  return state;
}
const renderAt = (p) => render(<MemoryRouter initialEntries={[p]}><App /></MemoryRouter>);

describe('Part D deployment', () => {
  it('settings: deployment card shows the bundle, dry-run diff, publish, mode switch', async () => {
    const state = fakeApi();
    window.confirm = vi.fn(() => true);
    renderAt('/settings');
    expect((await screen.findByTestId('bundle-version')).textContent).toMatch(/^v3/);
    expect(screen.getByLabelText('Remote-run').checked).toBe(true);
    fireEvent.click(screen.getByText('Show changes'));
    const dlg = await screen.findByRole('dialog', { name: 'What a publish would change' });
    expect(within(dlg).getByTestId('diff-summary').textContent).toMatch(/version 3 → 4/);
    expect(within(dlg).getByText('media/new.png')).toBeTruthy(); expect(within(dlg).getByText('zones.css')).toBeTruthy();
    fireEvent.click(within(dlg).getByText('Publish v4'));
    await waitFor(() => expect(state.calls.some(([m, p]) => m === 'POST' && p === '/deployment/publish')).toBe(true));
    await waitFor(() => expect(screen.getByTestId('bundle-version').textContent).toMatch(/^v4/));
    fireEvent.click(screen.getByLabelText('Remote-deploy'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PUT' && p === '/deployment/mode' && b.mode === 'deploy')).toBe(true));
    await waitFor(() => expect(screen.getByLabelText('Remote-deploy').checked).toBe(true));
    expect(screen.getByTestId('pending-sets').textContent).toMatch(/2 still on an older bundle/);
  });
  it('sets table: app build column with the bundle-pending indicator in deploy mode', async () => {
    fakeApi({ mode: 'deploy' });
    renderAt('/sets');
    const cells = await screen.findAllByTestId('app-build');
    expect(cells.length).toBe(2);
    expect(cells[0].textContent).toMatch(/abc1234/); expect(cells[0].textContent).toMatch(/bundle v3/); expect(cells[0].textContent).not.toMatch(/pending/); expect(cells[0].textContent).toMatch(/local/);
    expect(cells[1].textContent).toMatch(/zzz9999/); expect(cells[1].textContent).toMatch(/bundle v3 pending/);
  });
});
