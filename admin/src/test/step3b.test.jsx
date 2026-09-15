import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';

describe('step 3b admin', () => {
  it('groups page sets power mode; set drawer shows the last TV error', async () => {
    const me = { user: { id: 1, username: 'admin', role: 'superadmin' }, tenant: { id: 1, name: 'h', hostname: 'h', display_name: 'H', settings: {} } };
    const groups = [{ id: 1, name: 'Lobby', set_count: 1, layout_id: null, power_mode: null }];
    const set = { id: 1, serial: 'S1', model: 'M', online: true, ws: true, last_seen: new Date().toISOString(), group_id: 1, group_name: 'Lobby',
      last_error: { kind: 'media', message: 'HTML5 video failed for http://x/h265.m3u8: video element error 4', at: new Date().toISOString() } };
    const calls = [];
    const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
    global.fetch = vi.fn((url, init = {}) => {
      const path = url.replace(/^\/api\/admin/, ''); const method = init.method || 'GET'; const body = init.body ? JSON.parse(init.body) : null;
      calls.push([method, path, body]);
      if (path === '/me') return json(200, me);
      if (path === '/groups') return json(200, groups);
      if (path === '/groups/1' && method === 'PATCH') { groups[0].power_mode = body.power_mode; return json(200, groups[0]); }
      if (path === '/layouts' || path === '/lineups') return json(200, []);
      if (path === '/sets') return json(200, [set]);
      if (path === '/sets/1') return json(200, { ...set, events: [], commands: [], layout: { name: 'L' }, lineup: { id: null, channels: [] } });
      return json(404, { error: path });
    });
    render(<MemoryRouter initialEntries={['/groups']}><App /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('power mode Lobby'), { target: { value: 'WARM' } });
    await waitFor(() => expect(calls.some(([m, p, b]) => m === 'PATCH' && p === '/groups/1' && b.power_mode === 'WARM')).toBe(true));
    render(<MemoryRouter initialEntries={['/sets/1']}><App /></MemoryRouter>);
    expect((await screen.findByRole('note')).textContent).toMatch(/h265/);
  });
});
