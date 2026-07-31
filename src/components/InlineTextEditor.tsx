import { useEffect, useRef, type ChangeEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { textStyleOf, type EditorAction, type TextAnnotation } from '../model/editor'
import { CSS_FONT_STACKS } from '../pdf/textTypography'

interface InlineTextEditorProps {
  annotation: TextAnnotation
  selected: boolean
  renderScale: number
  dispatch: (action: EditorAction) => void
}

export function InlineTextEditor({
  annotation,
  selected,
  renderScale,
  dispatch,
}: InlineTextEditorProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const wasSelected = useRef(false)
  const style = textStyleOf(annotation)
  const historyGroup = `annotation-${annotation.id}-text`

  useEffect(() => {
    if (selected && !wasSelected.current) {
      const editor = editorRef.current
      editor?.focus()
      if (annotation.text === 'Type here') editor?.select()
    }
    wasSelected.current = selected
  }, [annotation.text, selected])

  const edit = (event: ChangeEvent<HTMLTextAreaElement>) => {
    dispatch({
      type: 'updateAnnotation',
      annotationId: annotation.id,
      patch: { text: event.target.value },
      historyGroup,
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') event.currentTarget.blur()
  }

  const keepGestureInsideEditor = (event: PointerEvent<HTMLTextAreaElement>) => {
    // Selecting words and moving the caret must never start an annotation drag.
    event.stopPropagation()
  }

  return (
    <textarea
      ref={editorRef}
      className="inline-text-editor"
      aria-label="Edit text"
      value={annotation.text}
      spellCheck
      onFocus={() => dispatch({ type: 'selectAnnotation', annotationId: annotation.id })}
      onChange={edit}
      onBlur={() => dispatch({ type: 'endHistoryGroup' })}
      onKeyDown={handleKeyDown}
      onPointerDown={keepGestureInsideEditor}
      style={{
        color: annotation.color,
        fontSize: `${annotation.fontSize * renderScale}px`,
        fontFamily: CSS_FONT_STACKS[style.fontFamily],
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        direction: style.direction,
        opacity: annotation.opacity ?? 1,
      }}
    />
  )
}
