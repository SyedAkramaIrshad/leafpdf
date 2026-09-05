import { useState } from 'react'
import {
  EMPTY_PERSONAL_DETAILS,
  PERSONAL_DETAIL_FIELDS,
  hasPersonalDetails,
  normalizePersonalDetails,
  preparedDetailPlacement,
  type PersonalDetails,
  type PreparedDetailPlacement,
} from '../model/personalDetails'

interface DetailsPanelProps {
  open: boolean
  saved: PersonalDetails | null
  saving: boolean
  onClose: () => void
  onSave: (details: PersonalDetails) => void
  onClear: () => void
  onPlace: (placement: PreparedDetailPlacement) => void
}

export function DetailsPanel({
  open,
  ...props
}: DetailsPanelProps) {
  if (!open) return null
  const savedKey = props.saved
    ? PERSONAL_DETAIL_FIELDS.map(({ id }) => props.saved?.[id] ?? '').join('\u0000')
    : 'empty'
  return <DetailsPanelContent key={savedKey} {...props} />
}

function DetailsPanelContent({
  saved,
  saving,
  onClose,
  onSave,
  onClear,
  onPlace,
}: Omit<DetailsPanelProps, 'open'>) {
  const [draft, setDraft] = useState<PersonalDetails>(() => ({ ...(saved ?? EMPTY_PERSONAL_DETAILS) }))
  const [confirmingClear, setConfirmingClear] = useState(false)

  return (
    <aside id="details-panel" className="next-panel details-panel" aria-labelledby="details-panel-title">
      <header className="next-panel-header">
        <div>
          <span className="inspector-label">PRIVATE DETAILS</span>
          <h2 id="details-panel-title">Fill without retyping</h2>
        </div>
        <button type="button" className="text-button" onClick={onClose} aria-label="Close personal details">×</button>
      </header>

      <p className="details-intro">
        Type or place a detail without saving it. Save only if you want LeafPDF to remember these values in this browser.
      </p>
      <p className="details-privacy-proof">
        <span aria-hidden="true">●</span>
        <strong>LOCAL ONLY · Never added to a PDF until you choose Place</strong>
      </p>

      <div className="details-ledger">
        {PERSONAL_DETAIL_FIELDS.map((field) => {
          const placement = preparedDetailPlacement(field.id, draft[field.id])
          const controlId = `personal-detail-${field.id}`
          return (
            <div className="details-ledger-row" key={field.id}>
              <label htmlFor={controlId}>{field.label}</label>
              <div className="details-ledger-control">
                {field.multiline ? (
                  <textarea
                    id={controlId}
                    value={draft[field.id]}
                    maxLength={field.maxLength}
                    onChange={(event) => setDraft((current) => ({ ...current, [field.id]: event.target.value }))}
                  />
                ) : (
                  <input
                    id={controlId}
                    type={field.inputMode === 'email' ? 'email' : field.inputMode === 'tel' ? 'tel' : 'text'}
                    inputMode={field.inputMode}
                    value={draft[field.id]}
                    maxLength={field.maxLength}
                    onChange={(event) => setDraft((current) => ({ ...current, [field.id]: event.target.value }))}
                  />
                )}
                <button
                  type="button"
                  className="details-place-button"
                  disabled={!placement}
                  onClick={() => { if (placement) onPlace(placement) }}
                  aria-label={`Place ${field.label}`}
                >
                  Place
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="details-panel-actions">
        <button
          type="button"
          className="details-save-button"
          aria-label={saving ? 'Saving details' : 'Save on this device'}
          disabled={saving || !hasPersonalDetails(draft)}
          onClick={() => onSave(normalizePersonalDetails(draft))}
        >
          {saving ? 'Saving details…' : 'Save on this device'}
        </button>

        {saved && !confirmingClear && (
          <button type="button" className="details-clear-button" onClick={() => setConfirmingClear(true)}>
            Clear saved details
          </button>
        )}
      </div>

      {saved && confirmingClear && (
        <section className="details-clear-confirmation" aria-label="Confirm clearing saved details">
          <strong>Clear these reusable details from this browser?</strong>
          <p>Text already placed in an open PDF will stay in that document.</p>
          <div>
            <button type="button" onClick={() => setConfirmingClear(false)} aria-label="Cancel clear">Cancel</button>
            <button type="button" className="is-danger" onClick={onClear} aria-label="Confirm clear">Clear</button>
          </div>
        </section>
      )}
    </aside>
  )
}
