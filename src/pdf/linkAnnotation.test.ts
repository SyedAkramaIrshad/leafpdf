import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { appendExternalLinkAnnotation } from './linkAnnotation'

function annotationDictionaries(document: PDFDocument): PDFDict[] {
  const value = document.getPage(0).node.get(PDFName.of('Annots'))
  const array = value instanceof PDFRef ? document.context.lookup(value) : value
  if (!(array instanceof PDFArray)) return []
  return Array.from({ length: array.size() }, (_, index) => {
    const entry = array.get(index)
    const dictionary = entry instanceof PDFRef ? document.context.lookup(entry) : entry
    if (!(dictionary instanceof PDFDict)) throw new Error('Expected an annotation dictionary.')
    return dictionary
  })
}

describe('appendExternalLinkAnnotation', () => {
  it('appends an invisible standard URI action without replacing existing annotations', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([400, 500])
    const note = document.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Rect: [10, 10, 30, 30],
    })
    const existing = document.context.obj([document.context.register(note)]) as PDFArray
    page.node.set(PDFName.of('Annots'), document.context.register(existing))

    appendExternalLinkAnnotation(
      document,
      page,
      [80, 50, 120, 200],
      'https://example.com/offer',
      'link-1',
    )

    const reopened = await PDFDocument.load(await document.save())
    const annotations = annotationDictionaries(reopened)
    expect(annotations.map((annotation) =>
      (annotation.get(PDFName.of('Subtype')) as PDFName).asString())).toEqual(['/Text', '/Link'])
    const link = annotations[1]
    const action = link.get(PDFName.of('A'))
    expect(action).toBeInstanceOf(PDFDict)
    const actionDictionary = action as PDFDict
    expect((actionDictionary.get(PDFName.of('S')) as PDFName).asString()).toBe('/URI')
    expect((actionDictionary.get(PDFName.of('URI')) as PDFString).decodeText()).toBe('https://example.com/offer')
    const rectangle = link.get(PDFName.of('Rect')) as PDFArray
    expect(Array.from({ length: rectangle.size() }, (_, index) =>
      (rectangle.get(index) as PDFNumber).asNumber())).toEqual([80, 50, 120, 200])
    expect(link.get(PDFName.of('Border'))?.toString()).toBe('[ 0 0 0 ]')
  })

  it('refuses an empty destination or non-finite rectangle before mutating the page', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([400, 500])

    expect(() => appendExternalLinkAnnotation(document, page, [10, 10, 20, 20], '', 'link-1')).toThrow(/destination/i)
    expect(() => appendExternalLinkAnnotation(document, page, [10, 10, Number.NaN, 20], 'https://example.com', 'link-1')).toThrow(/rectangle/i)
    expect(page.node.get(PDFName.of('Annots'))).toBeUndefined()
  })
})
