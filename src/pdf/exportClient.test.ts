import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeInWorker, exportInWorker } from './exportClient'
import { createEditorState } from '../model/editor'
import type { ExportWorkerRequest, ExportWorkerResponse } from './exportWorkerProtocol'

interface FakeWorkerInstance {
  posted: Array<{ message: ExportWorkerRequest; transfer?: Transferable[] }>
  terminated: boolean
  emit: (response: ExportWorkerResponse) => void
  fail: (error: unknown) => void
}

const instances: FakeWorkerInstance[] = []

class FakeWorker {
  onmessage: ((event: MessageEvent<ExportWorkerResponse>) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  posted: FakeWorkerInstance['posted'] = []
  terminated = false

  constructor() {
    instances.push(this as unknown as FakeWorkerInstance)
  }

  postMessage(message: ExportWorkerRequest, transfer?: Transferable[]) {
    this.posted.push({ message, transfer })
  }

  terminate() {
    this.terminated = true
  }

  emit(response: ExportWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<ExportWorkerResponse>)
  }

  fail(error: unknown) {
    this.onerror?.(error)
  }
}

function fileOf(bytes: number[]): File {
  return new File([new Uint8Array(bytes)], 'sample.pdf', { type: 'application/pdf' })
}

afterEach(() => {
  instances.length = 0
  vi.unstubAllGlobals()
})

describe('exportInWorker', () => {
  it('sends the serializable editor document and the source file, then resolves with the result', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const document = createEditorState('sample.pdf', 1).present
    const file = fileOf([37, 80, 68, 70])
    const pending = exportInWorker(file, document)

    await vi.waitFor(() => expect(instances[0]?.posted).toHaveLength(1))
    const [{ message }] = instances[0].posted
    expect(message.type).toBe('start')
    if (message.type !== 'start') throw new Error('expected a start request')
    expect(message.document).toEqual(document)
    // The document must survive structured cloning, so it may hold no functions.
    expect(() => structuredClone(message.document)).not.toThrow()
    // The file is passed by reference; the main thread never reads its bytes.
    expect(message.sourceFile).toBe(file)
    expect(message.allowCompatibilityCopy).toBe(false)

    instances[0].emit({ type: 'complete', bytes: new Uint8Array([1, 2, 3]).buffer })
    await expect(pending).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(instances[0].terminated).toBe(true)
  })

  it('forwards an accepted compatibility copy to the worker', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const pending = exportInWorker(fileOf([37]), createEditorState('sample.pdf', 1).present, undefined, {
      allowCompatibilityCopy: true,
    })

    await vi.waitFor(() => expect(instances[0]?.posted).toHaveLength(1))
    const [{ message }] = instances[0].posted
    if (message.type !== 'start') throw new Error('expected a start request')
    expect(message.allowCompatibilityCopy).toBe(true)

    instances[0].emit({ type: 'complete', bytes: new Uint8Array([1]).buffer })
    await pending
  })

  it('analyzes a source file on the worker without reading it on the main thread', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const file = fileOf([37, 80])
    const pending = analyzeInWorker(file)

    await vi.waitFor(() => expect(instances[0]?.posted).toHaveLength(1))
    const [{ message }] = instances[0].posted
    expect(message.type).toBe('analyze')
    if (message.type !== 'analyze') throw new Error('expected an analyze request')
    expect(message.sourceFile).toBe(file)

    const features = {
      isEncrypted: false,
      hasMetadata: true, hasOutlines: false, hasAttachments: false,
      hasAcroForm: false, hasDigitalSignatures: false, additionalFeatures: [],
    }
    instances[0].emit({ type: 'features', features })
    await expect(pending).resolves.toEqual(features)
    expect(instances[0].terminated).toBe(true)
  })

  it('reports progress to the caller', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const onProgress = vi.fn()
    const pending = exportInWorker(fileOf([37]), createEditorState('sample.pdf', 1).present, onProgress)

    await vi.waitFor(() => expect(instances[0]?.posted).toHaveLength(1))
    instances[0].emit({ type: 'progress', completedPages: 1, totalPages: 4 })
    expect(onProgress).toHaveBeenCalledWith({ completedPages: 1, totalPages: 4 })

    instances[0].emit({ type: 'complete', bytes: new Uint8Array([9]).buffer })
    await pending
  })

  it('surfaces the exact worker error message', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const pending = exportInWorker(fileOf([37]), createEditorState('sample.pdf', 1).present)

    await vi.waitFor(() => expect(instances[0]?.posted).toHaveLength(1))
    instances[0].emit({ type: 'error', message: 'LeafPDF cannot embed a font for "你好".', name: 'Error' })

    await expect(pending).rejects.toThrow('LeafPDF cannot embed a font for "你好".')
    expect(instances[0].terminated).toBe(true)
  })

  it('preserves the error name so callers can branch on it', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const pending = exportInWorker(fileOf([37]), createEditorState('sample.pdf', 1).present)

    await vi.waitFor(() => expect(instances[0]?.posted).toHaveLength(1))
    instances[0].emit({
      type: 'error',
      message: 'This PDF needs a compatibility copy.',
      name: 'CompatibilityConfirmationRequired',
      features: {
        isEncrypted: false,
        hasMetadata: false, hasOutlines: true, hasAttachments: false,
        hasAcroForm: false, hasDigitalSignatures: false, additionalFeatures: [],
      },
    })

    await expect(pending).rejects.toMatchObject({
      name: 'CompatibilityConfirmationRequired',
      features: { hasOutlines: true },
    })
  })

  it('rejects and terminates when the worker itself fails to run', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const pending = exportInWorker(fileOf([37]), createEditorState('sample.pdf', 1).present)

    await vi.waitFor(() => expect(instances[0]?.posted).toHaveLength(1))
    instances[0].fail(new ErrorEvent('error', { message: 'worker boot failure' }))

    await expect(pending).rejects.toThrow(/worker boot failure/)
    expect(instances[0].terminated).toBe(true)
  })
})
