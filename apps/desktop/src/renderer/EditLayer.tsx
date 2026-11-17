import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { AnnotationSpec, MarkSpec } from '@docedit/core';
import type { PendingEdit, Rect } from './edits.js';
import { fromScreenPoint, fromScreenRect, toScreenPoint, toScreenRect } from './textGeometry.js';

export type Tool = 'select' | 'highlight' | 'underline' | 'strikeout' | 'note' | 'freetext' | 'square' | 'circle' | 'ink' | 'link' | 'signature' | 'initials' | 'redact' | MarkTool;

/** Fill-and-sign marks: a click places one at a standard size, a drag sizes it (a line goes where it is dragged). */
export type MarkTool = 'check' | 'cross' | 'dot' | 'box' | 'line';
const MARK_TOOLS: Tool[] = ['check', 'cross', 'dot', 'box'];

/** Tools that draw on the page with the pointer (the text-markup tools work on selected text instead). */
export const DRAW_TOOLS: Tool[] = ['note', 'freetext', 'square', 'circle', 'ink', 'link', 'signature', 'initials', 'redact', 'check', 'cross', 'dot', 'box', 'line'];

/** What the user drew, in the page's user space. */
export type Drawn =
  | { tool: 'note'; at: { x: number; y: number } }
  | { tool: 'freetext' | 'square' | 'circle' | 'link' | 'signature' | 'initials' | 'redact' | 'check' | 'cross' | 'dot' | 'box'; rect: Rect }
  | { tool: 'line'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { tool: 'ink'; path: Array<{ x: number; y: number }> };

interface Props {
  pageId: string;
  view: number[];
  rotation: number;
  scale: number;
  width: number;
  height: number;
  edits: PendingEdit[];
  tool: Tool;
  selectedEdit: string | null;
  onSelectEdit(id: string | null): void;
  onDrawn(d: Drawn): void;
  /** pending form values on this page, drawn over their fields */
  fieldMarks?: Array<{ name: string; rect: Rect; value: string | boolean | string[] }>;
  onFieldClick?(name: string): void;
}

const rgbCss = (c: number[] | undefined, fallback: string) => (c ? `rgb(${c.map((v) => Math.round(v * 255)).join(',')})` : fallback);

export function EditLayer({ pageId, view, rotation, scale, width, height, edits, tool, selectedEdit, onSelectEdit, onDrawn, fieldMarks, onFieldClick }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [stroke, setStroke] = useState<Array<{ x: number; y: number }> | null>(null);
  const drawing = DRAW_TOOLS.includes(tool);
  const S = (r: Rect) => toScreenRect(r, view, rotation, scale);
  const P = (x: number, y: number) => toScreenPoint(x, y, view, rotation, scale);

  const local = (e: RPointerEvent) => {
    const b = svg.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(width, e.clientX - b.left)), y: Math.max(0, Math.min(height, e.clientY - b.top)) };
  };

  function down(e: RPointerEvent) {
    if (!drawing || e.button !== 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = local(e);
    if (tool === 'ink') setStroke([p]);
    else setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function move(e: RPointerEvent) {
    if (stroke) { const p = local(e); setStroke((s) => (s ? [...s, p] : s)); }
    else if (drag) { const p = local(e); setDrag({ ...drag, x1: p.x, y1: p.y }); }
  }
  function up() {
    if (stroke) {
      if (stroke.length > 1) onDrawn({ tool: 'ink', path: simplify(stroke).map((p) => fromScreenPoint(p.x, p.y, view, rotation, scale)) });
      setStroke(null);
      return;
    }
    if (!drag) return;
    const r = { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) };
    setDrag(null);
    if (tool === 'note') { onDrawn({ tool: 'note', at: fromScreenPoint(drag.x1, drag.y1, view, rotation, scale) }); return; }
    if (tool === 'redact' && (r.width < 3 || r.height < 3)) return; // a redaction must be drawn deliberately
    if (tool === 'line') {
      if (Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) >= 4) onDrawn({ tool: 'line', from: fromScreenPoint(drag.x0, drag.y0, view, rotation, scale), to: fromScreenPoint(drag.x1, drag.y1, view, rotation, scale) });
      return;
    }
    if (MARK_TOOLS.includes(tool) && (r.width < 6 || r.height < 6)) { // a click: a standard-size mark centred there
      const s = (tool === 'box' ? 18 : 14) * scale;
      onDrawn({ tool: tool as 'check', rect: fromScreenRect({ x: drag.x0 - s / 2, y: drag.y0 - s / 2, width: s, height: s }, view, rotation, scale) });
      return;
    }
    // a click without dragging places a default-sized box there
    const min = 6;
    const box = r.width < min || r.height < min
      ? { x: drag.x0, y: drag.y0, width: (tool === 'signature' ? 180 : tool === 'initials' ? 80 : tool === 'freetext' ? 200 : 120) * scale, height: (tool === 'signature' ? 60 : tool === 'freetext' ? 50 : 40) * scale }
      : r;
    onDrawn({ tool: tool as 'freetext', rect: fromScreenRect(box, view, rotation, scale) });
  }

  return (
    <svg
      ref={svg}
      className={`edit-layer${drawing ? ' drawing' : ''}`}
      width={width}
      height={height}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      data-page-id={pageId}
      aria-hidden={edits.length === 0 ? true : undefined}
    >
      {edits.map((e) => {
        const sel = e.id === selectedEdit;
        const pick = (ev: RPointerEvent) => { if (!drawing) { ev.stopPropagation(); onSelectEdit(e.id); } };
        const common = { className: `pending${sel ? ' selected' : ''}`, onPointerDown: pick, 'data-edit-id': e.id };
        if (e.type === 'signature') {
          const r = S(e.rect);
          return (
            <g key={e.id} {...common}>
              {e.image
                ? <image href={`data:image/${e.image.format === 'png' ? 'png' : 'jpeg'};base64,${e.image.base64}`} x={r.x} y={r.y} width={r.width} height={r.height} preserveAspectRatio="xMidYMid meet" />
                : <text x={r.x + 4} y={r.y + r.height * 0.65} fontSize={r.height * 0.5} className="sig-text">{e.typedName}</text>}
              <rect x={r.x} y={r.y} width={r.width} height={r.height} className="frame" />
            </g>
          );
        }
        if (e.type === 'mark') return <g key={e.id} {...common}>{drawMark(e.mark, S, P, scale)}</g>;
        if (e.type === 'redact') {
          const r = S(e.rect);
          return <rect key={e.id} {...common} x={r.x} y={r.y} width={r.width} height={r.height} className={`${common.className} redact-mark`}><title>{`Pending redaction${e.text ? `: ${e.text}` : ''}`}</title></rect>;
        }
        if (e.type === 'link') {
          const r = S(e.rect);
          return <rect key={e.id} {...common} x={r.x} y={r.y} width={r.width} height={r.height} className={`${common.className} link-box`}><title>{'url' in e.target ? e.target.url : 'Link to a page'}</title></rect>;
        }
        if (e.type !== 'annotation') return null;
        return <g key={e.id} {...common}>{drawAnnotation(e.annotation, S, P, scale, rotation)}</g>;
      })}
      {fieldMarks?.map((f) => {
        const r = S(f.rect);
        const text = typeof f.value === 'boolean' ? (f.value ? '✓' : '') : Array.isArray(f.value) ? f.value.join(', ') : f.value;
        return (
          <g key={f.name} className="pending field-mark" onPointerDown={(ev) => { if (!drawing) { ev.stopPropagation(); onFieldClick?.(f.name); } }}>
            <rect x={r.x} y={r.y} width={r.width} height={r.height} />
            <text x={r.x + 3} y={r.y + r.height * 0.72} fontSize={Math.min(r.height * 0.7, 12 * scale)}>{text}</text>
          </g>
        );
      })}
      {drag && tool === 'line' && <line className="mark-stroke" x1={drag.x0} y1={drag.y0} x2={drag.x1} y2={drag.y1} strokeWidth={1.5 * scale} />}
      {drag && tool !== 'note' && tool !== 'line' && (
        <rect className="rubber" x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} rx={tool === 'circle' ? 999 : 0} />
      )}
      {stroke && <polyline className="ink-live" points={stroke.map((p) => `${p.x},${p.y}`).join(' ')} />}
    </svg>
  );
}

