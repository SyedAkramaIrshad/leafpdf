import type { Annotation } from './editor'
import { annotationBounds, annotationsBounds, moveAnnotation, moveAnnotations } from './annotationMovement'

export interface AlignmentGuides {
  x: number | null
  y: number | null
}

export interface AlignmentSnapResult {
  annotation: Annotation
  guides: AlignmentGuides
}

export interface GroupAlignmentSnapResult {
  annotations: Annotation[]
  guides: AlignmentGuides
}

interface PageSize {
  width: number
  height: number
}

interface AxisSnap {
  correction: number
  guide: number | null
}

const NO_GUIDES: AlignmentGuides = { x: null, y: null }
const PAGE_TARGETS = [0.5, 0, 1]

function roundCoordinate(value: number) {
  return Math.round(value * 1e6) / 1e6
}

function anchors(start: number, size: number) {
  return [start + size / 2, start, start + size].map(roundCoordinate)
}

function axisTargets(peers: Annotation[], axis: 'x' | 'y') {
  const targets = [...PAGE_TARGETS]
  for (const peer of peers) {
    const box = annotationBounds(peer)
    const start = axis === 'x' ? box.x : box.y
    const size = axis === 'x' ? box.width : box.height
    targets.push(...anchors(start, size))
  }
  return targets
}

function nearestAxisSnap(
  start: number,
  size: number,
  targets: number[],
  pixelSpan: number,
  thresholdPx: number,
): AxisSnap {
  let best: { correction: number; guide: number; distance: number } | null = null

  for (const source of anchors(start, size)) {
    for (const target of targets) {
      const correction = target - source
      const distance = Math.abs(correction * pixelSpan)
      if (distance > thresholdPx + Number.EPSILON) continue
      if (best && distance >= best.distance - Number.EPSILON) continue
      best = { correction, guide: target, distance }
    }
  }

  return best
    ? { correction: best.correction, guide: best.guide }
    : { correction: 0, guide: null }
}

/**
 * Snap a pointer-dragged annotation to the nearest page or peer edge/center.
 * Coordinates stay normalized, while the tolerance is converted from CSS pixels
 * independently for each page axis. Rotated rectangles are intentionally excluded
 * until their transformed visual bounds can be represented without misleading rules.
 */
export function snapDraggedAnnotation(
  annotation: Annotation,
  peers: Annotation[],
  pageSize: PageSize,
  thresholdPx = 6,
): AlignmentSnapResult {
  if (
    (annotation.rotation ?? 0) !== 0
    || !Number.isFinite(pageSize.width)
    || !Number.isFinite(pageSize.height)
    || pageSize.width <= 0
    || pageSize.height <= 0
    || !Number.isFinite(thresholdPx)
    || thresholdPx < 0
  ) {
    return { annotation, guides: NO_GUIDES }
  }

  const eligiblePeers = peers.filter((peer) => (
    peer.id !== annotation.id
    && peer.pageId === annotation.pageId
    && (peer.rotation ?? 0) === 0
  ))
  const box = annotationBounds(annotation)
  const xSnap = nearestAxisSnap(
    box.x,
    box.width,
    axisTargets(eligiblePeers, 'x'),
    pageSize.width,
    thresholdPx,
  )
  const ySnap = nearestAxisSnap(
    box.y,
    box.height,
    axisTargets(eligiblePeers, 'y'),
    pageSize.height,
    thresholdPx,
  )

  return {
    annotation: moveAnnotation(annotation, xSnap.correction, ySnap.correction),
    guides: { x: xSnap.guide, y: ySnap.guide },
  }
}

/** Snap the union of a same-page selection while preserving internal spacing. */
export function snapDraggedAnnotations(
  annotations: Annotation[],
  peers: Annotation[],
  pageSize: PageSize,
  thresholdPx = 6,
): GroupAlignmentSnapResult {
  const pageIds = new Set(annotations.map(({ pageId }) => pageId))
  if (
    annotations.length === 0
    || pageIds.size !== 1
    || annotations.some((annotation) => (annotation.rotation ?? 0) !== 0)
    || !Number.isFinite(pageSize.width)
    || !Number.isFinite(pageSize.height)
    || pageSize.width <= 0
    || pageSize.height <= 0
    || !Number.isFinite(thresholdPx)
    || thresholdPx < 0
  ) {
    return { annotations, guides: NO_GUIDES }
  }

  const pageId = annotations[0].pageId
  const selectedIds = new Set(annotations.map(({ id }) => id))
  const eligiblePeers = peers.filter((peer) => (
    !selectedIds.has(peer.id)
    && peer.pageId === pageId
    && (peer.rotation ?? 0) === 0
  ))
  const box = annotationsBounds(annotations)
  if (!box) return { annotations, guides: NO_GUIDES }
  const xSnap = nearestAxisSnap(
    box.x,
    box.width,
    axisTargets(eligiblePeers, 'x'),
    pageSize.width,
    thresholdPx,
  )
  const ySnap = nearestAxisSnap(
    box.y,
    box.height,
    axisTargets(eligiblePeers, 'y'),
    pageSize.height,
    thresholdPx,
  )

  return {
    annotations: moveAnnotations(annotations, xSnap.correction, ySnap.correction),
    guides: { x: xSnap.guide, y: ySnap.guide },
  }
}
