import { useRef } from 'react'
import { useModalDialog } from './useModalDialog'

interface RecoveryDialogProps {
  open: boolean
  onRestore: () => void
  onDiscard: () => void
  /** Close the prompt without changing the locally stored recovery copy. */
  onClose: () => void
}

/**
 * Offers an intentionally conservative choice when a browser-local editing session
 * is found. Closing or pressing Escape keeps the recovery record intact.
 */
export function RecoveryDialog({ open, ...handlers }: RecoveryDialogProps) {
  // Mounted only while open so `useModalDialog` arms and disarms with the dialog.
  if (!open) return null
  return <RecoveryDialogContent {...handlers} />
}

function RecoveryDialogContent({ onRestore, onDiscard, onClose }: Omit<RecoveryDialogProps, 'open'>) {
  const restoreRef = useRef<HTMLButtonElement>(null)
  // Escape never discards a recovery record or applies it unexpectedly.
  const dialogRef = useModalDialog<HTMLElement>({ onEscape: onClose, initialFocusRef: restoreRef })

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={dialogRef}
        className="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
        aria-describedby="recovery-body"
      >
        <span className="inspector-label">LOCAL RECOVERY</span>
        <h2 id="recovery-title">Resume your previous editing session?</h2>
        <div id="recovery-body">
          <p>
            LeafPDF found annotations saved locally by this browser for this PDF. Restoring brings
            those edits back into the workspace; it never changes your original file.
          </p>
          <p className="dialog-note">
            Recovery is stored only on this device and browser. Clearing browser site data, using a
            private window, or opening the PDF on another device can remove it.
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>Not now</button>
          <button type="button" className="danger-button" onClick={onDiscard}>Discard recovery</button>
          <button type="button" ref={restoreRef} className="primary-button" onClick={onRestore}>Restore edits</button>
        </div>
      </section>
    </div>
  )
}