function drawAnnotation(a: AnnotationSpec, S: (r: Rect) => Rect, P: (x: number, y: number) => { x: number; y: number }, scale: number, rotation: number) {
  switch (a.kind) {
    case 'highlight': return a.rects.map((q, i) => { const r = S(q); return <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill={rgbCss(a.color, 'rgb(255,217,26)')} className="hl" />; });
    case 'underline': case 'strikeout': return a.rects.map((q, i) => {
      const r = S(q);
      // the line runs along the text: vertical on screen when the page is turned a quarter;
      // the text's "down" side is screen-left at 90° and screen-right at 270°
      const t = a.kind === 'underline' ? 0.92 : 0.5;
      const lx = rotation === 90 ? r.x + r.width * (1 - t) : r.x + r.width * t;
      return rotation === 90 || rotation === 270
        ? <line key={i} x1={lx} y1={r.y} x2={lx} y2={r.y + r.height} stroke={rgbCss(a.color, 'rgb(217,26,26)')} strokeWidth={Math.max(1, r.width / 14)} />
        : <line key={i} x1={r.x} y1={r.y + r.height * t} x2={r.x + r.width} y2={r.y + r.height * t} stroke={rgbCss(a.color, 'rgb(217,26,26)')} strokeWidth={Math.max(1, r.height / 14)} />;
    });
    case 'note': { const p = P(a.at.x, a.at.y); const s = 20 * scale; return <><rect x={p.x} y={p.y} width={s} height={s * 0.75} rx={3} fill={rgbCss(a.color, 'rgb(255,204,51)')} stroke="#444" /><title>{a.text}</title></>; }
    case 'freetext': { const r = S(a.rect); return <foreignObject x={r.x} y={r.y} width={r.width} height={r.height}><div className="ft" style={{ fontSize: (a.size ?? 12) * scale, color: rgbCss(a.color, 'rgb(217,26,26)') }}>{a.text}</div></foreignObject>; }
    case 'square': { const r = S(a.rect); return <rect x={r.x} y={r.y} width={r.width} height={r.height} fill="none" stroke={rgbCss(a.color, 'rgb(217,26,26)')} strokeWidth={(a.width ?? 2) * scale} />; }
    case 'circle': { const r = S(a.rect); return <ellipse cx={r.x + r.width / 2} cy={r.y + r.height / 2} rx={r.width / 2} ry={r.height / 2} fill="none" stroke={rgbCss(a.color, 'rgb(217,26,26)')} strokeWidth={(a.width ?? 2) * scale} />; }
    case 'ink': return a.paths.map((path, i) => <polyline key={i} points={path.map((p) => { const s = P(p.x, p.y); return `${s.x},${s.y}`; }).join(' ')} fill="none" stroke={rgbCss(a.color, 'rgb(217,26,26)')} strokeWidth={(a.width ?? 2) * scale} strokeLinecap="round" strokeLinejoin="round" />);
  }
}

