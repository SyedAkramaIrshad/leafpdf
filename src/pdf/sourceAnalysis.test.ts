import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'
import { analyzeSourcePdf, chooseExportStrategy, type SourcePdfFeatures } from './sourceAnalysis'
import { createEditorState, editorReducer, type EditorDocument } from '../model/editor'

const ENCRYPTED_FIXTURE = 'tmp/pdfs/edge-encrypted.pdf'

async function plainPdf(pages = 2): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  for (let index = 0; index < pages; index += 1) document.addPage([400, 500])
  return document.save()
}

async function titledPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.addPage([400, 500])
  document.setTitle('Preserve me')
  return document.save()
}

async function outlinedPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([400, 500])
  const context = document.context
  const outlines = context.obj({ Type: 'Outlines', Count: 1 })
  const outlinesRef = context.register(outlines)
  const item = context.obj({ Title: PDFHexString.fromText('Section one'), Parent: outlinesRef, Dest: [page.ref, PDFName.of('Fit')] })
  const itemRef = context.register(item)
  outlines.set(PDFName.of('First'), itemRef)
  outlines.set(PDFName.of('Last'), itemRef)
  document.catalog.set(PDFName.of('Outlines'), outlinesRef)
  return document.save()
}

async function attachmentPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.addPage([400, 500])
  await document.attach(new Uint8Array([104, 105]), 'note.txt', { mimeType: 'text/plain' })
  return document.save()
}

/** A `/Names` tree that is not `/EmbeddedFiles` must not read as an attachment. */
async function namedDestinationsPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([400, 500])
  const context = document.context
  const destinations = context.obj({ Names: [PDFString.of('intro'), context.obj([page.ref, PDFName.of('Fit')])] })
  const names = context.obj({ Dests: context.register(destinations) })
  document.catalog.set(PDFName.of('Names'), context.register(names))
  return document.save()
}

async function formPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([400, 500])
  document.getForm().createTextField('owner.name').addToPage(page, { x: 40, y: 400, width: 200, height: 24 })
  return document.save()
}

async function signedPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([400, 500])
  const context = document.context
  const signatureField = context.obj({
    FT: PDFName.of('Sig'),
    T: PDFHexString.fromText('Signature1'),
    Type: 'Annot',
    Subtype: 'Widget',
    Rect: [40, 40, 240, 100],
    P: page.ref,
  })
  const fieldRef = context.register(signatureField)
  page.node.set(PDFName.of('Annots'), context.obj([fieldRef]))
  const acroForm = context.obj({ Fields: context.obj([fieldRef]), SigFlags: 3 })
  document.catalog.set(PDFName.of('AcroForm'), context.register(acroForm))
  return document.save()
}

const NO_FEATURES: SourcePdfFeatures = {
  isEncrypted: false,
  hasMetadata: false,
  hasOutlines: false,
  hasAttachments: false,
  hasAcroForm: false,
  hasDigitalSignatures: false,
  additionalFeatures: [],
}

/** Build a PDF whose catalog carries one extra entry, to test detection of it. */
async function pdfWithCatalogEntry(key: string, value: unknown): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([400, 500])
  const resolved = value === 'PAGE_REF' ? page.ref : document.context.obj(value as never)
  document.catalog.set(PDFName.of(key), resolved as never)
  return document.save()
}

