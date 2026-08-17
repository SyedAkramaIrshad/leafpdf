import type { EditorDocument } from '../model/editor'
import type { SourcePdfFeatures } from './sourceFeatures'

/**
 * Both requests carry the user's `File` rather than an ArrayBuffer. A File is cloned by
 * reference to its underlying blob data, so neither of these messages materialises the
 * bytes of a large PDF on the main thread — only the worker reads them, once.
 * (Opening the document is a separate path that does allocate one copy; see `loadPdf`.)
 */
export interface ExportStartRequest {
  type: 'start'
  sourceFile: File
  document: EditorDocument
  allowCompatibilityCopy: boolean
  /**
   * The other PDFs whose pages the document inserts, keyed by the id carried in
   * each external page. Also Files, for the same no-main-thread-bytes reason.
   */
  insertedFiles: Array<{ id: string; file: File }>
  /**
   * Pre-rendered bitmaps for every source-backed page carrying a redaction.
   * Rendered on the main thread (pdf.js needs a canvas); the buffers are
   * transferred, not cloned. The exporter refuses to fall back to the original
   * page when one is missing.
   */
  rasterizedPages: Array<{ pageId: string; width: number; height: number; png: ArrayBuffer }>
}

export interface AnalyzeRequest {
  type: 'analyze'
  sourceFile: File
}

export type ExportWorkerRequest = ExportStartRequest | AnalyzeRequest

export interface ExportProgress {
  completedPages: number
  totalPages: number
}

export type ExportWorkerResponse =
  | ({ type: 'progress' } & ExportProgress)
  | { type: 'complete'; bytes: ArrayBuffer }
  | { type: 'features'; features: SourcePdfFeatures }
  | { type: 'error'; message: string; name: string; features?: SourcePdfFeatures }
