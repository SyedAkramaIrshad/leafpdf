import { describe, expect, it } from 'vitest'
import * as pako from 'pako'
import { PDFDocument, PDFName, PDFRawStream, PDFString, degrees } from 'pdf-lib'
import { createEditorState, editorReducer } from '../model/editor'
import { exportEditedPdf, exportedFileName } from './exportPdf'

/**
 * True when any byte run of the PDF carries `marker`, in either of the two
 * encodings pdf-lib emits text with: a literal string or a hex string. Content
 * streams are FlateDecode-compressed, so every stream is inflated before the
 * search — a raw byte scan alone cannot prove text absent.
 */
async function streamsContain(bytes: Uint8Array, marker: string): Promise<boolean> {
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
  const hex = Array.from(marker, (character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return text.includes(marker) || text.toLowerCase().includes(hex)
}

describe('exportEditedPdf', () => {
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
      { id: 'date', pageId: 'page-1', kind: 'stamp' as const, stamp: 'date' as const, label: '31/07/2026', x: 0.4, y: 0.5, width: 0.25, height: 0.06, color: '#182026', strokeWidth: 2 },
    ]
    for (const annotation of annotations) {
      state = editorReducer(state, { type: 'addAnnotation', annotation })
    }

    const output = await exportEditedPdf(sourceBytes, state.present)
    expect(output.byteLength).toBeGreaterThan(sourceBytes.byteLength + 400)
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1)
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
