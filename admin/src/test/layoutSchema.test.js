import { describe, it, expect } from 'vitest';
import { validateLayoutText, validateLayout } from '../layoutSchema.js';

describe('layout validation (client mirror)', () => {
  it('rejects invalid JSON', () => {
    expect(validateLayoutText('{oops').errors[0]).toMatch(/Invalid JSON/);
  });
  it('reports unknown types, duplicate ids, bad numbers, dangling screens', () => {
    const { errors, doc } = validateLayout({ schema: 1, zones: [{ id: 'a', type: 'nope' }, { id: 'a', type: 'text', x: 'x' }], screens: [{ id: 'home', zones: ['zzz'] }] });
    expect(doc).toBeNull();
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/unknown type "nope"/),
      expect.stringMatching(/duplicate zone id "a"/),
      expect.stringMatching(/x must be a number/),
      expect.stringMatching(/unknown zone "zzz"/),
    ]));
  });
  it('accepts a good document', () => {
    const r = validateLayout({ schema: 1, canvas: { w: 1920, h: 1080 }, zones: [{ id: 'tv', type: 'video', x: 0, y: 0, w: 1920, h: 1080 }, { id: 'c', type: 'clock' }], screens: [{ id: 'home', zones: ['tv', 'c'] }] });
    expect(r.errors).toEqual([]);
    expect(r.doc.zones.length).toBe(2);
  });
});
