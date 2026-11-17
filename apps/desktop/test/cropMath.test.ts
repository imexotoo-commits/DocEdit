import { describe, expect, it } from 'vitest';
import { cropFromMargins } from '../src/renderer/cropMath.js';
import { toScreenRect } from '../src/renderer/textGeometry.js';

const view = [0, 0, 600, 800];
const m = { top: 10, right: 20, bottom: 30, left: 40 };

describe('cropFromMargins', () => {
  it('maps displayed sides to the page sides for every rotation', () => {
    for (const rot of [0, 90, 180, 270]) {
      const crop = cropFromMargins(view, rot, m)!;
      // On screen, the crop box must sit exactly `m` in from each displayed edge.
      const full = toScreenRect({ x: 0, y: 0, width: 600, height: 800 }, view, rot, 1);
      const c = toScreenRect(crop, view, rot, 1);
      expect({ rot, top: c.y - full.y, left: c.x - full.x, right: full.x + full.width - (c.x + c.width), bottom: full.y + full.height - (c.y + c.height) })
        .toEqual({ rot, top: 10, left: 40, right: 20, bottom: 30 });
    }
  });
  it('works from a box that does not start at the origin and rejects impossible margins', () => {
    expect(cropFromMargins([100, 50, 700, 850], 0, { top: 0, right: 0, bottom: 0, left: 0 })).toEqual({ x: 100, y: 50, width: 600, height: 800 });
    expect(cropFromMargins(view, 0, { top: 400, right: 0, bottom: 399, left: 0 })).toBeNull();
    expect(cropFromMargins(view, 0, { top: -1, right: 0, bottom: 0, left: 0 })).toBeNull();
  });
});
