import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';

// Fake /api/admin backend: enough state for login → dashboard → sets → assign room.
function fakeApi() {
  const state = {
    me: null,
    sets: [{ id: 1, serial: '305MAXX1Z123', model: '43UM670H0UA', room_number: null, group_id: null, api: 'idcap', idpn: '306', online: true, ws: true, last_seen: new Date().toISOString(), reported_room: '[TV]305MAXX1Z123', reported_room_is_factory: true },
           { id: 2, serial: 'TEST0001', model: null, room_number: null, group_id: null, online: false, ws: false, last_seen: '2026-09-14T00:00:00.000Z' }],
    groups: [{ id: 1, name: 'Standard rooms', set_count: 0, layout_id: null }],
    layouts: [],
    calls: [],
  };
  const tenant = { id: 1, name: 'hoteldemo', hostname: 'hoteldemo.caritech.net', display_name: 'Hotel Demo' };
  const user = { id: 1, username: 'admin', role: 'superadmin', tenant_id: null };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const path = url.replace(/^\/api\/admin/, '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    state.calls.push([method, path, body]);
    if (path === '/me') return state.me ? json(200, state.me) : json(401, { error: 'not logged in' });
    if (path === '/login') {
      if (body.password !== 'secret') return json(401, { error: 'invalid username or password' });
      state.me = { user, tenant }; return json(200, state.me);
    }
    if (path === '/logout') { state.me = null; return json(200, { ok: true }); }
    if (path === '/dashboard') return json(200, { sets: { total: 2, online: 1, offline: 1, unassigned: 2 }, offline: [state.sets[1]], events: [], groups: 1, layouts: 0, ws_connected: 1 });
    if (path === '/sets') return json(200, state.sets);
    if (path === '/groups') return json(200, state.groups);
    if (path === '/layouts') return json(200, state.layouts);
    const m = path.match(/^\/sets\/(\d+)$/);
    if (m && method === 'GET') { const s = state.sets.find((x) => x.id === Number(m[1])); return json(200, { ...s, events: [], commands: [], layout: { name: 'Unassigned', builtin: 'unassigned' } }); }
    if (m && method === 'PATCH') { const s = state.sets.find((x) => x.id === Number(m[1])); Object.assign(s, body, { group_name: body.group_id ? 'Standard rooms' : null }); return json(200, s); }
    if (m && method === 'DELETE') { state.sets = state.sets.filter((x) => x.id !== Number(m[1])); return json(200, { ok: true }); }
    return json(404, { error: 'not found ' + path });
  });
  return state;
}

function renderApp(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe('admin app', () => {
  let state;
  beforeEach(() => { state = fakeApi(); });

  it('shows login when logged out, rejects a bad password, then logs in to the dashboard', async () => {
    renderApp('/');
    await screen.findByLabelText('Username');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByText('Sign in'));
    expect((await screen.findByRole('alert')).textContent).toContain('invalid username or password');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByText('Sign in'));
    expect(await screen.findByText('sets registered')).toBeTruthy();
    expect(screen.getByText('Hotel Demo')).toBeTruthy();
  });

  it('sets page lists sets, flags factory room, assigns room + group, deletes junk set', async () => {
    state.me = { user: { id: 1, username: 'admin', role: 'superadmin' }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo' } };
    renderApp('/sets');
    expect(await screen.findByText('305MAXX1Z123')).toBeTruthy();
    expect(screen.getAllByText('no room').length).toBe(2);
    fireEvent.click(screen.getByText('305MAXX1Z123'));
    expect(await screen.findByText('factory default')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g. 204'), { target: { value: '204' } });
    const groupSelect = within(screen.getByRole('dialog')).getAllByRole('combobox')[0];
    fireEvent.change(groupSelect, { target: { value: '1' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PATCH' && p === '/sets/1' && b.room_number === '204' && b.group_id === 1)).toBe(true));
    expect(await screen.findByText('Room 204')).toBeTruthy();

    // delete TEST0001
    fireEvent.click(screen.getByLabelText('Close'));
    fireEvent.click(await screen.findByText('TEST0001'));
    fireEvent.click(await screen.findByText('Delete this set'));
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(state.calls.some(([m, p]) => m === 'DELETE' && p === '/sets/2')).toBe(true));
    await waitFor(() => expect(screen.queryByText('TEST0001')).toBeNull());
  });
});
