import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import LayoutThumb from '../editor/LayoutThumb.jsx';
import TEMPLATES from '../../../shared/layout-templates.json';

const DOC = { schema: 2, canvas: { w: 1920, h: 1080, background: '#000' },
  zones: [
    { id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 },
    { id: 'clock', type: 'clock', x: 1600, y: 980, w: 240, h: 60 },
    { id: 'welcome', type: 'text', x: 80, y: 60, w: 800, h: 90, text: 'Hi {{room}}' },
    { id: 'btn', type: 'button', x: 80, y: 400, w: 300, h: 80, label: 'Info', action: { type: 'goto_page', page: 'info' } },
    { id: 'infotext', type: 'html', x: 100, y: 100, w: 1000, h: 500, html: '<h1>Info</h1>' },
  ],
  pages: [{ id: 'home', name: 'Home', zones: ['tv', 'clock', 'welcome', 'btn'], inherit: true }, { id: 'info', name: 'Hotel info', zones: ['infotext'], inherit: true }],
  home: 'home', keys: {}, focus: { color: '#ffd166', width: 6, radius: 12 }, back_on_home: 'none' };

function fakeApi() {
  const me = { user: { id: 1, username: 'admin', role: 'superadmin', tenant_id: null }, tenant: { id: 1, name: 'hoteldemo', hostname: 'h', display_name: 'Hotel Demo', settings: {} } };
  const state = { calls: [], layout: { id: 1, name: 'Room', version: 3, json: DOC } };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  global.fetch = vi.fn((url, init = {}) => {
    const path = url.replace(/^\/api\/admin/, '').split('?')[0];
    const method = init.method || 'GET'; const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    state.calls.push([method, path, body]);
    if (path === '/me') return json(200, me);
    if (path === '/layouts/1' && method === 'GET') return json(200, state.layout);
    if (path === '/layouts/1' && method === 'PUT') { state.layout = { ...state.layout, json: body.json, version: 4, pushed: 1 }; return json(200, state.layout); }
    if (path === '/sets') return json(200, [{ id: 7, serial: 'S7', room_number: '101', model: 'M', ws: true, online: true }]);
    if (path === '/sets/7/preview') return json(200, { ok: true });
    if (path === '/apps') return json(200, [{ id: 1, app_id: 'netflix', name: 'Netflix', icon: null }]);
    if (['/groups', '/media', '/layouts', '/lineups'].includes(path)) return json(200, []);
    return json(404, { error: 'not found ' + path });
  });
  return state;
}
const renderAt = (p) => render(<MemoryRouter initialEntries={[p]}><App /></MemoryRouter>);
const jsonDoc = () => { fireEvent.click(screen.getByRole('tab', { name: 'Advanced' })); const d = JSON.parse(screen.getByLabelText('Layout JSON').value); fireEvent.click(screen.getByRole('tab', { name: 'Canvas' })); return d; };
const select = (id) => { fireEvent.pointerDown(document.querySelector(`[data-zone="${id}"]`), { clientX: 10, clientY: 10, pointerId: 1 }); fireEvent.pointerUp(window, { clientX: 10, clientY: 10 }); };

