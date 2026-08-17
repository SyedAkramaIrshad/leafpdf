import { useRef } from 'react'
import { describeFeatures, type SourcePdfFeatures } from '../pdf/sourceFeatures'
import { useModalDialog } from './useModalDialog'

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
export function ExportCompatibilityDialog({ features, ...handlers }: ExportCompatibilityDialogProps) {
  if (!features) return null
  return <ExportCompatibilityDialogContent features={features} {...handlers} />
}

function ExportCompatibilityDialogContent({ features, onCancel, onAccept }: ExportCompatibilityDialogProps & { features: SourcePdfFeatures }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalDialog<HTMLDivElement>({ onEscape: onCancel, initialFocusRef: cancelRef })
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
        <h2 id="compatibility-title">This export needs a compatibility copy</h2>
        <div id="compatibility-body">
          <p>
            Moving, deleting, or inserting pages — and redacting — means rebuilding this PDF.
            LeafPDF cannot carry these features into a rebuilt file:
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
