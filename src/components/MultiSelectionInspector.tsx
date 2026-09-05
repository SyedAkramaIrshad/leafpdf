import { useState } from 'react'
import type { Annotation, EditorAction } from '../model/editor'
import { alignAnnotations, type GroupAlignment } from '../model/groupLayout'

interface MultiSelectionInspectorProps {
  annotations: Annotation[]
  dispatch: (action: EditorAction) => void
  onAddMore: () => void
  onDone: () => void
  announce?: (message: string) => void
}

const ALIGNMENTS: Array<{
  alignment: GroupAlignment
  label: string
  accessibleName: string
  announcement: string
  glyph: string
}> = [
  { alignment: 'left', label: 'Left', accessibleName: 'left', announcement: 'left', glyph: '▥' },
  { alignment: 'center-x', label: 'Center', accessibleName: 'center', announcement: 'to the horizontal center', glyph: '↔' },
  { alignment: 'right', label: 'Right', accessibleName: 'right', announcement: 'right', glyph: '▤' },
  { alignment: 'top', label: 'Top', accessibleName: 'top', announcement: 'top', glyph: '▔' },
  { alignment: 'center-y', label: 'Middle', accessibleName: 'middle', announcement: 'to the vertical middle', glyph: '↕' },
  { alignment: 'bottom', label: 'Bottom', accessibleName: 'bottom', announcement: 'bottom', glyph: '▁' },
]

export function MultiSelectionInspector({
  annotations,
  dispatch,
  onAddMore,
  onDone,
  announce,
}: MultiSelectionInspectorProps) {
  const [collapsed, setCollapsed] = useState(false)
  if (annotations.length < 2) return null
  const count = annotations.length

  const align = (alignment: GroupAlignment, announcement: string) => {
    dispatch({ type: 'replaceAnnotations', annotations: alignAnnotations(annotations, alignment) })
    announce?.(`Aligned ${count} items ${announcement}.`)
  }

  return (
    <aside
      id="item-properties"
      className={`inspector multi-selection-inspector ${collapsed ? 'is-collapsed' : ''}`}
      tabIndex={-1}
      aria-labelledby="group-properties-title"
    >
      <div className="inspector-header">
        <div>
          <span className="inspector-label">GROUP SELECTION</span>
          <h2 id="group-properties-title">{count} items</h2>
        </div>
        <div className="inspector-header-actions">
          <button
            type="button"
            className="inspector-toggle-button"
            aria-pressed={collapsed}
            onClick={() => {
              setCollapsed(true)
              onAddMore()
            }}
          >
            {collapsed ? 'Choosing…' : 'Add another'}
          </button>
          <button type="button" className="inspector-done-button" onClick={onDone}>Done</button>
        </div>
      </div>
      <div className="inspector-body">
        <p className="visually-hidden group-selection-status" role="status">{count} items selected</p>
        <p className="inspector-copy group-selection-hint">
          Drag the selection or blue grip to move everything together.
        </p>
        <section className="group-alignment" aria-labelledby="group-alignment-title">
          <h3 id="group-alignment-title">Align selected items</h3>
          <div className="group-alignment-grid">
            {ALIGNMENTS.map(({ alignment, label, accessibleName, announcement, glyph }) => (
              <button
                key={alignment}
                type="button"
                aria-label={`Align selected items ${accessibleName}`}
                onClick={() => align(alignment, announcement)}
              >
                <span aria-hidden="true">{glyph}</span>
                <small>{label}</small>
              </button>
            ))}
          </div>
        </section>
        <button
          type="button"
          className="danger-button group-delete-button"
          onClick={() => {
            dispatch({ type: 'removeAnnotations', annotationIds: annotations.map(({ id }) => id) })
            announce?.(`Deleted ${count} selected items. Undo restores them together.`)
          }}
        >
          Delete {count} items
        </button>
      </div>
    </aside>
  )
}
