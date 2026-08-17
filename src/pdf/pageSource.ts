import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorPage } from '../model/editor'

/** pdf.js documents inserted this session, keyed by `ExternalPage.documentId`. */
export type ExternalDocuments = ReadonlyMap<string, PDFDocumentProxy>

/**
 * Resolve which pdf.js document and 1-based page number render an editor page.
 * Blank pages (and external pages whose document is gone) have no source: they
 * render as an empty sheet.
 */
export function pageRenderSource(
  page: EditorPage,
  main: PDFDocumentProxy,
  external: ExternalDocuments,
): { pdf: PDFDocumentProxy; pageNumber: number } | null {
  if (page.kind === 'original') return { pdf: main, pageNumber: page.sourceIndex + 1 }
  if (page.kind === 'external') {
    const pdf = external.get(page.documentId)
    return pdf ? { pdf, pageNumber: page.sourceIndex + 1 } : null
  }
  return null
}
