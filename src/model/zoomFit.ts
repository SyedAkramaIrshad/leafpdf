export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2.25

export interface FitZoomInput {
  currentZoom: number
  renderedPageWidth: number
  viewportWidth: number
  horizontalInsets: number
}

export function clampZoom(value: number) {
  const finite = Number.isFinite(value) ? value : 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, finite))
}

/**
 * Recover the page's unscaled width from its current rendered width, then choose
 * the zoom that leaves the paper inside the canvas after its real CSS insets.
 * Milliprecision prevents ResizeObserver feedback from producing tiny updates.
 */
export function fitZoomForWidth({
  currentZoom,
  renderedPageWidth,
  viewportWidth,
  horizontalInsets,
}: FitZoomInput) {
  const availableWidth = viewportWidth - horizontalInsets
  if (
    !Number.isFinite(currentZoom)
    || !Number.isFinite(renderedPageWidth)
    || !Number.isFinite(availableWidth)
    || currentZoom <= 0
    || renderedPageWidth <= 0
    || availableWidth <= 0
  ) {
    return clampZoom(currentZoom)
  }

  const fitted = Math.round((currentZoom * availableWidth / renderedPageWidth) * 1000) / 1000
  return clampZoom(fitted)
}
