import { describe, it, expect } from 'vitest';
import { snap, clampRect, dragRect, resizeRect, newZone, addZone, removeZone, renameZone, toggleZoneInScreen, moveZoneOrder, nextZoneId, duplicateZone } from '../editor/geometry.js';

const C = { w: 1920, h: 1080 };
describe('geometry', () => {
  it('snaps and clamps', () => {
    expect(snap(14)).toBe(10); expect(snap(15)).toBe(20);
    expect(clampRect({ x: -50, y: 1000, w: 300, h: 200 }, C)).toEqual({ x: 0, y: 880, w: 300, h: 200 });
    expect(clampRect({ x: 0, y: 0, w: 5000, h: 10 }, C)).toEqual({ x: 0, y: 0, w: 1920, h: 40 });
  });
  it('drags with snapping and stays on canvas', () => {
    expect(dragRect({ x: 100, y: 100, w: 200, h: 100 }, 13, -7, C)).toEqual({ x: 110, y: 90, w: 200, h: 100 });
    expect(dragRect({ x: 100, y: 100, w: 200, h: 100 }, 13, -7, C, { free: true })).toEqual({ x: 113, y: 93, w: 200, h: 100 });
    expect(dragRect({ x: 1800, y: 0, w: 200, h: 100 }, 500, 0, C).x).toBe(1720);
  });
  it('resizes from each handle keeping the opposite edge', () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    expect(resizeRect(r, 'se', 25, 15, C)).toEqual({ x: 100, y: 100, w: 230, h: 120 });
    expect(resizeRect(r, 'nw', 25, 15, C)).toEqual({ x: 130, y: 120, w: 170, h: 80 });
    expect(resizeRect(r, 'e', -500, 0, C)).toEqual({ x: 100, y: 100, w: 40, h: 100 });
    expect(resizeRect(r, 'n', 0, 200, C)).toEqual({ x: 100, y: 160, w: 200, h: 40 });
    const a = resizeRect({ x: 0, y: 0, w: 160, h: 90 }, 'se', 160, 0, C, { aspect: 16 / 9 });
    expect(a).toEqual({ x: 0, y: 0, w: 320, h: 180 });
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
    const d = duplicateZone(doc, 'welcome', 'home');
    expect(d.zone.id).toBe('text'); expect(d.zone.x).toBe(doc.zones[1].x + 20);
    doc = removeZone(d.doc, 'welcome');
    expect(doc.zones.find((z) => z.id === 'welcome')).toBeUndefined();
    expect(doc.screens[0].zones).not.toContain('welcome');
    expect(nextZoneId({ zones: [{ id: 'chlist' }] }, 'channel_list')).toBe('chlist2');
    expect(newZone(doc, 'video')).toMatchObject({ type: 'video', w: 1200, h: 675 });
  });
});
