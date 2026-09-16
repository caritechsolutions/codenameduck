import { describe, it, expect } from 'vitest';
import SHARED from '../../../shared/zone-types.json';
import { ZONE_TYPES, validateLayout } from '../layoutSchema.js';
import { ZONE_TYPES as EDITOR_TYPES, newZone } from '../editor/geometry.js';

describe('zone types come from shared/zone-types.json', () => {
  it('validator and editor use the shared list and accept every type', () => {
    expect(ZONE_TYPES).toEqual(SHARED);
    expect(EDITOR_TYPES).toEqual(SHARED);
    const doc = { schema: 1, zones: SHARED.map((t, i) => ({ id: 'z' + i, type: t, x: 0, y: 0, w: 100, h: 50 })), screens: [] };
    expect(validateLayout(doc).errors).toEqual([]);
    for (const t of SHARED) expect(newZone({ zones: [], canvas: { w: 1920, h: 1080 } }, t).type).toBe(t);
  });
});
