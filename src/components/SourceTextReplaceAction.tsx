import type { PointerEvent } from 'react'

interface SourceTextReplaceActionProps {
  left: number
  top: number
  onReplace: () => void
}

export function SourceTextReplaceAction({ left, top, onReplace }: SourceTextReplaceActionProps) {
  const preserveSelection = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <button
      type="button"
      className="source-text-replace-action"
      aria-label="Replace selected source text"
      style={{ left, top }}
      onPointerDown={preserveSelection}
      onClick={onReplace}
    >
      <span className="source-text-replace-glyph" aria-hidden="true">Aa→</span>
      <span>
        <strong>Replace selected text</strong>
        <small>visual correction</small>
      </span>
    </button>
  )
}
