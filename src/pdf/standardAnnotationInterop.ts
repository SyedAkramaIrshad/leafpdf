import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  type PDFPage,
} from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ReviewComment } from '../project/projectTypes'

const TEXT_ANNOTATION_TYPE = 1
const ANNOTS = PDFName.of('Annots')

function annotationArray(document: PDFDocument, page: PDFPage): PDFArray {
  const existing = page.node.get(ANNOTS)
  if (existing instanceof PDFArray) return existing
  if (existing instanceof PDFRef) {
    const resolved = document.context.lookup(existing)
    if (resolved instanceof PDFArray) return resolved
  }
  const created = document.context.obj([])
  page.node.set(ANNOTS, created)
  return created
}

/**
 * Attach LeafPDF review comments as standard `/Text` annotations. These remain
 * recognizable as comments in Acrobat, Preview, Firefox, and other conforming
 * readers instead of being flattened into page graphics.
 */
export async function addStandardTextComments(
  sourceBytes: Uint8Array,
  comments: ReviewComment[],
  pageIndexById: Map<string, number>,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(sourceBytes.slice(), { updateMetadata: false })
  const pages = document.getPages()

  for (const comment of comments) {
    const pageIndex = pageIndexById.get(comment.pageId)
    if (pageIndex === undefined || pageIndex < 0 || pageIndex >= pages.length) continue
    const page = pages[pageIndex]
    const { width, height } = page.getSize()
    const iconSize = Math.min(24, width * 0.04, height * 0.04)
    const x = Math.max(0, Math.min(width - iconSize, comment.x * width))
    const y = Math.max(0, Math.min(height - iconSize, height - comment.y * height - iconSize))
    const annotation = document.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      Rect: [x, y, x + iconSize, y + iconSize],
      Contents: PDFHexString.fromText(comment.body),
      T: PDFHexString.fromText(comment.author || 'LeafPDF reviewer'),
      C: comment.resolved ? [0.25, 0.65, 0.42] : [1, 0.78, 0.2],
      F: 4,
      Name: PDFName.of(comment.resolved ? 'Check' : 'Comment'),
      NM: PDFHexString.fromText(comment.id),
    })
    annotationArray(document, page).push(document.context.register(annotation))
  }

  document.setProducer('LeafPDF')
  document.setModificationDate(new Date())
  return document.save()
}

function textFromObject(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'str' in value) {
    const text = (value as { str?: unknown }).str
    return typeof text === 'string' ? text : ''
  }
  return ''
}

function parsePdfDate(value: unknown): number {
  if (typeof value !== 'string') return Date.now()
  const match = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(value)
  if (!match) return Date.now()
  const [, year, month, day, hour, minute, second] = match
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
}

/** Import standard PDF text-note annotations into the LeafPDF review panel. */
export async function importStandardTextComments(
  pdf: PDFDocumentProxy,
  pageIdsBySourceIndex: string[],
): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = []
  for (let sourceIndex = 0; sourceIndex < pageIdsBySourceIndex.length; sourceIndex += 1) {
    const pageId = pageIdsBySourceIndex[sourceIndex]
    if (!pageId || sourceIndex >= pdf.numPages) continue
    const page = await pdf.getPage(sourceIndex + 1)
    const viewport = page.getViewport({ scale: 1 })
    const annotations = await page.getAnnotations({ intent: 'display' })
    for (const annotation of annotations as Array<Record<string, unknown>>) {
      if (annotation.annotationType !== TEXT_ANNOTATION_TYPE) continue
      const rect = annotation.rect
      if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((value) => typeof value === 'number')) continue
      const converted = viewport.convertToViewportRectangle(rect as [number, number, number, number])
      const left = Math.min(converted[0], converted[2])
      const top = Math.min(converted[1], converted[3])
      const createdAt = parsePdfDate(annotation.modificationDate)
      comments.push({
        id: typeof annotation.id === 'string' ? `pdf-${annotation.id}` : `pdf-${sourceIndex}-${comments.length}`,
        pageId,
        x: Math.max(0, Math.min(1, left / viewport.width)),
        y: Math.max(0, Math.min(1, top / viewport.height)),
        body: textFromObject(annotation.contentsObj ?? annotation.contents),
        author: textFromObject(annotation.titleObj ?? annotation.title),
        createdAt,
        updatedAt: createdAt,
        resolved: annotation.name === 'Check',
      })
    }
  }
  return comments
}
