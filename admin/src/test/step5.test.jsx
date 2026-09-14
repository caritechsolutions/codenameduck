import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';

function fakeApi({ role = 'superadmin' } = {}) {
  const me = { user: { id: 1, username: 'admin', role, tenant_id: role === 'superadmin' ? null : 1 }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: {} } };
  const state = { calls: [], messages: [], users: [{ id: 1, username: 'admin', role, tenant_id: null }], tenants: [{ id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', set_count: 1, online_count: 1, user_count: 1 }] };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const path = url.replace(/^\/api\/admin/, '').split('?')[0];
    const method = init.method || 'GET'; const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    state.calls.push([method, path, body]);
    if (path === '/me') return json(200, me);
    if (path === '/messages' && method === 'GET') return json(200, state.messages);
    if (path === '/messages' && method === 'POST') { const m = { id: state.messages.length + 1, ...body, target_name: body.target_type === 'all' ? 'all sets' : 'x', created_at: new Date().toISOString(), expired: false }; state.messages.unshift(m); return json(201, { ...m, pushed: 2 }); }
    if (path.startsWith('/messages/') && method === 'DELETE') { state.messages = state.messages.filter((m) => m.id !== Number(path.split('/')[2])); return json(200, { ok: true }); }
    if (path === '/groups' || path === '/sets' || path === '/layouts' || path === '/lineups' || path === '/assets') return json(200, []);
    if (path === '/users' && method === 'GET') return json(200, state.users);
    if (path === '/users' && method === 'POST') { state.users.push({ id: 2, ...body, tenant_name: 'hoteldemo' }); return json(201, state.users[1]); }
    if (path === '/tenants' && method === 'GET') return role === 'superadmin' ? json(200, state.tenants) : json(403, { error: 'superadmin only' });
    if (path === '/tenants' && method === 'POST') { state.tenants.push({ id: 2, ...body, set_count: 0, online_count: 0, user_count: 0, output: 'ok' }); return json(201, { ...state.tenants[1], output: 'created' }); }
    if (path === '/tenant') return json(200, { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: { weather: { lat: 51.5, lon: 4.2, units: 'metric' } } });
    if (path === '/weather') return json(200, { ok: true, icon: '☀', temp_c: 24, temp_f: 75, text: 'Clear', wind_kmh: 3 });
    return json(404, { error: 'not found ' + path });
  });
  return state;
}
const renderAt = (p) => render(<MemoryRouter initialEntries={[p]}><App /></MemoryRouter>);

describe('step 5 pages', () => {
  let state;
  beforeEach(() => { state = fakeApi(); });
  it('messages: send to all and take down', async () => {
    renderAt('/messages');
    fireEvent.change(await screen.findByLabelText('Message text'), { target: { value: 'Pool closed' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/messages' && b.text === 'Pool closed' && b.target_type === 'all' && b.ttl_minutes === 60)).toBe(true));
    expect(await screen.findByText('Pool closed')).toBeTruthy();
    fireEvent.click(screen.getByText('Take down'));
    await waitFor(() => expect(screen.queryByText('Pool closed')).toBeNull());
  });
  it('users: create a tenant-admin', async () => {
    renderAt('/users');
    fireEvent.click(await screen.findByText('New user'));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Bob' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/users' && b.username === 'bob' && b.role === 'tenant-admin')).toBe(true));
    expect(await screen.findByText('bob')).toBeTruthy();
  });
  it('settings: shows weather check; tenants page only for superadmin', async () => {
    renderAt('/settings');
    expect((await screen.findByLabelText('Latitude')).value).toBe('51.5');
    fireEvent.click(screen.getByText('Check weather now'));
    expect(await screen.findByText(/24°C/)).toBeTruthy();
    expect(screen.getByText('Tenants')).toBeTruthy();
  });
  it('tenant-admin does not see the Tenants nav', async () => {
    state = fakeApi({ role: 'tenant-admin' });
    renderAt('/users');
    await screen.findByText('New user');
    expect(screen.queryByText('Tenants')).toBeNull();
  });
  it('tenants: create runs the CLI', async () => {
    renderAt('/tenants');
    fireEvent.click(await screen.findByText('New tenant'));
    fireEvent.change(screen.getByLabelText('Tenant name'), { target: { value: 'hotelb' } });
    fireEvent.change(screen.getByLabelText('Tenant hostname'), { target: { value: 'hotelb.caritech.net' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/tenants' && b.name === 'hotelb')).toBe(true));
    expect(await screen.findByText('hotelb.caritech.net')).toBeTruthy();
  });
});
