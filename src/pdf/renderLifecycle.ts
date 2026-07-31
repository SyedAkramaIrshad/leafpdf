/**
 * PDF.js rejects a superseded canvas render with `RenderingCancelledException`.
 * That rejection is the expected result of our own `cancel()` call, so it must
 * never reach the user as a page-render failure.
 */
export function isRenderCancellation(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'RenderingCancelledException',
  )
}

export const PAGE_RENDER_ERROR = 'This page could not be rendered.'
