import type { PendingEdit } from './edits.js';
import type { PageItem } from './model.js';

/** Every pending content edit, so the user can review, revisit, edit or remove them before saving. */
export function ChangesPanel({ edits, pages, selected, onSelect, onEditText, onDelete }: {
  edits: PendingEdit[]; pages: PageItem[]; selected: string | null;
  onSelect(e: PendingEdit): void; onEditText(e: PendingEdit): void; onDelete(e: PendingEdit): void;
}) {
  if (!edits.length) return <div className="panel-empty">No unsaved changes to the page content. Use the Review tools to comment, highlight, draw or sign.</div>;
  const pageOf = (id: string) => { const i = pages.findIndex((p) => p.id === id); return i < 0 ? 'removed page' : `page ${i + 1}`; };
  return (
    <ul className="changes" aria-label="Unsaved content changes">
      {edits.map((e) => {
        const d = describe(e);
        const where = 'pageId' in e ? pageOf(e.pageId) : 'pages' in e ? (e.pages === 'all' ? 'all pages' : `${e.pages.length} page${e.pages.length === 1 ? '' : 's'}`) : 'document';
        const editable = e.type === 'annotation' && (e.annotation.kind === 'note' || e.annotation.kind === 'freetext');
        return (
          <li key={e.id} className={e.id === selected ? 'selected' : ''}>
            <button className="change-main" onClick={() => onSelect(e)}>
              <span className="change-kind">{d.kind}</span>
              {d.text && <span className="change-text">{d.text}</span>}
              <span className="muted small">{where}</span>
            </button>
            {editable && <button onClick={() => onEditText(e)} aria-label={`Edit ${d.kind}`}>Edit</button>}
            <button onClick={() => onDelete(e)} aria-label={`Remove ${d.kind}`}>×</button>
          </li>
        );
      })}
    </ul>
  );
}

function describe(e: PendingEdit): { kind: string; text?: string } {
  switch (e.type) {
    case 'metadata': return { kind: 'Properties', text: Object.entries(e.meta).filter(([, v]) => v !== undefined).map(([k]) => k).join(', ') };
    case 'fill': return { kind: 'Form values', text: `${Object.keys(e.values).length} field${Object.keys(e.values).length === 1 ? '' : 's'}` };
    case 'watermark': return { kind: 'Watermark', text: e.text };
    case 'furniture': return { kind: 'Header/footer', text: e.items.map((i) => i.text).join(' · ') };
    case 'signature': return { kind: 'Visual signature', text: e.typedName };
    case 'link': return { kind: 'Link', text: 'url' in e.target ? e.target.url : 'to a page' };
    case 'redact': return { kind: 'Redaction mark (pending)', text: e.text };
    case 'mark': return { kind: { check: 'Tick', cross: 'Cross', dot: 'Dot', box: 'Box', line: 'Line' }[e.mark.shape] };
    case 'annotation': {
      const a = e.annotation;
      const names = { highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikeout', note: 'Note', freetext: 'Text box', square: 'Rectangle', circle: 'Ellipse', ink: 'Drawing' } as const;
      return { kind: names[a.kind], text: a.kind === 'note' || a.kind === 'freetext' ? a.text : 'note' in a ? a.note : undefined };
    }
  }
}
