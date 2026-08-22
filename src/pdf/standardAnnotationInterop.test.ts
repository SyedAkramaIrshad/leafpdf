import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { addStandardTextComments, importStandardTextComments } from './standardAnnotationInterop'

function comment() {
  return {
    id: 'comment-1', pageId: 'page-1', x: 0.25, y: 0.3,
    body: 'Please verify this clause.', author: 'Syed',
    createdAt: 1, updatedAt: 2, resolved: false,
  }
}

describe('standard PDF annotation interoperability', () => {
  it('writes a real /Text annotation into the target page dictionary', async () => {
    const source = await PDFDocument.create()
    source.addPage([600, 800])
    source.addPage([600, 800])

    const outputBytes = await addStandardTextComments(
      await source.save(),
      [comment()],
      new Map([['page-1', 0]]),
    )
    const output = await PDFDocument.load(outputBytes)
    const annots = output.getPages()[0].node.get(PDFName.of('Annots'))
    expect(annots).toBeInstanceOf(PDFArray)
    const first = (annots as PDFArray).get(0)
    const dictionary = first instanceof PDFRef ? output.context.lookup(first) : first
    expect(dictionary).toBeInstanceOf(PDFDict)
    const annotation = dictionary as PDFDict
    expect((annotation.get(PDFName.of('Subtype')) as PDFName).asString()).toBe('/Text')
    expect((annotation.get(PDFName.of('Contents')) as PDFHexString).decodeText()).toBe('Please verify this clause.')
    expect((annotation.get(PDFName.of('T')) as PDFHexString).decodeText()).toBe('Syed')

    expect(output.getPages()[1].node.get(PDFName.of('Annots'))).toBeUndefined()
  })

  it('imports PDF.js text-note data into normalized review comments', async () => {
    const page = {
      getViewport: () => ({
        width: 600,
        height: 800,
        convertToViewportRectangle: () => [120, 160, 144, 184],
      }),
      getAnnotations: async () => [{
        id: '42', annotationType: 1, rect: [120, 616, 144, 640],
        contentsObj: { str: 'Imported note' }, titleObj: { str: 'Reviewer' },
        modificationDate: 'D:20260102030405', name: 'Comment',
      }],
    }
    const pdf = { numPages: 1, getPage: async () => page } as unknown as PDFDocumentProxy

    const comments = await importStandardTextComments(pdf, ['page-1'])

    expect(comments).toHaveLength(1)
    expect(comments[0]).toMatchObject({
      id: 'pdf-42', pageId: 'page-1', body: 'Imported note', author: 'Reviewer',
      x: 0.2, y: 0.2, resolved: false,
    })
  })
})
