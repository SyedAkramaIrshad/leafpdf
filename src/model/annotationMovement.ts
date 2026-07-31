import type { Annotation } from './editor'

function clampDelta(delta: number, lowest: number, highest: number, span: number): number {
  // The moved extent must stay inside [0, 1]: lowest + delta >= 0 and highest + delta <= span.
  return Math.min(span - highest, Math.max(-lowest, delta))
}

/**
 * Normalized coordinates are stored at micro-precision. On a 612pt page one unit
 * here is 0.0006pt, so this keeps repeated drags from accumulating binary
 * floating-point dust in serialized state without moving anything visibly.
 */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/**
 * Translate an annotation by a normalized delta, clamped so the whole annotation
 * stays on the page. Ink is translated point by point; every other kind moves by
 * its top-left corner and is limited by its own width and height.
 */
export function moveAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.kind === 'ink') {
    if (annotation.points.length === 0) return annotation
    const xs = annotation.points.map((point) => point.x)
    const ys = annotation.points.map((point) => point.y)
    const clampedX = clampDelta(dx, Math.min(...xs), Math.max(...xs), 1)
    const clampedY = clampDelta(dy, Math.min(...ys), Math.max(...ys), 1)
    if (clampedX === 0 && clampedY === 0) return annotation
    return {
      ...annotation,
      points: annotation.points.map((point) => ({ x: round(point.x + clampedX), y: round(point.y + clampedY) })),
    }
  }

  const clampedX = clampDelta(dx, annotation.x, annotation.x + annotation.width, 1)
  const clampedY = clampDelta(dy, annotation.y, annotation.y + annotation.height, 1)
  if (clampedX === 0 && clampedY === 0) return annotation
  return { ...annotation, x: round(annotation.x + clampedX), y: round(annotation.y + clampedY) }
}

const MIN_ANNOTATION_SIZE = 0.03

/**
 * Resize a rectangular annotation from its bottom-right corner. The top-left
 * anchor stays fixed, dimensions never fall below a usable handle size, and the
 * resized item cannot extend past the page edge.
 */
export function resizeAnnotation(annotation: Annotation, dw: number, dh: number): Annotation {
  if (annotation.kind === 'ink') return annotation
  const width = round(Math.min(1 - annotation.x, Math.max(MIN_ANNOTATION_SIZE, annotation.width + dw)))
  const height = round(Math.min(1 - annotation.y, Math.max(MIN_ANNOTATION_SIZE, annotation.height + dh)))
  if (width === annotation.width && height === annotation.height) return annotation
  return { ...annotation, width, height }
}

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

export function annotationBounds(annotation: Annotation) {
  if (annotation.kind !== 'ink' || annotation.points.length === 0) {
    return { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height }
  }
  const xs = annotation.points.map(({ x }) => x)
  const ys = annotation.points.map(({ y }) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(1e-6, Math.max(...xs) - x), height: Math.max(1e-6, Math.max(...ys) - y) }
}

/**
 * Resize from any corner while the diagonally opposite corner remains anchored.
 * The result is clamped to the page and never becomes too small to manipulate.
 */
export function resizeAnnotationFromCorner(
  annotation: Annotation,
  corner: ResizeCorner,
  dx: number,
  dy: number,
  preserveAspect: boolean,
): Annotation {
  const box = annotationBounds(annotation)
  const west = corner.includes('w')
  const north = corner.includes('n')
  const anchorX = west ? box.x + box.width : box.x
  const anchorY = north ? box.y + box.height : box.y
  let width = box.width + (west ? -dx : dx)
  let height = box.height + (north ? -dy : dy)

  if (preserveAspect) {
    const aspect = box.width / box.height
    const widthChange = Math.abs(width / box.width - 1)
    const heightChange = Math.abs(height / box.height - 1)
    if (widthChange >= heightChange) height = width / aspect
    else width = height * aspect
  }

  const maxWidth = west ? anchorX : 1 - anchorX
  const maxHeight = north ? anchorY : 1 - anchorY
  if (preserveAspect) {
    const scale = Math.min(maxWidth / width, maxHeight / height, 1)
    width *= scale
    height *= scale
  }
  width = round(Math.min(maxWidth, Math.max(MIN_ANNOTATION_SIZE, width)))
  height = round(Math.min(maxHeight, Math.max(MIN_ANNOTATION_SIZE, height)))
  const x = round(west ? anchorX - width : anchorX)
  const y = round(north ? anchorY - height : anchorY)
  if (x === box.x && y === box.y && width === box.width && height === box.height) return annotation
  if (annotation.kind === 'ink') {
    return {
      ...annotation,
      points: annotation.points.map((point) => ({
        x: round(x + ((point.x - box.x) / box.width) * width),
        y: round(y + ((point.y - box.y) / box.height) * height),
      })),
    }
  }
  return { ...annotation, x, y, width, height }
}

/** Store a stable visual angle in the compact [-180, 180) range. */
export function rotateAnnotation(annotation: Annotation, angle: number): Annotation {
  const rotation = round(((angle + 180) % 360 + 360) % 360 - 180)
  if (annotation.kind === 'ink') {
    const box = annotationBounds(annotation)
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2
    const radians = rotation * Math.PI / 180
    const points = annotation.points.map((point) => ({
      x: centerX + Math.cos(radians) * (point.x - centerX) - Math.sin(radians) * (point.y - centerY),
      y: centerY + Math.sin(radians) * (point.x - centerX) + Math.cos(radians) * (point.y - centerY),
    }))
    const minX = Math.min(...points.map(({ x }) => x))
    const maxX = Math.max(...points.map(({ x }) => x))
    const minY = Math.min(...points.map(({ y }) => y))
    const maxY = Math.max(...points.map(({ y }) => y))
    const shiftX = minX < 0 ? -minX : maxX > 1 ? 1 - maxX : 0
    const shiftY = minY < 0 ? -minY : maxY > 1 ? 1 - maxY : 0
    return {
      ...annotation,
      points: points.map((point) => ({ x: round(point.x + shiftX), y: round(point.y + shiftY) })),
    }
  }
  if ((annotation.rotation ?? 0) === rotation) return annotation
  return { ...annotation, rotation }
}
