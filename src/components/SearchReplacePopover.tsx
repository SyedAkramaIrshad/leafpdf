import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'

interface SearchReplacePopoverProps {
  query: string
  replacementText: string
  onReplacementTextChange: (value: string) => void
  sourceMatches: number
  totalMatches: number
  currentIsSource: boolean
  busy: boolean
  progress: { index: number; total: number } | null
  onReplaceThis: (replacementText: string) => void
  onReplaceAll: (replacementText: string) => void
  onStop: () => void
  onClose: () => void
}

export function SearchReplacePopover({
  query,
  replacementText,
  onReplacementTextChange,
  sourceMatches,
  totalMatches,
  currentIsSource,
  busy,
  progress,
  onReplaceThis,
  onReplaceAll,
  onStop,
  onClose,
}: SearchReplacePopoverProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const replacementReady = replacementText.trim().length > 0
  const ocrMatches = Math.max(0, totalMatches - sourceMatches)
  const allLabel = `Replace all ${sourceMatches} source match${sourceMatches === 1 ? '' : 'es'}`

  useEffect(() => {
    if (busy) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [busy])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!replacementReady || busy) return
    if (currentIsSource) onReplaceThis(replacementText)
    else if (sourceMatches > 0) onReplaceAll(replacementText)
  }

  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <form
      id="search-replace-popover"
      className="search-replace-popover"
      role="dialog"
      aria-label="Find and replace"
      aria-modal="false"
      onSubmit={submit}
      onKeyDown={keyDown}
    >
      <div className="search-replace-heading">
        <span className="search-replace-glyph" aria-hidden="true">Aa→</span>
        <strong>Replace “{query}”</strong>
        <button type="button" aria-label="Close find and replace" onClick={onClose} disabled={busy}>×</button>
      </div>

      <label className="search-replace-proof">
        <span className="search-replace-source" title={query}>{query}</span>
        <span aria-hidden="true">→</span>
        <input
          ref={inputRef}
          type="text"
          aria-label="Replacement text"
          placeholder="Replace with"
          value={replacementText}
          onChange={(event) => onReplacementTextChange(event.target.value)}
          disabled={busy}
        />
      </label>

      {busy && progress ? (
        <div className="search-replace-progress">
          <label>
            <span>Replacing {progress.index} of {progress.total}</span>
            <progress value={progress.index} max={progress.total} />
          </label>
          <button type="button" className="search-replace-stop" onClick={onStop}>Stop replacing</button>
        </div>
      ) : (
        <div className="search-replace-actions">
          <button
            type="submit"
            className="search-replace-current"
            disabled={!replacementReady || !currentIsSource}
          >
            Replace this match
          </button>
          <button
            type="button"
            disabled={!replacementReady || sourceMatches === 0}
            onClick={() => onReplaceAll(replacementText)}
          >
            {allLabel}
          </button>
        </div>
      )}

      {ocrMatches > 0 && (
        <p className="search-replace-ocr-note">
          {ocrMatches} OCR-only match{ocrMatches === 1 ? '' : 'es'} cannot be replaced automatically because no source text box exists.
        </p>
      )}
      <p className="search-replace-safety">
        <strong>Visual correction</strong>
        <span>Original source text remains searchable. Use Redact to remove content permanently.</span>
      </p>
    </form>
  )
}
