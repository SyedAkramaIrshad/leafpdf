import type { FormFieldTarget } from '../model/formNavigation'

interface FormFieldGuideProps {
  open: boolean
  busy: boolean
  target: FormFieldTarget | null
  pageNumber: number | null
  onStart: () => void
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

export function FormFieldGuide({
  open,
  busy,
  target,
  pageNumber,
  onStart,
  onPrevious,
  onNext,
  onClose,
}: FormFieldGuideProps) {
  if (!open) return null

  const position = busy
    ? 'Finding field…'
    : target && pageNumber !== null
      ? `Page ${pageNumber} · Field ${target.index} of ${target.total}`
      : 'Move through the PDF’s real form fields.'

  return (
    <section
      id="form-field-guide"
      className="form-field-guide"
      role="region"
      aria-label="Fillable field guide"
    >
      <header className="form-field-guide-header">
        <span className="form-field-guide-key" aria-hidden="true">TAB</span>
        <div>
          <strong>Fill this PDF</strong>
          <span role="status" aria-live="polite">{position}</span>
        </div>
        <button
          type="button"
          className="form-field-guide-close"
          aria-label="Close fillable field guide"
          onClick={onClose}
        >×</button>
      </header>
      <p>Optional fields stay optional.</p>
      <div className="form-field-guide-actions">
        {target ? (
          <>
            <button type="button" aria-label="Previous field" disabled={busy} onClick={onPrevious}>
              Previous
            </button>
            <button type="button" className="is-primary" aria-label="Next field" disabled={busy} onClick={onNext}>
              Next
            </button>
          </>
        ) : (
          <button type="button" className="is-primary" disabled={busy} onClick={onStart}>
            Start at first field
          </button>
        )}
      </div>
    </section>
  )
}