describe('B2b pages and element actions', () => {
  let state;
  beforeEach(() => { state = fakeApi(); });

  it('page navigator: select, add, rename, duplicate, set home, reorder, delete', async () => {
    renderAt('/layouts/1');
    await screen.findByLabelText('Layout canvas');
    expect(screen.getByLabelText('page Home').getAttribute('aria-current')).toBe('page');
    expect(within(screen.getByLabelText('page Home')).getByLabelText('home page')).toBeTruthy();
    // selecting the info page: the button (home only) dims, the clock/tv are inherited
    fireEvent.click(screen.getByLabelText('page Hotel info'));
    expect(document.querySelector('[data-zone="btn"]').className).toMatch(/dim/);
    expect(document.querySelector('[data-zone="clock"]').className).toMatch(/inherited/);
    expect(document.querySelector('[data-zone="infotext"]').className).not.toMatch(/dim/);
    // page settings in the panel; inherit off → the clock dims too
    expect(screen.getByLabelText('Page name').value).toBe('Hotel info');
    fireEvent.click(screen.getByLabelText('Inherit global zones from home'));
    expect(document.querySelector('[data-zone="clock"]').className).toMatch(/dim/);
    expect(jsonDoc().pages[1].inherit).toBe(false);
    // add + rename
    fireEvent.click(screen.getByLabelText('Add page'));
    fireEvent.change(screen.getByLabelText('New page name'), { target: { value: 'Dining' } });
    fireEvent.click(screen.getByText('Add'));
    expect(jsonDoc().pages.map((p) => p.id)).toEqual(['home', 'info', 'dining']);
    fireEvent.click(screen.getByLabelText('rename page dining'));
    fireEvent.change(screen.getByLabelText('Rename page'), { target: { value: 'Restaurant' } });
    fireEvent.keyDown(screen.getByLabelText('Rename page'), { key: 'Enter' });
    await waitFor(() => expect(jsonDoc().pages[2]).toMatchObject({ id: 'dining', name: 'Restaurant' }));
    // duplicate info: its html is copied, inherit flag kept
    fireEvent.click(screen.getByLabelText('duplicate page info'));
    let d = jsonDoc();
    expect(d.pages.map((p) => p.id)).toEqual(['home', 'info', 'hotel-info-copy', 'dining']);
    expect(d.pages[2].zones).toEqual(['html']); expect(d.zones.some((z) => z.id === 'html' && z.html === '<h1>Info</h1>')).toBe(true);
    // reorder + home
    fireEvent.click(screen.getByLabelText('move up dining'));
    expect(jsonDoc().pages.map((p) => p.id)).toEqual(['home', 'info', 'dining', 'hotel-info-copy']);
    fireEvent.click(screen.getByLabelText('set home info'));
    d = jsonDoc();
    expect(d.home).toBe('info');
    expect(screen.queryByLabelText('delete page info')).toBeNull();   // home cannot be deleted
    fireEvent.click(screen.getByLabelText('set home home'));
    // delete the copy: its own html zone goes, everything else stays
    fireEvent.click(screen.getByLabelText('delete page hotel-info-copy'));
    d = jsonDoc();
    expect(d.pages.map((p) => p.id)).toEqual(['home', 'info', 'dining']);
    expect(d.zones.some((z) => z.id === 'html')).toBe(false);
    expect(d.zones.some((z) => z.id === 'infotext')).toBe(true);
    expect(screen.getByLabelText('page Home').getAttribute('aria-current')).toBe('page');
  });

  it('action picker on text/image/button: pages dropdown, tune, toggle; layout focus ring + BACK on home', async () => {
    renderAt('/layouts/1');
    await screen.findByLabelText('Layout canvas');
    select('btn');
    const pick = screen.getByLabelText('Action');
    expect(pick.value).toBe('goto_page:info');
    expect(Array.from(pick.querySelectorAll('optgroup')).map((g) => g.label)).toEqual(['Pages', 'Built-in']);
    expect(Array.from(pick.querySelectorAll('option')).map((o) => o.value)).toEqual(['', 'goto_page:home', 'goto_page:info', 'back', 'fullscreen_tv', 'tune', 'launch_app', 'toggle']);
    fireEvent.change(pick, { target: { value: 'tune' } });
    fireEvent.change(screen.getByLabelText('channel #'), { target: { value: '12' } });
    expect(jsonDoc().zones.find((z) => z.id === 'btn').action).toEqual({ type: 'tune', number: 12 });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'toggle' } });
    fireEvent.change(screen.getByLabelText('toggle zone'), { target: { value: 'welcome' } });
    expect(jsonDoc().zones.find((z) => z.id === 'btn').action).toEqual({ type: 'toggle', zone: 'welcome' });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'launch_app' } });
    fireEvent.change(screen.getByLabelText('app id'), { target: { value: 'netflix' } });   // discovered apps feed the select
    expect(jsonDoc().zones.find((z) => z.id === 'btn').action).toEqual({ type: 'launch_app', app_id: 'netflix' });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: '' } });
    expect(jsonDoc().zones.find((z) => z.id === 'btn').action).toBeUndefined();
    // button label + focused style
    fireEvent.change(screen.getByLabelText('Button label'), { target: { value: 'Watch' } });
    fireEvent.change(screen.getByLabelText('Focused background'), { target: { value: '#ff0000' } });
    expect(jsonDoc().zones.find((z) => z.id === 'btn')).toMatchObject({ label: 'Watch', focusStyle: { background: '#ff0000' } });
    // a text zone gets an action too and shows the ⚡ marker on the canvas
    select('welcome');
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'back' } });
    expect(jsonDoc().zones.find((z) => z.id === 'welcome').action).toEqual({ type: 'back' });
    expect(document.querySelector('[data-zone="welcome"]').className).toMatch(/has-action/);
    // video zones have no action field
    select('tv');
    expect(screen.queryByLabelText('Action')).toBeNull();
    // layout-level: focus ring + BACK on home
    fireEvent.pointerDown(screen.getByLabelText('Layout canvas'));
    fireEvent.change(screen.getByLabelText('Focus colour'), { target: { value: '#00ff00' } });
    fireEvent.change(screen.getByLabelText('Focus width'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('BACK on home'), { target: { value: 'fullscreen_tv' } });
    const d = jsonDoc();
    expect(d.focus).toEqual({ color: '#00ff00', width: 10, radius: 12 }); expect(d.back_on_home).toBe('fullscreen_tv');
    // an action pointing at a deleted page is flagged inline, not as an alert
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    const bad = { ...DOC, zones: DOC.zones.map((z) => (z.id === 'btn' ? { ...z, action: { type: 'goto_page', page: 'gone' } } : z)) };
    fireEvent.change(screen.getByLabelText('Layout JSON'), { target: { value: JSON.stringify(bad) } });
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
    expect(screen.getByLabelText('errors on btn')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preview follows the selected page; preview on set sends the page; thumbnails use the home page', async () => {
    renderAt('/layouts/1');
    await screen.findByLabelText('Layout canvas');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    const stage = document.querySelector('.tvstage');
    await waitFor(() => expect(stage.querySelector('#zone-btn')).toBeTruthy());
    expect(stage.querySelector('#zone-btn').className).toMatch(/focusable/);
    expect(stage.querySelector('#zone-btn').className).toMatch(/focused/);   // first focusable gets the ring in the preview
    expect(stage.querySelector('#zone-btn .btn-label').textContent).toBe('Info');
    fireEvent.click(screen.getByLabelText('page Hotel info'));
    await waitFor(() => expect(stage.querySelector('#zone-infotext')).toBeTruthy());
    expect(stage.querySelector('#zone-btn')).toBeNull();
    expect(stage.querySelector('#zone-clock')).toBeTruthy();   // inherited
    fireEvent.change(screen.getByLabelText('Preview set'), { target: { value: '7' } });
    fireEvent.click(screen.getByText('Preview', { selector: 'button:not([role=tab])' }));
    await waitFor(() => expect(state.calls.some(([m, p, b]) => m === 'POST' && p === '/sets/7/preview' && b.page === 'info' && b.json.schema === 2)).toBe(true));
    // thumbnails: only home-page zones, for v2 and for legacy v1 documents
    const { container } = render(<LayoutThumb doc={DOC} width={160} />);
    expect(container.querySelectorAll('.thumb div').length).toBe(4);
    const v1 = render(<LayoutThumb doc={{ schema: 1, zones: [{ id: 'a', type: 'text', x: 0, y: 0, w: 10, h: 10 }, { id: 'h', type: 'html', hidden: true, x: 0, y: 0, w: 10, h: 10 }], screens: [{ id: 'home', zones: ['a'] }] }} width={160} />);
    expect(v1.container.querySelectorAll('.thumb div').length).toBe(1);
    for (const t of TEMPLATES) expect(t.json.pages.length).toBeGreaterThan(0);
  });
});