describe('analyzeSourcePdf', () => {
  it('reports no structural features for a plain PDF', async () => {
    expect(await analyzeSourcePdf(await plainPdf())).toEqual(NO_FEATURES)
  })

  it('detects document metadata', async () => {
    const features = await analyzeSourcePdf(await titledPdf())
    expect(features.hasMetadata).toBe(true)
    expect(features.hasOutlines).toBe(false)
  })

  it('detects outlines through the catalog', async () => {
    const features = await analyzeSourcePdf(await outlinedPdf())
    expect(features.hasOutlines).toBe(true)
  })

  it('does not treat an empty outline root as bookmarks', async () => {
    // pypdf writes an empty `/Outlines` dictionary into every document it produces.
    // Treating that as bookmarks would demand a compatibility copy for nothing.
    const document = await PDFDocument.create()
    document.addPage([400, 500])
    const outlines = document.context.obj({ Type: 'Outlines', Count: 0 })
    document.catalog.set(PDFName.of('Outlines'), document.context.register(outlines))
    const features = await analyzeSourcePdf(await document.save())
    expect(features.hasOutlines).toBe(false)
  })

  it('detects attachments through /Names -> /EmbeddedFiles', async () => {
    const features = await analyzeSourcePdf(await attachmentPdf())
    expect(features.hasAttachments).toBe(true)
  })

  it('does not treat a non-attachment /Names tree as an attachment', async () => {
    const features = await analyzeSourcePdf(await namedDestinationsPdf())
    expect(features.hasAttachments).toBe(false)
  })

  it('detects an AcroForm without claiming a signature', async () => {
    const features = await analyzeSourcePdf(await formPdf())
    expect(features.hasAcroForm).toBe(true)
    expect(features.hasDigitalSignatures).toBe(false)
  })

  it('detects a digital signature through a /FT /Sig field', async () => {
    const features = await analyzeSourcePdf(await signedPdf())
    expect(features.hasDigitalSignatures).toBe(true)
    expect(features.hasAcroForm).toBe(true)
  })

  it('detects catalog features beyond the four named booleans', async () => {
    // Each of these is either page-index dependent or opaque, so a rebuild cannot
    // carry it across and the user has to be told before it is dropped.
    const cases: Array<[string, unknown, string]> = [
      ['StructTreeRoot', { Type: 'StructTreeRoot' }, 'Tagged-PDF structure (accessibility)'],
      ['PageLabels', { Nums: [0, { P: 'i' }] }, 'Custom page numbering'],
      ['OCProperties', { OCGs: [], D: {} }, 'Optional content layers'],
      ['OpenAction', 'PAGE_REF', 'An action that runs when the file opens'],
      ['AA', { WC: {} }, 'Additional document actions'],
      ['Dests', { intro: [] }, 'Named destinations'],
      ['Threads', [], 'Article threads'],
      ['Collection', { Type: 'Collection' }, 'Portfolio collection'],
      ['Requirements', [], 'Viewer requirements'],
    ]

    for (const [key, value, label] of cases) {
      const features = await analyzeSourcePdf(await pdfWithCatalogEntry(key, value))
      expect(features.additionalFeatures, `${key} should be detected`).toContain(label)
    }
  })

  it('detects named destinations inside a /Names tree', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([400, 500])
    const context = document.context
    const destinations = context.obj({ Names: [PDFString.of('intro'), context.obj([page.ref, PDFName.of('Fit')])] })
    const names = context.obj({ Dests: context.register(destinations) })
    document.catalog.set(PDFName.of('Names'), context.register(names))

    const features = await analyzeSourcePdf(await document.save())
    expect(features.additionalFeatures).toContain('Named destinations')
    // A destination tree is still not an attachment.
    expect(features.hasAttachments).toBe(false)
  })

  it('detects document JavaScript inside a /Names tree', async () => {
    const document = await PDFDocument.create()
    document.addPage([400, 500])
    const context = document.context
    const scripts = context.obj({ Names: [PDFString.of('main'), context.obj({ S: PDFName.of('JavaScript') })] })
    const names = context.obj({ JavaScript: context.register(scripts) })
    document.catalog.set(PDFName.of('Names'), context.register(names))

    expect((await analyzeSourcePdf(await document.save())).additionalFeatures).toContain('Document JavaScript')
  })

  it('does not flag catalog entries a rebuild can simply copy', async () => {
    // Single direct objects with no page dependency: the rebuild path copies these,
    // so warning about them would be noise.
    for (const [key, value] of [
      ['PageMode', PDFName.of('UseOutlines')],
      ['PageLayout', PDFName.of('TwoColumnLeft')],
      ['Lang', PDFString.of('en-GB')],
    ] as Array<[string, unknown]>) {
      const features = await analyzeSourcePdf(await pdfWithCatalogEntry(key, value))
      expect(features.additionalFeatures, `${key} should not block`).toEqual([])
    }
  })

  it('detects an internal link from one page to another', async () => {
    // Reported defect: page 1 links to page 2, page 2 is deleted, and the export went
    // through without asking — leaving the link pointing at an orphaned page.
    const document = await PDFDocument.create()
    const first = document.addPage([400, 500])
    const second = document.addPage([400, 500])
    const context = document.context
    const link = context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [40, 40, 200, 60],
      Dest: [second.ref, PDFName.of('Fit')],
    })
    first.node.set(PDFName.of('Annots'), context.obj([context.register(link)]))

    const features = await analyzeSourcePdf(await document.save())
    expect(features.additionalFeatures).toContain('Links between pages')
  })

  it('detects an internal link expressed as a /GoTo action', async () => {
    const document = await PDFDocument.create()
    const first = document.addPage([400, 500])
    const second = document.addPage([400, 500])
    const context = document.context
    const link = context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [40, 40, 200, 60],
      A: context.obj({ S: PDFName.of('GoTo'), D: [second.ref, PDFName.of('Fit')] }),
    })
    first.node.set(PDFName.of('Annots'), context.obj([context.register(link)]))

    expect((await analyzeSourcePdf(await document.save())).additionalFeatures).toContain('Links between pages')
  })

  it('does not flag a plain external web link', async () => {
    // A URI action does not reference a page, so reordering cannot break it.
    const document = await PDFDocument.create()
    const page = document.addPage([400, 500])
    const context = document.context
    const link = context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [40, 40, 200, 60],
      A: context.obj({ S: PDFName.of('URI'), URI: PDFString.of('https://example.com') }),
    })
    page.node.set(PDFName.of('Annots'), context.obj([context.register(link)]))

    expect((await analyzeSourcePdf(await document.save())).additionalFeatures).toEqual([])
  })

  it('does not flag a page whose annotations are only highlights', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([400, 500])
    const context = document.context
    const square = context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50] })
    page.node.set(PDFName.of('Annots'), context.obj([context.register(square)]))

    expect((await analyzeSourcePdf(await document.save())).additionalFeatures).toEqual([])
  })

  it('reports no features rather than throwing on damaged bytes', async () => {
    expect(await analyzeSourcePdf(new Uint8Array([1, 2, 3]))).toEqual(NO_FEATURES)
  })

  // Permissions-only encryption (empty user password) opens in any viewer but
  // cannot be exported; it must be reported as encryption, not as "no features".
  it.skipIf(!existsSync(ENCRYPTED_FIXTURE))('reports an encrypted document as encrypted', async () => {
    const bytes = new Uint8Array(readFileSync(ENCRYPTED_FIXTURE))
    const features = await analyzeSourcePdf(bytes)
    expect(features.isEncrypted).toBe(true)
  })
})

