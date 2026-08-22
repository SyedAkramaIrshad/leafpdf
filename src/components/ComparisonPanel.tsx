import { useRef } from 'react'
import type { PdfComparisonResult } from '../compare/pdfComparison'

interface ComparisonPanelProps {
  open: boolean
  comparing: boolean
  comparisonName: string | null
  result: PdfComparisonResult | null
  onClose: () => void
  onCompare: (file: File) => void
  onNavigate: (pageNumber: number) => void
}

export function ComparisonPanel({
  open,
  comparing,
  comparisonName,
  result,
  onClose,
  onCompare,
  onNavigate,
}: ComparisonPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  if (!open) return null

  return (
    <aside className="next-panel comparison-panel" aria-labelledby="comparison-panel-title">
      <header className="next-panel-header">
        <div>
          <span className="inspector-label">LOCAL COMPARE</span>
          <h2 id="comparison-panel-title">Compare PDFs</h2>
        </div>
        <button type="button" className="text-button" onClick={onClose} aria-label="Close comparison panel">×</button>
      </header>

      <p>
        Compare extracted page text locally. The comparison PDF is read in this browser and is never uploaded.
      </p>
      <button type="button" className="primary-button" disabled={comparing} onClick={() => inputRef.current?.click()}>
        {comparing ? 'Comparing…' : result ? 'Choose another PDF' : 'Choose comparison PDF'}
      </button>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onCompare(file)
          event.currentTarget.value = ''
        }}
      />

      {result && (
        <>
          <div className="comparison-summary">
            <strong>{result.changedPages} changed page{result.changedPages === 1 ? '' : 's'}</strong>
            <span>{result.leftPages} current · {result.rightPages} in {comparisonName}</span>
          </div>
          <ol className="comparison-list">
            {result.pages.map((page) => (
              <li key={page.pageNumber} className={`status-${page.status}`}>
                <button type="button" onClick={() => onNavigate(page.pageNumber)}>
                  <strong>Page {page.pageNumber}</strong>
                  <span>{page.status.replace('-', ' ')}</span>
                  <small>{Math.round(page.similarity * 100)}% text similarity</small>
                </button>
                {page.removed.slice(0, 3).map((line, index) => (
                  <p key={`removed-${index}`} className="comparison-removed">− {line}</p>
                ))}
                {page.added.slice(0, 3).map((line, index) => (
                  <p key={`added-${index}`} className="comparison-added">+ {line}</p>
                ))}
                {page.removed.length + page.added.length > 6 && (
                  <small>{page.removed.length + page.added.length - 6} more changed lines</small>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  )
}
