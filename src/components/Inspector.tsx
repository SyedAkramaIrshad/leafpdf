import { useEffect } from 'react'
import { annotationId as createAnnotationId, type Annotation, type EditorAction } from '../model/editor'
import { FontSizeControl } from './FontSizeControl'

interface InspectorProps {
  annotation: Annotation | null
  dispatch: (action: EditorAction) => void
  canPaste?: boolean
}

export function Inspector({ annotation, dispatch, canPaste = false }: InspectorProps) {
  const annotationId = annotation?.id ?? null

  // Leaving the inspector, or switching to another annotation, ends whatever run of
  // edits was collapsing into one undo entry.
  useEffect(() => {
    if (!annotationId) return
    return () => dispatch({ type: 'endHistoryGroup' })
  }, [annotationId, dispatch])

  if (!annotation) {
    return (
      <aside className="inspector empty-inspector">
        <span className="inspector-label">INSPECTOR</span>
        <div className="empty-inspector-mark">+</div>
        <p>Select an item on the page to adjust it.</p>
      </aside>
    )
  }

  const update = (patch: Partial<Annotation>, historyGroup?: string) =>
    dispatch({ type: 'updateAnnotation', annotationId: annotation.id, patch, historyGroup })
  const endGroup = () => dispatch({ type: 'endHistoryGroup' })

  // One key per control, so typing groups separately from dragging a slider.
  const group = (property: string) => `annotation-${annotation.id}-${property}`

  return (
    <aside className="inspector">
      <span className="inspector-label">{annotation.kind.toUpperCase()}</span>
      {annotation.kind === 'text' && (
        <>
          <p className="inspector-copy inline-edit-hint">Edit the words directly on the page. Use the blue grip to move the text.</p>
          <label>Font family
            <select
              value={annotation.fontFamily ?? 'sans'}
              onChange={(event) => update({ fontFamily: event.target.value as 'sans' | 'serif' | 'mono' })}
            >
              <option value="sans">Sans serif</option>
              <option value="serif">Serif</option>
              <option value="mono">Monospace</option>
            </select>
          </label>
          <div className="format-buttons" aria-label="Text emphasis">
            <button
              type="button"
              aria-label="Bold"
              aria-pressed={(annotation.fontWeight ?? 400) === 700}
              onClick={() => update({ fontWeight: (annotation.fontWeight ?? 400) === 700 ? 400 : 700 })}
            >
              B
            </button>
            <button
              type="button"
              aria-label="Italic"
              aria-pressed={(annotation.fontStyle ?? 'normal') === 'italic'}
              onClick={() => update({ fontStyle: (annotation.fontStyle ?? 'normal') === 'italic' ? 'normal' : 'italic' })}
            >
              I
            </button>
          </div>
          <label>Size
            <FontSizeControl
              value={annotation.fontSize}
              onChange={(fontSize) => update({ fontSize }, group('size'))}
              onCommit={endGroup}
            />
          </label>
          <label>Color
            <input
              type="color" value={annotation.color}
              onChange={(event) => update({ color: event.target.value }, group('color'))}
              onBlur={endGroup}
            />
          </label>
        </>
      )}
      {annotation.kind === 'highlight' && (
        <>
          <label>Color
            <input
              type="color" value={annotation.color}
              onChange={(event) => update({ color: event.target.value }, group('color'))}
              onBlur={endGroup}
            />
          </label>
          <label>Opacity
            <input
              type="range" min="0.1" max="0.8" step="0.05" value={annotation.opacity}
              onChange={(event) => update({ opacity: Number(event.target.value) }, group('opacity'))}
              onPointerUp={endGroup}
              onBlur={endGroup}
            />
          </label>
        </>
      )}
      {annotation.kind === 'ink' && (
        <>
          <label>Color
            <input
              type="color" value={annotation.color}
              onChange={(event) => update({ color: event.target.value }, group('color'))}
              onBlur={endGroup}
            />
          </label>
          <label>Weight
            <input
              type="range" min="1" max="9" step="0.5" value={annotation.strokeWidth}
              onChange={(event) => update({ strokeWidth: Number(event.target.value) }, group('strokeWidth'))}
              onPointerUp={endGroup}
              onBlur={endGroup}
            />
          </label>
        </>
      )}
      {annotation.kind === 'shape' && (
        <>
          <label>Stroke
            <input type="color" value={annotation.strokeColor} onChange={(event) => update({ strokeColor: event.target.value }, group('strokeColor'))} onBlur={endGroup} />
          </label>
          {(annotation.shape === 'rectangle' || annotation.shape === 'ellipse') && (
            <label>Fill
              <input type="color" value={annotation.fillColor ?? '#ffffff'} onChange={(event) => update({ fillColor: event.target.value }, group('fillColor'))} onBlur={endGroup} />
            </label>
          )}
          <label>Weight
            <input type="range" min="1" max="10" step="0.5" value={annotation.strokeWidth} onChange={(event) => update({ strokeWidth: Number(event.target.value) }, group('strokeWidth'))} onPointerUp={endGroup} onBlur={endGroup} />
          </label>
        </>
      )}
      {annotation.kind === 'stamp' && (
        <label>Color
          <input type="color" value={annotation.color} onChange={(event) => update({ color: event.target.value }, group('color'))} onBlur={endGroup} />
        </label>
      )}
      {annotation.kind === 'image' && <p className="inspector-copy">Drag the image to move it. Select it and drag the blue corner handle to resize it.</p>}
      {annotation.kind === 'redaction' && (
        <p className="inspector-copy redaction-copy">
          On export, this page is converted to a picture with the covered area removed for good.
          The area is not recoverable from the exported file. Text on that page will no longer be selectable.
        </p>
      )}
      <div className="object-actions" aria-label="Object actions">
        <button type="button" onClick={() => dispatch({ type: 'duplicateAnnotation', annotationId: annotation.id, newId: createAnnotationId() })}>Duplicate</button>
        <button type="button" onClick={() => dispatch({ type: 'copyAnnotation', annotationId: annotation.id })}>Copy</button>
        <button type="button" disabled={!canPaste} onClick={() => dispatch({ type: 'pasteAnnotation', pageId: annotation.pageId, newId: createAnnotationId() })}>Paste</button>
        <button type="button" onClick={() => dispatch({ type: 'bringForward', annotationId: annotation.id })}>Bring forward</button>
        <button type="button" onClick={() => dispatch({ type: 'sendBackward', annotationId: annotation.id })}>Send backward</button>
      </div>
      <button type="button" className="danger-button" onClick={() => dispatch({ type: 'removeAnnotation', annotationId: annotation.id })}>Delete item</button>
    </aside>
  )
}
