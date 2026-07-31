import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { SourcePdfFeatures } from './sourceFeatures'

export interface LoadedPdf {
  document: PDFDocumentProxy
  /**
   * The user's original file, passed by reference to the export worker, which reads
   * the bytes itself, so no export ever allocates them on the main thread. Note that
   * opening the document does allocate one main-thread copy; see `loadPdf`.
   */
  sourceFile: File
  fileName: string
  pageCount: number
  /** Stable source identity used to prevent recovery records crossing PDFs. */
  documentFingerprint: string
  /** Structural features detected once at open time, so export can warn without re-parsing. */
  features: SourcePdfFeatures
}
