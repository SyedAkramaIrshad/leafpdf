import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorDocument, RedactionAnnotation } from '../model/editor'
import { pageRenderSource, type ExternalDocuments } from './pageSource'
import { paintRedactionMask } from './redactionMask'

/**
 * Device pixels per PDF point when burning a redaction, i.e. 144 DPI. High
 * enough that ordinary documents stay crisp in print, low enough that a
 * rasterized page stays a few hundred kilobytes.
 */
const REDACTION_RASTER_SCALE = 2

/** The same ceiling the page canvas uses, so no page can demand an absurd bitmap. */
const PIXEL_BUDGET = 16_000_000

export interface RasterizedPage {
  pageId: string
  /** Final page size in PDF points, at the page's display orientation. */
  width: number
  height: number
  png: ArrayBuffer
}

/**
 * Render every source-backed page that carries a redaction to a bitmap, with
 * the redacted regions burned in as opaque black. The bitmaps replace those
 * pages wholesale at export, which is what makes the removal irreversible:
 * the exported file contains pixels, not the original text and graphics.
 *
 * Runs on the main thread because rendering needs pdf.js and a canvas; the
 * heavy PDF assembly still happens on the worker.
 */
export async function rasterizeRedactedPages(
  main: PDFDocumentProxy,
  external: ExternalDocuments,
  document: EditorDocument,
): Promise<RasterizedPage[]> {
  const results: RasterizedPage[] = []
  for (const page of document.pages) {
    const redactions = document.annotations.filter(
      (annotation): annotation is RedactionAnnotation =>
        annotation.pageId === page.id && annotation.kind === 'redaction',
    )
    // A blank page has no source content to remove; its boxes are drawn as
    // plain black rectangles by the exporter instead.
    if (redactions.length === 0 || page.kind === 'blank') continue

    const source = pageRenderSource(page, main, external)
    if (!source) throw new Error('A redacted page could not be read, so the export was stopped.')
    const sourcePage = await source.pdf.getPage(source.pageNumber)
    const rotation = (sourcePage.rotate + page.rotation) % 360
    const base = sourcePage.getViewport({ scale: 1, rotation })
    const scale = Math.min(REDACTION_RASTER_SCALE, Math.sqrt(PIXEL_BUDGET / (base.width * base.height)))
    const viewport = sourcePage.getViewport({ scale, rotation })

    const canvas = window.document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('This browser refused a drawing surface for redaction.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await sourcePage.render({ canvas, canvasContext: context, viewport }).promise

    context.fillStyle = '#000000'
    for (const redaction of redactions) {
      // Match the preview's top-left rotation transform. The helper expands the
      // local rectangle before rotating so antialiasing cannot expose an edge.
      paintRedactionMask(context, redaction, canvas.width, canvas.height)
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('The redacted page image could not be encoded.')
    results.push({
      pageId: page.id,
      width: base.width,
      height: base.height,
      png: await blob.arrayBuffer(),
    })
  }
  return results
}
