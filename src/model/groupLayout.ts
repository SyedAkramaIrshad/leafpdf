import type { Annotation } from './editor'
import { annotationBounds, annotationsBounds, moveAnnotation } from './annotationMovement'

export type GroupAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'

/** Align same-page items to their current group extent without changing size. */
export function alignAnnotations(
  annotations: Annotation[],
  alignment: GroupAlignment,
): Annotation[] {
  if (
    annotations.length < 2
    || new Set(annotations.map(({ pageId }) => pageId)).size !== 1
  ) return annotations

  const group = annotationsBounds(annotations)
  if (!group) return annotations
  return annotations.map((annotation) => {
    const box = annotationBounds(annotation)
    const dx = alignment === 'left'
      ? group.x - box.x
      : alignment === 'center-x'
        ? group.x + group.width / 2 - (box.x + box.width / 2)
        : alignment === 'right'
          ? group.x + group.width - (box.x + box.width)
          : 0
    const dy = alignment === 'top'
      ? group.y - box.y
      : alignment === 'center-y'
        ? group.y + group.height / 2 - (box.y + box.height / 2)
        : alignment === 'bottom'
          ? group.y + group.height - (box.y + box.height)
          : 0
    return moveAnnotation(annotation, dx, dy)
  })
}
