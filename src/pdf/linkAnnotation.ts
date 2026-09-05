import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  type PDFPage,
} from 'pdf-lib'
import { containsControlCharacter } from '../model/linkTarget'

export type PdfLinkRectangle = [number, number, number, number]

const ANNOTS = PDFName.of('Annots')

function annotationArray(document: PDFDocument, page: PDFPage): PDFArray {
  const existing = page.node.get(ANNOTS)
  if (existing instanceof PDFArray) return existing
  if (existing instanceof PDFRef) {
    const resolved = document.context.lookup(existing)
    if (resolved instanceof PDFArray) return resolved
  }
  const created = document.context.obj([]) as PDFArray
  page.node.set(ANNOTS, created)
  return created
}

/** Append a borderless, standards-based external link to a PDF page. */
export function appendExternalLinkAnnotation(
  document: PDFDocument,
  page: PDFPage,
  rectangle: PdfLinkRectangle,
  destination: string,
  id: string,
): void {
  if (!destination || containsControlCharacter(destination)) {
    throw new Error('A PDF link destination must be a non-empty URI.')
  }
  const [left, bottom, right, top] = rectangle
  if (!rectangle.every(Number.isFinite) || right <= left || top <= bottom) {
    throw new Error('A PDF link rectangle must contain four finite, increasing coordinates.')
  }
  const action = document.context.obj({
    S: PDFName.of('URI'),
    URI: PDFString.of(destination),
  })
  const link = document.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: rectangle,
    Border: [0, 0, 0],
    A: action,
    F: 4,
    H: PDFName.of('I'),
    NM: PDFHexString.fromText(id),
  })
  annotationArray(document, page).push(document.context.register(link))
}
