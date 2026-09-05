import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PdfFormOutput } from '../pdf/exportWorkerProtocol'

interface PdfSaveMenuProps {
  disabled: boolean
  disabledReason?: string
  exporting: boolean
  primaryLabel: string
  progressLabel: string
  onSave: (output: PdfFormOutput) => void
}

const outputs: Array<{
  output: PdfFormOutput
  label: string
  description: string
  marker?: string
}> = [
  {
    output: 'fillable',
    label: 'Save fillable PDF',
    description: 'Keep form fields editable',
    marker: 'DEFAULT',
  },
  {
    output: 'flattened',
    label: 'Save flattened PDF',
    description: 'Fix current form values into the pages',
  },
]

export function PdfSaveMenu({
  disabled,
  disabledReason,
  exporting,
  primaryLabel,
  progressLabel,
  onSave,
}: PdfSaveMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const unavailable = disabled || exporting
  const visibleLabel = exporting ? progressLabel : primaryLabel
  const compactLabel = exporting ? '…' : primaryLabel === 'Save again' ? 'Again' : 'Save'

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      queueMicrotask(() => triggerRef.current?.focus())
      return
    } else return
    event.preventDefault()
    event.stopPropagation()
    items[next]?.focus()
  }

  const save = (output: PdfFormOutput) => {
    setOpen(false)
    onSave(output)
  }

  return (
    <div className="pdf-save-menu">
      <div className="pdf-save-control" role="group" aria-label="Save PDF">
        <button
          type="button"
          className="export-button pdf-save-primary"
          disabled={unavailable}
          title={disabled ? disabledReason : undefined}
          aria-label={visibleLabel}
          onClick={() => save('fillable')}
        >
          <span className="pdf-save-primary-full" aria-hidden="true">{visibleLabel}</span>
          <span className="pdf-save-primary-compact" aria-hidden="true">{compactLabel}</span>
        </button>
        <button
          ref={triggerRef}
          type="button"
          className="pdf-save-disclosure"
          aria-label="Choose PDF output"
          aria-haspopup="menu"
          aria-controls="pdf-save-output-menu"
          aria-expanded={open}
          disabled={unavailable}
          title={disabled ? disabledReason : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          <span aria-hidden="true">⌄</span>
        </button>
      </div>
      {open && (
        <div
          ref={menuRef}
          id="pdf-save-output-menu"
          className="pdf-save-popover"
          role="menu"
          aria-label="PDF output"
          onKeyDown={navigateMenu}
        >
          <span className="pdf-save-heading" aria-hidden="true">PDF OUTPUT</span>
          {outputs.map((item) => (
            <button
              key={item.output}
              type="button"
              role="menuitem"
              aria-label={item.label}
              onClick={() => save(item.output)}
            >
              <span className="pdf-save-option-title" aria-hidden="true">
                <strong>{item.label}</strong>
                {item.marker && <small>{item.marker}</small>}
              </span>
              <span aria-hidden="true">{item.description}</span>
            </button>
          ))}
          <p>Flattening removes form controls. It is not encryption.</p>
        </div>
      )}
    </div>
  )
}
