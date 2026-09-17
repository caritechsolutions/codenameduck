import { describe, it, expect } from 'vitest';
import { GRID, snap, clampRect, dragRect, resizeRect, guideSnap, alignZones, distributeZones, newZone, addZone, removeZone, renameZone, toggleZoneInPage, moveZoneOrder, nextZoneId, duplicateZone, errorsByZone, actionValue, parseActionValue, actionChoices, updateZones,
  addPage, renamePage, removePage, duplicatePage, movePage, setHomePage, setPageInherit, pageZoneIds, isOnPage, isInheritedOnPage, upgradeLayout, homePageId } from '../editor/geometry.js';
import { spatialNext, actionOf, validatePages } from '../../../shared/layout-model.js';

const C = { w: 1920, h: 1080 };
const V2 = (zones, pages) => ({ schema: 2, canvas: C, zones, pages: pages || [{ id: 'home', name: 'Home', zones: zones.map((z) => z.id), inherit: true }], home: 'home' });

describe('geometry', () => {
  it('snaps to the 8 px grid and clamps', () => {
    expect(GRID).toBe(8);
    expect(snap(11)).toBe(8); expect(snap(13)).toBe(16); expect(snap(100)).toBe(104);
    expect(clampRect({ x: -50, y: 1000, w: 300, h: 200 }, C)).toEqual({ x: 0, y: 880, w: 300, h: 200 });
    expect(clampRect({ x: 0, y: 0, w: 5000, h: 10 }, C)).toEqual({ x: 0, y: 0, w: 1920, h: 40 });
  });
  it('drags with snapping and stays on canvas', () => {
    expect(dragRect({ x: 100, y: 100, w: 200, h: 100 }, 13, -7, C)).toEqual({ x: 112, y: 96, w: 200, h: 100 });
    expect(dragRect({ x: 100, y: 100, w: 200, h: 100 }, 13, -7, C, { free: true })).toEqual({ x: 113, y: 93, w: 200, h: 100 });
    expect(dragRect({ x: 1800, y: 0, w: 200, h: 100 }, 500, 0, C).x).toBe(1720);
  });
  it('resizes from each handle keeping the opposite edge', () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    expect(resizeRect(r, 'se', 25, 15, C)).toEqual({ x: 100, y: 100, w: 224, h: 112 });
    expect(resizeRect(r, 'nw', 25, 15, C)).toEqual({ x: 128, y: 112, w: 172, h: 88 });
    expect(resizeRect(r, 'e', -500, 0, C)).toEqual({ x: 100, y: 100, w: 40, h: 100 });
    expect(resizeRect(r, 'n', 0, 200, C)).toEqual({ x: 100, y: 160, w: 200, h: 40 });
    const a = resizeRect({ x: 0, y: 0, w: 160, h: 90 }, 'se', 160, 0, C, { aspect: 16 / 9 });
    expect(a).toEqual({ x: 0, y: 0, w: 320, h: 180 });
  });
  it('smart guides snap edges and centres to other zones and the canvas', () => {
    const others = [{ x: 640, y: 120, w: 1200, h: 675 }];
    let g = guideSnap({ x: 336, y: 300, w: 300, h: 100 }, others, C);
    expect(g.rect.x).toBe(340); expect(g.guides).toEqual([{ axis: 'x', pos: 640 }]);
    g = guideSnap({ x: 807, y: 123, w: 300, h: 100 }, others, C);
    expect(g.rect).toEqual({ x: 810, y: 120, w: 300, h: 100 });
    expect(g.guides).toEqual([{ axis: 'x', pos: 960 }, { axis: 'y', pos: 120 }]);
    g = guideSnap({ x: 200, y: 300, w: 300, h: 100 }, others, C);
    expect(g.rect.x).toBe(200); expect(g.guides).toEqual([]);
  });
  it('aligns to the canvas for one zone and to the selection for several; distributes 3+', () => {
    const doc = { canvas: C, zones: [{ id: 'a', type: 'text', x: 100, y: 100, w: 200, h: 100 }, { id: 'b', type: 'text', x: 500, y: 300, w: 100, h: 50 }, { id: 'c', type: 'text', x: 900, y: 50, w: 300, h: 20, locked: true }] };
    expect(alignZones(doc, ['a'], 'right').zones[0].x).toBe(1720);
    expect(alignZones(doc, ['a'], 'center').zones[0].x).toBe(860);
    expect(alignZones(doc, ['a'], 'bottom').zones[0].y).toBe(980);
    let d = alignZones(doc, ['a', 'b'], 'left');
    expect(d.zones.map((z) => z.x)).toEqual([100, 100, 900]);
    d = alignZones(doc, ['a', 'b'], 'middle');
    expect(d.zones.map((z) => z.y)).toEqual([175, 200, 50]);
    d = alignZones(doc, ['a', 'c'], 'top');
    expect(d.zones[2].y).toBe(50);
    const three = { canvas: C, zones: [{ id: 'a', x: 0, y: 0, w: 100, h: 10 }, { id: 'b', x: 150, y: 0, w: 100, h: 10 }, { id: 'c', x: 500, y: 0, w: 100, h: 10 }] };
    expect(distributeZones(three, ['a', 'b', 'c'], 'x').zones.map((z) => z.x)).toEqual([0, 250, 500]);
    expect(distributeZones(three, ['a', 'b'], 'x')).toBe(three);
  });
  it('document edits are immutable and keep pages consistent', () => {
    let doc = V2([]);
    const a = addZone(doc, 'text', 'home');
    expect(a.zone.id).toBe('text'); expect(a.doc.pages[0].zones).toEqual(['text']); expect(doc.zones.length).toBe(0);
    const b = addZone(a.doc, 'text', 'home');
    expect(b.zone.id).toBe('text2');
    const h = addZone(b.doc, 'html', 'home');
    expect(h.doc.pages[0].zones).toContain('html');   // no more hidden pages: html goes on the page like anything else
    doc = renameZone(h.doc, 'text', 'welcome');
    expect(doc.zones[0].id).toBe('welcome'); expect(doc.pages[0].zones[0]).toBe('welcome');
    expect(renameZone(doc, 'welcome', 'text2')).toBe(doc); // collision refused
    doc = toggleZoneInPage(doc, 'home', 'text2');
    expect(doc.pages[0].zones).toEqual(['welcome', 'html']);
    doc = moveZoneOrder(doc, 'welcome', 1);
    expect(doc.zones.map((z) => z.id)).toEqual(['text2', 'welcome', 'html']);
    doc = moveZoneOrder(doc, 'html', 'back');
    expect(doc.zones.map((z) => z.id)).toEqual(['html', 'text2', 'welcome']);
    const d = duplicateZone(doc, ['welcome', 'text2'], 'home');
    expect(d.zones.map((z) => z.id)).toEqual(['text', 'text3']); expect(d.zone.x).toBe(doc.zones[2].x + 16);
    expect(d.doc.pages[0].zones).toEqual(['welcome', 'html', 'text', 'text3']);
    doc = removeZone(d.doc, ['welcome', 'text3']);
    expect(doc.zones.map((z) => z.id)).toEqual(['html', 'text2', 'text']);
    expect(doc.pages[0].zones).toEqual(['html', 'text']);
    expect(nextZoneId({ zones: [{ id: 'chlist' }] }, 'channel_list')).toBe('chlist2');
    expect(newZone(doc, 'video')).toMatchObject({ type: 'video', w: 1200, h: 675 });
    expect(newZone(doc, 'button')).toMatchObject({ type: 'button', label: 'Button', action: { type: 'fullscreen_tv' } });
    expect(newZone(doc, 'text', { x: 1000, y: 500 })).toMatchObject({ x: 600, y: 456 });
    const withBanner = addZone(doc, 'banner', 'home');
    expect(withBanner.zone).toMatchObject({ type: 'banner', x: 80, y: 880 });
    expect(withBanner.doc.pages[0].zones).not.toContain('banner'); // placement zones are global
    expect(updateZones(doc, ['text'], () => ({ locked: true })).zones[2].locked).toBe(true);
    // renaming a zone follows toggle actions that point at it
    const t = V2([{ id: 'box', type: 'text', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', type: 'button', x: 0, y: 0, w: 10, h: 10, action: { type: 'toggle', zone: 'box' } }]);
    expect(renameZone(t, 'box', 'panel').zones[1].action).toEqual({ type: 'toggle', zone: 'panel' });
  });
  it('pages: add, rename, inherit, home, reorder, duplicate (globals shared), remove (orphans dropped)', () => {
    let doc = V2([{ id: 'tv', type: 'video', x: 0, y: 0, w: 960, h: 540 }, { id: 'clock', type: 'clock', x: 0, y: 0, w: 100, h: 50 }, { id: 'welcome', type: 'text', x: 0, y: 0, w: 100, h: 50 }]);
    let r = addPage(doc, 'Hotel info');
    doc = r.doc;
    expect(r.page).toEqual({ id: 'hotel-info', name: 'Hotel info', zones: [], inherit: true });
    expect(addPage(doc, 'Hotel info').page.id).toBe('hotel-info-2');
    // inherited globals from home, not the text
    expect(pageZoneIds(doc, 'hotel-info')).toEqual(['tv', 'clock']);
    expect(isInheritedOnPage(doc, 'hotel-info', 'tv')).toBe(true); expect(isOnPage(doc, 'hotel-info', 'tv')).toBe(false);
    expect(pageZoneIds(setPageInherit(doc, 'hotel-info', false), 'hotel-info')).toEqual([]);
    doc = renamePage(doc, 'hotel-info', 'Info');
    expect(doc.pages[1].name).toBe('Info'); expect(doc.pages[1].id).toBe('hotel-info');   // id is stable
    const withText = addZone(doc, 'text', 'hotel-info');
    doc = withText.doc;
    expect(doc.pages[1].zones).toEqual(['text']);
    // duplicate: the new page gets its own copy of the text, shares nothing else
    const dup = duplicatePage(doc, 'hotel-info');
    expect(dup.page.id).toBe('info-copy'); expect(dup.page.zones).toEqual(['text2']);
    expect(dup.doc.pages.map((p) => p.id)).toEqual(['home', 'hotel-info', 'info-copy']);
    // duplicate home: global zones are shared, the text is copied
    const dh = duplicatePage(doc, 'home');
    expect(dh.page.zones).toEqual(['tv', 'clock', 'text2']);
    // reorder + home
    doc = movePage(doc, 'hotel-info', 0);
    expect(doc.pages.map((p) => p.id)).toEqual(['hotel-info', 'home']); expect(homePageId(doc)).toBe('home');
    doc = setHomePage(doc, 'hotel-info');
    expect(homePageId(doc)).toBe('hotel-info');
    expect(removePage(doc, 'hotel-info')).toBe(doc);   // cannot remove the home page
    doc = setHomePage(doc, 'home');
    // remove: the page's own text goes, globals and shared zones stay, actions pointing at it are cleared
    doc = { ...doc, zones: [...doc.zones, { id: 'btn', type: 'button', x: 0, y: 0, w: 10, h: 10, action: { type: 'goto_page', page: 'hotel-info' } }] };
    doc.pages = doc.pages.map((p) => (p.id === 'home' ? { ...p, zones: [...p.zones, 'btn'] } : p));
    doc = removePage(doc, 'hotel-info');
    expect(doc.pages.map((p) => p.id)).toEqual(['home']);
    expect(doc.zones.map((z) => z.id)).toEqual(['tv', 'clock', 'welcome', 'btn']);
    expect(doc.zones[3].action).toBeUndefined();
    expect(validatePages(doc)).toEqual([]);
  });
  it('maps validation messages to zones and encodes actions for the picker', () => {
    expect(errorsByZone(['zone "pic": unknown type "bogus"', 'at most one video zone', 'zone "pic": x must be a number'])).toEqual({ pic: ['zone "pic": unknown type "bogus"', 'zone "pic": x must be a number'] });
    expect(actionValue({ action: 'goto_page', page: 'info' })).toBe('goto_page:info');
    expect(actionValue({ type: 'goto_page', page: 'dining' })).toBe('goto_page:dining');
    expect(actionValue({ action: 'show_page', page: 'legacy' })).toBe('goto_page:legacy');   // legacy spelling still reads
    expect(actionValue({ action: 'fullscreen_tv' })).toBe('fullscreen_tv');
    expect(actionValue(undefined)).toBe('');
    expect(parseActionValue('goto_page:info')).toEqual({ type: 'goto_page', page: 'info' });
    expect(parseActionValue('tune', { type: 'tune', number: 5 })).toEqual({ type: 'tune', number: 5 });
    expect(parseActionValue('launch_app', { type: 'launch_app', app_id: 'netflix' })).toEqual({ type: 'launch_app', app_id: 'netflix' });
    expect(parseActionValue('')).toBeNull();
    const ch = actionChoices(V2([], [{ id: 'home', name: 'Home', zones: [] }, { id: 'dining', name: 'Dining', zones: [] }]), [{ id: 'netflix', name: 'Netflix' }]);
    expect(ch.pages.map((p) => p.value)).toEqual(['goto_page:home', 'goto_page:dining']);
    expect(ch.pages[1].label).toBe('Go to page “Dining”');
    expect(ch.builtins.map((b) => b.value)).toEqual(['back', 'fullscreen_tv', 'tune', 'launch_app', 'toggle']);
    expect(actionOf('close_page')).toEqual({ type: 'back' });
    expect(actionOf('toggle_menu')).toEqual({ type: 'fullscreen_tv' });
    expect(actionOf('home', 'start')).toEqual({ type: 'goto_page', page: 'start' });
  });
  it('upgrades a v1 layout: screens → pages, fullscreen dropped, hidden zones → pages, actions renamed', () => {
    const v1 = { schema: 1, canvas: C, zones: [
      { id: 'tv', type: 'video', x: 0, y: 0, w: 960, h: 540 },
      { id: 'menu', type: 'menu', x: 0, y: 0, w: 100, h: 100, items: [{ label: 'TV', action: 'fullscreen_tv' }, { label: 'Info', action: 'show_page', page: 'info' }, { label: 'Ch', action: 'show_screen', screen: 'channels' }, { label: 'Home', action: 'home' }, { label: 'X', action: 'close_page' }] },
      { id: 'info', type: 'html', x: 0, y: 0, w: 100, h: 100, hidden: true, html: '<p>i</p>' },
      { id: 'chlist', type: 'channel_list', x: 0, y: 0, w: 100, h: 100 }],
      keys: { PORTAL: 'toggle_menu', BACK: 'close_page', RED: 'show_page', GREEN: 'reload' },
      screens: [{ id: 'home', zones: ['tv', 'menu'] }, { id: 'fullscreen', zones: ['tv'] }, { id: 'channels', zones: ['tv', 'chlist'] }] };
    const d = upgradeLayout(v1);
    expect(d.schema).toBe(2);
    expect(d.pages).toEqual([
      { id: 'home', name: 'Home', zones: ['tv', 'menu'], inherit: false },
      { id: 'channels', name: 'Channels', zones: ['tv', 'chlist'], inherit: false },
      { id: 'info', name: 'Info', zones: ['info'], inherit: true }]);
    expect(d.home).toBe('home');
    expect(d.zones.find((z) => z.id === 'info').hidden).toBeUndefined();
    expect(d.zones[1].items).toEqual([{ label: 'TV', action: 'fullscreen_tv' }, { label: 'Info', action: 'goto_page', page: 'info' }, { label: 'Ch', action: 'goto_page', page: 'channels' }, { label: 'Home', action: 'goto_page', page: 'home' }, { label: 'X', action: 'back' }]);
    expect(d.keys).toEqual({ PORTAL: { type: 'fullscreen_tv' }, BACK: { type: 'back' }, GREEN: { type: 'reload' } });   // RED had no page → dropped
    expect(d.focus).toEqual({ color: '#ffd166', width: 6, radius: 12 }); expect(d.back_on_home).toBe('none');
    expect(validatePages(d)).toEqual([]);
    expect(upgradeLayout(d)).toEqual(d);   // idempotent
    // a v1 doc without screens gets one home page with every zone
    const bare = upgradeLayout({ schema: 1, zones: [{ id: 'a', type: 'text' }] });
    expect(bare.pages).toEqual([{ id: 'home', name: 'Home', zones: ['a'], inherit: false }]);
  });
  it('spatial navigation picks the nearest element in the pressed direction', () => {
    //  [0]      [1]
    //  [2]  [3]
    //          [4]  (far right, lower)
    const R = [{ x: 0, y: 0, w: 100, h: 50 }, { x: 400, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 }, { x: 200, y: 200, w: 100, h: 50 }, { x: 700, y: 260, w: 100, h: 50 }];
    expect(spatialNext(R, -1, 'down')).toBe(0);              // nothing focused → top-left
    expect(spatialNext(R, 0, 'right')).toBe(1);
    expect(spatialNext(R, 0, 'down')).toBe(2);
    expect(spatialNext(R, 1, 'down')).toBe(3);               // nearest below, not the far-right one
    expect(spatialNext(R, 3, 'right')).toBe(4);
    expect(spatialNext(R, 3, 'left')).toBe(2);
    expect(spatialNext(R, 2, 'up')).toBe(0);
    expect(spatialNext(R, 4, 'left')).toBe(3);
    expect(spatialNext(R, 0, 'left')).toBe(-1);              // nothing that way
    expect(spatialNext(R, 0, 'up')).toBe(-1);
    expect(spatialNext([], 0, 'up')).toBe(-1);
  });
});
