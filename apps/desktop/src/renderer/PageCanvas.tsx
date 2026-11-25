import { useEffect, useRef, useState, type ReactNode } from 'react';
import { pdfjs, type PDFDocumentProxy } from './pdf.js';

/** A link on a page: an external address or a destination inside the document (pdf.js dest form). */
export type PageLink = { url: string } | { dest: unknown };
interface LinkBox { link: PageLink; left: number; top: number; width: number; height: number; title: string }

interface Props {
  doc: PDFDocumentProxy | null; // null = blank page
  pageIndex: number;
  /** absolute rotation to render with (page's own /Rotate + user rotation) */
  rotation: number;
  scale: number;
  width: number; // css px at this scale
  height: number;
  textLayer?: boolean;
  /** element whose viewport decides visibility (the scroll container) */
  root?: Element | null;
  /** when set, links on the page are clickable and reported here */
  onLink?: (link: PageLink) => void;
  /** drawn above the page image and below the text layer (search highlights) */
  children?: ReactNode;
  /** show only this part of the page (css px within width x height), e.g. a crop box */
  clip?: { x: number; y: number; width: number; height: number };
}

/**
 * Renders one page when it comes near the visible area and drops the pixels when it leaves,
 * so long documents keep a bounded number of canvases. Renders are cancelled when props change.
 */
export function PageCanvas({ doc, pageIndex, rotation, scale, width, height, textLayer, root, onLink, children, clip }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [links, setLinks] = useState<LinkBox[]>([]);
  const wantLinks = !!onLink;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { root: root ?? null, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !visible || !canvas) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let text: InstanceType<typeof pdfjs.TextLayer> | undefined;
    setFailed(false);
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale, rotation });
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      // keep very large zooms from allocating huge canvases
      const pxScale = Math.min(ratio, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
      canvas.width = Math.max(1, Math.floor(viewport.width * pxScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * pxScale));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      renderTask = page.render({ canvas: null, canvasContext: ctx, viewport, transform: pxScale !== 1 ? [pxScale, 0, 0, pxScale, 0, 0] : undefined });
      await renderTask.promise;
      if (cancelled) return;
      if (wantLinks) {
        const annots = await page.getAnnotations({ intent: 'display' });
        if (cancelled) return;
        const boxes: LinkBox[] = [];
        for (const a of annots as Array<{ subtype?: string; rect: number[]; url?: string; unsafeUrl?: string; dest?: unknown }>) {
          if (a.subtype !== 'Link') continue;
          const url = a.url ?? a.unsafeUrl;
          const link: PageLink | null = url ? { url } : a.dest != null ? { dest: a.dest } : null;
          if (!link) continue; // actions such as JavaScript or launching files are never offered
          // the rectangle's two opposite corners in the viewport (pdf.js 6 has the point conversion only)
          const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(a.rect[0] ?? 0, a.rect[1] ?? 0) as number[];
          const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(a.rect[2] ?? 0, a.rect[3] ?? 0) as number[];
          boxes.push({ link, left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), title: url ? url : 'Go to linked page' });
        }
        setLinks(boxes);
      }
      if (!textLayer || !textRef.current) return;
      const container = textRef.current;
      container.replaceChildren();
      container.style.setProperty('--scale-factor', String(scale));
      text = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
      await text.render();
    })().catch((err: unknown) => {
      if ((err as { name?: string })?.name === 'RenderingCancelledException' || cancelled) return;
      console.error(err);
      setFailed(true);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      text?.cancel();
      textRef.current?.replaceChildren();
      // release the pixel memory of pages that scrolled away
      canvas.width = 0; canvas.height = 0;
    };
  }, [doc, pageIndex, rotation, scale, visible, textLayer, wantLinks]);

  return (
    <div ref={box} className="page-surface" style={clip ? { width: clip.width, height: clip.height } : { width, height }}>
      <div className="page-inner" style={{ width, height, left: clip ? -clip.x : 0, top: clip ? -clip.y : 0 }}>
      {doc && <canvas ref={canvasRef} style={{ width, height }} aria-hidden="true" />}
      {doc && textLayer && <div ref={textRef} className="textLayer" />}
      {children}
      {visible && onLink && links.map((l, i) => (
        <button key={i} className="link-hit" title={l.title} aria-label={'url' in l.link ? `Link to ${l.title}` : l.title}
          style={{ left: l.left, top: l.top, width: l.width, height: l.height }}
          onClick={() => onLink(l.link)} />
      ))}
      </div>
      {failed && <div className="page-error">This page could not be displayed.</div>}
    </div>
  );
}
