import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type WheelEvent } from 'react'

const MIN_FONT_SIZE = 6
const MAX_FONT_SIZE = 96

function clampFontSize(value: number) {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
}

interface FontSizeControlProps {
  value: number
  onChange: (value: number) => void
  onCommit: () => void
}

export function FontSizeControl({ value, onChange, onCommit }: FontSizeControlProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value))
  }, [value])

  const emit = (next: number) => {
    const clamped = clampFontSize(next)
    setDraft(String(clamped))
    onChange(clamped)
  }

  const changeDraft = (event: ChangeEvent<HTMLInputElement>) => {
    const nextDraft = event.target.value
    setDraft(nextDraft)
    if (nextDraft === '') return
    const parsed = Number(nextDraft)
    if (Number.isFinite(parsed) && parsed >= MIN_FONT_SIZE && parsed <= MAX_FONT_SIZE) {
      onChange(Math.round(parsed))
    }
  }

  const commitDraft = () => {
    const parsed = Number(draft)
    emit(Number.isFinite(parsed) && draft !== '' ? parsed : value)
    onCommit()
  }

  const step = (delta: number, commit = false) => {
    const parsed = Number(draft)
    const base = Number.isFinite(parsed) && draft !== '' ? parsed : value
    emit(base + delta)
    if (commit) onCommit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitDraft()
      event.currentTarget.select()
    }
  }

  const handleWheel = (event: WheelEvent<HTMLInputElement>) => {
    event.preventDefault()
    if (event.deltaY === 0) return
    step(event.deltaY < 0 ? 1 : -1)
  }

  return (
    <div className="font-size-control">
      <button type="button" aria-label="Decrease font size" onClick={() => step(-1, true)}>−</button>
      <div className="font-size-value">
        <input
          ref={inputRef}
          aria-label="Font size"
          type="number"
          inputMode="numeric"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          step="1"
          value={draft}
          onChange={changeDraft}
          onBlur={commitDraft}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
        />
        <span aria-hidden="true">pt</span>
      </div>
      <button type="button" aria-label="Increase font size" onClick={() => step(1, true)}>+</button>
    </div>
  )
}
