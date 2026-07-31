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
