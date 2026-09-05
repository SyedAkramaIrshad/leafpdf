import { Fragment, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import {
  moveAnnotation,
  moveAnnotations,
  annotationBounds,
  annotationsBounds,
  resizeAnnotationFromCorner,
  rotateAnnotation,
  type ResizeCorner,
} from '../model/annotationMovement'
import {
  snapDraggedAnnotation,
  snapDraggedAnnotations,
  type AlignmentGuides,
} from '../model/alignmentSnapping'
import {
  imageOpacityOf,
  textMarkStrokeWidthOf,
  textMarkStyleOf,
  type Annotation,
  type EditorAction,
  type HighlightAnnotation,
  type Tool,
} from '../model/editor'
import { InlineTextEditor } from './InlineTextEditor'

function annotationSelectionLabel(annotation: Annotation) {
  if (annotation.kind === 'highlight') return `Select ${textMarkStyleOf(annotation)} annotation`
  if (annotation.kind === 'form-field') {
    if (annotation.fieldType === 'radio') {
      return `Select radio choice ${annotation.optionValue} in ${annotation.fieldName} group`
    }
    return {
      text: 'Select text field',
      checkbox: 'Select checkbox field',
      dropdown: 'Select dropdown field',
    }[annotation.fieldType]
  }
  if (annotation.kind === 'image' && annotation.role === 'signature') return 'Select signature annotation'
  if (annotation.kind === 'stamp') {
    const name = annotation.stamp === 'check' ? 'checkmark' : annotation.stamp
    return `Select ${name} annotation`
  }
  return `Select ${annotation.kind} annotation`
}

function TextMarkPreview({ annotation, renderScale }: { annotation: HighlightAnnotation; renderScale: number }) {
  const mark = textMarkStyleOf(annotation)
  if (mark === 'highlight') {
    return <span className="highlight-fill" style={{ background: annotation.color, opacity: annotation.opacity }} />
  }
  const y = mark === 'underline' ? 82 : 50
  return (
    <svg
      className={`text-mark-preview is-${mark}`}
      data-text-mark={mark}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line
        x1="1"
        y1={y}
        x2="99"
        y2={y}
        stroke={annotation.color}
        strokeWidth={textMarkStrokeWidthOf(annotation) * renderScale}
        strokeOpacity={annotation.opacity}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

interface AnnotationLayerProps {
  annotations: Annotation[]
  activeTool: Tool
  selectedAnnotationIds: string[]
  multiSelectMode?: boolean
  onMultiSelectComplete?: () => void
  dispatch: (action: EditorAction) => void
  onCreate: (event: PointerEvent<HTMLDivElement>) => void
  onDrawStart: (event: PointerEvent<HTMLDivElement>) => void
  onDrawMove: (event: PointerEvent<HTMLDivElement>) => void
  onDrawEnd: (event: PointerEvent<HTMLDivElement>) => void
  draftPoints: Array<{ x: number; y: number }>
  renderScale: number
}

const ARROW_DELTAS: Record<string, { dx: number; dy: number } | undefined> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

const NO_ALIGNMENT_GUIDES: AlignmentGuides = { x: null, y: null }

export function AnnotationLayer({
  annotations,
  activeTool,
  selectedAnnotationIds,
  multiSelectMode = false,
  onMultiSelectComplete,
  dispatch,
  onCreate,
  onDrawStart,
  onDrawMove,
  onDrawEnd,
  draftPoints,
  renderScale,
}: AnnotationLayerProps) {
  const drag = useRef<{ annotations: Annotation[]; clientX: number; clientY: number } | null>(null)
  const resize = useRef<{ annotation: Annotation; corner: ResizeCorner; clientX: number; clientY: number } | null>(null)
  const rotating = useRef<{ annotation: Annotation; centerX: number; centerY: number; pointerAngle: number } | null>(null)
  const [pointerPreview, setPointerPreview] = useState<Annotation[] | null>(null)
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>(NO_ALIGNMENT_GUIDES)
  const selectedAnnotations = annotations.filter(({ id }) => selectedAnnotationIds.includes(id))

  const layerBounds = (element: Element) =>
    element.closest('.annotation-layer')?.getBoundingClientRect()

  const movedFromPointer = (event: PointerEvent<Element>) => {
    const current = drag.current
    const bounds = layerBounds(event.currentTarget)
    if (!current || !bounds || bounds.width === 0 || bounds.height === 0) return null
    const screenX = event.clientX - current.clientX
    const screenY = event.clientY - current.clientY
    const moved = moveAnnotations(
      current.annotations,
      screenX / bounds.width,
      screenY / bounds.height,
    )
    if (event.altKey || (screenX === 0 && screenY === 0)) {
      return { annotations: moved, guides: NO_ALIGNMENT_GUIDES }
    }
    if (moved.length === 1) {
      const result = snapDraggedAnnotation(moved[0], annotations, bounds)
      return { annotations: [result.annotation], guides: result.guides }
    }
    return snapDraggedAnnotations(moved, annotations, bounds)
  }

  const resizedFromPointer = (event: PointerEvent<Element>) => {
    const current = resize.current
    const bounds = layerBounds(event.currentTarget)
    if (!current || !bounds || bounds.width === 0 || bounds.height === 0) return null
    const screenX = event.clientX - current.clientX
    const screenY = event.clientY - current.clientY
    const radians = -((current.annotation.rotation ?? 0) * Math.PI / 180)
    // Handles rotate with the item. Convert the screen-space pointer movement back
    // into the annotation's local axes before changing its width and height.
    const localX = Math.cos(radians) * screenX - Math.sin(radians) * screenY
    const localY = Math.sin(radians) * screenX + Math.cos(radians) * screenY
    return resizeAnnotationFromCorner(
      current.annotation,
      current.corner,
      localX / bounds.width,
      localY / bounds.height,
      current.annotation.kind === 'image'
        || (current.annotation.kind === 'form-field'
          && (current.annotation.fieldType === 'checkbox' || current.annotation.fieldType === 'radio'))
        || event.shiftKey,
    )
  }

  const beginDrag = (event: PointerEvent<Element>, annotation: Annotation) => {
    if (activeTool !== 'select') return
    const additive = multiSelectMode || event.shiftKey || event.metaKey || event.ctrlKey
    if (additive) {
      event.preventDefault()
      event.stopPropagation()
      dispatch({ type: 'toggleAnnotationSelection', annotationId: annotation.id })
      if (multiSelectMode) onMultiSelectComplete?.()
      return
    }
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const moving = selectedAnnotationIds.includes(annotation.id) && selectedAnnotations.length > 1
      ? selectedAnnotations
      : [annotation]
    drag.current = { annotations: moving, clientX: event.clientX, clientY: event.clientY }
    setPointerPreview(moving)
    setAlignmentGuides(NO_ALIGNMENT_GUIDES)
    if (moving.length === 1) dispatch({ type: 'selectAnnotation', annotationId: annotation.id })
  }

  const previewDrag = (event: PointerEvent<Element>) => {
    const result = movedFromPointer(event)
    if (!result) return
    setPointerPreview(result.annotations)
    setAlignmentGuides(result.guides)
  }

  /**
   * Keyboard equivalent of dragging. Arrow keys nudge by 1% of the page, Shift+Arrow
   * by 5%, both clamped by the same `moveAnnotation` used for pointer drags. Each
   * press shares one history group so a run of nudges undoes in one step.
   */
  const handleKeyDown = (event: KeyboardEvent<Element>, annotation: Annotation) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      dispatch({ type: 'selectAnnotation', annotationId: annotation.id })
      return
    }
    const step = event.shiftKey ? 0.05 : 0.01
    const delta = ARROW_DELTAS[event.key]
    if (!delta) return
    event.preventDefault()
    if (selectedAnnotationIds.includes(annotation.id) && selectedAnnotations.length > 1) {
      const moved = moveAnnotations(selectedAnnotations, delta.dx * step, delta.dy * step)
      if (moved.every((candidate, index) => candidate === selectedAnnotations[index])) return
      dispatch({
        type: 'replaceAnnotations',
        annotations: moved,
        historyGroup: `group-${[...selectedAnnotationIds].sort().join('-')}-keyboard-nudge`,
      })
      return
    }
    const moved = moveAnnotation(annotation, delta.dx * step, delta.dy * step)
    if (moved === annotation) return
    dispatch({ type: 'selectAnnotation', annotationId: annotation.id })
    dispatch({ type: 'replaceAnnotation', annotation: moved })
  }

  const finishDrag = (event: PointerEvent<Element>) => {
    const result = movedFromPointer(event)
    drag.current = null
    setPointerPreview(null)
    setAlignmentGuides(NO_ALIGNMENT_GUIDES)
    if (!result) return
    if (result.annotations.length === 1) {
      dispatch({ type: 'replaceAnnotation', annotation: result.annotations[0] })
      return
    }
    dispatch({ type: 'replaceAnnotations', annotations: result.annotations })
  }

  const cancelDrag = () => {
    drag.current = null
    setPointerPreview(null)
    setAlignmentGuides(NO_ALIGNMENT_GUIDES)
  }

  const finishTextEditing = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dispatch({ type: 'endHistoryGroup' })
    dispatch({ type: 'selectAnnotation', annotationId: null })
  }

  const beginResize = (event: PointerEvent<HTMLButtonElement>, annotation: Annotation, corner: ResizeCorner) => {
    if (activeTool !== 'select') return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resize.current = { annotation, corner, clientX: event.clientX, clientY: event.clientY }
    setPointerPreview([annotation])
    setAlignmentGuides(NO_ALIGNMENT_GUIDES)
    dispatch({ type: 'selectAnnotation', annotationId: annotation.id })
  }

  const previewResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const resized = resizedFromPointer(event)
    if (resized) setPointerPreview([resized])
  }

  const finishResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const resized = resizedFromPointer(event)
    resize.current = null
    setPointerPreview(null)
    if (resized) dispatch({ type: 'replaceAnnotation', annotation: resized })
  }

  const cancelResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    resize.current = null
    setPointerPreview(null)
  }

  const rotatedFromPointer = (event: PointerEvent<Element>) => {
    const current = rotating.current
    if (!current) return null
    const angle = Math.atan2(event.clientY - current.centerY, event.clientX - current.centerX) * 180 / Math.PI
    return rotateAnnotation(current.annotation, (current.annotation.rotation ?? 0) + angle - current.pointerAngle)
  }

  const beginRotate = (event: PointerEvent<HTMLButtonElement>, annotation: Annotation) => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = layerBounds(event.currentTarget)
    if (!bounds) return
    const box = annotationBounds(annotation)
    // Annotation rotation is anchored at its top-left in both the browser preview
    // and PDF exporter, so pointer angles must use that same pivot.
    const centerX = bounds.left + box.x * bounds.width
    const centerY = bounds.top + box.y * bounds.height
    event.currentTarget.setPointerCapture(event.pointerId)
    rotating.current = {
      annotation,
      centerX,
      centerY,
      pointerAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI,
    }
    setPointerPreview([annotation])
    setAlignmentGuides(NO_ALIGNMENT_GUIDES)
  }
  const previewRotate = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rotated = rotatedFromPointer(event)
    if (rotated) setPointerPreview([rotated])
  }
  const finishRotate = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rotated = rotatedFromPointer(event)
    rotating.current = null
    setPointerPreview(null)
    if (rotated) dispatch({ type: 'replaceAnnotation', annotation: rotated })
  }
  const cancelRotate = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    rotating.current = null
    setPointerPreview(null)
  }

  const transformHandles = (annotation: Annotation) => {
    if (
      activeTool !== 'select'
      || selectedAnnotationIds.length !== 1
      || selectedAnnotationIds[0] !== annotation.id
    ) return null
    const box = annotationBounds(annotation)
    const positions: Array<{ corner: ResizeCorner; x: number; y: number; label: string }> = [
      { corner: 'nw', x: 0, y: 0, label: 'Resize item from top left' },
      { corner: 'ne', x: 100, y: 0, label: 'Resize item from top right' },
      { corner: 'sw', x: 0, y: 100, label: 'Resize item from bottom left' },
      { corner: 'se', x: 100, y: 100, label: 'Resize item' },
    ]
    return (
      <div
        className="transform-controls"
        data-testid="transform-controls"
        style={{
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.width * 100}%`,
          height: `${box.height * 100}%`,
          transform: annotation.rotation ? `rotate(${annotation.rotation}deg)` : undefined,
          transformOrigin: 'left top',
        }}
      >
        {annotation.kind !== 'link' && annotation.kind !== 'form-field' && (
          <>
            <span
              className="rotation-stem"
              aria-hidden="true"
              style={{ left: '50%', top: 0 }}
            />
            <button
              type="button"
              className="rotation-handle"
              aria-label="Rotate item"
              title="Drag to rotate"
              style={{ left: '50%', top: 0 }}
              onPointerDown={(event) => beginRotate(event, annotation)}
              onPointerMove={previewRotate}
              onPointerUp={finishRotate}
              onPointerCancel={cancelRotate}
            />
          </>
        )}
        {positions.map(({ corner, x, y, label }) => (
          <button
            key={corner}
            type="button"
            className={`resize-handle resize-${corner}`}
            aria-label={label}
            title={eventTitle(corner, annotation)}
            style={{ left: `${x}%`, top: `${y}%` }}
            onPointerDown={(event) => beginResize(event, annotation, corner)}
            onPointerMove={previewResize}
            onPointerUp={finishResize}
            onPointerCancel={cancelResize}
          />
        ))}
      </div>
    )
  }

  const previewById = new Map(pointerPreview?.map((annotation) => [annotation.id, annotation]) ?? [])
  const renderedSelectedAnnotations = annotations
    .filter(({ id }) => selectedAnnotationIds.includes(id))
    .map((annotation) => previewById.get(annotation.id) ?? annotation)
  const groupBounds = renderedSelectedAnnotations.length > 1
    ? annotationsBounds(renderedSelectedAnnotations)
    : null
  const groupAnchor = renderedSelectedAnnotations[0]

  return (
    <div
      className={`annotation-layer tool-${activeTool}`}
      onPointerDown={activeTool === 'pen' ? onDrawStart : undefined}
      onPointerMove={activeTool === 'pen' ? onDrawMove : undefined}
      onPointerUp={activeTool === 'pen' ? onDrawEnd : onCreate}
      onPointerCancel={activeTool === 'pen' ? onDrawEnd : undefined}
    >
      {alignmentGuides.x !== null && (
        <i
          className="alignment-guide is-vertical"
          data-testid="alignment-guide-x"
          aria-hidden="true"
          style={{ left: `${alignmentGuides.x * 100}%` }}
        />
      )}
      {alignmentGuides.y !== null && (
        <i
          className="alignment-guide is-horizontal"
          data-testid="alignment-guide-y"
          aria-hidden="true"
          style={{ top: `${alignmentGuides.y * 100}%` }}
        />
      )}
      {annotations.map((annotation) => {
        const renderedAnnotation = previewById.get(annotation.id) ?? annotation
        const selected = selectedAnnotationIds.includes(renderedAnnotation.id)
        const singleSelected = selected && selectedAnnotationIds.length === 1
        const style = {
          left: `${renderedAnnotation.x * 100}%`,
          top: `${renderedAnnotation.y * 100}%`,
          width: `${renderedAnnotation.width * 100}%`,
          height: `${renderedAnnotation.height * 100}%`,
          transform: renderedAnnotation.rotation ? `rotate(${renderedAnnotation.rotation}deg)` : undefined,
          transformOrigin: 'left top',
        }
        if (renderedAnnotation.kind === 'ink') {
          const points = renderedAnnotation.points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')
          return (
            <Fragment key={renderedAnnotation.id}>
              <svg
                className={`annotation ink-annotation ${selected ? 'is-selected' : ''}`}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="button"
                tabIndex={0}
                aria-label="Select ink annotation"
                onPointerDown={(event) => beginDrag(event, renderedAnnotation)}
                onPointerMove={previewDrag}
                onPointerUp={finishDrag}
                onPointerCancel={cancelDrag}
                onKeyDown={(event) => handleKeyDown(event, renderedAnnotation)}
              >
                <polyline points={points} fill="none" stroke={renderedAnnotation.color} strokeWidth={renderedAnnotation.strokeWidth * renderScale} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {transformHandles(renderedAnnotation)}
            </Fragment>
          )
        }
        if (renderedAnnotation.kind === 'text') {
          return (
            <Fragment key={renderedAnnotation.id}>
              <div
                className={`annotation text-annotation ${selected ? 'is-selected' : ''}`}
                style={style}
                role="group"
                aria-label="Added text"
                data-source-replacement={renderedAnnotation.sourceReplacement ? 'true' : undefined}
              >
                <InlineTextEditor
                  annotation={renderedAnnotation}
                  selected={singleSelected}
                  multiSelectMode={multiSelectMode}
                  onToggleSelection={() => {
                    dispatch({ type: 'toggleAnnotationSelection', annotationId: renderedAnnotation.id })
                    if (multiSelectMode) onMultiSelectComplete?.()
                  }}
                  renderScale={renderScale}
                  dispatch={dispatch}
                />
              </div>
              {singleSelected && (
                <div
                  className="text-edit-toolbar"
                  style={{
                    left: `${renderedAnnotation.x * 100}%`,
                    top: `${renderedAnnotation.y * 100}%`,
                  }}
                  role="toolbar"
                  aria-label="Text editing"
                >
                  <button
                    type="button"
                    className="move-handle"
                    aria-label="Move text"
                    title="Drag to move text"
                    onPointerDown={(event) => beginDrag(event, renderedAnnotation)}
                    onPointerMove={previewDrag}
                    onPointerUp={finishDrag}
                    onPointerCancel={cancelDrag}
                    onKeyDown={(event) => handleKeyDown(event, renderedAnnotation)}
                  >
                    <span aria-hidden="true">⠿</span>
                    <span>Move</span>
                  </button>
                  <button
                    type="button"
                    className="text-finish-button"
                    aria-label="Finish editing text"
                    aria-keyshortcuts="Enter"
                    title="Done editing (Enter)"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={finishTextEditing}
                  >
                    <span>Done</span>
                    <kbd aria-hidden="true">↵</kbd>
                  </button>
                </div>
              )}
              {transformHandles(renderedAnnotation)}
            </Fragment>
          )
        }
        return (
          <Fragment key={renderedAnnotation.id}>
            <div
              className={`annotation ${renderedAnnotation.kind}-annotation ${renderedAnnotation.kind === 'highlight' ? `text-mark-${textMarkStyleOf(renderedAnnotation)}` : ''} ${selected ? 'is-selected' : ''}`}
              style={style}
              role="button"
              tabIndex={0}
              aria-label={annotationSelectionLabel(renderedAnnotation)}
              data-annotation-id={renderedAnnotation.id}
              onPointerDown={(event) => beginDrag(event, renderedAnnotation)}
              onPointerMove={previewDrag}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              onKeyDown={(event) => handleKeyDown(event, renderedAnnotation)}
            >
              {renderedAnnotation.kind === 'highlight' && (
                <TextMarkPreview annotation={renderedAnnotation} renderScale={renderScale} />
              )}
              {renderedAnnotation.kind === 'link' && (
                <span className="link-proof" title="Clickable area - not visible in the saved PDF">LINK</span>
              )}
              {renderedAnnotation.kind === 'form-field' && (
                <span
                  className={`form-field-proof is-${renderedAnnotation.fieldType}`}
                  title={renderedAnnotation.fieldType === 'radio'
                    ? `Radio group ${renderedAnnotation.fieldName}, option ${renderedAnnotation.optionValue} - saved as an interactive PDF field`
                    : 'Fillable field guide - saved as an interactive PDF field'}
                >
                  {renderedAnnotation.fieldType === 'checkbox' ? (
                    <>
                      <span className="form-field-checkbox-proof" aria-hidden="true">
                        {renderedAnnotation.checkedByDefault ? '✓' : ''}
                      </span>
                      <span className="form-field-proof-name">{renderedAnnotation.fieldName}</span>
                    </>
                  ) : renderedAnnotation.fieldType === 'radio' ? (
                    <>
                      <span className="form-field-radio-proof" aria-hidden="true">
                        {renderedAnnotation.selectedByDefault ? '●' : ''}
                      </span>
                      <span className="form-field-option-value">{renderedAnnotation.optionValue}</span>
                      {renderedAnnotation.required && <span className="form-field-required" aria-hidden="true">*</span>}
                    </>
                  ) : renderedAnnotation.fieldType === 'dropdown' ? (
                    <>
                      <span className="form-field-dropdown-value">
                        {renderedAnnotation.defaultOption || renderedAnnotation.options[0] || 'Choose…'}
                      </span>
                      <span className="form-field-dropdown-chevron" aria-hidden="true">▾</span>
                      <span className="form-field-proof-name">{renderedAnnotation.fieldName}</span>
                      {renderedAnnotation.required && <span className="form-field-required" aria-hidden="true">*</span>}
                    </>
                  ) : (
                    <>
                      <span className="form-field-proof-type">TEXT FIELD</span>
                      <span className="form-field-proof-name">{renderedAnnotation.fieldName}</span>
                      {renderedAnnotation.required && <span className="form-field-required" aria-hidden="true">*</span>}
                    </>
                  )}
                </span>
              )}
              {renderedAnnotation.kind === 'whiteout' && (
                <span className="whiteout-fill" title="Whiteout: visual cover only" />
              )}
              {renderedAnnotation.kind === 'redaction' && (
                <span className="redaction-fill" title="Redaction: exported as permanent removal" />
              )}
              {renderedAnnotation.kind === 'image' && (
                <img
                  src={renderedAnnotation.dataUrl}
                  alt={renderedAnnotation.role === 'signature' ? 'Placed signature' : 'Placed image'}
                  draggable={false}
                  style={{ opacity: imageOpacityOf(renderedAnnotation) }}
                />
              )}
              {renderedAnnotation.kind === 'shape' && (
                <svg className="shape-preview" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {renderedAnnotation.shape === 'rectangle' && <rect x="0" y="0" width="100" height="100" fill={renderedAnnotation.fillColor ?? 'none'} stroke={renderedAnnotation.strokeColor} strokeWidth={renderedAnnotation.strokeWidth * renderScale} vectorEffect="non-scaling-stroke" />}
                  {renderedAnnotation.shape === 'ellipse' && <ellipse cx="50" cy="50" rx="50" ry="50" fill={renderedAnnotation.fillColor ?? 'none'} stroke={renderedAnnotation.strokeColor} strokeWidth={renderedAnnotation.strokeWidth * renderScale} vectorEffect="non-scaling-stroke" />}
                  {(renderedAnnotation.shape === 'line' || renderedAnnotation.shape === 'arrow') && <line x1="3" y1="97" x2="97" y2="3" stroke={renderedAnnotation.strokeColor} strokeWidth={renderedAnnotation.strokeWidth * renderScale} vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
                  {renderedAnnotation.shape === 'arrow' && <polyline points="72,3 97,3 97,28" fill="none" stroke={renderedAnnotation.strokeColor} strokeWidth={renderedAnnotation.strokeWidth * renderScale} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
                </svg>
              )}
              {renderedAnnotation.kind === 'stamp' && (
                renderedAnnotation.stamp === 'date'
                  ? <span className="date-stamp" style={{ color: renderedAnnotation.color }}>{renderedAnnotation.label}</span>
                  : <svg className="stamp-preview" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {renderedAnnotation.stamp === 'check' && <polyline points="8,52 38,82 94,15" fill="none" stroke={renderedAnnotation.color} strokeWidth={renderedAnnotation.strokeWidth * renderScale} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
                    {renderedAnnotation.stamp === 'cross' && <><line x1="14" y1="14" x2="86" y2="86" stroke={renderedAnnotation.color} strokeWidth={renderedAnnotation.strokeWidth * renderScale} vectorEffect="non-scaling-stroke" strokeLinecap="round" /><line x1="86" y1="14" x2="14" y2="86" stroke={renderedAnnotation.color} strokeWidth={renderedAnnotation.strokeWidth * renderScale} vectorEffect="non-scaling-stroke" strokeLinecap="round" /></>}
                    {renderedAnnotation.stamp === 'dot' && <circle cx="50" cy="50" r="34" fill={renderedAnnotation.color} />}
                  </svg>
              )}
            </div>
            {transformHandles(renderedAnnotation)}
          </Fragment>
        )
      })}
      {groupBounds && groupAnchor && (
        <div
          className="group-selection-outline"
          style={{
            left: `${groupBounds.x * 100}%`,
            top: `${groupBounds.y * 100}%`,
            width: `${groupBounds.width * 100}%`,
            height: `${groupBounds.height * 100}%`,
          }}
          role="group"
          aria-label={`${renderedSelectedAnnotations.length} selected items`}
        >
          <span className="group-selection-count">{renderedSelectedAnnotations.length} items</span>
          <button
            type="button"
            className="group-move-handle"
            aria-label={`Move ${renderedSelectedAnnotations.length} selected items`}
            title="Drag to move selected items together"
            onPointerDown={(event) => beginDrag(event, groupAnchor)}
            onPointerMove={previewDrag}
            onPointerUp={finishDrag}
            onPointerCancel={cancelDrag}
            onKeyDown={(event) => handleKeyDown(event, groupAnchor)}
          >
            <span aria-hidden="true">⠿</span>
          </button>
        </div>
      )}
      {draftPoints.length > 1 && (
        <svg className="ink-draft" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points={draftPoints.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')} fill="none" stroke="#3157d5" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        </svg>
      )}
    </div>
  )
}

function eventTitle(corner: ResizeCorner, annotation: Annotation) {
  if (annotation.kind === 'image') {
    const name = annotation.role === 'signature' ? 'Signature' : 'Image'
    return `Drag the ${corner.toUpperCase()} corner to resize. ${name} proportions stay locked.`
  }
  if (annotation.kind === 'form-field'
    && (annotation.fieldType === 'checkbox' || annotation.fieldType === 'radio')) {
    const name = annotation.fieldType === 'radio' ? 'Radio choice' : 'Checkbox'
    return `Drag the ${corner.toUpperCase()} corner to resize. ${name} stays square.`
  }
  return `Drag the ${corner.toUpperCase()} corner to resize. Hold Shift to preserve aspect ratio.`
}
