import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';

const TODAY = '2026-09-18';
const RES = { id: 1, room_number: '101', first_name: 'Jane', last_name: 'Doe', guest: 'Jane Doe', checkin_date: '2026-09-18', checkout_date: '2026-09-20', nights: 2, lang: 'en', vip: true, notes: 'late', source: 'manual', status: 'booked', checked_in_at: null, checked_out_at: null, created_at: '2026-09-17T10:00:00.000Z', updated_at: '2026-09-17T10:00:00.000Z' };

function fakeApi() {
  const me = { user: { id: 1, username: 'admin', role: 'superadmin', tenant_id: null }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: {} } };
  const state = { calls: [], reservations: [RES], profiles: [], key: null, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', default_layout_id: null, default_lineup_id: null, settings: { timezone: 'Europe/Amsterdam', checkin_time: '15:00', checkout_time: '10:30' } },
    groups: [{ id: 1, name: 'Std', description: '', set_count: 2, layout_id: 5, instant_power: null, vacant_layout_id: null, welcome_popup_s: 0 }] };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const [path0, qs] = url.replace(/^\/api\/admin/, '').split('?');
    const path = path0; const q = Object.fromEntries(new URLSearchParams(qs || ''));
    const method = init.method || 'GET'; const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    state.calls.push([method, path, body, q]);
    if (path === '/me') return json(200, me);
    if (path === '/pms/settings') return json(200, { timezone: 'Europe/Amsterdam', checkin_time: '15:00', checkout_time: '10:30', today: TODAY, api_key: state.key, fields: ['room', 'first_name', 'last_name', 'checkin', 'checkout', 'lang', 'notes', 'vip'], date_formats: ['auto', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD', 'excel'] });
    if (path === '/pms/key' && method === 'POST') { state.key = { prefix: 'ccpms_abcdef', created_at: new Date().toISOString() }; return json(200, { key: 'ccpms_abcdef0123456789SECRET', prefix: 'ccpms_abcdef' }); }
    if (path === '/pms/key' && method === 'DELETE') { state.key = null; return json(200, { ok: true }); }
    if (path === '/groups' && method === 'GET') return json(200, state.groups);
    if (path === '/groups/1' && method === 'PATCH') { Object.assign(state.groups[0], body); return json(200, state.groups[0]); }
    if (path === '/rooms') return json(200, [{ room_number: '101', sets: 1, group_id: 1, group_name: 'Std', occupied: true, checked_in: false, reservation: RES, current: null }, { room_number: '102', sets: 1, group_id: 1, group_name: 'Std', occupied: false, checked_in: false, reservation: null, current: null }]);
    if (path === '/reservations' && method === 'GET') {
      let rows = state.reservations;
      if (q.arrivals) rows = rows.filter((r) => r.checkin_date === q.arrivals);
      if (q.q) rows = rows.filter((r) => r.guest.toLowerCase().includes(q.q.toLowerCase()));
      return json(200, rows);
    }
    if (path === '/reservations' && method === 'POST') {
      if (body.last_name === 'Overlap') return json(400, { error: 'room 102 already has Someone from 2026-09-19 to 2026-09-21 (reservation #9)' });
      const r = { ...RES, ...body, id: state.reservations.length + 1, guest: `${body.first_name} ${body.last_name}`.trim(), status: 'booked', nights: 1 }; state.reservations = [...state.reservations, r]; return json(201, r);
    }
    if (path === '/reservations/1/checkin') { state.reservations = state.reservations.map((r) => (r.id === 1 ? { ...r, status: 'checked_in' } : r)); return json(200, state.reservations[0]); }
    if (path === '/reservations/1/checkout') { state.reservations = state.reservations.map((r) => (r.id === 1 ? { ...r, status: 'checked_out' } : r)); return json(200, state.reservations[0]); }
    if (path === '/reservations/1' && method === 'PATCH') { state.reservations = state.reservations.map((r) => (r.id === 1 ? { ...r, ...body } : r)); return json(200, state.reservations[0]); }
    if (path === '/reservations/1' && method === 'DELETE') { state.reservations = state.reservations.map((r) => (r.id === 1 ? { ...r, status: 'cancelled' } : r)); return json(200, state.reservations[0]); }
    if (path === '/import/parse') return json(200, { kind: 'csv', headers: ['Kamer', 'Naam', 'Aankomst', 'Vertrek'], rows: [['101', 'Doe, Jane', '20/09/2026', '22/09/2026'], ['102', 'Bad', '31/02/2026', '22/09/2026'], ['103', 'Ok Two', '21/09/2026', '23/09/2026']], total: 3, truncated: false, guess: { room: 0, last_name: 1, checkin: 2, checkout: 3 } });
    if (path === '/import/preview') return json(200, { ok: 2, bad: 1, rows: [
      { index: 0, value: { room_number: '101', first_name: 'Jane', last_name: 'Doe', checkin_date: '2026-09-20', checkout_date: '2026-09-22' }, errors: [] },
      { index: 1, value: { room_number: '102', first_name: '', last_name: 'Bad', checkin_date: '', checkout_date: '2026-09-22' }, errors: ['bad check-in date "31/02/2026"'] },
      { index: 2, value: { room_number: '103', first_name: 'Ok', last_name: 'Two', checkin_date: '2026-09-21', checkout_date: '2026-09-23' }, errors: [] }] });
    if (path === '/import/commit') return json(200, { imported: 2, skipped: [{ row: 2, reason: 'bad check-in date "31/02/2026"', values: ['102', 'Bad', '31/02/2026', '22/09/2026'] }], reservations: [] });
    if (path === '/import/report') return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('row,reason\r\n2,bad\r\n') });
    if (path === '/import-profiles' && method === 'GET') return json(200, state.profiles);
    if (path === '/import-profiles' && method === 'POST') { const p = { id: state.profiles.length + 1, name: body.name, mapping: body.mapping, date_format: body.date_format }; state.profiles = [...state.profiles, p]; return json(200, p); }
    if (path === '/tenant' && method === 'GET') return json(200, state.tenant);
    if (path === '/tenant' && method === 'PATCH') { state.tenant = { ...state.tenant, ...body, settings: { ...state.tenant.settings, ...(body.settings || {}) } }; return json(200, state.tenant); }
    if (path === '/layouts') return json(200, [{ id: 5, name: 'Rooms' }, { id: 6, name: 'Vacant' }]);
    if (['/sets', '/media', '/lineups', '/assets', '/tenants'].includes(path)) return json(200, []);
    return json(404, { error: 'not found ' + path });
  });
  return state;
}
const renderAt = (p) => render(<MemoryRouter initialEntries={[p]}><App /></MemoryRouter>);

