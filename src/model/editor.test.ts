import { describe, expect, it } from 'vitest'
import { moveAnnotation } from './annotationMovement'
import { createEditorState, editorReducer, type InkAnnotation, type TextAnnotation } from './editor'

describe('editorReducer', () => {
  it('selects, rotates, reorders, and removes pages', () => {
    let state = createEditorState('sample.pdf', 3)
    state = editorReducer(state, { type: 'selectPage', pageId: 'page-2' })
    expect(state.selectedPageId).toBe('page-2')

    state = editorReducer(state, { type: 'rotatePage', pageId: 'page-2', degrees: 90 })
    expect(state.present.pages[1].rotation).toBe(90)

    state = editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 })
    expect(state.present.pages.map((page) => page.id)).toEqual(['page-2', 'page-1', 'page-3'])

    state = editorReducer(state, { type: 'removePage', pageId: 'page-2' })
    expect(state.present.pages).toHaveLength(2)
    expect(state.selectedPageId).toBe('page-1')
  })

  it('adds, updates, removes, undoes, and redoes annotations', () => {
    const annotation: TextAnnotation = {
      id: 'annotation-1',
      pageId: 'page-1',
      kind: 'text',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.08,
      text: 'Draft',
      color: '#182026',
      fontSize: 18,
    }
    let state = createEditorState('sample.pdf', 1)
    state = editorReducer(state, { type: 'addAnnotation', annotation })
    state = editorReducer(state, {
      type: 'updateAnnotation',
      annotationId: annotation.id,
      patch: { text: 'Approved' },
    })
    expect(state.present.annotations[0]).toMatchObject({ text: 'Approved' })

    state = editorReducer(state, { type: 'undo' })
    expect(state.present.annotations[0]).toMatchObject({ text: 'Draft' })
    state = editorReducer(state, { type: 'redo' })
    expect(state.present.annotations[0]).toMatchObject({ text: 'Approved' })
    state = editorReducer(state, { type: 'removeAnnotation', annotationId: annotation.id })
    expect(state.present.annotations).toHaveLength(0)
  })

  it('collapses one typing session into a single undo entry', () => {
    const annotation: TextAnnotation = {
      id: 'annotation-1', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.2,
      width: 0.3, height: 0.08, text: 'Draft', color: '#182026', fontSize: 18,
    }
    let state = createEditorState('sample.pdf', 1)
    state = editorReducer(state, { type: 'addAnnotation', annotation })
    const depthAfterAdd = state.past.length

    const group = `annotation-${annotation.id}-text`
    for (const text of ['Approved', 'Approved b', 'Approved by Syed']) {
      state = editorReducer(state, { type: 'updateAnnotation', annotationId: annotation.id, patch: { text }, historyGroup: group })
    }
    expect(state.present.annotations[0]).toMatchObject({ text: 'Approved by Syed' })
    // Three keystrokes, one snapshot.
    expect(state.past).toHaveLength(depthAfterAdd + 1)

    state = editorReducer(state, { type: 'endHistoryGroup' })
    state = editorReducer(state, { type: 'undo' })
    expect(state.present.annotations[0]).toMatchObject({ text: 'Draft' })
  })

  it('starts a new undo entry for a different group key', () => {
    const annotation: TextAnnotation = {
      id: 'annotation-1', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.2,
      width: 0.3, height: 0.08, text: 'Draft', color: '#182026', fontSize: 18,
    }
    let state = createEditorState('sample.pdf', 1)
    state = editorReducer(state, { type: 'addAnnotation', annotation })
    const depthAfterAdd = state.past.length

    state = editorReducer(state, {
      type: 'updateAnnotation', annotationId: annotation.id, patch: { text: 'Approved' },
      historyGroup: `annotation-${annotation.id}-text`,
    })
    state = editorReducer(state, {
      type: 'updateAnnotation', annotationId: annotation.id, patch: { color: '#b3261e' },
      historyGroup: 'color',
    })
    expect(state.past).toHaveLength(depthAfterAdd + 2)

    state = editorReducer(state, { type: 'undo' })
    expect(state.present.annotations[0]).toMatchObject({ text: 'Approved', color: '#182026' })
  })

  it('ends the active group when a structural change happens', () => {
    const annotation: TextAnnotation = {
      id: 'annotation-1', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.2,
      width: 0.3, height: 0.08, text: 'Draft', color: '#182026', fontSize: 18,
    }
    let state = createEditorState('sample.pdf', 2)
    state = editorReducer(state, { type: 'addAnnotation', annotation })
    const group = `annotation-${annotation.id}-text`
    state = editorReducer(state, { type: 'updateAnnotation', annotationId: annotation.id, patch: { text: 'One' }, historyGroup: group })
    expect(state.historyGroupKey).toBe(group)

    state = editorReducer(state, { type: 'rotatePage', pageId: 'page-1', degrees: 90 })
    expect(state.historyGroupKey).toBeNull()

    // The same key again must open a fresh entry rather than rejoin the old one.
    const depth = state.past.length
    state = editorReducer(state, { type: 'updateAnnotation', annotationId: annotation.id, patch: { text: 'Two' }, historyGroup: group })
    expect(state.past).toHaveLength(depth + 1)
  })

  it('tracks unsaved changes and clears them only when told', () => {
    let state = createEditorState('sample.pdf', 1)
    expect(state.dirty).toBe(false)

    state = editorReducer(state, { type: 'selectAnnotation', annotationId: null })
    state = editorReducer(state, { type: 'setZoom', zoom: 1.5 })
    // Selection and zoom are not document edits.
    expect(state.dirty).toBe(false)

    state = editorReducer(state, { type: 'rotatePage', pageId: 'page-1', degrees: 90 })
    expect(state.dirty).toBe(true)

    state = editorReducer(state, { type: 'markSaved', document: state.present })
    expect(state.dirty).toBe(false)

    state = editorReducer(state, { type: 'undo' })
    // Undoing back past a save still leaves the file on disk out of date.
    expect(state.dirty).toBe(true)
  })

  it('does not clear unsaved changes made while an export was running', () => {
    let state = createEditorState('sample.pdf', 2)
    state = editorReducer(state, { type: 'rotatePage', pageId: 'page-1', degrees: 90 })

    // The export starts here and captures this document.
    const exported = state.present

    // The user keeps editing while the worker runs.
    state = editorReducer(state, {
      type: 'addAnnotation',
      annotation: {
        id: 'later', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.1,
        width: 0.3, height: 0.08, text: 'Added during export', color: '#182026', fontSize: 18,
      },
    })
    expect(state.present).not.toBe(exported)

    // The export finishing must not mark the newer work as saved.
    state = editorReducer(state, { type: 'markSaved', document: exported })
    expect(state.dirty).toBe(true)
    expect(state.present.annotations).toHaveLength(1)
  })

  it('clears unsaved changes when the exported document is still current', () => {
    let state = createEditorState('sample.pdf', 2)
    state = editorReducer(state, { type: 'rotatePage', pageId: 'page-1', degrees: 90 })
    const exported = state.present

    state = editorReducer(state, { type: 'markSaved', document: exported })
    expect(state.dirty).toBe(false)
  })

  it('does not allow removing the final page', () => {
    const state = createEditorState('sample.pdf', 1)
    const next = editorReducer(state, { type: 'removePage', pageId: 'page-1' })
    expect(next).toBe(state)
  })

  it('replaces one whole annotation in a single history entry', () => {
    const ink: InkAnnotation = {
      id: 'annotation-ink',
      pageId: 'page-1',
      kind: 'ink',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
      color: '#3157d5',
      strokeWidth: 2.5,
    }
    let state = createEditorState('sample.pdf', 1)
    state = editorReducer(state, { type: 'addAnnotation', annotation: ink })
    const historyDepth = state.past.length

    state = editorReducer(state, { type: 'replaceAnnotation', annotation: moveAnnotation(ink, 0.1, 0.1) })
    expect(state.past).toHaveLength(historyDepth + 1)
    expect(state.present.annotations).toHaveLength(1)
    const moved = state.present.annotations[0]
    expect(moved.kind).toBe('ink')
    if (moved.kind === 'ink') {
      expect(moved.points).toEqual([
        { x: 0.2, y: 0.2 },
        { x: 0.3, y: 0.3 },
      ])
    }

    state = editorReducer(state, { type: 'undo' })
    expect(state.present.annotations[0]).toEqual(ink)
  })

  it('ignores a replacement for an annotation that is not present', () => {
    const state = createEditorState('sample.pdf', 1)
    const next = editorReducer(state, {
      type: 'replaceAnnotation',
      annotation: {
        id: 'missing', pageId: 'page-1', kind: 'text', x: 0, y: 0, width: 0.1, height: 0.1,
        text: 'x', color: '#000000', fontSize: 12,
      },
    })
    expect(next).toBe(state)
  })

  it('copies without mutating, then pastes and duplicates as undoable new objects', () => {
    const annotation: TextAnnotation = {
      id: 'source', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.1,
      width: 0.3, height: 0.08, text: 'Copy me', color: '#000000', fontSize: 12,
    }
    let state = editorReducer(createEditorState('sample.pdf', 1), { type: 'addAnnotation', annotation })
    const depth = state.past.length
    state = editorReducer(state, { type: 'copyAnnotation', annotationId: 'source' })
    expect(state.past).toHaveLength(depth)
    expect(state.clipboard?.id).toBe('source')

    state = editorReducer(state, { type: 'pasteAnnotation', pageId: 'page-1', newId: 'pasted' })
    expect(state.present.annotations.at(-1)).toMatchObject({ id: 'pasted', x: 0.12, y: 0.12 })
    state = editorReducer(state, { type: 'undo' })
    expect(state.present.annotations).toHaveLength(1)

    state = editorReducer(state, { type: 'duplicateAnnotation', annotationId: 'source', newId: 'duplicate' })
    expect(state.present.annotations.at(-1)?.id).toBe('duplicate')
  })

  it('changes layer order and adds document-wide annotations atomically', () => {
    const make = (id: string): TextAnnotation => ({
      id, pageId: 'page-1', kind: 'text', x: 0.1, y: 0.1, width: 0.2, height: 0.05,
      text: id, color: '#000000', fontSize: 12,
    })
    let state = createEditorState('sample.pdf', 1)
    state = editorReducer(state, { type: 'addAnnotations', annotations: [make('a'), make('b'), make('c')] })
    expect(state.past).toHaveLength(1)
    state = editorReducer(state, { type: 'bringForward', annotationId: 'a' })
    expect(state.present.annotations.map(({ id }) => id)).toEqual(['b', 'a', 'c'])
    state = editorReducer(state, { type: 'sendBackward', annotationId: 'c' })
    expect(state.present.annotations.map(({ id }) => id)).toEqual(['b', 'c', 'a'])
  })

  it('restores a recovered document and selects its first page', () => {
    const recovered = createEditorState('recovered.pdf', 2).present
    const state = editorReducer(createEditorState('sample.pdf', 1), { type: 'restoreDocument', document: recovered })
    expect(state.present).toBe(recovered)
    expect(state.selectedPageId).toBe('page-1')
    expect(state.dirty).toBe(true)
    expect(state.past).toHaveLength(1)
    const undone = editorReducer(state, { type: 'undo' })
    expect(undone.present.fileName).toBe('sample.pdf')
  })

  it('inserts blank pages after the requested page as one undoable step', () => {
    let state = createEditorState('sample.pdf', 2)
    const blank = { id: 'page-blank', kind: 'blank' as const, width: 595, height: 842, rotation: 0 as const }
    state = editorReducer(state, { type: 'insertPages', afterPageId: 'page-1', pages: [blank] })
    expect(state.present.pages.map(({ id }) => id)).toEqual(['page-1', 'page-blank', 'page-2'])
    expect(state.selectedPageId).toBe('page-blank')
    expect(state.dirty).toBe(true)

    // Duplicate ids and unknown anchors are rejected outright.
    expect(editorReducer(state, { type: 'insertPages', afterPageId: 'page-1', pages: [blank] })).toBe(state)
    expect(editorReducer(state, { type: 'insertPages', afterPageId: 'missing', pages: [{ ...blank, id: 'page-other' }] })).toBe(state)

    const undone = editorReducer(state, { type: 'undo' })
    expect(undone.present.pages.map(({ id }) => id)).toEqual(['page-1', 'page-2'])
  })

  it('inserts external pages at the front when asked', () => {
    let state = createEditorState('sample.pdf', 1)
    const inserted = [0, 1].map((sourceIndex) => ({
      id: `page-ext-${sourceIndex}`,
      kind: 'external' as const,
      documentId: 'inserted-1',
      sourceIndex,
      rotation: 0 as const,
    }))
    state = editorReducer(state, { type: 'insertPages', afterPageId: null, pages: inserted })
    expect(state.present.pages.map(({ id }) => id)).toEqual(['page-ext-0', 'page-ext-1', 'page-1'])
  })

  it('records form values as undoable document edits', () => {
    let state = createEditorState('form.pdf', 1)
    state = editorReducer(state, { type: 'setFormValue', fieldName: 'owner.name', value: 'Syed' })
    expect(state.present.formValues['owner.name']).toBe('Syed')
    expect(state.dirty).toBe(true)
    expect(state.past).toHaveLength(1)

    // Same value again is a no-op, not a new history entry.
    expect(editorReducer(state, { type: 'setFormValue', fieldName: 'owner.name', value: 'Syed' })).toBe(state)

    state = editorReducer(state, { type: 'setFormValue', fieldName: 'subscribed', value: true })
    const undone = editorReducer(state, { type: 'undo' })
    expect(undone.present.formValues).toEqual({ 'owner.name': 'Syed' })
  })

  it('collapses a form-field typing session into one undo entry', () => {
    let state = createEditorState('form.pdf', 1)
    for (const value of ['S', 'Sy', 'Syed']) {
      state = editorReducer(state, { type: 'setFormValue', fieldName: 'owner.name', value, historyGroup: 'form-owner.name' })
    }
    expect(state.past).toHaveLength(1)
    const undone = editorReducer(state, { type: 'undo' })
    expect(undone.present.formValues['owner.name']).toBeUndefined()
  })

})
