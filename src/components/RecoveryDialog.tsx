import { useCallback, useEffect, useRef } from 'react'

interface RecoveryDialogProps {
  open: boolean
  onRestore: () => void
  onDiscard: () => void
  /** Close the prompt without changing the locally stored recovery copy. */
  onClose: () => void
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Offers an intentionally conservative choice when a browser-local editing session
 * is found. Closing or pressing Escape keeps the recovery record intact.
 */
export function RecoveryDialog({ open, onRestore, onDiscard, onClose }: RecoveryDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const restoreRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement as HTMLElement | null
    restoreRef.current?.focus()
    return () => openerRef.current?.focus()
  }, [open])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      // Escape never discards a recovery record or applies it unexpectedly.
      onCloseRef.current()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => !element.hasAttribute('disabled'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
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
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  if (!open) return null

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
