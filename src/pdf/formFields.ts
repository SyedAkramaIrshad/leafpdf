import type { PDFDocumentProxy } from 'pdfjs-dist'

export type FormFieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown'

/** One visible widget of an AcroForm field, as found on a specific page. */
export interface FormFieldWidget {
  /** pdf.js annotation id, unique on its page. */
  id: string
  /** Fully qualified field name — the key used in `EditorDocument.formValues`. */
  fieldName: string
  kind: FormFieldKind
  /** PDF user-space rectangle; the form layer converts it to view coordinates. */
  rect: [number, number, number, number]
  multiLine: boolean
  readOnly: boolean
  /** Dropdown choices. `exportValue` is what the PDF stores when selected. */
  options: Array<{ exportValue: string; displayValue: string }>
  /** The on-state a checkbox or radio widget writes when selected. */
  onValue: string
  initialValue: string | boolean
}

/**
 * The slice of a pdf.js Widget annotation this module reads. pdf.js does not
 * export a type for annotation records, so the shape is narrowed defensively:
 * anything missing or mistyped makes the widget unfillable rather than crashing.
 */
interface RawWidget {
  id?: unknown
  subtype?: unknown
  fieldType?: unknown
  fieldName?: unknown
  fieldValue?: unknown
  buttonValue?: unknown
  exportValue?: unknown
  checkBox?: unknown
  radioButton?: unknown
  pushButton?: unknown
  hidden?: unknown
  readOnly?: unknown
  multiLine?: unknown
  combo?: unknown
  options?: unknown
  rect?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asRect(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  return value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ? (value as [number, number, number, number])
    : null
}

function widgetOptions(value: unknown): Array<{ exportValue: string; displayValue: string }> {
  if (!Array.isArray(value)) return []
  const options: Array<{ exportValue: string; displayValue: string }> = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as { exportValue?: unknown; displayValue?: unknown }
    const exportValue = asString(record.exportValue) ?? asString(record.displayValue)
    if (exportValue === null) continue
    options.push({ exportValue, displayValue: asString(record.displayValue) ?? exportValue })
  }
  return options
}

function mapWidget(raw: RawWidget | null | undefined): FormFieldWidget | null {
  if (typeof raw !== 'object' || raw === null) return null
  if (raw.subtype !== 'Widget' || raw.hidden === true) return null
  const fieldName = asString(raw.fieldName)
  const rect = asRect(raw.rect)
  const id = asString(raw.id)
  if (!fieldName || !rect || !id) return null

  const base = {
    id,
    fieldName,
    rect,
    multiLine: raw.multiLine === true,
    readOnly: raw.readOnly === true,
    options: [] as FormFieldWidget['options'],
  }

  if (raw.fieldType === 'Tx') {
    return { ...base, kind: 'text', onValue: '', initialValue: asString(raw.fieldValue) ?? '' }
  }
  if (raw.fieldType === 'Btn') {
    // Push buttons run actions; they hold no value to fill.
    if (raw.pushButton === true) return null
    const onValue = asString(raw.exportValue) ?? asString(raw.buttonValue) ?? 'Yes'
    if (raw.radioButton === true) {
      return { ...base, kind: 'radio', onValue, initialValue: asString(raw.fieldValue) ?? '' }
    }
    return { ...base, kind: 'checkbox', onValue, initialValue: asString(raw.fieldValue) === onValue }
  }
  if (raw.fieldType === 'Ch') {
    // Multi-select list boxes are out of scope; a combo or single-select list
    // maps cleanly onto one stored string.
    const value = Array.isArray(raw.fieldValue) ? asString(raw.fieldValue[0]) : asString(raw.fieldValue)
    return { ...base, kind: 'dropdown', options: widgetOptions(raw.options), onValue: '', initialValue: value ?? '' }
  }
  // Signature fields and unknown types are deliberately not fillable.
  return null
}

/**
 * Read the fillable form widgets on one page. Called lazily per page so opening
 * a large document never scans every page up front; export only needs the values
 * the user actually changed, which live in the editor document.
 */
export async function readPageFormFields(pdf: PDFDocumentProxy, pageNumber: number): Promise<FormFieldWidget[]> {
  const page = await pdf.getPage(pageNumber)
  const annotations = (await page.getAnnotations({ intent: 'display' })) as RawWidget[]
  const widgets: FormFieldWidget[] = []
  for (const raw of annotations) {
    const widget = mapWidget(raw)
    if (widget) widgets.push(widget)
  }
  return widgets
}
