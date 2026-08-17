import { useRef } from 'react'
import { useModalDialog } from './useModalDialog'

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
export function DiscardChangesDialog({ open, ...handlers }: DiscardChangesDialogProps) {
  if (!open) return null
  return <DiscardChangesDialogContent {...handlers} />
}

function DiscardChangesDialogContent({ onContinue, onDiscard }: Omit<DiscardChangesDialogProps, 'open'>) {
  const continueRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalDialog<HTMLDivElement>({ onEscape: onContinue, initialFocusRef: continueRef })

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
