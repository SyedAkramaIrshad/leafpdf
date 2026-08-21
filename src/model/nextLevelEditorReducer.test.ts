import { describe, expect, it } from 'vitest'
import { createEditorState, editorReducer, type TextAnnotation } from './editor'
import { nextLevelEditorReducer } from './nextLevelEditorReducer'

function text(): TextAnnotation {
  return {
    id: 'text-1', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.2,
    width: 0.3, height: 0.08, text: 'Move me', color: '#182026', fontSize: 18,
  }
}

describe('nextLevelEditorReducer', () => {
  it('collapses consecutive 1% and 5% keyboard nudges into one undo entry', () => {
    let state = editorReducer(createEditorState('sample.pdf', 1), { type: 'addAnnotation', annotation: text() })
    const depth = state.past.length

    state = nextLevelEditorReducer(state, {
      type: 'replaceAnnotation',
      annotation: { ...text(), x: 0.11 },
    })
    state = nextLevelEditorReducer(state, {
      type: 'replaceAnnotation',
      annotation: { ...text(), x: 0.16 },
    })

    expect(state.past).toHaveLength(depth + 1)
    expect(state.present.annotations[0]).toMatchObject({ x: 0.16 })
    state = nextLevelEditorReducer(state, { type: 'endHistoryGroup' })
    state = nextLevelEditorReducer(state, { type: 'undo' })
    expect(state.present.annotations[0]).toMatchObject({ x: 0.1 })
  })

  it('keeps a pointer-like translation as its own history entry', () => {
    let state = editorReducer(createEditorState('sample.pdf', 1), { type: 'addAnnotation', annotation: text() })
    const depth = state.past.length

    state = nextLevelEditorReducer(state, {
      type: 'replaceAnnotation',
      annotation: { ...text(), x: 0.137 },
    })

    expect(state.past).toHaveLength(depth + 1)
    expect(state.historyGroupKey).toBeNull()
  })

  it('ends a keyboard group when selection moves to another object', () => {
    const second: TextAnnotation = { ...text(), id: 'text-2', x: 0.5 }
    let state = editorReducer(createEditorState('sample.pdf', 1), {
      type: 'addAnnotations', annotations: [text(), second],
    })
    state = nextLevelEditorReducer(state, {
      type: 'replaceAnnotation', annotation: { ...text(), y: 0.21 },
    })
    expect(state.historyGroupKey).not.toBeNull()

    state = nextLevelEditorReducer(state, { type: 'selectAnnotation', annotationId: 'text-2' })
    expect(state.historyGroupKey).toBeNull()
  })
})
