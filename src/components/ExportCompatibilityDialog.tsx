import { useCallback, useEffect, useRef } from 'react'
import { describeFeatures, type SourcePdfFeatures } from '../pdf/sourceFeatures'

interface ExportCompatibilityDialogProps {
  features: SourcePdfFeatures | null
  onCancel: () => void
  onAccept: () => void
}

/**
 * Shown when the requested page operation cannot be expressed without rebuilding
 * the document, which would drop or invalidate catalog features. Cancel takes
 * default focus so the destructive choice is never the accidental one.
 */
export function ExportCompatibilityDialog({ features, onCancel, onAccept }: ExportCompatibilityDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    if (!features) return
    openerRef.current = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => openerRef.current?.focus()
  }, [features])

  const keyboard = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancelRef.current()
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
    if (!features) return
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [features, keyboard])

  if (!features) return null
  const lost = describeFeatures(features)

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="compatibility-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compatibility-title"
        aria-describedby="compatibility-body"
      >
        <h2 id="compatibility-title">Reordering these pages needs a compatibility copy</h2>
        <div id="compatibility-body">
          <p>
            Moving or deleting pages in this PDF means rebuilding it. LeafPDF cannot carry these
            features into a rebuilt file:
          </p>
          <ul>
            {lost.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p>
            The compatibility copy keeps your page order, text edits, and annotations. Your original
            file is never changed, so you can keep it for the features listed above.
          </p>
          {features.hasDigitalSignatures && (
            <p className="dialog-warning">
              A compatibility copy invalidates the existing digital signature. LeafPDF cannot
              re-sign a PDF.
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} onClick={onCancel}>Cancel</button>
          <button type="button" className="danger-button" onClick={onAccept}>Export compatibility copy</button>
        </div>
      </div>
    </div>
  )
}
