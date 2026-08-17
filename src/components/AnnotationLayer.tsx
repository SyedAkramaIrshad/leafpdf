import { Fragment, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  moveAnnotation,
  annotationBounds,
  resizeAnnotationFromCorner,
  rotateAnnotation,
  type ResizeCorner,
} from '../model/annotationMovement'
import { type Annotation, type EditorAction, type Tool } from '../model/editor'
import { InlineTextEditor } from './InlineTextEditor'

interface AnnotationLayerProps {
  annotations: Annotation[]
  activeTool: Tool
  selectedAnnotationId: string | null
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

export function AnnotationLayer({
  annotations,
  activeTool,
  selectedAnnotationId,
  dispatch,
  onCreate,
  onDrawStart,
  onDrawMove,
  onDrawEnd,
  draftPoints,
  renderScale,
}: AnnotationLayerProps) {
  const drag = useRef<{ annotation: Annotation; clientX: number; clientY: number } | null>(null)
  const resize = useRef<{ annotation: Annotation; corner: ResizeCorner; clientX: number; clientY: number } | null>(null)
  const rotating = useRef<{ annotation: Annotation; centerX: number; centerY: number; pointerAngle: number } | null>(null)
  const [pointerPreview, setPointerPreview] = useState<Annotation | null>(null)

  const layerBounds = (element: Element) =>
    element.closest('.annotation-layer')?.getBoundingClientRect()

  const movedFromPointer = (event: PointerEvent<Element>) => {
    const current = drag.current
    const bounds = layerBounds(event.currentTarget)
    if (!current || !bounds || bounds.width === 0 || bounds.height === 0) return null
    return moveAnnotation(
      current.annotation,
      (event.clientX - current.clientX) / bounds.width,
      (event.clientY - current.clientY) / bounds.height,
    )
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
      event.shiftKey,
    )
  }

  const beginDrag = (event: PointerEvent<Element>, annotation: Annotation) => {
    if (activeTool !== 'select') return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { annotation, clientX: event.clientX, clientY: event.clientY }
    setPointerPreview(annotation)
    dispatch({ type: 'selectAnnotation', annotationId: annotation.id })
  }

  const previewDrag = (event: PointerEvent<Element>) => {
    const moved = movedFromPointer(event)
    if (moved) setPointerPreview(moved)
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
    const moved = moveAnnotation(annotation, delta.dx * step, delta.dy * step)
    if (moved === annotation) return
    dispatch({ type: 'selectAnnotation', annotationId: annotation.id })
    dispatch({ type: 'replaceAnnotation', annotation: moved })
  }

  const finishDrag = (event: PointerEvent<Element>) => {
    const moved = movedFromPointer(event)
    drag.current = null
    setPointerPreview(null)
    if (moved) dispatch({ type: 'replaceAnnotation', annotation: moved })
  }

  const cancelDrag = () => {
    drag.current = null
    setPointerPreview(null)
  }

  const beginResize = (event: PointerEvent<HTMLButtonElement>, annotation: Annotation, corner: ResizeCorner) => {
    if (activeTool !== 'select') return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resize.current = { annotation, corner, clientX: event.clientX, clientY: event.clientY }
    setPointerPreview(annotation)
    dispatch({ type: 'selectAnnotation', annotationId: annotation.id })
  }

  const previewResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const resized = resizedFromPointer(event)
    if (resized) setPointerPreview(resized)
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
    setPointerPreview(annotation)
  }
  const previewRotate = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rotated = rotatedFromPointer(event)
    if (rotated) setPointerPreview(rotated)
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
    if (activeTool !== 'select' || selectedAnnotationId !== annotation.id) return null
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
        {positions.map(({ corner, x, y, label }) => (
          <button
            key={corner}
            type="button"
            className={`resize-handle resize-${corner}`}
            aria-label={label}
            title={eventTitle(corner)}
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

  return (
    <div
      className={`annotation-layer tool-${activeTool}`}
      onPointerDown={activeTool === 'pen' ? onDrawStart : undefined}
      onPointerMove={activeTool === 'pen' ? onDrawMove : undefined}
      onPointerUp={activeTool === 'pen' ? onDrawEnd : onCreate}
      onPointerCancel={activeTool === 'pen' ? onDrawEnd : undefined}
    >
      {annotations.map((annotation) => {
        const renderedAnnotation = pointerPreview?.id === annotation.id ? pointerPreview : annotation
        const selected = selectedAnnotationId === renderedAnnotation.id
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
              >
                <InlineTextEditor
                  annotation={renderedAnnotation}
                  selected={selected}
                  renderScale={renderScale}
                  dispatch={dispatch}
                />
              </div>
              {selected && (
                <button
                  type="button"
                  className="move-handle"
                  aria-label="Move text"
                  title="Drag to move text"
                  style={{
                    left: `${renderedAnnotation.x * 100}%`,
                    top: `${renderedAnnotation.y * 100}%`,
                  }}
                  onPointerDown={(event) => beginDrag(event, renderedAnnotation)}
                  onPointerMove={previewDrag}
                  onPointerUp={finishDrag}
                  onPointerCancel={cancelDrag}
                  onKeyDown={(event) => handleKeyDown(event, renderedAnnotation)}
                >
                  <span aria-hidden="true">⠿</span>
                </button>
              )}
              {transformHandles(renderedAnnotation)}
            </Fragment>
          )
        }
        return (
          <Fragment key={renderedAnnotation.id}>
            <div
              className={`annotation ${renderedAnnotation.kind}-annotation ${selected ? 'is-selected' : ''}`}
              style={style}
              role="button"
              tabIndex={0}
              aria-label={`Select ${renderedAnnotation.kind} annotation`}
              onPointerDown={(event) => beginDrag(event, renderedAnnotation)}
              onPointerMove={previewDrag}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              onKeyDown={(event) => handleKeyDown(event, renderedAnnotation)}
            >
              {renderedAnnotation.kind === 'highlight' && (
                <span style={{ background: renderedAnnotation.color, opacity: renderedAnnotation.opacity }} />
              )}
              {renderedAnnotation.kind === 'redaction' && (
                <span className="redaction-fill" title="Redaction: exported as permanent removal" />
              )}
              {renderedAnnotation.kind === 'image' && <img src={renderedAnnotation.dataUrl} alt="Placed annotation" draggable={false} />}
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
      {draftPoints.length > 1 && (
        <svg className="ink-draft" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points={draftPoints.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')} fill="none" stroke="#3157d5" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        </svg>
      )}
    </div>
  )
}

function eventTitle(corner: ResizeCorner) {
  return `Drag the ${corner.toUpperCase()} corner to resize. Hold Shift to preserve aspect ratio.`
}
