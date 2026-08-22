import type { RedactionAnnotation } from '../model/editor'

/**
 * The subset of CanvasRenderingContext2D used to burn a redaction. Keeping this
 * structural makes the security-critical coordinate transform easy to unit test
 * without creating a browser canvas.
 */
export interface RedactionMaskContext {
  save: () => void
  restore: () => void
  translate: (x: number, y: number) => void
  rotate: (angle: number) => void
  fillRect: (x: number, y: number, width: number, height: number) => void
}

/**
 * Paint one redaction in the same display-space transform used by the editor.
 *
 * Annotation coordinates are normalized against the page's final displayed
 * orientation. CSS previews rotate around the annotation's top-left corner, so
 * the raster mask must translate to that point before applying the same angle.
 * Ignoring this transform would black out an axis-aligned region while the user
 * saw a rotated one, potentially leaving intended content in the exported PDF.
 *
 * The rectangle expands in its local axes before rotation. This puts the
 * antialiased edge outside the intended region, leaving every intended pixel
 * fully opaque rather than blended with sensitive source content.
 */
export function paintRedactionMask(
  context: RedactionMaskContext,
  redaction: RedactionAnnotation,
  canvasWidth: number,
  canvasHeight: number,
  paddingPixels = 2,
): void {
  const x = redaction.x * canvasWidth
  const y = redaction.y * canvasHeight
  const width = redaction.width * canvasWidth
  const height = redaction.height * canvasHeight
  const padding = Math.max(0, paddingPixels)
  const start = padding === 0 ? 0 : -padding

  context.save()
  try {
    context.translate(x, y)
    context.rotate(((redaction.rotation ?? 0) * Math.PI) / 180)
    context.fillRect(
      start,
      start,
      width + padding * 2,
      height + padding * 2,
    )
  } finally {
    context.restore()
  }
}
