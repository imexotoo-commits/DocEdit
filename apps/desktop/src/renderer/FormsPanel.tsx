import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from './pdf.js';

/** A form field as the panel needs it (from pdf.js field objects). */
export interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'radiobutton' | 'combobox' | 'listbox' | 'signature' | 'button' | 'other';
  value: string | boolean | string[];
  options: Array<{ value: string; label: string }>;
  readOnly: boolean;
  multiline: boolean;
  multiple: boolean;
  /** first widget: page in the source document and rectangle in user space */
  page: number;
  rect: [number, number, number, number];
  /** for checkboxes and radio buttons: the value meaning "on" per widget */
  onValues: string[];
}

export interface FormInfo { fields: FormField[]; xfa: boolean }

type RawWidget = { name?: string; type?: string; value?: unknown; editable?: boolean; readOnly?: boolean; multiline?: boolean; multipleSelection?: boolean; page?: number; rect?: number[]; exportValues?: string; items?: Array<{ exportValue: string; displayValue: string }> };

export async function loadForm(doc: PDFDocumentProxy, bytes: Uint8Array): Promise<FormInfo> {
  const [objs, md, core] = await Promise.all([doc.getFieldObjects().catch(() => null), doc.getMetadata().catch(() => null), window.docedit.listFormFields(bytes).catch(() => [])]);
  const byName = new Map(core.map((f) => [f.name, f]));
  const xfa = !!(md?.info as Record<string, unknown> | undefined)?.IsXFAPresent;
  const fields: FormField[] = [];
  for (const [name, widgets] of Object.entries((objs ?? {}) as Record<string, RawWidget[]>)) {
    const w = widgets.find((x) => x.type) ?? widgets[0];
    if (!w) continue;
    const t = (['text', 'checkbox', 'radiobutton', 'combobox', 'listbox', 'signature', 'button'] as const).find((k) => k === w.type) ?? 'other';
    const onValues = widgets.map((x) => x.exportValues).filter((v): v is string => typeof v === 'string');
    let value: FormField['value'] = typeof w.value === 'string' ? w.value : Array.isArray(w.value) ? (w.value as string[]) : '';
    if (t === 'checkbox') value = !!w.value && w.value !== 'Off';
    // radio buttons: use the choice names the file defines (pdf.js reports internal button states)
    const c = byName.get(name);
    if (t === 'radiobutton' && c?.options?.length) { onValues.splice(0, onValues.length, ...c.options); value = typeof c.value === 'string' ? c.value : ''; }
    fields.push({
      name, type: t, value,
      options: (w.items ?? []).map((i) => ({ value: i.exportValue, label: i.displayValue })),
      readOnly: w.editable === false || !!w.readOnly, multiline: !!w.multiline, multiple: !!w.multipleSelection,
      page: w.page ?? 0, rect: (w.rect as [number, number, number, number]) ?? [0, 0, 0, 0], onValues,
    });
  }
  // reading order: by page, then top to bottom, then left to right
  fields.sort((a, b) => a.page - b.page || b.rect[3] - a.rect[3] || a.rect[0] - b.rect[0]);
  return { fields, xfa };
}

interface Props {
  form: FormInfo | null;
  /** values changed in this session (pending), by field name */
  pending: Record<string, string | boolean | string[]>;
  onChange(name: string, value: string | boolean | string[]): void;
  onReveal(field: FormField): void;
  onSaveFlattened(): void;
}

export function FormsPanel({ form, pending, onChange, onReveal, onSaveFlattened }: Props) {
  if (!form) return <div className="panel-empty">Reading form…</div>;
  const fillable = form.fields.filter((f) => f.type !== 'signature' && f.type !== 'button' && f.type !== 'other');
  return (
    <div className="forms-panel">
      {form.xfa && <div className="callout small"><p>This document also contains an XFA form. XFA forms are not supported; only the standard form fields below can be filled, and other programs may show the XFA version instead.</p></div>}
      {!fillable.length && <div className="panel-empty">This document has no fillable form fields.</div>}
      <form className="fields" onSubmit={(e) => e.preventDefault()}>
        {fillable.map((f) => <FieldInput key={f.name} field={f} value={f.name in pending ? pending[f.name]! : f.value} onChange={(v) => onChange(f.name, v)} onFocus={() => onReveal(f)} />)}
      </form>
      {fillable.length > 0 && (
        <div className="forms-footer">
          <button onClick={onSaveFlattened} title="Save a copy where the fields become plain page content">Save flattened copy…</button>
        </div>
      )}
    </div>
  );
}

function FieldInput({ field: f, value, onChange, onFocus }: { field: FormField; value: FormField['value']; onChange(v: FormField['value']): void; onFocus(): void }) {
  const [text, setText] = useState(typeof value === 'string' ? value : '');
  useEffect(() => { if (typeof value === 'string') setText(value); }, [value]);
  const label = <span className="field-name">{f.name}{f.readOnly ? ' (read-only)' : ''}</span>;
  if (f.type === 'checkbox') {
    return <label className="field check-field" data-field={f.name}><input type="checkbox" checked={value === true} disabled={f.readOnly} onFocus={onFocus} onChange={(e) => onChange(e.target.checked)} /> {label}</label>;
  }
  if (f.type === 'radiobutton') {
    return (
      <fieldset className="field" data-field={f.name} disabled={f.readOnly}>
        <legend>{label}</legend>
        {f.onValues.map((v) => <label key={v}><input type="radio" name={`radio-${f.name}`} checked={value === v} onFocus={onFocus} onChange={() => onChange(v)} /> {v}</label>)}
      </fieldset>
    );
  }
  if (f.type === 'combobox' || f.type === 'listbox') {
    const multiple = f.type === 'listbox' && f.multiple;
    return (
      <label className="field" data-field={f.name}>{label}
        <select multiple={multiple} disabled={f.readOnly} onFocus={onFocus}
          value={multiple ? (Array.isArray(value) ? value : [String(value)]) : Array.isArray(value) ? value[0] ?? '' : String(value)}
          onChange={(e) => onChange(multiple ? [...e.target.selectedOptions].map((o) => o.value) : e.target.value)}>
          {!multiple && <option value="">—</option>}
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  const commit = () => { if (text !== value) onChange(text); };
  return (
    <label className="field" data-field={f.name}>{label}
      {f.multiline
        ? <textarea rows={3} value={text} disabled={f.readOnly} onFocus={onFocus} onChange={(e) => setText(e.target.value)} onBlur={commit} />
        : <input type="text" value={text} disabled={f.readOnly} onFocus={onFocus} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />}
    </label>
  );
}
