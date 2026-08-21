import {
  editorReducer,
  type Annotation,
  type EditorAction,
  type EditorState,
} from './editorCore'

const KEYBOARD_STEPS = [0.01, 0.05]
const EPSILON = 0.000002

function near(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= EPSILON
}

function isStep(value: number): boolean {
  return KEYBOARD_STEPS.some((step) => near(Math.abs(value), step))
}

function sameExceptPosition(left: Annotation, right: Annotation): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'ink' || right.kind === 'ink') return false
  const leftCopy = { ...left, x: 0, y: 0 }
  const rightCopy = { ...right, x: 0, y: 0 }
  return JSON.stringify(leftCopy) === JSON.stringify(rightCopy)
}

function isRectangularKeyboardNudge(left: Annotation, right: Annotation): boolean {
  if (left.kind === 'ink' || right.kind === 'ink') return false
  if (!sameExceptPosition(left, right)) return false
  const dx = right.x - left.x
  const dy = right.y - left.y
  return (isStep(dx) && near(dy, 0)) || (isStep(dy) && near(dx, 0))
}

function isInkKeyboardNudge(left: Annotation, right: Annotation): boolean {
  if (left.kind !== 'ink' || right.kind !== 'ink') return false
  if (left.points.length === 0 || left.points.length !== right.points.length) return false
  if (left.id !== right.id || left.pageId !== right.pageId) return false
  if (left.color !== right.color || left.strokeWidth !== right.strokeWidth) return false
  const dx = right.points[0].x - left.points[0].x
  const dy = right.points[0].y - left.points[0].y
  if (!((isStep(dx) && near(dy, 0)) || (isStep(dy) && near(dx, 0)))) return false
  return left.points.every((point, index) => {
    const next = right.points[index]
    return near(next.x - point.x, dx) && near(next.y - point.y, dy)
  })
}

function isKeyboardNudge(left: Annotation, right: Annotation): boolean {
  return left.id === right.id
    && left.pageId === right.pageId
    && (isRectangularKeyboardNudge(left, right) || isInkKeyboardNudge(left, right))
}

/**
 * The view emits a complete `replaceAnnotation` for both pointer gestures and
 * keyboard movement. Exact 1%/5% single-axis translations are the documented
 * keyboard steps, so only those replacements join a history group. Pointer drag,
 * resize, and rotation remain one independent undo entry per gesture.
 */
export function nextLevelEditorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'selectAnnotation' && action.annotationId !== state.selectedAnnotationId) {
    const selected = editorReducer(state, action)
    return selected.historyGroupKey === null ? selected : { ...selected, historyGroupKey: null }
  }

  if (action.type !== 'replaceAnnotation') return editorReducer(state, action)
  const current = state.present.annotations.find((annotation) => annotation.id === action.annotation.id)
  if (!current || !isKeyboardNudge(current, action.annotation)) return editorReducer(state, action)

  return editorReducer(state, {
    type: 'updateAnnotation',
    annotationId: action.annotation.id,
    patch: action.annotation,
    historyGroup: `annotation-${action.annotation.id}-keyboard-nudge`,
  })
}
