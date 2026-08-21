import type { SanitizeOptions } from './sanitizePdf'

type SanitizeRequest = {
  bytes: ArrayBuffer
  options: SanitizeOptions
}

type SanitizeResponse =
  | { type: 'complete'; bytes: ArrayBuffer }
  | { type: 'error'; message: string }

self.onmessage = async (event: MessageEvent<SanitizeRequest>) => {
  try {
    const { sanitizePdfBytes } = await import('./sanitizePdf')
    const output = await sanitizePdfBytes(new Uint8Array(event.data.bytes), event.data.options)
    const bytes = output.slice().buffer as ArrayBuffer
    const response: SanitizeResponse = { type: 'complete', bytes }
    self.postMessage(response, { transfer: [bytes] })
  } catch (error) {
    const response: SanitizeResponse = {
      type: 'error',
      message: error instanceof Error ? error.message : 'The sanitized copy could not be created.',
    }
    self.postMessage(response)
  }
}
