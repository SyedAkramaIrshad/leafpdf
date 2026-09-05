import type { ImageAnnotation, NormalizedPoint } from './editor'

const MIN_MEDIA_SIZE = 0.02

export interface PendingMediaPlacement {
  dataUrl: string
  mimeType: ImageAnnotation['mimeType']
  role?: ImageAnnotation['role']
  width: number
  /** Intrinsic bitmap width divided by height. */
  aspectRatio: number
}

export interface MediaSurfaceSize {
  width: number
  height: number
}

export interface MediaPlacementBounds {
  x: number
  y: number
  width: number
  height: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number) {
  return Math.round(value * 1e6) / 1e6
}

function positiveOr(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function mediaSize(value: number) {
  return clamp(Number.isFinite(value) ? value : MIN_MEDIA_SIZE, MIN_MEDIA_SIZE, 1)
}

function pointCoordinate(value: number) {
  return clamp(Number.isFinite(value) ? value : 0.5, 0, 1)
}

function annotationOrigin(value: number, size: number) {
  return Number.isFinite(value)
    ? clamp(value, 0, 1 - size)
    : (1 - size) / 2
}

function proportionalSize(pending: PendingMediaPlacement, surface: MediaSurfaceSize) {
  const surfaceWidth = positiveOr(surface.width, 1)
  const surfaceHeight = positiveOr(surface.height, 1)
  const pageRatio = positiveOr(surfaceWidth / surfaceHeight, 1)
  const aspectRatio = positiveOr(pending.aspectRatio, 1)
  const preferredWidth = mediaSize(pending.width)
  const preferredHeight = positiveOr(preferredWidth * pageRatio / aspectRatio, MIN_MEDIA_SIZE)
  const scale = Math.min(1, 1 / preferredWidth, 1 / preferredHeight)
  return {
    width: round(preferredWidth * scale),
    height: round(preferredHeight * scale),
  }
}

export function mediaPlacementBounds(
  pending: PendingMediaPlacement,
  point: NormalizedPoint,
  surface: MediaSurfaceSize,
): MediaPlacementBounds {
  const { width, height } = proportionalSize(pending, surface)
  const centreX = pointCoordinate(point.x)
  const centreY = pointCoordinate(point.y)
  return {
    x: round(clamp(centreX - width / 2, 0, 1 - width)),
    y: round(clamp(centreY - height / 2, 0, 1 - height)),
    width,
    height,
  }
}

export function mediaAnnotationAtPoint(
  pending: PendingMediaPlacement,
  pageId: string,
  point: NormalizedPoint,
  id: string,
  surface: MediaSurfaceSize,
): ImageAnnotation {
  return {
    id,
    pageId,
    kind: 'image',
    ...mediaPlacementBounds(pending, point, surface),
    dataUrl: pending.dataUrl,
    mimeType: pending.mimeType,
    role: pending.role,
  }
}

/**
 * Swap the bitmap inside an existing image while keeping its visual centre in
 * the same page-pixel location. Rotation happens in page pixels, where a
 * normalized x unit and y unit can have different physical lengths, so the
 * calculation deliberately leaves normalized space until the final clamp.
 */
export function replacementMediaBounds(
  annotation: Pick<ImageAnnotation, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  aspectRatio: number,
  surface: MediaSurfaceSize,
): MediaPlacementBounds {
  const surfaceWidth = positiveOr(surface.width, 1)
  const surfaceHeight = positiveOr(surface.height, 1)
  const oldWidth = mediaSize(annotation.width)
  const oldHeight = mediaSize(annotation.height)
  const oldX = annotationOrigin(annotation.x, oldWidth) * surfaceWidth
  const oldY = annotationOrigin(annotation.y, oldHeight) * surfaceHeight
  const oldWidthPixels = oldWidth * surfaceWidth
  const oldHeightPixels = oldHeight * surfaceHeight
  const rotation = Number.isFinite(annotation.rotation) ? annotation.rotation ?? 0 : 0
  const radians = rotation * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const centreX = oldX + cosine * oldWidthPixels / 2 - sine * oldHeightPixels / 2
  const centreY = oldY + sine * oldWidthPixels / 2 + cosine * oldHeightPixels / 2
  const size = proportionalSize({
    dataUrl: '',
    mimeType: 'image/png',
    width: oldWidth,
    aspectRatio,
  }, { width: surfaceWidth, height: surfaceHeight })
  const newWidthPixels = size.width * surfaceWidth
  const newHeightPixels = size.height * surfaceHeight
  const originX = centreX - cosine * newWidthPixels / 2 + sine * newHeightPixels / 2
  const originY = centreY - sine * newWidthPixels / 2 - cosine * newHeightPixels / 2

  return {
    x: round(clamp(originX / surfaceWidth, 0, 1 - size.width)),
    y: round(clamp(originY / surfaceHeight, 0, 1 - size.height)),
    width: size.width,
    height: size.height,
  }
}
