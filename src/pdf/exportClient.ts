import type { EditorDocument } from '../model/editor'
import type { SourcePdfFeatures } from './sourceFeatures'
import type {
  ExportProgress,
  ExportWorkerRequest,
  ExportWorkerResponse,
} from './exportWorkerProtocol'

/**
 * An error raised inside the worker, rebuilt on the main thread. `name` and
 * `features` survive the message boundary so callers can still recognise a
 * compatibility-confirmation failure, which a plain string could not express.
 */
export class ExportWorkerError extends Error {
  readonly features?: SourcePdfFeatures

  constructor(message: string, name: string, features?: SourcePdfFeatures) {
    super(message)
    this.name = name
    this.features = features
  }
}

function createExportWorker(): Worker {
  return new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' })
}

/**
 * Run one request on a fresh worker and terminate it, whatever the outcome.
 * `settle` turns each response into either a resolution or a rejection.
 */
function runOnWorker<T>(
  request: ExportWorkerRequest,
  settle: (response: ExportWorkerResponse, resolve: (value: T) => void, reject: (error: unknown) => void) => void,
  onProgress?: (progress: ExportProgress) => void,
  transfer: Transferable[] = [],
): Promise<T> {
  const worker = createExportWorker()

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (act: () => void) => {
      if (settled) return
      settled = true
      worker.terminate()
      act()
    }

    worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
      const response = event.data
      if (response.type === 'progress') {
        onProgress?.({ completedPages: response.completedPages, totalPages: response.totalPages })
        return
      }
      if (response.type === 'error') {
        finish(() => reject(new ExportWorkerError(response.message, response.name, response.features)))
        return
      }
      settle(response, (value) => finish(() => resolve(value)), (error) => finish(() => reject(error)))
    }

    worker.onerror = (event: unknown) => {
      const message = typeof event === 'object' && event !== null && 'message' in event
        ? String((event as { message?: unknown }).message)
        : 'The export worker stopped unexpectedly.'
      finish(() => reject(new ExportWorkerError(message, 'ExportWorkerError')))
    }

    worker.postMessage(request, { transfer })
  })
}

/**
 * Export on a worker thread so the UI keeps painting while pdf-lib works. The
 * worker reads the file itself, so exporting never allocates the bytes on the main
 * thread. Opening the document separately does, in `loadPdf`.
 */
export function exportInWorker(
  file: File,
  document: EditorDocument,
  onProgress?: (progress: ExportProgress) => void,
  options: {
    allowCompatibilityCopy?: boolean
    insertedFiles?: Array<{ id: string; file: File }>
    rasterizedPages?: Array<{ pageId: string; width: number; height: number; png: ArrayBuffer }>
  } = {},
): Promise<Uint8Array> {
  const rasterizedPages = options.rasterizedPages ?? []
  return runOnWorker<Uint8Array>(
    {
      type: 'start',
      sourceFile: file,
      document,
      allowCompatibilityCopy: options.allowCompatibilityCopy ?? false,
      insertedFiles: options.insertedFiles ?? [],
      rasterizedPages,
    },
    (response, resolve) => {
      if (response.type === 'complete') resolve(new Uint8Array(response.bytes))
    },
    onProgress,
    // Bitmap buffers move to the worker rather than being copied.
    rasterizedPages.map(({ png }) => png),
  )
}

/**
 * Detect structural features on the worker. pdf-lib parses the whole object graph,
 * which would visibly freeze the UI at open time for a large file.
 */
export function analyzeInWorker(file: File): Promise<SourcePdfFeatures> {
  return runOnWorker<SourcePdfFeatures>(
    { type: 'analyze', sourceFile: file },
    (response, resolve) => {
      if (response.type === 'features') resolve(response.features)
    },
  )
}
