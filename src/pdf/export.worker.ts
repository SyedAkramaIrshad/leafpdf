import type { SourcePdfFeatures } from './sourceFeatures'
import type { ExportWorkerRequest, ExportWorkerResponse } from './exportWorkerProtocol'

function post(response: ExportWorkerResponse, transfer?: Transferable[]) {
  if (transfer) {
    self.postMessage(response, { transfer })
    return
  }
  self.postMessage(response)
}

async function handle(request: ExportWorkerRequest) {
  if (request.type === 'analyze') {
    const { analyzeSourcePdf } = await import('./sourceAnalysis')
    const bytes = new Uint8Array(await request.sourceFile.arrayBuffer())
    post({ type: 'features', features: await analyzeSourcePdf(bytes) })
    return
  }

  const { exportEditedPdf } = await import('./exportPdf')
  const bytes = await exportEditedPdf(
    new Uint8Array(await request.sourceFile.arrayBuffer()),
    request.document,
    {
      allowCompatibilityCopy: request.allowCompatibilityCopy,
      onProgress: (completedPages, totalPages) => post({ type: 'progress', completedPages, totalPages }),
    },
  )
  // Copy into a standalone buffer so the result can be transferred, not cloned.
  const transferable = bytes.slice().buffer as ArrayBuffer
  post({ type: 'complete', bytes: transferable }, [transferable])
}

self.onmessage = async (event: MessageEvent<ExportWorkerRequest>) => {
  try {
    await handle(event.data)
  } catch (error) {
    // Carry the detected features across the message boundary so the main thread
    // can offer the compatibility dialog without re-parsing the document.
    const features = error instanceof Error && error.name === 'CompatibilityConfirmationRequired'
      ? (error as Error & { features?: SourcePdfFeatures }).features
      : undefined
    post({
      type: 'error',
      message: error instanceof Error ? error.message : 'The export failed.',
      name: error instanceof Error ? error.name : 'Error',
      features,
    })
  }
}
