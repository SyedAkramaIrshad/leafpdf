import { useState, type FormEvent } from 'react'
import type { ReviewComment } from '../project/projectTypes'

interface ReviewPanelProps {
  open: boolean
  comments: ReviewComment[]
  currentPageId: string
  pageNumberById: Map<string, number>
  onClose: () => void
  onCreate: (body: string, author: string) => void
  onSelect: (comment: ReviewComment) => void
  onToggleResolved: (id: string) => void
  onDelete: (id: string) => void
  onImport: () => void
}

export function ReviewPanel({
  open,
  comments,
  currentPageId,
  pageNumberById,
  onClose,
  onCreate,
  onSelect,
  onToggleResolved,
  onDelete,
  onImport,
}: ReviewPanelProps) {
  const [body, setBody] = useState('')
  const [author, setAuthor] = useState('')
  const [showResolved, setShowResolved] = useState(true)
  if (!open) return null

  const visible = comments
    .filter((comment) => showResolved || !comment.resolved)
    .sort((left, right) => left.createdAt - right.createdAt)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!body.trim()) return
    onCreate(body.trim(), author.trim())
    setBody('')
  }

  return (
    <aside className="next-panel review-panel" aria-labelledby="review-panel-title">
      <header className="next-panel-header">
        <div>
          <span className="inspector-label">REVIEW</span>
          <h2 id="review-panel-title">Comments</h2>
        </div>
        <button type="button" className="text-button" onClick={onClose} aria-label="Close comments panel">×</button>
      </header>

      <form className="review-compose" onSubmit={submit}>
        <label>
          Comment on page {pageNumberById.get(currentPageId) ?? 1}
          <textarea
            value={body}
            maxLength={20_000}
            placeholder="Add a review note"
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <label>
          Author
          <input value={author} maxLength={200} placeholder="Optional" onChange={(event) => setAuthor(event.target.value)} />
        </label>
        <button type="submit" className="primary-button" disabled={!body.trim()}>Add comment</button>
      </form>

      <div className="review-actions">
        <button type="button" className="text-button" onClick={onImport}>Import PDF comments</button>
        <label>
          <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
          Show resolved
        </label>
      </div>

      <ol className="review-list">
        {visible.map((comment) => (
          <li key={comment.id} className={comment.resolved ? 'is-resolved' : ''}>
            <button type="button" className="review-comment-body" onClick={() => onSelect(comment)}>
              <strong>Page {pageNumberById.get(comment.pageId) ?? '?'}</strong>
              <span>{comment.body}</span>
              <small>{comment.author || 'Anonymous'} · {new Date(comment.updatedAt).toLocaleString()}</small>
            </button>
            <div>
              <button type="button" className="text-button" onClick={() => onToggleResolved(comment.id)}>
                {comment.resolved ? 'Reopen' : 'Resolve'}
              </button>
              <button type="button" className="text-button danger-text" onClick={() => onDelete(comment.id)}>Delete</button>
            </div>
          </li>
        ))}
      </ol>
      {visible.length === 0 && <p className="empty-panel">No comments in this view.</p>}
    </aside>
  )
}
