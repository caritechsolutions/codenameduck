import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import ZonePanel from '../editor/ZonePanel.jsx';
import { ToastProvider } from '../components/ui.jsx';

const ITEMS = [
  { id: 1, uuid: 'aaaa', kind: 'image', ext: 'png', mime: 'image/png', name: 'Lobby', bytes: 204800, width: 1920, height: 1080, url: '/procentric/application/media/aaaa.png', thumb_url: '/procentric/application/media/thumbs/aaaa.jpg', created_at: new Date().toISOString() },
  { id: 2, uuid: 'bbbb', kind: 'video', ext: 'mp4', mime: 'video/mp4', name: 'Promo', bytes: 5242880, width: null, height: null, url: '/procentric/application/media/bbbb.mp4', thumb_url: null, created_at: new Date().toISOString() },
];

function fakeApi() {
  const me = { user: { id: 1, username: 'admin', role: 'superadmin', tenant_id: null }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: { logo_url: '/procentric/application/media/aaaa.png' } } };
  const state = { calls: [], items: ITEMS.map((i) => ({ ...i })) };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const path = url.replace(/^\/api\/admin/, '').split('?')[0];
    const method = init.method || 'GET'; const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body || null;
    state.calls.push([method, path, body, init.headers || {}]);
    if (path === '/me') return json(200, me);
    if (path === '/media' && method === 'GET') return json(200, state.items);
    if (path === '/media' && method === 'POST') { const it = { ...ITEMS[0], id: 3, uuid: 'cccc', name: decodeURIComponent(init.headers['X-Filename']).replace(/\.\w+$/, ''), url: '/procentric/application/media/cccc.png' }; state.items.unshift(it); return json(201, it); }
    if (path.startsWith('/media/') && method === 'PATCH') { const it = state.items.find((i) => i.id === Number(path.split('/')[2])); it.name = body.name; return json(200, it); }
    if (path === '/media/1' && method === 'DELETE') return json(409, { error: 'media is in use', layouts: [{ id: 7, name: 'Lobby screen' }], logo: true });
    if (path === '/media/2' && method === 'DELETE') { state.items = state.items.filter((i) => i.id !== 2); return json(200, { ok: true }); }
    if (path === '/tenant' && method === 'PATCH') return json(200, { ...me.tenant, settings: body.settings });
    if (['/groups', '/sets', '/layouts', '/lineups', '/assets'].includes(path)) return json(200, []);
    if (path === '/tenant') return json(200, me.tenant);
    return json(404, { error: 'not found ' + path });
  });
  return state;
}
const renderAt = (p) => render(<MemoryRouter initialEntries={[p]}><App /></MemoryRouter>);

describe('B1 media library', () => {
  let state;
  beforeEach(() => { state = fakeApi(); });

  it('lists the library with the logo badge, renames, and explains a blocked delete', async () => {
    renderAt('/media');
    expect(await screen.findByText('Lobby')).toBeTruthy();
    expect(screen.getByText('Promo')).toBeTruthy();
    expect(screen.getByText('logo')).toBeTruthy();
    // select → detail panel → rename
    fireEvent.click(screen.getByLabelText('Lobby'));
    const detail = await screen.findByRole('region', { name: 'Media details' });
    expect(within(detail).getByText('/procentric/application/media/aaaa.png')).toBeTruthy();
    fireEvent.change(within(detail).getByLabelText('Media name'), { target: { value: 'Lobby day' } });
    fireEvent.click(within(detail).getByText('Rename'));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'PATCH' && p === '/media/1' && b.name === 'Lobby day')).toBe(true));
    expect(await screen.findAllByText('Lobby day')).toBeTruthy();
    // delete is blocked: dialog names the layout and the logo
    fireEvent.click(within(detail).getByText('Delete'));
    const dlg = await screen.findByRole('dialog', { name: 'This file is in use' });
    expect(within(dlg).getByText('Layout “Lobby screen”').getAttribute('href')).toBe('/layouts/7');
    expect(within(dlg).getByText(/The hotel logo/)).toBeTruthy();
    fireEvent.click(within(dlg).getByText('OK'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // the video can be deleted
    fireEvent.click(screen.getByLabelText('Promo'));
    fireEvent.click(within(await screen.findByRole('region', { name: 'Media details' })).getByText('Delete'));
    await waitFor(() => expect(screen.queryByText('Promo')).toBeNull());
  });

  it('uploads dropped files as raw bodies with the file name', async () => {
    renderAt('/media');
    await screen.findByText('Lobby');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'Pool area.png', { type: 'image/png' });
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(state.calls.some(([m, p, b, h]) => m === 'POST' && p === '/media' && b === file && h['X-Filename'] === 'Pool%20area.png' && h['Content-Type'] === 'image/png')).toBe(true));
    expect(await screen.findByText('Pool area')).toBeTruthy();
  });

  it('"Use as hotel logo" patches settings.logo_url', async () => {
    renderAt('/media');
    await screen.findByText('Promo');
    fireEvent.click(screen.getByLabelText('Lobby'));
    const detail = await screen.findByRole('region', { name: 'Media details' });
    expect(within(detail).getByText('Current logo').disabled).toBe(true);
  });

  it('image zone and canvas background pick from the library', async () => {
    const DOC = { schema: 1, canvas: { w: 1920, h: 1080, background: '#000' }, zones: [{ id: 'pic', type: 'image', x: 0, y: 0, w: 400, h: 300, src: '' }], keys: {}, screens: [{ id: 'home', zones: ['pic'] }] };
    function H() {
      const [doc, setDoc] = React.useState(DOC);
      const [sel, setSel] = React.useState(['pic']);
      return <ToastProvider><ZonePanel doc={doc} selectedIds={sel} onChange={setDoc} onSelect={setSel} screenId="home" setScreenId={() => {}} /><pre data-testid="json">{JSON.stringify(doc)}</pre></ToastProvider>;
    }
    render(<H />);
    fireEvent.click(screen.getByLabelText('Choose image'));
    const dlg = await screen.findByRole('dialog', { name: 'Choose an image' });
    expect(await within(dlg).findByText('Lobby')).toBeTruthy();
    expect(within(dlg).queryByText('Promo')).toBeNull();   // videos are not offered for image zones
    fireEvent.click(within(dlg).getByLabelText('Lobby'));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('json').textContent).zones[0].src).toBe('/procentric/application/media/aaaa.png'));
    expect(screen.queryByRole('dialog')).toBeNull();
    // the {{logo}} tile is offered too
    fireEvent.click(screen.getByLabelText('Choose image'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByLabelText('Tenant logo'));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('json').textContent).zones[0].src).toBe('{{logo}}'));
    // URL entry
    fireEvent.click(screen.getByLabelText('Choose image'));
    const d3 = await screen.findByRole('dialog');
    fireEvent.change(within(d3).getByLabelText('Media URL'), { target: { value: 'http://x/y.png' } });
    fireEvent.click(within(d3).getByText('Use URL'));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('json').textContent).zones[0].src).toBe('http://x/y.png'));
  });
});
