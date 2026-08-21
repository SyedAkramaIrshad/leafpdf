import type { SanitizeOptions } from './sanitizePdf'

type SanitizeResponse =
  | { type: 'complete'; bytes: ArrayBuffer }
  | { type: 'error'; message: string }

export function sanitizeInWorker(bytes: Uint8Array, options: SanitizeOptions = {}): Promise<Uint8Array> {
  const worker = new Worker(new URL('./sanitize.worker.ts', import.meta.url), { type: 'module' })
  const transferable = bytes.slice().buffer as ArrayBuffer
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      worker.terminate()
      action()
    }
    worker.onmessage = (event: MessageEvent<SanitizeResponse>) => {
      if (event.data.type === 'error') {
        finish(() => reject(new Error(event.data.message)))
      } else {
        finish(() => resolve(new Uint8Array(event.data.bytes)))
      }
    }
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || 'The sanitization worker stopped unexpectedly.')))
    }
    worker.postMessage({ bytes: transferable, options }, { transfer: [transferable] })
  })
}
