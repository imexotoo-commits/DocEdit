/**
 * PDF to Word: rebuild the reading order of each page from its text (lines, paragraphs, headings) into a .docx.
 * A PDF stores positioned glyphs, not paragraphs, so this is a best-effort reflow: the text is editable,
 * the exact layout is not kept. Pages without text (scans) are included as pictures.
 */
import { zip, type ZipEntry } from './zip.js';

/** A piece of text on a page: position in PDF points (origin bottom-left), font size. */
export interface TextPiece { str: string; x: number; y: number; size: number; width: number; /** upright text only; rotated pieces get their own paragraph */ upright: boolean }

export type Block =
  | { kind: 'para'; text: string; size: number; heading: 0 | 1 | 2 }
  | { kind: 'image'; png: Uint8Array; width: number; height: number };

export interface DocPage { width: number; height: number; blocks: Block[] }

/** Group pieces into lines, lines into paragraphs; larger text becomes headings. */
export function reflow(pieces: TextPiece[]): Block[] {
  const items = pieces.filter((p) => p.str.trim() || p.str === ' ');
  if (!items.length) return [];
  // lines: same baseline within half a font size, read left to right
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; size: number; pieces: TextPiece[] }> = [];
  for (const p of sorted) {
    const line = lines.find((l) => p.upright && l.pieces[0]!.upright && Math.abs(l.y - p.y) < Math.max(l.size, p.size) * 0.5);
    if (line) { line.pieces.push(p); line.size = Math.max(line.size, p.size); }
    else lines.push({ y: p.y, size: p.size, pieces: [p] });
  }
  lines.sort((a, b) => b.y - a.y);
  const lineText = (l: (typeof lines)[number]) => {
    const ps = [...l.pieces].sort((a, b) => a.x - b.x);
    let s = '';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!, prev = ps[i - 1];
      if (prev && !s.endsWith(' ') && !p.str.startsWith(' ') && p.x - (prev.x + prev.width) > p.size * 0.2) s += ' ';
      s += p.str;
    }
    return s.replace(/\s+/g, ' ').trim();
  };
  // the most common size is the body text
  const counts = new Map<number, number>();
  for (const l of lines) { const k = Math.round(l.size); counts.set(k, (counts.get(k) ?? 0) + lineText(l).length); }
  const body = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  const level = (size: number): 0 | 1 | 2 => (size >= body * 1.6 ? 1 : size >= body * 1.25 ? 2 : 0);

  const out: Block[] = [];
  let para: { text: string; size: number; heading: 0 | 1 | 2; lastY: number } | null = null;
  for (const l of lines) {
    const text = lineText(l);
    if (!text) continue;
    const h = level(l.size);
    const gap = para ? para.lastY - l.y : 0;
    const joins = para && para.heading === h && h === 0 && Math.abs(para.size - l.size) < 1 && gap < l.size * 1.75;
    if (joins && para) {
      // a word broken at the end of a line keeps together
      para.text = para.text.endsWith('-') && /^[a-z]/.test(text) ? para.text.slice(0, -1) + text : `${para.text} ${text}`;
      para.lastY = l.y;
    } else {
      if (para) out.push({ kind: 'para', text: para.text, size: para.size, heading: para.heading });
      para = { text, size: l.size, heading: h, lastY: l.y };
    }
  }
  if (para) out.push({ kind: 'para', text: para.text, size: para.size, heading: para.heading });
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  // characters XML 1.0 does not allow
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
const EMU_PER_PT = 12700;

export async function buildDocx(pages: DocPage[], title: string): Promise<Uint8Array> {
  const media: ZipEntry[] = [];
  const rels: string[] = [];
  const body: string[] = [];
  const first = pages[0] ?? { width: 612, height: 792 };
  const margin = 72; // 1 inch
  const usable = { w: first.width - 2 * margin, h: first.height - 2 * margin };
  let pic = 0;
  pages.forEach((page, pi) => {
    if (pi > 0) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    for (const b of page.blocks) {
      if (b.kind === 'para') {
        const size = Math.round(Math.max(6, Math.min(72, b.size)) * 2); // half-points
        const style = b.heading ? `<w:pPr><w:pStyle w:val="Heading${b.heading}"/></w:pPr>` : '';
        const run = `<w:rPr>${b.heading ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
        body.push(`<w:p>${style}<w:r>${run}<w:t xml:space="preserve">${esc(b.text)}</w:t></w:r></w:p>`);
      } else {
        pic++;
        const id = `rIdImg${pic}`;
        media.push({ name: `word/media/page${pic}.png`, data: b.png, store: true });
        rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page${pic}.png"/>`);
        const k = Math.min(usable.w / b.width, usable.h / b.height, 1);
        const cx = Math.round(b.width * k * EMU_PER_PT), cy = Math.round(b.height * k * EMU_PER_PT);
        body.push(`<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${pic}" name="Page ${pi + 1}"/>`
          + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
          + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${pic}" name="page${pic}.png"/><pic:cNvPicPr/></pic:nvPicPr>`
          + `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
          + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
          + `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
      }
    }
  });
  const tw = (pt: number) => Math.round(pt * 20);
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${tw(first.width)}" w:h="${tw(first.height)}"${first.width > first.height ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(margin)}" w:right="${tw(margin)}" w:bottom="${tw(margin)}" w:left="${tw(margin)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>` },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/document.xml', data: document },
    ...media,
  ]);
}

/** Plain text: one block of lines per page, pages separated by a form feed (which most editors show as a page break). */
export function buildText(pages: DocPage[]): string {
  return pages.map((p) => p.blocks.flatMap((b) => (b.kind === 'para' ? [b.text] : [])).join('\r\n\r\n')).join('\r\n\f\r\n');
}
