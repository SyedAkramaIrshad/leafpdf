import { useRef } from 'react'
import { useModalDialog } from './useModalDialog'

interface DiscardChangesDialogProps {
  open: boolean
  projectChanges?: boolean
  pdfCopyCurrent?: boolean
  onContinue: () => void
  onDiscard: () => void
  onKeepRecovery?: () => void
  busy?: boolean
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

function DiscardChangesDialogContent({
  onContinue,
  onDiscard,
  projectChanges = false,
  pdfCopyCurrent = false,
  onKeepRecovery,
  busy = false,
}: Omit<DiscardChangesDialogProps, 'open'>) {
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
        <h2 id="discard-title">Keep your edits before leaving?</h2>
        <p id="discard-body">
          {projectChanges ? <>
            {pdfCopyCurrent
              ? 'A PDF copy was requested for these edits; check that the file finished saving. '
              : 'No current PDF copy has been saved in this session. '}
            Keep recovery and leave preserves the editable project in this browser.
            Discard editable changes removes that recovery copy. A download request alone
            does not confirm a file was saved; reopen your .leafpdf file to check it.
          </> : <>
            This document has edits you have not exported. Closing it discards them. Your original
            file on disk is unchanged either way.
          </>}
        </p>
        <div className="dialog-actions">
          <button type="button" ref={continueRef} disabled={busy} onClick={onContinue}>Continue editing</button>
          {onKeepRecovery && <button type="button" className="primary-button" disabled={busy} onClick={onKeepRecovery}>
            {busy ? 'Please wait…' : 'Keep recovery and leave'}
          </button>}
          <button type="button" className="danger-button" disabled={busy} onClick={onDiscard}>
            {projectChanges ? 'Discard editable changes' : 'Discard changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
