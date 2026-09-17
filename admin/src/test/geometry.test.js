import { describe, it, expect } from 'vitest';
import { GRID, snap, clampRect, dragRect, resizeRect, guideSnap, alignZones, distributeZones, newZone, addZone, removeZone, renameZone, toggleZoneInScreen, moveZoneOrder, nextZoneId, duplicateZone, errorsByZone, actionValue, parseActionValue, actionChoices, updateZones } from '../editor/geometry.js';

const C = { w: 1920, h: 1080 };
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
    // right edge 636 → other's left 640
    let g = guideSnap({ x: 336, y: 300, w: 300, h: 100 }, others, C);
    expect(g.rect.x).toBe(340); expect(g.guides).toEqual([{ axis: 'x', pos: 640 }]);
    // horizontal centre 957 → canvas centre 960; top 123 → other's top 120
    g = guideSnap({ x: 807, y: 123, w: 300, h: 100 }, others, C);
    expect(g.rect).toEqual({ x: 810, y: 120, w: 300, h: 100 });
    expect(g.guides).toEqual([{ axis: 'x', pos: 960 }, { axis: 'y', pos: 120 }]);
    // nothing within the threshold → unchanged
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
    d = alignZones(doc, ['a', 'b'], 'middle');   // selection spans y 100..350 → middle 225
    expect(d.zones.map((z) => z.y)).toEqual([175, 200, 50]);
    d = alignZones(doc, ['a', 'c'], 'top');      // locked zone never moves
    expect(d.zones[2].y).toBe(50);
    const three = { canvas: C, zones: [{ id: 'a', x: 0, y: 0, w: 100, h: 10 }, { id: 'b', x: 150, y: 0, w: 100, h: 10 }, { id: 'c', x: 500, y: 0, w: 100, h: 10 }] };
    expect(distributeZones(three, ['a', 'b', 'c'], 'x').zones.map((z) => z.x)).toEqual([0, 250, 500]);
    expect(distributeZones(three, ['a', 'b'], 'x')).toBe(three);
  });
  it('document edits are immutable and keep screens consistent', () => {
    let doc = { schema: 1, canvas: C, zones: [], screens: [{ id: 'home', zones: [] }] };
    const a = addZone(doc, 'text', 'home');
    expect(a.zone.id).toBe('text'); expect(a.doc.screens[0].zones).toEqual(['text']); expect(doc.zones.length).toBe(0);
    const b = addZone(a.doc, 'text', 'home');
    expect(b.zone.id).toBe('text2');
    const h = addZone(b.doc, 'html', 'home');
    expect(h.doc.screens[0].zones).not.toContain('html'); // hidden pages are not auto-added
    doc = renameZone(h.doc, 'text', 'welcome');
    expect(doc.zones[0].id).toBe('welcome'); expect(doc.screens[0].zones[0]).toBe('welcome');
    expect(renameZone(doc, 'welcome', 'text2')).toBe(doc); // collision refused
    doc = toggleZoneInScreen(doc, 'home', 'text2');
    expect(doc.screens[0].zones).toEqual(['welcome']);
    doc = moveZoneOrder(doc, 'welcome', 1);
    expect(doc.zones.map((z) => z.id)).toEqual(['text2', 'welcome', 'html']);
    doc = moveZoneOrder(doc, 'html', 'back');
    expect(doc.zones.map((z) => z.id)).toEqual(['html', 'text2', 'welcome']);
    doc = moveZoneOrder(doc, 'html', 'front');
    expect(doc.zones.map((z) => z.id)).toEqual(['text2', 'welcome', 'html']);
    const d = duplicateZone(doc, ['welcome', 'text2'], 'home');
    expect(d.zones.map((z) => z.id)).toEqual(['text', 'text3']); expect(d.zone.x).toBe(doc.zones[1].x + 16);
    expect(d.doc.screens[0].zones).toEqual(['welcome', 'text', 'text3']);
    doc = removeZone(d.doc, ['welcome', 'text3']);
    expect(doc.zones.map((z) => z.id)).toEqual(['text2', 'html', 'text']);
    expect(doc.screens[0].zones).toEqual(['text']);
    expect(nextZoneId({ zones: [{ id: 'chlist' }] }, 'channel_list')).toBe('chlist2');
    expect(newZone(doc, 'video')).toMatchObject({ type: 'video', w: 1200, h: 675 });
    expect(newZone(doc, 'text', { x: 1000, y: 500 })).toMatchObject({ x: 600, y: 456 });   // centred on the drop point, snapped
    const withBanner = addZone(doc, 'banner', 'home');
    expect(withBanner.zone).toMatchObject({ type: 'banner', x: 80, y: 880 });
    expect(withBanner.doc.screens[0].zones).not.toContain('banner'); // placement zones are global
    expect(updateZones(doc, ['text'], () => ({ locked: true })).zones[2].locked).toBe(true);
  });
  it('maps validation messages to zones and encodes menu actions', () => {
    expect(errorsByZone(['zone "pic": unknown type "bogus"', 'at most one video zone', 'zone "pic": x must be a number'])).toEqual({ pic: ['zone "pic": unknown type "bogus"', 'zone "pic": x must be a number'] });
    expect(actionValue({ action: 'show_page', page: 'info' })).toBe('show_page:info');
    expect(actionValue({ action: 'show_screen', screen: 'dining' })).toBe('show_screen:dining');
    expect(actionValue({ action: 'fullscreen_tv' })).toBe('fullscreen_tv');
    expect(parseActionValue('show_page:info')).toEqual({ action: 'show_page', page: 'info', screen: undefined });
    expect(parseActionValue('show_screen:dining')).toEqual({ action: 'show_screen', screen: 'dining', page: undefined });
    expect(parseActionValue('home')).toEqual({ action: 'home', page: undefined, screen: undefined });
    const ch = actionChoices({ zones: [{ id: 'info', hidden: true }, { id: 'tv' }], screens: [{ id: 'home' }, { id: 'fullscreen' }, { id: 'dining' }] }, [{ id: 'netflix', name: 'Netflix' }]);
    expect(ch.pages.map((p) => p.value)).toEqual(['show_page:info']);
    expect(ch.screens.map((s) => s.value)).toEqual(['show_screen:fullscreen', 'show_screen:dining']);
    expect(ch.apps[0]).toEqual({ value: 'launch_app:netflix', label: 'Launch Netflix' });
    expect(ch.builtins.some((b) => b.value === 'fullscreen_tv')).toBe(true);
  });
});
