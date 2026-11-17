import type { Rect } from './model.js';

export interface Margins { top: number; right: number; bottom: number; left: number }

/**
 * Crop box (user space) for margins given as the user sees the page — top, right, bottom, left of the
 * displayed page — on a page with visible box `view` [x0, y0, x1, y1] shown at `rotation` degrees clockwise.
 * Returns null when the margins leave less than 2 points either way.
 */
export function cropFromMargins(view: number[], rotation: number, m: Margins): Rect | null {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = view;
  // which user-space side each displayed side lies on
  let l: number, b: number, r: number, t: number;
  switch (((rotation % 360) + 360) % 360) {
    case 90: [l, t, r, b] = [m.top, m.right, m.bottom, m.left]; break;
    case 180: [b, l, t, r] = [m.top, m.right, m.bottom, m.left]; break;
    case 270: [r, b, l, t] = [m.top, m.right, m.bottom, m.left]; break;
    default: [t, r, b, l] = [m.top, m.right, m.bottom, m.left];
  }
  const width = x1 - x0 - l - r, height = y1 - y0 - b - t;
  if (!(width >= 2 && height >= 2) || [l, b, r, t].some((v) => !(v >= 0))) return null;
  return { x: x0 + l, y: y0 + b, width, height };
}
