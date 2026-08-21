import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { sanitizePdfBytes } from './sanitizePdf'

async function sensitiveFixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.setTitle('Confidential title')
  document.setAuthor('Sensitive author')
  document.attach(new Uint8Array([1, 2, 3]), 'secret.bin', { mimeType: 'application/octet-stream' })
  const page = document.addPage([600, 800])
  const form = document.getForm()
  const field = form.createTextField('person.name')
  field.setText('Private value')
  field.addToPage(page, { x: 50, y: 700, width: 200, height: 30 })
  const note = document.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: [100, 100, 124, 124],
    Contents: PDFHexString.fromText('Private comment'),
  })
  const annots = page.node.lookup(PDFName.of('Annots'))
  const array = annots && 'push' in annots ? annots : document.context.obj([])
  if (!annots) page.node.set(PDFName.of('Annots'), array)
  ;(array as { push: (value: unknown) => void }).push(document.context.register(note))
  return document.save()
}

describe('sanitizePdfBytes', () => {
  it('rebuilds pages while dropping metadata, forms, attachments, and annotations', async () => {
    const sanitized = await PDFDocument.load(await sanitizePdfBytes(await sensitiveFixture()))

    expect(sanitized.getPageCount()).toBe(1)
    expect(sanitized.getTitle()).toBeUndefined()
    expect(sanitized.getAuthor()).toBeUndefined()
    expect(sanitized.catalog.get(PDFName.of('AcroForm'))).toBeUndefined()
    expect(sanitized.catalog.get(PDFName.of('Names'))).toBeUndefined()
    expect(sanitized.catalog.get(PDFName.of('Metadata'))).toBeUndefined()
    expect(sanitized.getPages()[0].node.get(PDFName.of('Annots'))).toBeUndefined()
    expect(sanitized.getProducer()).toBe('LeafPDF sanitized copy')
  })

  it('copies ordinary metadata only when explicitly requested', async () => {
    const sanitized = await PDFDocument.load(await sanitizePdfBytes(
      await sensitiveFixture(),
      { keepDocumentMetadata: true },
    ))

    expect(sanitized.getTitle()).toBe('Confidential title')
    expect(sanitized.getAuthor()).toBe('Sensitive author')
    expect(sanitized.catalog.get(PDFName.of('AcroForm'))).toBeUndefined()
  })
})
