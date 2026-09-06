import { describe, expect, it } from 'vitest'
import * as pako from 'pako'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, degrees } from 'pdf-lib'
import { createEditorState, editorReducer, hasRedactions } from '../model/editor'
import { exportEditedPdf, exportedFileName } from './exportPdf'

async function decodedPdfContent(bytes: Uint8Array): Promise<string> {
  const document = await PDFDocument.load(bytes.slice())
  let text = new TextDecoder('latin1').decode(bytes)
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue
    const raw = object.getContents()
    try {
      text += new TextDecoder('latin1').decode(pako.inflate(raw))
    } catch {
      text += new TextDecoder('latin1').decode(raw)
    }
  }
  return text
}

/**
 * True when any byte run of the PDF carries `marker`, in either of the two
 * encodings pdf-lib emits text with: a literal string or a hex string. Content
 * streams are FlateDecode-compressed, so every stream is inflated before the
 * search — a raw byte scan alone cannot prove text absent.
 */
async function streamsContain(bytes: Uint8Array, marker: string): Promise<boolean> {
  const text = await decodedPdfContent(bytes)
  const hex = Array.from(marker, (character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return text.includes(marker) || text.toLowerCase().includes(hex)
}

function liveAnnotationSubtypes(document: PDFDocument): string[] {
  const subtypes: string[] = []
  for (const page of document.getPages()) {
    const value = page.node.get(PDFName.of('Annots'))
    const annotations = value instanceof PDFRef ? document.context.lookup(value) : value
    if (!(annotations instanceof PDFArray)) continue
    for (let index = 0; index < annotations.size(); index += 1) {
      const entry = annotations.get(index)
      const annotation = entry instanceof PDFRef ? document.context.lookup(entry) : entry
      if (!(annotation instanceof PDFDict)) throw new Error(`Dangling page annotation reference: ${String(entry)}`)
      const subtype = annotation.get(PDFName.of('Subtype'))
      if (subtype instanceof PDFName) subtypes.push(subtype.asString())
    }
  }
  return subtypes
}

describe('exportEditedPdf', () => {
  it('preserves existing annotations and adds a normalized link on a rotated page', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    page.setRotation(degrees(90))
    const note = source.context.obj({
      Type: PDFName.of('Annot'), Subtype: PDFName.of('Text'), Rect: [10, 10, 30, 30],
    })
    page.node.set(
      PDFName.of('Annots'),
      source.context.obj([source.context.register(note)]) as PDFArray,
    )
    const sourceBytes = await source.save()
    let state = createEditorState('linked.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'link-1', pageId: 'page-1', kind: 'link', x: 0.1, y: 0.2,
        width: 0.3, height: 0.1, targetType: 'url', target: 'example.com/offer',
      },
    })

    const output = await exportEditedPdf(sourceBytes, state.present)
    const reopened = await PDFDocument.load(output)
    const annotsValue = reopened.getPage(0).node.get(PDFName.of('Annots'))
    const annots = annotsValue instanceof PDFRef ? reopened.context.lookup(annotsValue) : annotsValue
    expect(annots).toBeInstanceOf(PDFArray)
    const dictionaries = Array.from({ length: (annots as PDFArray).size() }, (_, index) => {
      const entry = (annots as PDFArray).get(index)
      const dictionary = entry instanceof PDFRef ? reopened.context.lookup(entry) : entry
      if (!(dictionary instanceof PDFDict)) throw new Error('Expected an annotation dictionary.')
      return dictionary
    })
    expect(dictionaries.map((annotation) =>
      (annotation.get(PDFName.of('Subtype')) as PDFName).asString())).toEqual(['/Text', '/Link'])
    const link = dictionaries[1]
    const action = link.get(PDFName.of('A')) as PDFDict
    expect((action.get(PDFName.of('URI')) as PDFString).decodeText()).toBe('https://example.com/offer')
    const rectangle = link.get(PDFName.of('Rect')) as PDFArray
    expect(Array.from({ length: rectangle.size() }, (_, index) =>
      (rectangle.get(index) as PDFNumber).asNumber())).toEqual([80, 50, 120, 200])
  })

  it('adds link annotations when page changes require a rebuilt copy', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.addPage([400, 500])
    const sourceBytes = await source.save()
    let state = createEditorState('reordered-links.pdf', 2)
    state = editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'link-2', pageId: 'page-2', kind: 'link', x: 0.2, y: 0.25,
        width: 0.4, height: 0.08, targetType: 'email', target: 'hello@example.com',
      },
    })

    const output = await exportEditedPdf(sourceBytes, state.present, { allowCompatibilityCopy: true })
    const reopened = await PDFDocument.load(output)
    const annots = reopened.getPage(0).node.get(PDFName.of('Annots')) as PDFArray
    expect(annots).toBeInstanceOf(PDFArray)
    const entry = annots.get(0)
    const link = (entry instanceof PDFRef ? reopened.context.lookup(entry) : entry) as PDFDict
    const action = link.get(PDFName.of('A')) as PDFDict
    expect((link.get(PDFName.of('Subtype')) as PDFName).asString()).toBe('/Link')
    expect((action.get(PDFName.of('URI')) as PDFString).decodeText()).toBe('mailto:hello@example.com')
  })

  it('paints whiteout as opaque white while retaining the covered source content', async () => {
    const marker = 'WHITEOUT-SOURCE-MARKER-XYZ'
    const source = await PDFDocument.create()
    source.addPage([400, 500]).drawText(marker, { x: 40, y: 430 })
    const sourceBytes = await source.save()
    expect(await streamsContain(sourceBytes, marker)).toBe(true)

    let state = createEditorState('correction.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'whiteout-1', pageId: 'page-1', kind: 'whiteout', x: 0.08, y: 0.08,
        width: 0.64, height: 0.08,
      },
    })
    expect(hasRedactions(state.present)).toBe(false)

    const output = await exportEditedPdf(sourceBytes, state.present)

    expect((await PDFDocument.load(output)).getPageCount()).toBe(1)
    expect(await streamsContain(output, marker)).toBe(true)
    const content = await decodedPdfContent(output)
    expect(content).toMatch(/1 1 1 rg[\s\S]*\b(?:re|m)\b[\s\S]*\bf\b/)
  })

  it('exports underline and strikeout marks as stroked lines at their semantic positions', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    const sourceBytes = await source.save()
    let state = createEditorState('review-marks.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'underline-1', pageId: 'page-1', kind: 'highlight', mark: 'underline',
        x: 0.3, y: 0.2, width: 0.4, height: 0.1, rotation: 90,
        color: '#3157d5', opacity: 1, strokeWidth: 3,
      },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'strikeout-1', pageId: 'page-1', kind: 'highlight', mark: 'strikeout',
        x: 0.1, y: 0.4, width: 0.4, height: 0.1,
        color: '#b54434', opacity: 0.75, strokeWidth: 2,
      },
    })

    const output = await exportEditedPdf(sourceBytes, state.present)
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1)
    const content = await decodedPdfContent(output)
    expect(content).toMatch(/79(?:\.\d+)? 400 m\s+79(?:\.\d+)? 240 l\s+S/)
    expect(content).toMatch(/40 275 m\s+200 275 l\s+S/)
    expect(content).toMatch(/\b3 w\b/)
    expect(content).toMatch(/\b2 w\b/)
  })

  it('exports shapes and fill symbols as real page content', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    const sourceBytes = await source.save()
    let state = createEditorState('markup.pdf', 1)
    const annotations = [
      { id: 'rect', pageId: 'page-1', kind: 'shape' as const, shape: 'rectangle' as const, x: 0.1, y: 0.1, width: 0.25, height: 0.12, strokeColor: '#3157d5', fillColor: '#dce5ff', strokeWidth: 2 },
      { id: 'ellipse', pageId: 'page-1', kind: 'shape' as const, shape: 'ellipse' as const, x: 0.4, y: 0.1, width: 0.2, height: 0.12, strokeColor: '#3157d5', strokeWidth: 2 },
      { id: 'line', pageId: 'page-1', kind: 'shape' as const, shape: 'line' as const, x: 0.1, y: 0.3, width: 0.25, height: 0.08, strokeColor: '#182026', strokeWidth: 2 },
      { id: 'arrow', pageId: 'page-1', kind: 'shape' as const, shape: 'arrow' as const, x: 0.4, y: 0.3, width: 0.25, height: 0.08, strokeColor: '#182026', strokeWidth: 2 },
      { id: 'check', pageId: 'page-1', kind: 'stamp' as const, stamp: 'check' as const, x: 0.1, y: 0.5, width: 0.06, height: 0.05, color: '#1f7a4f', strokeWidth: 3 },
      { id: 'cross', pageId: 'page-1', kind: 'stamp' as const, stamp: 'cross' as const, x: 0.2, y: 0.5, width: 0.05, height: 0.05, color: '#b3261e', strokeWidth: 3 },
      { id: 'dot', pageId: 'page-1', kind: 'stamp' as const, stamp: 'dot' as const, x: 0.3, y: 0.5, width: 0.04, height: 0.04, color: '#182026', strokeWidth: 2 },
      { id: 'date', pageId: 'page-1', kind: 'stamp' as const, stamp: 'date' as const, label: '31/07/2026', dateValue: '2026-08-30', dateFormat: 'day-month' as const, x: 0.4, y: 0.5, width: 0.25, height: 0.06, color: '#182026', strokeWidth: 2 },
    ]
    for (const annotation of annotations) {
      state = editorReducer(state, { type: 'addAnnotation', annotation })
    }

    const output = await exportEditedPdf(sourceBytes, state.present)
    expect(output.byteLength).toBeGreaterThan(sourceBytes.byteLength + 400)
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1)
    expect(await streamsContain(output, '31/07/2026')).toBe(true)
    expect(await streamsContain(output, '30 Aug 2026')).toBe(false)
  })

  it('copies reordered pages, applies rotation, and paints annotations', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500]).drawText('First page')
    source.addPage([500, 400]).drawText('Second page')
    const sourceBytes = await source.save()

    let state = createEditorState('sample.pdf', 2)
    state = editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 })
    state = editorReducer(state, { type: 'rotatePage', pageId: 'page-2', degrees: 90 })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'text-1', pageId: 'page-2', kind: 'text', x: 0.1, y: 0.12,
        width: 0.4, height: 0.08, text: 'Approved', color: '#182026', fontSize: 18,
      },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'highlight-1', pageId: 'page-1', kind: 'highlight', x: 0.2, y: 0.25,
        width: 0.45, height: 0.06, color: '#ffd447', opacity: 0.4,
      },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'ink-1', pageId: 'page-1', kind: 'ink', x: 0, y: 0, width: 1, height: 1,
        points: [{ x: 0.1, y: 0.8 }, { x: 0.4, y: 0.75 }, { x: 0.6, y: 0.82 }],
        color: '#3157d5', strokeWidth: 3,
      },
    })

    const output = await exportEditedPdf(sourceBytes, state.present)
    const reopened = await PDFDocument.load(output)
    expect(reopened.getPageCount()).toBe(2)
    expect(reopened.getPage(0).getSize()).toEqual({ width: 500, height: 400 })
    expect(reopened.getPage(0).getRotation().angle).toBe(90)
    expect(output.byteLength).toBeGreaterThan(sourceBytes.byteLength)
  })

  it('removes redacted page content from the exported bytes entirely', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500]).drawText('CONFIDENTIAL-MARKER-XYZ')
    source.addPage([400, 500]).drawText('SECOND-PAGE-STAYS')
    const sourceBytes = await source.save()
    // The marker must be provably present in the input, or absence proves nothing.
    expect(await streamsContain(sourceBytes, 'CONFIDENTIAL-MARKER-XYZ')).toBe(true)

    let state = createEditorState('secret.pdf', 2)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: { id: 'redact-1', pageId: 'page-1', kind: 'redaction', x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
    })

    // A 1x1 PNG stands in for the burned bitmap: the safety property under test
    // is that the original page objects never reach the output, not image fidelity.
    const png = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ), (character) => character.charCodeAt(0)).buffer as ArrayBuffer

    const output = await exportEditedPdf(sourceBytes, state.present, {
      rasterizedPages: new Map([['page-1', { width: 400, height: 500, png }]]),
    })
    expect(await streamsContain(output, 'CONFIDENTIAL-MARKER-XYZ')).toBe(false)
    expect(await streamsContain(output, 'SECOND-PAGE-STAYS')).toBe(true)
    const reopened = await PDFDocument.load(output)
    expect(reopened.getPageCount()).toBe(2)
  })

  it('refuses to export a redacted page whose bitmap is missing', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500]).drawText('CONFIDENTIAL-MARKER-XYZ')
    const sourceBytes = await source.save()

    let state = createEditorState('secret.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: { id: 'redact-1', pageId: 'page-1', kind: 'redaction', x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
    })
    // No rasterizedPages supplied: the export must stop, never fall back to
    // copying the original page.
    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/redacted page was not rasterized/)
  })

  it('inserts blank pages in place while keeping the source catalog', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500]).drawText('First')
    source.addPage([400, 500]).drawText('Second')
    source.setTitle('Preserve me')
    const sourceBytes = await source.save()

    let state = createEditorState('doc.pdf', 2)
    state = editorReducer(state, {
      type: 'insertPages',
      afterPageId: 'page-1',
      pages: [{ id: 'page-blank', kind: 'blank', width: 300, height: 200, rotation: 0 }],
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'text-1', pageId: 'page-blank', kind: 'text', x: 0.1, y: 0.1,
        width: 0.6, height: 0.2, text: 'On the new page', color: '#182026', fontSize: 14,
      },
    })

    const output = await exportEditedPdf(sourceBytes, state.present)
    const reopened = await PDFDocument.load(output)
    expect(reopened.getPageCount()).toBe(3)
    expect(reopened.getPage(1).getSize()).toEqual({ width: 300, height: 200 })
    // In-place insertion keeps the catalog, so the title survives.
    expect(reopened.getTitle()).toBe('Preserve me')
  })

  it('merges pages copied from an inserted PDF', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    const sourceBytes = await source.save()

    const donor = await PDFDocument.create()
    donor.addPage([222, 333]).drawText('Donor one')
    donor.addPage([250, 350]).drawText('Donor two')
    const donorBytes = await donor.save()

    let state = createEditorState('doc.pdf', 1)
    state = editorReducer(state, {
      type: 'insertPages',
      afterPageId: 'page-1',
      pages: [0, 1].map((sourceIndex) => ({
        id: `page-donor-${sourceIndex}`,
        kind: 'external',
        documentId: 'inserted-1',
        sourceIndex,
        rotation: 0,
      })),
    })

    const output = await exportEditedPdf(sourceBytes, state.present, {
      insertedDocuments: new Map([['inserted-1', donorBytes]]),
    })
    const reopened = await PDFDocument.load(output)
    expect(reopened.getPageCount()).toBe(3)
    expect(reopened.getPage(1).getSize()).toEqual({ width: 222, height: 333 })
    expect(reopened.getPage(2).getSize()).toEqual({ width: 250, height: 350 })
  })

  it('exports a document whose original pages were all deleted', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500]).drawText('Original to be deleted')
    const sourceBytes = await source.save()

    const donor = await PDFDocument.create()
    donor.addPage([300, 300]).drawText('Inserted survivor')
    const donorBytes = await donor.save()

    let state = createEditorState('replaced.pdf', 1)
    state = editorReducer(state, {
      type: 'insertPages',
      afterPageId: 'page-1',
      pages: [{ id: 'page-donor', kind: 'external', documentId: 'inserted-1', sourceIndex: 0, rotation: 0 }],
    })
    // Two pages exist, so the last-page guard allows deleting the original.
    state = editorReducer(state, { type: 'removePage', pageId: 'page-1' })
    expect(state.present.pages.map(({ id }) => id)).toEqual(['page-donor'])

    const output = await exportEditedPdf(sourceBytes, state.present, {
      insertedDocuments: new Map([['inserted-1', donorBytes]]),
    })
    const reopened = await PDFDocument.load(output)
    expect(reopened.getPageCount()).toBe(1)
    expect(reopened.getPage(0).getSize()).toEqual({ width: 300, height: 300 })
  })

  it('redacts a page that carries source rotation and user rotation', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    page.drawText('ROTATED-SECRET-MARKER')
    page.setRotation(degrees(90))
    const sourceBytes = await source.save()
    expect(await streamsContain(sourceBytes, 'ROTATED-SECRET-MARKER')).toBe(true)

    let state = createEditorState('rotated.pdf', 1)
    state = editorReducer(state, { type: 'rotatePage', pageId: 'page-1', degrees: 90 })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: { id: 'redact-1', pageId: 'page-1', kind: 'redaction', x: 0, y: 0, width: 1, height: 1 },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'note-1', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.1,
        width: 0.4, height: 0.1, text: 'On top of the raster', color: '#ffffff', fontSize: 12,
      },
    })

    const png = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ), (character) => character.charCodeAt(0)).buffer as ArrayBuffer
    // Source /Rotate 90 + user 90 = upside down, still 400x500 in raw size; the
    // raster is taken at display orientation, so its page is 400x500 unrotated.
    const output = await exportEditedPdf(sourceBytes, state.present, {
      rasterizedPages: new Map([['page-1', { width: 400, height: 500, png }]]),
    })
    expect(await streamsContain(output, 'ROTATED-SECRET-MARKER')).toBe(false)
    const reopened = await PDFDocument.load(output)
    expect(reopened.getPage(0).getRotation().angle % 360).toBe(0)
    expect(reopened.getPage(0).getSize()).toEqual({ width: 400, height: 500 })
  })

  it('keeps an inserted page\'s own rotation and adds the user\'s on top', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    const sourceBytes = await source.save()

    const donor = await PDFDocument.create()
    const donorPage = donor.addPage([300, 200])
    donorPage.setRotation(degrees(90))
    const donorBytes = await donor.save()

    let state = createEditorState('rotations.pdf', 1)
    state = editorReducer(state, {
      type: 'insertPages',
      afterPageId: 'page-1',
      pages: [{ id: 'page-donor', kind: 'external', documentId: 'd', sourceIndex: 0, rotation: 0 }],
    })
    state = editorReducer(state, { type: 'rotatePage', pageId: 'page-donor', degrees: 90 })

    const output = await exportEditedPdf(sourceBytes, state.present, {
      insertedDocuments: new Map([['d', donorBytes]]),
    })
    const reopened = await PDFDocument.load(output)
    expect(reopened.getPageCount()).toBe(2)
    // Donor /Rotate 90 + user 90 must compose to 180.
    expect(reopened.getPage(1).getRotation().angle % 360).toBe(180)
  })

  it('fails clearly when an inserted PDF is missing at export time', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    const sourceBytes = await source.save()

    let state = createEditorState('doc.pdf', 1)
    state = editorReducer(state, {
      type: 'insertPages',
      afterPageId: 'page-1',
      pages: [{ id: 'page-x', kind: 'external', documentId: 'gone', sourceIndex: 0, rotation: 0 }],
    })
    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/no longer available/)
  })

  it('writes filled values into the real AcroForm fields', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    const form = source.getForm()
    const nameField = form.createTextField('owner.name')
    nameField.addToPage(page, { x: 40, y: 400, width: 200, height: 24 })
    const agree = form.createCheckBox('owner.agrees')
    agree.addToPage(page, { x: 40, y: 360, width: 18, height: 18 })
    const colour = form.createDropdown('owner.colour')
    colour.addOptions(['Green', 'Blue'])
    colour.addToPage(page, { x: 40, y: 320, width: 120, height: 22 })
    const sourceBytes = await source.save()

    let state = createEditorState('form.pdf', 1)
    state = editorReducer(state, { type: 'setFormValue', fieldName: 'owner.name', value: 'Syed Akrama' })
    state = editorReducer(state, { type: 'setFormValue', fieldName: 'owner.agrees', value: true })
    state = editorReducer(state, { type: 'setFormValue', fieldName: 'owner.colour', value: 'Blue' })

    const output = await exportEditedPdf(sourceBytes, state.present)
    const reopened = await PDFDocument.load(output)
    const reopenedForm = reopened.getForm()
    expect(reopenedForm.getTextField('owner.name').getText()).toBe('Syed Akrama')
    expect(reopenedForm.getCheckBox('owner.agrees').isChecked()).toBe(true)
    expect(reopenedForm.getDropdown('owner.colour').getSelected()).toEqual(['Blue'])
  })

  it('keeps source form controls fillable by default and removes them only for flattened output', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    const form = source.getForm()
    form.createTextField('offer.name').addToPage(page, { x: 40, y: 410, width: 220, height: 24 })
    form.createCheckBox('offer.accepted').addToPage(page, { x: 40, y: 370, width: 18, height: 18 })
    const relocation = form.createRadioGroup('offer.relocation')
    relocation.addOptionToPage('Yes', page, { x: 40, y: 330, width: 18, height: 18 })
    relocation.addOptionToPage('No', page, { x: 80, y: 330, width: 18, height: 18 })
    const office = form.createDropdown('offer.office')
    office.addOptions(['Dubai', 'Abu Dhabi'])
    office.addToPage(page, { x: 40, y: 290, width: 140, height: 22 })
    const sourceBytes = await source.save()

    let state = createEditorState('offer.pdf', 1)
    state = editorReducer(state, { type: 'setFormValue', fieldName: 'offer.name', value: 'Browser verified' })
    state = editorReducer(state, { type: 'setFormValue', fieldName: 'offer.accepted', value: true })
    state = editorReducer(state, { type: 'setFormValue', fieldName: 'offer.relocation', value: 'No' })
    state = editorReducer(state, { type: 'setFormValue', fieldName: 'offer.office', value: 'Abu Dhabi' })

    const fillable = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
    expect(fillable.getForm().getFields()).toHaveLength(4)
    expect(fillable.getForm().getTextField('offer.name').getText()).toBe('Browser verified')
    expect(fillable.getForm().getRadioGroup('offer.relocation').getSelected()).toBe('No')

    const flattenedBytes = await exportEditedPdf(sourceBytes, state.present, { formOutput: 'flattened' })
    const flattened = await PDFDocument.load(flattenedBytes)
    const acroForm = flattened.catalog.lookup(PDFName.of('AcroForm'), PDFDict)
    expect(acroForm.lookup(PDFName.of('Fields'), PDFArray).size()).toBe(0)
    expect(flattened.getForm().getFields()).toHaveLength(0)
    expect(liveAnnotationSubtypes(flattened)).not.toContain('/Widget')
    expect(await streamsContain(flattenedBytes, 'Browser verified')).toBe(true)
    expect(await streamsContain(flattenedBytes, 'Abu Dhabi')).toBe(true)
  })

  it('flattens created controls on both preserved and rebuilt exports', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.addPage([400, 500])
    const sourceBytes = await source.save()

    let preserved = createEditorState('created-preserved.pdf', 2)
    preserved = editorReducer(preserved, {
      type: 'addAnnotation',
      annotation: {
        id: 'created-name', pageId: 'page-1', kind: 'form-field', fieldType: 'text',
        fieldName: 'created.name', x: 0.1, y: 0.2, width: 0.5, height: 0.08,
        required: false, defaultText: 'Applicant', multiline: false,
      },
    })
    const preservedBytes = await exportEditedPdf(sourceBytes, preserved.present, { formOutput: 'flattened' })
    expect((await PDFDocument.load(preservedBytes)).getForm().getFields()).toHaveLength(0)
    expect(await streamsContain(preservedBytes, 'Applicant')).toBe(true)

    let rebuilt = createEditorState('created-rebuilt.pdf', 2)
    rebuilt = editorReducer(rebuilt, { type: 'movePage', pageId: 'page-2', direction: -1 })
    rebuilt = editorReducer(rebuilt, {
      type: 'addAnnotation',
      annotation: {
        id: 'created-office', pageId: 'page-2', kind: 'form-field', fieldType: 'dropdown',
        fieldName: 'created.office', options: ['Dubai', 'Bengaluru'], defaultOption: 'Dubai',
        x: 0.1, y: 0.3, width: 0.5, height: 0.08, required: true,
      },
    })
    const rebuiltBytes = await exportEditedPdf(sourceBytes, rebuilt.present, { formOutput: 'flattened' })
    expect((await PDFDocument.load(rebuiltBytes)).getForm().getFields()).toHaveLength(0)
    expect(await streamsContain(rebuiltBytes, 'Dubai')).toBe(true)
  })

  it('does not invent an AcroForm when flattening a PDF with no form controls', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500]).drawText('Plain PDF')
    const sourceBytes = await source.save()
    const state = createEditorState('plain.pdf', 1)

    const output = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present, {
      formOutput: 'flattened',
    }))

    expect(output.catalog.get(PDFName.of('AcroForm'))).toBeUndefined()
  })

  it('creates native text and checkbox fields on a rotated preserved page', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    page.setRotation(degrees(90))
    const sourceForm = source.getForm()
    sourceForm.createTextField('source.owner').addToPage(page, { x: 20, y: 20, width: 120, height: 20 })
    const sourceBytes = await source.save()

    let state = createEditorState('make-fillable.pdf', 1)
    state = editorReducer(state, { type: 'setFormValue', fieldName: 'source.owner', value: 'Syed' })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'created-text', pageId: 'page-1', kind: 'form-field', fieldType: 'text',
        fieldName: 'leafpdf.text.1', x: 0.1, y: 0.2, width: 0.3, height: 0.1,
        required: true, defaultText: 'Applicant', multiline: true,
      },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'created-checkbox', pageId: 'page-1', kind: 'form-field', fieldType: 'checkbox',
        fieldName: 'leafpdf.checkbox.1', x: 0.7, y: 0.5, width: 0.08, height: 0.1,
        required: false, checkedByDefault: true,
      },
    })

    const output = await exportEditedPdf(sourceBytes, state.present)
    const reopened = await PDFDocument.load(output)
    const form = reopened.getForm()
    expect(form.getFields().map((field) => field.getName()).sort()).toEqual([
      'leafpdf.checkbox.1', 'leafpdf.text.1', 'source.owner',
    ])
    expect(form.getTextField('source.owner').getText()).toBe('Syed')
    const text = form.getTextField('leafpdf.text.1')
    expect(text.getText()).toBe('Applicant')
    expect(text.isRequired()).toBe(true)
    expect(text.isMultiline()).toBe(true)
    const textWidget = text.acroField.getWidgets()[0]
    expect(textWidget.getRectangle()).toEqual({
      x: expect.closeTo(80, 8), y: expect.closeTo(50, 8),
      width: expect.closeTo(40, 8), height: expect.closeTo(150, 8),
    })
    expect(textWidget.getAppearanceCharacteristics()?.getRotation()).toBe(90)

    const checkbox = form.getCheckBox('leafpdf.checkbox.1')
    expect(checkbox.isChecked()).toBe(true)
    expect(checkbox.isRequired()).toBe(false)
    expect(checkbox.acroField.getWidgets()[0].getRectangle()).toEqual({
      x: expect.closeTo(200, 8), y: expect.closeTo(350, 8),
      width: expect.closeTo(40, 8), height: expect.closeTo(40, 8),
    })
  })

  it('creates one native radio group and a native dropdown that remain fillable', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    page.setRotation(degrees(90))
    source.getForm().createTextField('source.owner').addToPage(page, { x: 20, y: 20, width: 120, height: 20 })
    const sourceBytes = await source.save()
    let state = createEditorState('choices.pdf', 1)
    for (const annotation of [
      {
        id: 'radio-yes', pageId: 'page-1', kind: 'form-field' as const, fieldType: 'radio' as const,
        fieldName: 'relocation', optionValue: 'Yes', selectedByDefault: true,
        x: 0.1, y: 0.3, width: 0.05, height: 0.0625, required: true,
      },
      {
        id: 'radio-no', pageId: 'page-1', kind: 'form-field' as const, fieldType: 'radio' as const,
        fieldName: 'relocation', optionValue: 'No', selectedByDefault: false,
        x: 0.2, y: 0.3, width: 0.05, height: 0.0625, required: true,
      },
      {
        id: 'location', pageId: 'page-1', kind: 'form-field' as const, fieldType: 'dropdown' as const,
        fieldName: 'office.location', options: ['Dubai', 'Abu Dhabi', 'Bengaluru'], defaultOption: 'Dubai',
        x: 0.2, y: 0.5, width: 0.3, height: 0.08, required: true,
      },
    ]) {
      state = editorReducer(state, { type: 'addAnnotation', annotation })
    }

    const reopened = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
    const form = reopened.getForm()
    const radio = form.getRadioGroup('relocation')
    expect(radio.getOptions()).toEqual(['Yes', 'No'])
    expect(radio.getSelected()).toBe('Yes')
    expect(radio.isRequired()).toBe(true)
    expect(radio.acroField.getWidgets()).toHaveLength(2)
    expect(radio.acroField.getWidgets()[0].getRectangle()).toEqual({
      x: expect.closeTo(120, 8), y: expect.closeTo(50, 8),
      width: expect.closeTo(25, 8), height: expect.closeTo(25, 8),
    })
    expect(radio.acroField.getWidgets()[0].getAppearanceCharacteristics()?.getRotation()).toBe(90)

    const dropdown = form.getDropdown('office.location')
    expect(dropdown.getOptions()).toEqual(['Dubai', 'Abu Dhabi', 'Bengaluru'])
    expect(dropdown.getSelected()).toEqual(['Dubai'])
    expect(dropdown.isRequired()).toBe(true)
    expect(dropdown.acroField.getWidgets()).toHaveLength(1)

    radio.select('No')
    dropdown.select('Abu Dhabi')
    const refilled = await PDFDocument.load(await reopened.save())
    expect(refilled.getForm().getRadioGroup('relocation').getSelected()).toBe('No')
    expect(refilled.getForm().getDropdown('office.location').getSelected()).toEqual(['Abu Dhabi'])
  })

  it('maps created field widgets at every quarter-turn page rotation', async () => {
    const source = await PDFDocument.create()
    for (const rotation of [0, 90, 180, 270] as const) {
      const page = source.addPage([400, 500])
      page.setRotation(degrees(rotation))
    }
    const sourceBytes = await source.save()
    let state = createEditorState('rotations.pdf', 4)
    for (const [index, rotation] of [0, 90, 180, 270].entries()) {
      state = editorReducer(state, {
        type: 'addAnnotation',
        annotation: {
          id: `field-${rotation}`, pageId: `page-${index + 1}`, kind: 'form-field', fieldType: 'text',
          fieldName: `rotation.${rotation}`, x: 0.1, y: 0.2, width: 0.3, height: 0.1,
          required: false, defaultText: '', multiline: false,
        },
      })
    }

    const reopened = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
    const expected = [
      { x: 40, y: 350, width: 120, height: 50, rotation: 0 },
      { x: 80, y: 50, width: 40, height: 150, rotation: 90 },
      { x: 240, y: 100, width: 120, height: 50, rotation: 180 },
      { x: 280, y: 300, width: 40, height: 150, rotation: 270 },
    ]
    for (const target of expected) {
      const field = reopened.getForm().getTextField(`rotation.${target.rotation}`)
      const widget = field.acroField.getWidgets()[0]
      const rectangle = widget.getRectangle()
      expect(rectangle.x).toBeCloseTo(target.x, 8)
      expect(rectangle.y).toBeCloseTo(target.y, 8)
      expect(rectangle.width).toBeCloseTo(target.width, 8)
      expect(rectangle.height).toBeCloseTo(target.height, 8)
      expect(widget.getAppearanceCharacteristics()?.getRotation()).toBe(target.rotation)
    }
  })

  it('creates fields on reordered and blank pages in a rebuilt copy', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.addPage([500, 400])
    const sourceBytes = await source.save()
    let state = createEditorState('rebuilt-form.pdf', 2)
    state = editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 })
    state = editorReducer(state, {
      type: 'insertPages', afterPageId: 'page-1',
      pages: [{ id: 'page-blank', kind: 'blank', width: 300, height: 200, rotation: 0 }],
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'reordered-text', pageId: 'page-2', kind: 'form-field', fieldType: 'text',
        fieldName: 'reordered.name', x: 0.1, y: 0.1, width: 0.4, height: 0.08,
        required: false, defaultText: '', multiline: false,
      },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'reordered-radio', pageId: 'page-2', kind: 'form-field', fieldType: 'radio',
        fieldName: 'rebuilt.choice', optionValue: 'First', selectedByDefault: false,
        x: 0.6, y: 0.2, width: 0.05, height: 0.05, required: true,
      },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'blank-radio', pageId: 'page-blank', kind: 'form-field', fieldType: 'radio',
        fieldName: 'rebuilt.choice', optionValue: 'Second', selectedByDefault: true,
        x: 0.6, y: 0.3, width: 0.06, height: 0.09, required: true,
      },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'blank-dropdown', pageId: 'page-blank', kind: 'form-field', fieldType: 'dropdown',
        fieldName: 'blank.location', options: ['Dubai', 'Bengaluru'], defaultOption: 'Bengaluru',
        x: 0.2, y: 0.6, width: 0.4, height: 0.1, required: false,
      },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'blank-checkbox', pageId: 'page-blank', kind: 'form-field', fieldType: 'checkbox',
        fieldName: 'blank.accepted', x: 0.2, y: 0.3, width: 0.08, height: 0.12,
        required: true, checkedByDefault: false,
      },
    })

    const reopened = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
    const form = reopened.getForm()
    const textWidget = form.getTextField('reordered.name').acroField.getWidgets()[0]
    const checkboxWidget = form.getCheckBox('blank.accepted').acroField.getWidgets()[0]
    expect(textWidget.P()).toBe(reopened.getPage(0).ref)
    expect(checkboxWidget.P()).toBe(reopened.getPage(2).ref)
    expect(form.getCheckBox('blank.accepted').isRequired()).toBe(true)
    const rebuiltRadio = form.getRadioGroup('rebuilt.choice')
    expect(rebuiltRadio.getOptions()).toEqual(['First', 'Second'])
    expect(rebuiltRadio.getSelected()).toBe('Second')
    expect(rebuiltRadio.acroField.getWidgets()[0].P()).toBe(reopened.getPage(0).ref)
    expect(rebuiltRadio.acroField.getWidgets()[1].P()).toBe(reopened.getPage(2).ref)
    expect(form.getDropdown('blank.location').getOptions()).toEqual(['Dubai', 'Bengaluru'])
    expect(form.getDropdown('blank.location').getSelected()).toEqual(['Bengaluru'])
  })

  it('adds a fillable field above a safely rasterized redaction page', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500]).drawText('REMOVE THIS')
    const sourceBytes = await source.save()
    let state = createEditorState('redacted-form.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: { id: 'redaction', pageId: 'page-1', kind: 'redaction', x: 0.1, y: 0.1, width: 0.4, height: 0.1 },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'after-redaction', pageId: 'page-1', kind: 'form-field', fieldType: 'text',
        fieldName: 'replacement.answer', x: 0.1, y: 0.3, width: 0.5, height: 0.08,
        required: false, defaultText: '', multiline: false,
      },
    })
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'redacted-dropdown', pageId: 'page-1', kind: 'form-field', fieldType: 'dropdown',
        fieldName: 'replacement.location', options: ['Dubai', 'Abu Dhabi'], defaultOption: 'Dubai',
        x: 0.1, y: 0.5, width: 0.5, height: 0.08, required: true,
      },
    })
    const png = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ), (character) => character.charCodeAt(0)).buffer as ArrayBuffer

    const output = await exportEditedPdf(sourceBytes, state.present, {
      rasterizedPages: new Map([['page-1', { width: 400, height: 500, png }]]),
    })
    const reopened = await PDFDocument.load(output)
    expect(reopened.getForm().getTextField('replacement.answer')).toBeDefined()
    expect(reopened.getForm().getDropdown('replacement.location').getSelected()).toEqual(['Dubai'])
    expect(await streamsContain(output, 'REMOVE THIS')).toBe(false)
  })

  it('blocks duplicate and source-conflicting created field names before save', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    source.getForm().createTextField('source.name').addToPage(page, { x: 20, y: 20, width: 100, height: 20 })
    const sourceBytes = await source.save()
    const created = (id: string, fieldName: string) => ({
      id, pageId: 'page-1', kind: 'form-field' as const, fieldType: 'text' as const,
      fieldName, x: 0.1, y: 0.2, width: 0.3, height: 0.08,
      required: false, defaultText: '', multiline: false,
    })

    let conflicting = createEditorState('conflict.pdf', 1)
    conflicting = editorReducer(conflicting, { type: 'addAnnotation', annotation: created('one', 'source.name') })
    await expect(exportEditedPdf(sourceBytes, conflicting.present)).rejects.toThrow(/source PDF already uses.*source\.name/i)

    let duplicate = createEditorState('duplicate.pdf', 1)
    duplicate = editorReducer(duplicate, { type: 'addAnnotation', annotation: created('one', 'same.name') })
    duplicate = editorReducer(duplicate, { type: 'addAnnotation', annotation: created('two', 'same.name') })
    await expect(exportEditedPdf(sourceBytes, duplicate.present)).rejects.toThrow(/created field.*same\.name/i)
  })

  it('blocks invalid radio-group and dropdown semantics before save', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    const sourceBytes = await source.save()
    const radio = (id: string, optionValue: string, selectedByDefault: boolean, required = true) => ({
      id, pageId: 'page-1', kind: 'form-field' as const, fieldType: 'radio' as const,
      fieldName: 'relocation', optionValue, selectedByDefault,
      x: 0.1, y: 0.2, width: 0.05, height: 0.05, required,
    })
    const invalidRadioSets = [
      [radio('yes', 'Yes', false), radio('duplicate', 'Yes', false)],
      [radio('yes', 'Yes', true), radio('no', 'No', true)],
      [radio('yes', 'Yes', false, true), radio('no', 'No', false, false)],
    ]
    for (const annotations of invalidRadioSets) {
      let state = createEditorState('invalid-radio.pdf', 1)
      for (const annotation of annotations) {
        state = editorReducer(state, { type: 'addAnnotation', annotation })
      }
      await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/radio group.*relocation/i)
    }

    for (const dropdown of [
      { options: [] as string[], defaultOption: '' },
      { options: ['Dubai', 'Dubai'], defaultOption: 'Dubai' },
      { options: ['Dubai'], defaultOption: 'London' },
    ]) {
      let state = createEditorState('invalid-dropdown.pdf', 1)
      state = editorReducer(state, {
        type: 'addAnnotation',
        annotation: {
          id: 'location', pageId: 'page-1', kind: 'form-field', fieldType: 'dropdown',
          fieldName: 'office.location', ...dropdown,
          x: 0.1, y: 0.2, width: 0.3, height: 0.06, required: false,
        },
      })
      await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/dropdown.*office\.location/i)
    }
  })

  it('refuses to remove an XFA form while adding fields in place', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.getForm()
    const acroForm = source.catalog.lookup(PDFName.of('AcroForm'), PDFDict)
    acroForm.set(PDFName.of('XFA'), PDFString.of('legacy-xfa-packet'))
    const sourceBytes = await source.save({ updateFieldAppearances: false })
    let state = createEditorState('xfa.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'field', pageId: 'page-1', kind: 'form-field', fieldType: 'text',
        fieldName: 'leafpdf.text.1', x: 0.1, y: 0.2, width: 0.3, height: 0.08,
        required: false, defaultText: '', multiline: false,
      },
    })

    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/XFA form.*stopped/i)
  })

  it('refuses flattened output when an XFA form cannot be painted safely', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.getForm()
    const acroForm = source.catalog.lookup(PDFName.of('AcroForm'), PDFDict)
    acroForm.set(PDFName.of('XFA'), PDFString.of('legacy-xfa-packet'))
    const sourceBytes = await source.save({ updateFieldAppearances: false })

    await expect(exportEditedPdf(
      sourceBytes,
      createEditorState('xfa.pdf', 1).present,
      { formOutput: 'flattened' },
    )).rejects.toThrow(/XFA form.*cannot flatten safely/i)
  })

  it('names the field when a value cannot be stored, instead of dropping it', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    const form = source.getForm()
    form.createTextField('owner.name').addToPage(page, { x: 40, y: 400, width: 200, height: 24 })
    const sourceBytes = await source.save()

    let state = createEditorState('form.pdf', 1)
    // Standard form fonts store WinAnsi only; Arabic must refuse by name, not vanish.
    state = editorReducer(state, { type: 'setFormValue', fieldName: 'owner.name', value: 'مرحبا' })
    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/owner\.name/)

    let missing = createEditorState('form.pdf', 1)
    missing = editorReducer(missing, { type: 'setFormValue', fieldName: 'no.such.field', value: 'x' })
    await expect(exportEditedPdf(sourceBytes, missing.present)).rejects.toThrow(/no\.such\.field/)
  })

  it('preserves source metadata when no page is reordered', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.setTitle('Preserve me')
    source.setAuthor('Syed')
    source.setSubject('Quarterly review')
    source.setKeywords(['leafpdf', 'export'])
    source.setLanguage('en-GB')
    const sourceBytes = await source.save()

    let state = createEditorState('preserve.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'text-1', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.1,
        width: 0.4, height: 0.08, text: 'Reviewed', color: '#182026', fontSize: 14,
      },
    })

    const reopened = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
    expect(reopened.getTitle()).toBe('Preserve me')
    expect(reopened.getAuthor()).toBe('Syed')
    expect(reopened.getSubject()).toBe('Quarterly review')
    expect(reopened.getKeywords()).toContain('leafpdf')
  })

  it('carries metadata across a rebuild of a reordered plain PDF', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.addPage([400, 500])
    source.setTitle('Reordered but titled')
    source.setAuthor('Syed')
    const sourceBytes = await source.save()

    let state = createEditorState('reordered.pdf', 2)
    state = editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 })

    const reopened = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
    expect(reopened.getPageCount()).toBe(2)
    expect(reopened.getTitle()).toBe('Reordered but titled')
    expect(reopened.getAuthor()).toBe('Syed')
  })

  it('keeps outlines and form fields when only annotations are added', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    source.getForm().createTextField('owner.name').addToPage(page, { x: 40, y: 400, width: 200, height: 24 })
    const sourceBytes = await source.save()

    let state = createEditorState('form.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'highlight-1', pageId: 'page-1', kind: 'highlight', x: 0.1, y: 0.1,
        width: 0.4, height: 0.06, color: '#ffd447', opacity: 0.4,
      },
    })

    const reopened = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
    expect(reopened.getForm().getFields().map((field) => field.getName())).toContain('owner.name')
  })

  it('refuses to reorder a structured document without an accepted compatibility copy', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    source.addPage([400, 500])
    source.getForm().createTextField('owner.name').addToPage(page, { x: 40, y: 400, width: 200, height: 24 })
    const sourceBytes = await source.save()

    let state = createEditorState('form.pdf', 2)
    state = editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 })

    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/compatibility/i)
    // The same export succeeds once the user accepts the compatibility copy.
    const accepted = await exportEditedPdf(sourceBytes, state.present, { allowCompatibilityCopy: true })
    expect((await PDFDocument.load(accepted)).getPageCount()).toBe(2)
  })

  it.each([0, 90, 180, 270] as const)('places an annotation on a page rotated %i degrees', async (rotation) => {
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    page.setRotation(degrees(rotation))
    const sourceBytes = await source.save()

    let state = createEditorState('rotated.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: `text-${rotation}`, pageId: 'page-1', kind: 'text', x: 0.1, y: 0.1,
        width: 0.5, height: 0.1, text: `Rotation ${rotation}`, color: '#182026', fontSize: 12,
      },
    })

    const output = await exportEditedPdf(sourceBytes, state.present)
    const reopened = await PDFDocument.load(output)
    // Rotation is carried through untouched, and the page still has real content.
    expect(reopened.getPage(0).getRotation().angle).toBe(rotation)
    expect(output.byteLength).toBeGreaterThan(sourceBytes.byteLength)
  })

  it('adds the editor rotation on top of the source rotation', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500]).setRotation(degrees(270))
    const sourceBytes = await source.save()

    let state = createEditorState('rotated.pdf', 1)
    state = editorReducer(state, { type: 'rotatePage', pageId: 'page-1', degrees: 90 })

    const reopened = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
    expect(reopened.getPage(0).getRotation().angle).toBe(0)
  })

  it('removes a deleted page and keeps the remaining order', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.addPage([420, 520])
    source.addPage([440, 540])
    const sourceBytes = await source.save()

    let state = createEditorState('deleted.pdf', 3)
    state = editorReducer(state, { type: 'removePage', pageId: 'page-2' })

    const reopened = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
    expect(reopened.getPageCount()).toBe(2)
    // Pages 1 and 3 survive, identified by their distinct sizes.
    expect(reopened.getPage(0).getSize()).toEqual({ width: 400, height: 500 })
    expect(reopened.getPage(1).getSize()).toEqual({ width: 440, height: 540 })
  })

  it('reports a malformed placed image instead of writing a broken PDF', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    const sourceBytes = await source.save()

    let state = createEditorState('image.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'image-1', pageId: 'page-1', kind: 'image', x: 0.1, y: 0.1,
        width: 0.4, height: 0.2,
        dataUrl: 'data:image/png;base64,',
        mimeType: 'image/png',
      },
    })

    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/image data is invalid/i)
  })

  it('exports a placed image with the same contain fit shown in the editor', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    const sourceBytes = await source.save()
    const squarePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

    let state = createEditorState('image.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'image-1', pageId: 'page-1', kind: 'image', x: 0.1, y: 0.1,
        // A square bitmap in this 160pt by 200pt box is shown as 160pt square
        // by the editor's object-fit: contain preview.
        width: 0.4, height: 0.4,
        dataUrl: squarePng,
        mimeType: 'image/png',
      },
    })

    const output = await exportEditedPdf(sourceBytes, state.present)
    const content = await decodedPdfContent(output)

    expect(content).toMatch(/160 0 0 160 0 0 cm/)
    expect(content).not.toMatch(/160 0 0 200 0 0 cm/)
  })

  it('exports placed-image opacity without fading other page content', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500]).drawText('OPAQUE PAGE CONTENT')
    const sourceBytes = await source.save()
    const squarePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    let state = createEditorState('faded-image.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'image-1', pageId: 'page-1', kind: 'image', x: 0.1, y: 0.1,
        width: 0.4, height: 0.4, dataUrl: squarePng, mimeType: 'image/png', opacity: 0.35,
      },
    })

    const output = await exportEditedPdf(sourceBytes, state.present)
    const reopened = await PDFDocument.load(output)
    const resources = reopened.getPage(0).node.Resources()
    const graphicsStates = resources?.lookupMaybe(PDFName.ExtGState, PDFDict)
    const opacities = graphicsStates?.keys().flatMap((key) => {
      const state = graphicsStates.lookupMaybe(key, PDFDict)
      const opacity = state?.lookupMaybe(PDFName.of('ca'), PDFNumber)
      return opacity ? [opacity.asNumber()] : []
    }) ?? []

    expect(opacities).toContain(0.35)
    expect(await streamsContain(output, 'OPAQUE PAGE CONTENT')).toBe(true)
  })

  it('copies page-independent catalog entries across a rebuild', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.addPage([400, 500])
    source.setTitle('Reordered')
    source.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
    source.catalog.set(PDFName.of('PageLayout'), PDFName.of('TwoColumnLeft'))
    source.catalog.set(PDFName.of('Lang'), PDFString.of('en-GB'))
    const sourceBytes = await source.save()

    let state = createEditorState('reordered.pdf', 2)
    state = editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 })

    // These are single direct objects with no page dependency, so a reorder keeps them.
    const reopened = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
    expect(reopened.catalog.get(PDFName.of('PageMode'))?.toString()).toBe('/UseOutlines')
    expect(reopened.catalog.get(PDFName.of('PageLayout'))?.toString()).toBe('/TwoColumnLeft')
    expect(reopened.catalog.get(PDFName.of('Lang'))?.toString()).toContain('en-GB')
    expect(reopened.getTitle()).toBe('Reordered')
  })

  it('discloses indirectly held catalog entries rather than dropping them quietly', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.addPage([400, 500])
    // XMP lives in a stream whose object graph belongs to the source document, so it
    // cannot be copied across without rewriting references. It must be disclosed.
    source.catalog.set(
      PDFName.of('Metadata'),
      source.context.register(source.context.stream('<x:xmpmeta/>', { Type: 'Metadata', Subtype: 'XML' })),
    )
    const sourceBytes = await source.save()

    let state = createEditorState('xmp.pdf', 2)
    state = editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 })

    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/XMP metadata/)
  })

  it('requires confirmation before a reorder would drop tagged-PDF structure', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    source.addPage([400, 500])
    source.catalog.set(
      PDFName.of('StructTreeRoot'),
      source.context.register(source.context.obj({ Type: 'StructTreeRoot' })),
    )
    const sourceBytes = await source.save()

    let state = createEditorState('tagged.pdf', 2)
    state = editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 })

    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/Tagged-PDF structure/)
    // Annotating without reordering keeps it, so no confirmation is needed.
    const annotated = editorReducer(createEditorState('tagged.pdf', 2), {
      type: 'addAnnotation',
      annotation: {
        id: 'h', pageId: 'page-1', kind: 'highlight', x: 0.1, y: 0.1,
        width: 0.3, height: 0.05, color: '#ffd447', opacity: 0.4,
      },
    })
    const kept = await PDFDocument.load(await exportEditedPdf(sourceBytes, annotated.present))
    expect(kept.catalog.get(PDFName.of('StructTreeRoot'))).toBeDefined()
  })

  it('refuses to delete a page that another page links to', async () => {
    // A catalog-only scan missed this: page 1 links to page 2, page 2 is deleted, and
    // the export left the link pointing at an orphaned page reference.
    const source = await PDFDocument.create()
    const first = source.addPage([400, 500])
    const second = source.addPage([400, 500])
    const link = source.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [40, 40, 200, 60],
      Dest: [second.ref, PDFName.of('Fit')],
    })
    first.node.set(PDFName.of('Annots'), source.context.obj([source.context.register(link)]))
    const sourceBytes = await source.save()

    let state = createEditorState('linked.pdf', 2)
    state = editorReducer(state, { type: 'removePage', pageId: 'page-2' })

    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/Links between pages/)
    // Accepting the disclosed copy still works.
    const accepted = await exportEditedPdf(sourceBytes, state.present, { allowCompatibilityCopy: true })
    expect((await PDFDocument.load(accepted)).getPageCount()).toBe(1)
  })

  it('requires confirmation to delete the last page of a structured document', async () => {
    // Trailing deletes leave the remaining pages at their own source indexes, which an
    // order-only check read as "unchanged" and let through without asking.
    const source = await PDFDocument.create()
    const page = source.addPage([400, 500])
    source.addPage([400, 500])
    source.getForm().createTextField('owner.name').addToPage(page, { x: 40, y: 400, width: 200, height: 24 })
    const sourceBytes = await source.save()

    let state = createEditorState('form.pdf', 2)
    state = editorReducer(state, { type: 'removePage', pageId: 'page-2' })

    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/compatibility/i)
  })

  it('creates a safe edited filename', () => {
    expect(exportedFileName('Quarterly Report.PDF')).toBe('Quarterly Report-edited.pdf')
    expect(exportedFileName('Quarterly Report.PDF', 'flattened')).toBe('Quarterly Report-flattened.pdf')
  })

  it('exports Arabic, Devanagari, and Latin text without an encoding failure', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    const sourceBytes = await source.save()

    let state = createEditorState('unicode.pdf', 1)
    const strings = ['مرحبا', 'नमस्ते', 'Grüße — €50 ½']
    strings.forEach((text, index) => {
      state = editorReducer(state, {
        type: 'addAnnotation',
        annotation: {
          id: `text-${index}`, pageId: 'page-1', kind: 'text', x: 0.1, y: 0.1 + index * 0.2,
          width: 0.7, height: 0.1, text, color: '#182026', fontSize: 18,
        },
      })
    })

    const output = await exportEditedPdf(sourceBytes, state.present)
    const reopened = await PDFDocument.load(output)
    expect(reopened.getPageCount()).toBe(1)
    expect(output.byteLength).toBeGreaterThan(sourceBytes.byteLength)
  })

  it('refuses an export whose text needs a script it cannot embed', async () => {
    const source = await PDFDocument.create()
    source.addPage([400, 500])
    const sourceBytes = await source.save()

    let state = createEditorState('cjk.pdf', 1)
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'text-cjk', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.1,
        width: 0.7, height: 0.1, text: '你好', color: '#182026', fontSize: 18,
      },
    })

    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/你好/)
    await expect(exportEditedPdf(sourceBytes, state.present)).rejects.toThrow(/cannot embed/i)
  })
})
