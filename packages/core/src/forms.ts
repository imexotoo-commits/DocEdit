import { PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from '@cantoo/pdf-lib';
import { loadDoc, saveDoc } from './document.js';
import { DocEditError } from './errors.js';
import type { Pdf } from './types.js';

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'button' | 'signature' | 'unknown';
export interface FieldInfo { name: string; kind: FieldKind; value: string | boolean | string[] | null; options?: string[]; readOnly: boolean }

export async function listFormFields(pdf: Pdf): Promise<FieldInfo[]> {
  const form = (await loadDoc(pdf)).getForm();
  return form.getFields().map((f): FieldInfo => {
    const base = { name: f.getName(), readOnly: f.isReadOnly() };
    if (f instanceof PDFTextField) return { ...base, kind: 'text', value: f.getText() ?? '' };
    if (f instanceof PDFCheckBox) return { ...base, kind: 'checkbox', value: f.isChecked() };
    if (f instanceof PDFRadioGroup) return { ...base, kind: 'radio', value: f.getSelected() ?? null, options: f.getOptions() };
    if (f instanceof PDFDropdown) return { ...base, kind: 'dropdown', value: f.getSelected(), options: f.getOptions() };
    if (f instanceof PDFOptionList) return { ...base, kind: 'list', value: f.getSelected(), options: f.getOptions() };
    return { ...base, kind: f.constructor.name.includes('Signature') ? 'signature' : f.constructor.name.includes('Button') ? 'button' : 'unknown', value: null };
  });
}

/** Fill fields by name. Values: string (text/radio/dropdown), boolean (checkbox), string[] (list). */
export async function fillFormFields(pdf: Pdf, values: Record<string, string | boolean | string[]>, opts: { flatten?: boolean } = {}): Promise<Pdf> {
  const doc = await loadDoc(pdf);
  const form = doc.getForm();
  for (const [name, v] of Object.entries(values)) {
    const f = form.getFieldMaybe(name);
    if (!f) throw new DocEditError(`No form field named "${name}"`, 'NO_SUCH_FIELD');
    if (f instanceof PDFTextField) f.setText(String(v));
    else if (f instanceof PDFCheckBox) (v ? f.check() : f.uncheck());
    else if (f instanceof PDFRadioGroup) f.select(String(v));
    else if (f instanceof PDFDropdown) f.select(String(v));
    else if (f instanceof PDFOptionList) f.select(Array.isArray(v) ? v : [String(v)]);
    else throw new DocEditError(`Field "${name}" cannot be filled`, 'UNFILLABLE');
  }
  form.updateFieldAppearances();
  if (opts.flatten) form.flatten();
  return saveDoc(doc);
}

/** Turn form fields into plain page content (no longer editable). */
export async function flattenForm(pdf: Pdf): Promise<Pdf> {
  const doc = await loadDoc(pdf);
  doc.getForm().flatten();
  return saveDoc(doc);
}
