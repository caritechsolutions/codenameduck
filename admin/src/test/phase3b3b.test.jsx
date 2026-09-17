import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';

const base = { title: null, icon_url: null, type: null, name_override: null, icon_override: null, icon: null, raw: {}, first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), group_ids: [], models: ['43UM670H0UA'], set_count: 2 };
const APPS = [
  { ...base, id: 1, app_id: 'netflix', name: 'Netflix', activation: 'not_activated', activated_sets: 0, unactivated_sets: 2, reported_sets: 2, auth_status: 'unregistered' },
  { ...base, id: 2, app_id: 'youtube.leanback.v4', name: 'YouTube', activation: 'activated', activated_sets: 2, unactivated_sets: 0, reported_sets: 2, auth_status: 'registered' },
  { ...base, id: 3, app_id: 'amazon', name: 'Prime Video', activation: 'unknown', activated_sets: 0, unactivated_sets: 0, reported_sets: 0, auth_status: null },
];
const GROUPS = [{ id: 1, name: 'Rooms', set_count: 4 }];

function fakeApi() {
  const me = { user: { id: 1, username: 'admin', role: 'superadmin', tenant_id: null }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: {} } };
  const state = { calls: [], config: { tokens: [], accountNumber: '' }, results: [] };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const path = url.replace(/^\/api\/admin/, '').split('?')[0];
    const method = init.method || 'GET'; const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    state.calls.push([method, path, body]);
    if (path === '/me') return json(200, me);
    if (path === '/apps' && method === 'GET') return json(200, APPS);
    if (path === '/apps/activation' && method === 'GET') return json(200, { config: state.config, results: state.results });
    if (path === '/apps/activation' && method === 'PUT') { state.config = { tokens: body.tokens.filter((t) => t.id && t.token), accountNumber: body.accountNumber || '' }; return json(200, { config: state.config }); }
    if (path === '/apps/activation/run') { state.results = [{ set_id: 5, serial: 'S5', room_number: '101', model: 'M', ok: true, result: { result: true }, updated_at: new Date().toISOString() }]; return json(200, { queued: body.group_id ? 4 : 9, command_ids: [] }); }
    if (path === '/groups') return json(200, GROUPS);
    if (['/sets', '/media', '/layouts', '/lineups'].includes(path)) return json(200, []);
    return json(404, { error: 'not found ' + path });
  });
  return state;
}
const renderAt = (p) => render(<MemoryRouter initialEntries={[p]}><App /></MemoryRouter>);

describe('B3b app activation', () => {
  let state;
  beforeEach(() => { state = fakeApi(); });

  it('shows activation badges, greys un-activated rows (admin only) and the raw status', async () => {
    renderAt('/apps');
    const nf = (await screen.findByText('Netflix')).closest('tr');
    expect(nf.className).toBe('unactivated');
    expect(within(nf).getByText(/not activated · 0\/2 set/)).toBeTruthy();
    expect(within(nf).getByText(/not activated/).getAttribute('title')).toBe('register/status: unregistered');
    const yt = screen.getByText('YouTube').closest('tr');
    expect(yt.className).toBe('');
    expect(within(yt).getByText(/activated · 2\/2 set/)).toBeTruthy();
    expect(within(screen.getByText('Prime Video').closest('tr')).getByText('unknown')).toBeTruthy();
    fireEvent.click(within(nf).getByText('Raw'));
    const dlg = await screen.findByRole('dialog', { name: 'Raw entry for netflix' });
    expect(dlg.textContent).toMatch(/"register_status": "unregistered"/);
  });

  it('activation panel: tokens + account number saved, register now queues on all sets or a group, results listed', async () => {
    renderAt('/apps');
    await screen.findByText('Netflix');
    expect(screen.getByText('No set has reported a registration result yet.')).toBeTruthy();
    const registerBtn = screen.getByText('Register now');
    expect(registerBtn.disabled).toBe(true);   // nothing to register yet
    fireEvent.click(screen.getByText('Add token'));
    fireEvent.change(screen.getByLabelText('Token app'), { target: { value: 'netflix' } });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'NFX-123' } });
    expect(screen.getByText('Register now').disabled).toBe(false);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PUT' && p === '/apps/activation' && b.tokens[0].id === 'netflix' && b.tokens[0].token === 'NFX-123')).toBe(true));
    fireEvent.change(screen.getByLabelText('Register group'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Register now'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/apps/activation/run' && b.group_id === 1)).toBe(true));
    expect(await screen.findByText('Room 101', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText('registered')).toBeTruthy();
    // account number path
    fireEvent.click(screen.getByLabelText('remove token'));
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: 'ACC-9' } });
    fireEvent.change(screen.getByLabelText('Register group'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Register now'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PUT' && p === '/apps/activation' && b.accountNumber === 'ACC-9' && b.tokens.length === 0)).toBe(true));
    await waitFor(() => expect(state.calls.filter(([m, p]) => m === 'POST' && p === '/apps/activation/run').length).toBe(2));
  });
});
