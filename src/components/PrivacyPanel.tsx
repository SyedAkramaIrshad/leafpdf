import type { PrivacyReport } from '../privacy/privacyReport'

interface PrivacyPanelProps {
  open: boolean
  report: PrivacyReport
  sanitizing: boolean
  onClose: () => void
  onExportSanitized: () => void
}

export function PrivacyPanel({ open, report, sanitizing, onClose, onExportSanitized }: PrivacyPanelProps) {
  if (!open) return null
  return (
    <aside className="next-panel privacy-panel" aria-labelledby="privacy-panel-title">
      <header className="next-panel-header">
        <div>
          <span className="inspector-label">PRIVACY</span>
          <h2 id="privacy-panel-title">Document report</h2>
        </div>
        <button type="button" className="text-button" onClick={onClose} aria-label="Close privacy report">×</button>
      </header>

      <ul className="privacy-findings">
        {report.findings.map((finding) => (
          <li key={finding.id} className={finding.detected ? 'is-detected' : 'is-clear'}>
            <span aria-hidden="true">{finding.detected ? '!' : '✓'}</span>
            <div>
              <strong>{finding.label}</strong>
              <p>{finding.detail}</p>
              {finding.detected && (
                <small>{finding.removedBySanitizedCopy ? 'Removed by sanitized copy' : 'Applied before sanitized rebuild'}</small>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="dialog-note">{report.knownKeyLimit}</p>
      {!report.canSanitize && (
        <p className="error-message">This PDF is encrypted and cannot be rebuilt into a sanitized copy.</p>
      )}
      <button
        type="button"
        className="primary-button"
        disabled={!report.canSanitize || sanitizing}
        onClick={onExportSanitized}
      >
        {sanitizing ? 'Creating sanitized copy…' : 'Export sanitized copy'}
      </button>
    </aside>
  )
}
