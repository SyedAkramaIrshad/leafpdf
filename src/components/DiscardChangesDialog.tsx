import { useCallback, useEffect, useRef } from 'react'

interface DiscardChangesDialogProps {
  open: boolean
  onContinue: () => void
  onDiscard: () => void
}

/**
 * Guards closing a document with unsaved edits. `Continue editing` takes default
 * focus and Escape maps to it, so the destructive choice is never the accidental
 * one.
 */
export function DiscardChangesDialog({ open, onContinue, onDiscard }: DiscardChangesDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const onContinueRef = useRef(onContinue)
  onContinueRef.current = onContinue

  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement as HTMLElement | null
    continueRef.current?.focus()
    return () => openerRef.current?.focus()
  }, [open])

  const keyboard = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onContinueRef.current()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])
    if (buttons.length === 0) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [open, keyboard])

  if (!open) return null

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="compatibility-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-title"
        aria-describedby="discard-body"
      >
        <h2 id="discard-title">Close without exporting?</h2>
        <p id="discard-body">
          This document has edits you have not exported. Closing it discards them. Your original
          file on disk is unchanged either way.
        </p>
        <div className="dialog-actions">
          <button type="button" ref={continueRef} onClick={onContinue}>Continue editing</button>
          <button type="button" className="danger-button" onClick={onDiscard}>Discard changes</button>
        </div>
      </div>
    </div>
  )
}