describe('chooseExportStrategy', () => {
  const documentOf = (mutate: (state: ReturnType<typeof createEditorState>) => ReturnType<typeof createEditorState>): EditorDocument =>
    mutate(createEditorState('sample.pdf', 3)).present

  const untouched = documentOf((state) => state)
  const reordered = documentOf((state) => editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 }))
  const deleted = documentOf((state) => editorReducer(state, { type: 'removePage', pageId: 'page-2' }))

  it('preserves the source document when page order is unchanged', () => {
    expect(chooseExportStrategy(NO_FEATURES, untouched)).toBe('preserve')
    expect(chooseExportStrategy({ ...NO_FEATURES, hasOutlines: true, hasAcroForm: true }, untouched)).toBe('preserve')
  })

  it('preserves a deletion when no catalog feature can be left dangling', () => {
    expect(chooseExportStrategy(NO_FEATURES, deleted)).toBe('preserve')
    expect(chooseExportStrategy({ ...NO_FEATURES, hasMetadata: true }, deleted)).toBe('preserve')
  })

  it('requires confirmation to delete a page from a structured document', () => {
    expect(chooseExportStrategy({ ...NO_FEATURES, hasOutlines: true }, deleted)).toBe('requires-confirmation')
    expect(chooseExportStrategy({ ...NO_FEATURES, hasAcroForm: true }, deleted)).toBe('requires-confirmation')
    expect(chooseExportStrategy({ ...NO_FEATURES, hasAttachments: true }, deleted)).toBe('requires-confirmation')
    expect(chooseExportStrategy({ ...NO_FEATURES, hasDigitalSignatures: true }, deleted)).toBe('requires-confirmation')
  })

  it('rebuilds a reordered plain PDF without asking', () => {
    expect(chooseExportStrategy(NO_FEATURES, reordered)).toBe('rebuild-safe')
    expect(chooseExportStrategy({ ...NO_FEATURES, hasMetadata: true }, reordered)).toBe('rebuild-safe')
  })

  it('requires confirmation to reorder a structured document', () => {
    expect(chooseExportStrategy({ ...NO_FEATURES, hasOutlines: true }, reordered)).toBe('requires-confirmation')
    expect(chooseExportStrategy({ ...NO_FEATURES, hasDigitalSignatures: true }, reordered)).toBe('requires-confirmation')
  })

  it('treats deleting the last page as a deletion, not as an untouched document', () => {
    // The remaining pages still sit at their own source indexes after a trailing
    // delete, so an order-only check reported "unchanged" and skipped confirmation.
    const trailingDeleted = documentOf((state) => editorReducer(state, { type: 'removePage', pageId: 'page-3' }))
    expect(trailingDeleted.pages.map((page) => page.kind === 'original' ? page.sourceIndex : -1)).toEqual([0, 1])

    expect(chooseExportStrategy({ ...NO_FEATURES, hasOutlines: true }, trailingDeleted, 3))
      .toBe('requires-confirmation')
    expect(chooseExportStrategy(NO_FEATURES, trailingDeleted, 3)).toBe('preserve')
  })

  it('still preserves when every page is present in order', () => {
    expect(chooseExportStrategy({ ...NO_FEATURES, hasOutlines: true }, untouched, 3)).toBe('preserve')
  })

  it('treats insertions like deletions: in place when plain, confirmed when structured', () => {
    const inserted = documentOf((state) => editorReducer(state, {
      type: 'insertPages',
      afterPageId: 'page-1',
      pages: [{ id: 'page-new', kind: 'blank', width: 595, height: 842, rotation: 0 }],
    }))
    expect(chooseExportStrategy(NO_FEATURES, inserted, 3)).toBe('preserve')
    expect(chooseExportStrategy({ ...NO_FEATURES, hasOutlines: true }, inserted, 3)).toBe('requires-confirmation')

    // Inserting AND reordering the originals can only be expressed by a rebuild.
    const insertedAndReordered = documentOf((state) => {
      const withInsert = editorReducer(state, {
        type: 'insertPages',
        afterPageId: 'page-1',
        pages: [{ id: 'page-new', kind: 'blank', width: 595, height: 842, rotation: 0 }],
      })
      return editorReducer(withInsert, { type: 'movePage', pageId: 'page-3', direction: -1 })
    })
    expect(chooseExportStrategy(NO_FEATURES, insertedAndReordered, 3)).toBe('rebuild-safe')
  })

  it('routes any redaction through a rebuild, confirmed when features exist', () => {
    const redacted = documentOf((state) => editorReducer(state, {
      type: 'addAnnotation',
      annotation: { id: 'r1', pageId: 'page-1', kind: 'redaction', x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
    }))
    // Even with untouched page order, a redaction can never take the preserve path.
    expect(chooseExportStrategy(NO_FEATURES, redacted, 3)).toBe('rebuild-safe')
    expect(chooseExportStrategy({ ...NO_FEATURES, hasAcroForm: true }, redacted, 3)).toBe('requires-confirmation')
  })

  it('requires confirmation for any additional catalog feature', () => {
    const tagged = { ...NO_FEATURES, additionalFeatures: ['Tagged-PDF structure'] }
    expect(chooseExportStrategy(tagged, reordered)).toBe('requires-confirmation')
    expect(chooseExportStrategy(tagged, deleted)).toBe('requires-confirmation')
    // Annotating in place still preserves everything, so it never needs asking.
    expect(chooseExportStrategy(tagged, untouched)).toBe('preserve')
  })
})
