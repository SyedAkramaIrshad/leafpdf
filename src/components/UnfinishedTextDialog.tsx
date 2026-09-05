import { useRef } from 'react'
import { useModalDialog } from './useModalDialog'

interface UnfinishedTextDialogProps {
  count: number
  onCancel: () => void
  onReview: () => void
  onSaveAnyway: () => void
}

export function UnfinishedTextDialog({ count, ...handlers }: UnfinishedTextDialogProps) {
  if (count < 1) return null
  return <UnfinishedTextDialogContent count={count} {...handlers} />
}

function UnfinishedTextDialogContent({
  count,
  onCancel,
  onReview,
  onSaveAnyway,
}: UnfinishedTextDialogProps) {
  const reviewRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalDialog<HTMLDivElement>({ onEscape: onCancel, initialFocusRef: reviewRef })

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="compatibility-dialog unfinished-text-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unfinished-text-title"
        aria-describedby="unfinished-text-body"
      >
        <h2 id="unfinished-text-title">Finish this text before saving?</h2>
        <p id="unfinished-text-body">
          {count === 1
            ? 'LeafPDF found one text box that is empty or still says “Type here”. Review it so the placeholder does not end up in your PDF.'
            : `LeafPDF found ${count} text boxes that are empty or still say “Type here”. Review the first one so placeholders do not end up in your PDF.`}
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="save-anyway-button" onClick={onSaveAnyway}>Save anyway</button>
          <button type="button" className="review-text-button" ref={reviewRef} onClick={onReview}>Review text</button>
        </div>
      </div>
    </div>
  )
}