describe('Part C rooms & reservations', () => {
  let state;
  beforeEach(() => { state = fakeApi(); });

  it('calendar: rooms × days with bars, today highlighted, bar opens the reservation, check in now, empty cell adds with room/date prefilled, server errors shown', async () => {
    renderAt('/rooms');
    const cal = await screen.findByTestId('calendar');
    await waitFor(() => expect(within(cal).getAllByTestId('cal-bar').length).toBe(1));
    expect(within(cal).getByText('101')).toBeTruthy(); expect(within(cal).getByText('102')).toBeTruthy();
    expect(cal.querySelector('.cal-head.today')).toBeTruthy();
    const bar = within(cal).getByTestId('cal-bar');
    expect(bar.textContent).toBe('★ Jane Doe'); expect(bar.className).toMatch(/st-booked/);
    expect(bar.style.gridColumn).toBe('3 / 5');   // from = yesterday → check-in is the 2nd day column (grid col 3), two nights
    fireEvent.click(bar);
    const dlg = await screen.findByRole('dialog', { name: 'Reservation #1 · booked' });
    expect(within(dlg).getByLabelText('Room').value).toBe('101');
    expect(within(dlg).getByLabelText('First name').value).toBe('Jane');
    expect(within(dlg).getByLabelText('Check-out date').value).toBe('2026-09-20');
    expect(within(dlg).getByLabelText('VIP').checked).toBe(true);
    fireEvent.change(within(dlg).getByLabelText('Notes'), { target: { value: 'allergic to feathers' } });
    fireEvent.click(within(dlg).getByText('Save'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PATCH' && p === '/reservations/1' && b.notes === 'allergic to feathers' && b.room_number === '101')).toBe(true));
    // reopen → check in now (confirm) → POST
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(cal).getByTestId('cal-bar'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Check in now'));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Check in now?' })).getByText('Check in'));
    await waitFor(() => expect(state.calls.some(([m, p]) => m === 'POST' && p === '/reservations/1/checkin')).toBe(true));
    await waitFor(() => expect(within(screen.getByTestId('calendar')).getByTestId('cal-bar').className).toMatch(/st-checked_in/));
    // empty cell → new reservation prefilled
    fireEvent.click(within(screen.getByTestId('calendar')).getByLabelText('add reservation room 102 on 2026-09-19'));
    const nd = await screen.findByRole('dialog', { name: 'New reservation' });
    expect(within(nd).getByLabelText('Room').value).toBe('102');
    expect(within(nd).getByLabelText('Check-in date').value).toBe('2026-09-19');
    expect(within(nd).getByLabelText('Check-out date').value).toBe('2026-09-20');
    expect(within(nd).getByText('Add').disabled).toBe(true);   // no name yet
    fireEvent.change(within(nd).getByLabelText('Last name'), { target: { value: 'Overlap' } });
    fireEvent.click(within(nd).getByText('Add'));
    expect((await within(nd).findByRole('alert')).textContent).toMatch(/already has Someone/);
    fireEvent.change(within(nd).getByLabelText('Last name'), { target: { value: 'Smith' } });
    fireEvent.change(within(nd).getByLabelText('Language'), { target: { value: 'de' } });
    fireEvent.click(within(nd).getByText('Add'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/reservations' && b.room_number === '102' && b.last_name === 'Smith' && b.lang === 'de' && b.checkin_date === '2026-09-19')).toBe(true));
    await waitFor(() => expect(within(screen.getByTestId('calendar')).getAllByTestId('cal-bar').length).toBe(2));
  });

  it('list + arrivals tabs, search, group filter, export link, import link', async () => {
    renderAt('/rooms');
    await screen.findByTestId('calendar');
    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    expect((await screen.findAllByTestId('res-row')).length).toBe(1);
    fireEvent.change(screen.getByLabelText('Search reservations'), { target: { value: 'nobody' } });
    await waitFor(() => expect(state.calls.some(([m, p, , q]) => m === 'GET' && p === '/reservations' && q.q === 'nobody')).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: 'Arrivals today' }));
    await waitFor(() => expect(state.calls.some(([m, p, , q]) => m === 'GET' && p === '/reservations' && q.arrivals === TODAY)).toBe(true));
    expect((await screen.findAllByTestId('res-row')).length).toBe(1);
    fireEvent.change(screen.getByLabelText('Filter by group'), { target: { value: '1' } });
    await waitFor(() => expect(state.calls.some(([m, p, , q]) => m === 'GET' && p === '/reservations' && q.group_id === '1')).toBe(true));
    expect(screen.getByText('Export CSV').getAttribute('href')).toMatch(/^\/api\/admin\/reservations\/export\?from=2026-09-17&to=/);
    expect(screen.getByText('Import…').getAttribute('href')).toBe('/rooms/import');
  });

  it('import: file → parse, mapping from the guess, date format, preview, commit, skipped report, profiles', async () => {
    renderAt('/rooms/import');
    const input = await screen.findByLabelText('Import file');
    fireEvent.change(input, { target: { files: [new File(['Kamer;Naam\n101;Doe'], 'export.csv', { type: 'text/csv' })] } });
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/import/parse' && b.filename === 'export.csv' && typeof b.content_base64 === 'string' && b.content_base64.length > 0)).toBe(true));
    const roomSel = await screen.findByLabelText('column for room');
    expect(roomSel.value).toBe('0');
    expect(screen.getByLabelText('column for last_name').value).toBe('1');
    expect(screen.getByLabelText('column for first_name').value).toBe('');
    fireEvent.change(screen.getByLabelText('Date format'), { target: { value: 'DD/MM/YYYY' } });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/import/preview' && b.date_format === 'DD/MM/YYYY' && b.mapping.room === 0 && b.rows.length === 3)).toBe(true));
    const rows = await screen.findAllByTestId('preview-row');
    expect(rows.map((r) => r.getAttribute('data-ok'))).toEqual(['1', '0', '1']);
    expect(rows[1].textContent).toMatch(/bad check-in date/);
    fireEvent.click(screen.getByText('Import 2 reservation(s)'));
    await waitFor(() => expect(state.calls.some(([m, p]) => m === 'POST' && p === '/import/commit')).toBe(true));
    expect((await screen.findByText('Download report of skipped rows'))).toBeTruthy();
    expect(screen.getByText(/2.*reservation\(s\) imported/).textContent).toMatch(/1.*skipped/);
    fireEvent.click(screen.getByText('Download report of skipped rows'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/import/report' && b.skipped.length === 1 && b.headers[0] === 'Kamer')).toBe(true));
    // profile round trip
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Mews' } });
    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/import-profiles' && b.name === 'Mews' && b.date_format === 'DD/MM/YYYY' && b.mapping.checkin === 2)).toBe(true));
    fireEvent.change(screen.getByLabelText('column for room'), { target: { value: '3' } });
    expect(screen.getByLabelText('column for room').value).toBe('3');
    await waitFor(() => expect(screen.getByLabelText('Load profile').querySelectorAll('option').length).toBe(2));
    fireEvent.change(screen.getByLabelText('Load profile'), { target: { value: '1' } });
    await waitFor(() => expect(screen.getByLabelText('column for room').value).toBe('0'));
  });

  it('settings: check-in/out times saved; PMS API key generated and shown once', async () => {
    renderAt('/settings');
    const cin = await screen.findByLabelText('Check-in time');
    expect(cin.value).toBe('15:00');
    fireEvent.change(cin, { target: { value: '16:00' } });
    fireEvent.change(screen.getByLabelText('Check-out time'), { target: { value: '11:00' } });
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/London' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PATCH' && p === '/tenant' && b.settings.checkin_time === '16:00' && b.settings.checkout_time === '11:00' && b.settings.timezone === 'Europe/London')).toBe(true));
    expect(screen.queryByLabelText(/Guest name placeholder/)).toBeNull();
    fireEvent.click(screen.getByText('Generate key'));
    expect((await screen.findByTestId('pms-key')).textContent).toBe('ccpms_abcdef0123456789SECRET');
    await waitFor(() => expect(screen.getByText('Regenerate key')).toBeTruthy());
    fireEvent.click(screen.getByText('Revoke'));
    await waitFor(() => expect(state.calls.some(([m, p]) => m === 'DELETE' && p === '/pms/key')).toBe(true));
  });

  it('groups: vacant layout and welcome popup options', async () => {
    renderAt('/groups');
    const vac = await screen.findByLabelText('vacant layout Std');
    fireEvent.change(vac, { target: { value: '6' } });
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PATCH' && p === '/groups/1' && b.vacant_layout_id === '6')).toBe(true));
    fireEvent.change(screen.getByLabelText('welcome popup Std'), { target: { value: '10' } });
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PATCH' && p === '/groups/1' && b.welcome_popup_s === 10)).toBe(true));
  });
});
