import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';

const SET = { id: 7, serial: 'S7', room_number: '101', model: '43UM670H0UA', group_id: null, group_name: null, online: true, ws: true, last_seen: new Date().toISOString(), first_seen: new Date().toISOString(), api: 'idcap', firmware_version: '03.25.80', app_version: 'x', notes: '', layout_override_id: null, lineup_override_id: null, instant_power: 2, last_error: null };
const EVENTS = [
  { id: 41, type: 'tv_apps_registration_reason', created_at: new Date().toISOString(), payload: { trigger: 'boot', sending: ['netflix'], apps: [{ id: 'netflix', in_list: false, status: { id: 'netflix', auth: false, auth_status: 'authFail' }, activated: false }, { id: 'amazon', in_list: true, status: { auth: true, auth_status: 'authSuccess' }, activated: true }] } },
  { id: 40, type: 'tv_service_country', created_at: new Date().toISOString(), payload: { country: 'NL', ok: true } },
];
function fakeApi() {
  const me = { user: { id: 1, username: 'admin', role: 'superadmin', tenant_id: null }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: {} } };
  const state = { calls: [] };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const path = url.replace(/^\/api\/admin/, '').split('?')[0];
    const method = init.method || 'GET';
    state.calls.push([method, path]);
    if (path === '/me') return json(200, me);
    if (path === '/sets') return json(200, [SET]);
    if (path === '/sets/7') return json(200, { ...SET, events: EVENTS, commands: [] });
    if (path === '/sets/7/commands') return json(200, []);
    if (['/groups', '/layouts', '/lineups', '/media'].includes(path)) return json(200, []);
    return json(404, { error: 'not found ' + path });
  });
  return state;
}

describe('B3d set drawer events', () => {
  beforeEach(() => { fakeApi(); });
  it('event rows expand on click to the full JSON, with a copy button', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MemoryRouter initialEntries={['/sets/7']}><App /></MemoryRouter>);
    const rows = await screen.findAllByTestId('event-row');
    expect(rows.length).toBe(2);
    const reason = rows.find((r) => r.getAttribute('data-type') === 'tv_apps_registration_reason');
    expect(reason.textContent).toMatch(/"trigger":"boot"/);
    expect(reason.textContent.length).toBeLessThan(200);   // truncated preview
    expect(screen.queryByTestId('event-detail')).toBeNull();
    fireEvent.click(reason);
    const detail = await screen.findByTestId('event-detail');
    expect(detail.querySelector('pre').textContent).toContain('"auth_status": "authFail"');   // full, pretty-printed
    expect(detail.querySelector('pre').textContent).toContain('"in_list": true');
    fireEvent.click(within(detail).getByLabelText('copy event 41'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = JSON.parse(writeText.mock.calls[0][0]);
    expect(copied.id).toBe(41); expect(copied.type).toBe('tv_apps_registration_reason'); expect(copied.payload.sending).toEqual(['netflix']);
    expect(await within(detail).findByText('Copied')).toBeTruthy();
    fireEvent.click(reason);
    await waitFor(() => expect(screen.queryByTestId('event-detail')).toBeNull());
  });
});