/** Check and cross strokes in a unit square, y up (the same shapes core draws into the page). */
const MARK_STROKES = { check: [[0.1, 0.5, 0.38, 0.16], [0.38, 0.16, 0.9, 0.86]], cross: [[0.14, 0.14, 0.86, 0.86], [0.14, 0.86, 0.86, 0.14]] } as const;

function drawMark(m: MarkSpec, S: (r: Rect) => Rect, P: (x: number, y: number) => { x: number; y: number }, scale: number) {
  if (m.shape === 'line') {
    const a = P(m.from.x, m.from.y), b = P(m.to.x, m.to.y);
    return <><line className="mark-stroke" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={1.5 * scale} /><line className="mark-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} /></>;
  }
  const r = S(m.rect), s = Math.min(r.width, r.height);
  const hit = <rect className="mark-hit" x={r.x} y={r.y} width={r.width} height={r.height} />;
  if (m.shape === 'box') return <><rect className="mark-stroke" x={r.x} y={r.y} width={r.width} height={r.height} fill="none" strokeWidth={Math.max(0.75 * scale, s * 0.06)} />{hit}</>;
  if (m.shape === 'dot') return <><circle className="mark-fill" cx={r.x + r.width / 2} cy={r.y + r.height / 2} r={s * 0.32} />{hit}</>;
  // screen y runs down
  return <>{MARK_STROKES[m.shape].map(([u1, v1, u2, v2], i) => (
    <line key={i} className="mark-stroke" x1={r.x + u1 * r.width} y1={r.y + (1 - v1) * r.height} x2={r.x + u2 * r.width} y2={r.y + (1 - v2) * r.height} strokeWidth={Math.max(scale, s * 0.12)} />
  ))}{hit}</>;
}

/** Drop points closer than 1.5 px to the previous one; keeps ink annotations small. */
function simplify(pts: Array<{ x: number; y: number }>) {
  const out = [pts[0]!];
  for (const p of pts.slice(1)) { const q = out[out.length - 1]!; if (Math.hypot(p.x - q.x, p.y - q.y) >= 1.5) out.push(p); }
  if (out.length === 1 && pts.length > 1) out.push(pts[pts.length - 1]!);
  return out;
}
