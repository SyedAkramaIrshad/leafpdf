import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Annotation, CreatedFormFieldAnnotation, HighlightAnnotation, ImageAnnotation, LinkAnnotation, TextAnnotation, WhiteoutAnnotation } from '../model/editor'
import { AnnotationLayer } from './AnnotationLayer'

const image: ImageAnnotation = {
  id: 'image-1',
  pageId: 'page-1',
  kind: 'image',
  x: 0.1,
  y: 0.2,
  width: 0.25,
  height: 0.15,
  dataUrl: 'data:image/png;base64,AAAA',
  mimeType: 'image/png',
}

function renderLayer(dispatch = vi.fn(), annotation: Annotation = image) {
  const view = render(
    <AnnotationLayer
      annotations={[annotation]}
      activeTool="select"
      selectedAnnotationIds={[annotation.id]}
      dispatch={dispatch}
      onCreate={vi.fn()}
      onDrawStart={vi.fn()}
      onDrawMove={vi.fn()}
      onDrawEnd={vi.fn()}
      draftPoints={[]}
      renderScale={1}
    />,
  )
  const layer = view.container.querySelector<HTMLElement>('.annotation-layer')
  if (!layer) throw new Error('Annotation layer was not rendered.')
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 1000,
    width: 1000,
    height: 1000,
    toJSON: () => ({}),
  })
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  return { ...view, dispatch }
}

describe('AnnotationLayer pointer previews', () => {
  it('fades only the placed bitmap while keeping its selection shell opaque', () => {
    const { container } = renderLayer(vi.fn(), { ...image, opacity: 0.35 })
    const placed = screen.getByAltText('Placed image')
    const shell = screen.getByRole('button', { name: 'Select image annotation' })

    expect(placed).toHaveStyle({ opacity: '0.35' })
    expect(shell.style.opacity).toBe('')
    expect(container.querySelector('.resize-handle')).toBeInTheDocument()
  })

  it('renders semantic text marks with distinct accessible labels and line positions', () => {
    const underline: HighlightAnnotation = {
      id: 'underline-1', pageId: 'page-1', kind: 'highlight', mark: 'underline',
      x: 0.1, y: 0.2, width: 0.4, height: 0.06, color: '#3157d5', opacity: 1, strokeWidth: 3,
    }
    const strikeout: HighlightAnnotation = {
      id: 'strikeout-1', pageId: 'page-1', kind: 'highlight', mark: 'strikeout',
      x: 0.1, y: 0.3, width: 0.4, height: 0.06, color: '#b54434', opacity: 1, strokeWidth: 2,
    }
    const { container } = render(
      <AnnotationLayer
        annotations={[underline, strikeout]}
        activeTool="select"
        selectedAnnotationIds={[]}
        dispatch={vi.fn()}
        onCreate={vi.fn()}
        onDrawStart={vi.fn()}
        onDrawMove={vi.fn()}
        onDrawEnd={vi.fn()}
        draftPoints={[]}
        renderScale={1}
      />,
    )

    expect(screen.getByRole('button', { name: 'Select underline annotation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select strikeout annotation' })).toBeInTheDocument()
    const underlineLine = container.querySelector('[data-text-mark="underline"] line')
    const strikeoutLine = container.querySelector('[data-text-mark="strikeout"] line')
    expect(underlineLine).toHaveAttribute('y1', '82')
    expect(underlineLine).toHaveAttribute('stroke-width', '3')
    expect(strikeoutLine).toHaveAttribute('y1', '50')
    expect(strikeoutLine).toHaveAttribute('stroke-width', '2')
  })

  it('renders whiteout as an opaque selectable visual cover', () => {
    const whiteout: WhiteoutAnnotation = {
      id: 'whiteout-1', pageId: 'page-1', kind: 'whiteout', x: 0.12, y: 0.16,
      width: 0.42, height: 0.08,
    }
    const { container } = render(
      <AnnotationLayer
        annotations={[whiteout]}
        activeTool="select"
        selectedAnnotationIds={['whiteout-1']}
        dispatch={vi.fn()}
        onCreate={vi.fn()}
        onDrawStart={vi.fn()}
        onDrawMove={vi.fn()}
        onDrawEnd={vi.fn()}
        draftPoints={[]}
        renderScale={1}
      />,
    )

    expect(screen.getByRole('button', { name: 'Select whiteout annotation' })).toBeInTheDocument()
    expect(container.querySelector('.whiteout-fill')).toBeInTheDocument()
    expect(container.querySelector('.whiteout-fill')).toHaveAttribute('title', 'Whiteout: visual cover only')
  })

  it('shows an editor-only link proof with resize handles but no rotation control', () => {
    const link: LinkAnnotation = {
      id: 'link-1', pageId: 'page-1', kind: 'link', x: 0.12, y: 0.16,
      width: 0.42, height: 0.08, targetType: 'url', target: 'example.com',
    }
    const { container } = renderLayer(vi.fn(), link)

    expect(screen.getByRole('button', { name: 'Select link annotation' })).toBeInTheDocument()
    expect(screen.getByText('LINK')).toHaveAttribute('title', 'Clickable area - not visible in the saved PDF')
    expect(container.querySelector('.link-proof')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Resize item/ })).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Rotate item' })).not.toBeInTheDocument()
  })

  it('shows a blueprint proof for a created field with resize handles but no rotation', () => {
    const field: CreatedFormFieldAnnotation = {
      id: 'field-1', pageId: 'page-1', kind: 'form-field', fieldType: 'text',
      fieldName: 'candidate.name', x: 0.12, y: 0.16, width: 0.42, height: 0.08,
      required: true, defaultText: 'Your name', multiline: false,
    }
    const { container } = renderLayer(vi.fn(), field)

    expect(screen.getByRole('button', { name: 'Select text field' })).toBeInTheDocument()
    expect(screen.getByText('TEXT FIELD')).toBeInTheDocument()
    expect(screen.getByText('candidate.name')).toBeInTheDocument()
    expect(container.querySelector('.form-field-proof')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Resize item/ })).toHaveLength(4)
    expect(screen.queryByRole('button', { name: 'Rotate item' })).not.toBeInTheDocument()
  })

  it('keeps a created checkbox square while resizing', () => {
    const field: CreatedFormFieldAnnotation = {
      id: 'field-check', pageId: 'page-1', kind: 'form-field', fieldType: 'checkbox',
      fieldName: 'accept.terms', x: 0.1, y: 0.2, width: 0.05, height: 0.05,
      required: false, checkedByDefault: true,
    }
    const { dispatch } = renderLayer(vi.fn(), field)
    const resize = screen.getByRole('button', { name: 'Resize item' })
    const checkbox = screen.getByRole('button', { name: 'Select checkbox field' })

    fireEvent.pointerDown(resize, { pointerId: 22, clientX: 150, clientY: 250 })
    fireEvent.pointerMove(resize, { pointerId: 22, clientX: 230, clientY: 290 })
    expect(checkbox).toHaveStyle({ width: '13%', height: '13%' })
    fireEvent.pointerUp(resize, { pointerId: 22, clientX: 230, clientY: 290 })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'replaceAnnotation',
      annotation: expect.objectContaining({ id: 'field-check', width: 0.13, height: 0.13 }),
    })
  })

  it('renders radio and dropdown blueprint proofs and keeps radio choices square', () => {
    const radio: CreatedFormFieldAnnotation = {
      id: 'radio-yes', pageId: 'page-1', kind: 'form-field', fieldType: 'radio',
      fieldName: 'relocation', optionValue: 'Yes', selectedByDefault: true,
      x: 0.1, y: 0.2, width: 0.05, height: 0.05, required: true,
    }
    const radioView = renderLayer(vi.fn(), radio)
    expect(screen.getByRole('button', { name: 'Select radio choice Yes in relocation group' })).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(radioView.container.querySelector('.form-field-proof')).toHaveAttribute(
      'title',
      expect.stringContaining('Radio group relocation, option Yes'),
    )
    expect(radioView.container.querySelector('.form-field-radio-proof')).toHaveTextContent('●')

    const resize = screen.getByRole('button', { name: 'Resize item' })
    fireEvent.pointerDown(resize, { pointerId: 41, clientX: 150, clientY: 250 })
    fireEvent.pointerMove(resize, { pointerId: 41, clientX: 220, clientY: 280 })
    expect(screen.getByRole('button', { name: 'Select radio choice Yes in relocation group' })).toHaveStyle({ width: '12%', height: '12%' })
    radioView.unmount()

    const dropdown: CreatedFormFieldAnnotation = {
      id: 'dropdown-1', pageId: 'page-1', kind: 'form-field', fieldType: 'dropdown',
      fieldName: 'office.location', options: ['Dubai', 'Abu Dhabi'], defaultOption: 'Dubai',
      x: 0.1, y: 0.2, width: 0.3, height: 0.06, required: false,
    }
    const dropdownView = renderLayer(vi.fn(), dropdown)
    expect(screen.getByRole('button', { name: 'Select dropdown field' })).toBeInTheDocument()
    expect(screen.getByText('Dubai')).toBeInTheDocument()
    expect(screen.getByText('office.location')).toBeInTheDocument()
    expect(dropdownView.container.querySelector('.form-field-dropdown-chevron')).toHaveTextContent('▾')
    expect(screen.queryByRole('button', { name: 'Rotate item' })).not.toBeInTheDocument()
  })

  it('identifies a signature separately from an ordinary image', () => {
    render(
      <AnnotationLayer
        annotations={[{ ...image, role: 'signature' }]}
        activeTool="select"
        selectedAnnotationIds={[]}
        dispatch={vi.fn()}
        onCreate={vi.fn()}
        onDrawStart={vi.fn()}
        onDrawMove={vi.fn()}
        onDrawEnd={vi.fn()}
        draftPoints={[]}
        renderScale={1}
      />,
    )

    expect(screen.getByRole('button', { name: 'Select signature annotation' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select image annotation' })).not.toBeInTheDocument()
  })

  it('previews movement continuously and commits exactly once on release', () => {
    const { dispatch } = renderLayer()
    const placedImage = screen.getByRole('button', { name: 'Select image annotation' })

    fireEvent.pointerDown(placedImage, { pointerId: 1, clientX: 100, clientY: 200 })
    fireEvent.pointerMove(placedImage, { pointerId: 1, clientX: 160, clientY: 240 })

    expect(placedImage).toHaveStyle({ left: '16%', top: '24%' })
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'replaceAnnotation' }))

    fireEvent.pointerUp(placedImage, { pointerId: 1, clientX: 160, clientY: 240 })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'replaceAnnotation',
      annotation: expect.objectContaining({ id: 'image-1', x: 0.16, y: 0.24 }),
    })
  })

  it('snaps a pointer preview to page center and clears its guide after one commit', () => {
    const { dispatch } = renderLayer()
    const placedImage = screen.getByRole('button', { name: 'Select image annotation' })

    fireEvent.pointerDown(placedImage, { pointerId: 5, clientX: 100, clientY: 200 })
    fireEvent.pointerMove(placedImage, { pointerId: 5, clientX: 374, clientY: 200 })

    expect(placedImage).toHaveStyle({ left: '37.5%', top: '20%' })
    expect(screen.getByTestId('alignment-guide-x')).toHaveStyle({ left: '50%' })
    expect(screen.queryByTestId('alignment-guide-y')).not.toBeInTheDocument()
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'replaceAnnotation' }))

    fireEvent.pointerUp(placedImage, { pointerId: 5, clientX: 374, clientY: 200 })

    expect(screen.queryByTestId('alignment-guide-x')).not.toBeInTheDocument()
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'replaceAnnotation',
      annotation: expect.objectContaining({ id: 'image-1', x: 0.375, y: 0.2 }),
    })
  })

  it('bypasses snapping and hides guides while Option or Alt is held', () => {
    const { dispatch } = renderLayer()
    const placedImage = screen.getByRole('button', { name: 'Select image annotation' })

    fireEvent.pointerDown(placedImage, { pointerId: 6, clientX: 100, clientY: 200 })
    fireEvent.pointerMove(placedImage, { pointerId: 6, clientX: 374, clientY: 200, altKey: true })

    expect(placedImage).toHaveStyle({ left: '37.4%', top: '20%' })
    expect(screen.queryByTestId('alignment-guide-x')).not.toBeInTheDocument()

    fireEvent.pointerUp(placedImage, { pointerId: 6, clientX: 374, clientY: 200, altKey: true })

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'replaceAnnotation',
      annotation: expect.objectContaining({ id: 'image-1', x: 0.374, y: 0.2 }),
    })
  })

  it('does not snap a near-aligned item when the pointer only selects it', () => {
    const dispatch = vi.fn()
    renderLayer(dispatch, { ...image, x: 0.374 })
    const placedImage = screen.getByRole('button', { name: 'Select image annotation' })

    fireEvent.pointerDown(placedImage, { pointerId: 7, clientX: 100, clientY: 200 })
    fireEvent.pointerUp(placedImage, { pointerId: 7, clientX: 100, clientY: 200 })

    expect(screen.queryByTestId('alignment-guide-x')).not.toBeInTheDocument()
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'replaceAnnotation',
      annotation: expect.objectContaining({ id: 'image-1', x: 0.374 }),
    })
  })

  it('locks image proportions while previewing and commits exactly once on release', () => {
    const { dispatch } = renderLayer()
    const resize = screen.getByRole('button', { name: 'Resize item' })
    const placedImage = screen.getByRole('button', { name: 'Select image annotation' })

    expect(resize).toHaveAttribute('title', expect.stringMatching(/proportions stay locked/i))

    fireEvent.pointerDown(resize, { pointerId: 2, clientX: 350, clientY: 350 })
    fireEvent.pointerMove(resize, { pointerId: 2, clientX: 430, clientY: 410 })

    expect(placedImage).toHaveStyle({ width: '35%', height: '21%' })
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'replaceAnnotation' }))

    fireEvent.pointerUp(resize, { pointerId: 2, clientX: 430, clientY: 410 })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'replaceAnnotation',
      annotation: expect.objectContaining({ id: 'image-1', width: 0.35, height: 0.21 }),
    })
  })

  it('keeps ordinary annotation resizing free when Shift is not held', () => {
    const text: TextAnnotation = {
      id: 'text-resize', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.2,
      width: 0.25, height: 0.15, text: 'Draft', color: '#182026', fontSize: 18,
    }
    const { dispatch } = renderLayer(vi.fn(), text)
    const resize = screen.getByRole('button', { name: 'Resize item' })
    const addedText = screen.getByRole('group', { name: 'Added text' })

    fireEvent.pointerDown(resize, { pointerId: 8, clientX: 350, clientY: 350 })
    fireEvent.pointerMove(resize, { pointerId: 8, clientX: 430, clientY: 410 })

    expect(addedText).toHaveStyle({ width: '33%', height: '21%' })
    fireEvent.pointerUp(resize, { pointerId: 8, clientX: 430, clientY: 410 })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'replaceAnnotation',
      annotation: expect.objectContaining({ id: 'text-resize', width: 0.33, height: 0.21 }),
    })
  })

  it('shows four corner handles and previews rotation before one commit', () => {
    const { dispatch } = renderLayer()
    expect(screen.getAllByRole('button', { name: /Resize item/ })).toHaveLength(4)
    const rotate = screen.getByRole('button', { name: 'Rotate item' })
    const placedImage = screen.getByRole('button', { name: 'Select image annotation' })

    fireEvent.pointerDown(rotate, { pointerId: 4, clientX: 225, clientY: 150 })
    fireEvent.pointerMove(rotate, { pointerId: 4, clientX: 375, clientY: 275 })
    expect(placedImage.style.transform).toContain('rotate(')
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'replaceAnnotation' }))
    fireEvent.pointerUp(rotate, { pointerId: 4, clientX: 375, clientY: 275 })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'replaceAnnotation',
      annotation: expect.objectContaining({ id: 'image-1', rotation: expect.any(Number) }),
    })
  })

  it('rotates the transform controls with a rotated item', () => {
    render(
      <AnnotationLayer
        annotations={[{ ...image, rotation: 35 }]}
        activeTool="select"
        selectedAnnotationIds={['image-1']}
        dispatch={vi.fn()}
        onCreate={vi.fn()}
        onDrawStart={vi.fn()}
        onDrawMove={vi.fn()}
        onDrawEnd={vi.fn()}
        draftPoints={[]}
        renderScale={1}
      />,
    )

    expect(screen.getByTestId('transform-controls')).toHaveStyle({
      left: '10%',
      top: '20%',
      width: '25%',
      height: '15%',
      transform: 'rotate(35deg)',
    })
  })
})

describe('AnnotationLayer group selection', () => {
  const date: Annotation = {
    id: 'date-1', pageId: 'page-1', kind: 'stamp', stamp: 'date',
    x: 0.52, y: 0.42, width: 0.18, height: 0.05,
    label: '30 Aug 2026', color: '#182026', strokeWidth: 2,
  }

  function renderSelection(
    selectedAnnotationIds: string[],
    options: { multiSelectMode?: boolean; onMultiSelectComplete?: () => void } = {},
  ) {
    const dispatch = vi.fn()
    const view = render(
      <AnnotationLayer
        annotations={[image, date]}
        activeTool="select"
        selectedAnnotationIds={selectedAnnotationIds}
        multiSelectMode={options.multiSelectMode ?? false}
        onMultiSelectComplete={options.onMultiSelectComplete}
        dispatch={dispatch}
        onCreate={vi.fn()}
        onDrawStart={vi.fn()}
        onDrawMove={vi.fn()}
        onDrawEnd={vi.fn()}
        draftPoints={[]}
        renderScale={1}
      />,
    )
    const layer = view.container.querySelector<HTMLElement>('.annotation-layer')
    if (!layer) throw new Error('Annotation layer was not rendered.')
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000,
      width: 1000, height: 1000, toJSON: () => ({}),
    })
    HTMLElement.prototype.setPointerCapture = vi.fn()
    return { ...view, dispatch }
  }

  it('toggles another item with a modifier without starting a drag', () => {
    const { dispatch } = renderSelection(['image-1'])
    const dateItem = screen.getByRole('button', { name: 'Select date annotation' })

    fireEvent.pointerDown(dateItem, { pointerId: 61, clientX: 520, clientY: 420, shiftKey: true })
    fireEvent.pointerUp(dateItem, { pointerId: 61, clientX: 520, clientY: 420, shiftKey: true })

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleAnnotationSelection', annotationId: 'date-1' })
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'replaceAnnotation' }))
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'replaceAnnotations' }))
  })

  it('uses Select-more mode for one additive touch selection', () => {
    const complete = vi.fn()
    const { dispatch } = renderSelection(['image-1'], {
      multiSelectMode: true,
      onMultiSelectComplete: complete,
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Select date annotation' }), {
      pointerId: 62, clientX: 520, clientY: 420,
    })

    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleAnnotationSelection', annotationId: 'date-1' })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('renders one group frame and suppresses single-item transform controls', () => {
    renderSelection(['image-1', 'date-1'])

    expect(screen.getByRole('group', { name: '2 selected items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move 2 selected items' })).toBeInTheDocument()
    expect(screen.queryByTestId('transform-controls')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finish editing text' })).not.toBeInTheDocument()
  })

  it('previews and commits one grouped drag while preserving spacing', () => {
    const { dispatch } = renderSelection(['image-1', 'date-1'])
    const placedImage = screen.getByRole('button', { name: 'Select image annotation' })
    const dateItem = screen.getByRole('button', { name: 'Select date annotation' })

    fireEvent.pointerDown(placedImage, { pointerId: 63, clientX: 100, clientY: 200 })
    fireEvent.pointerMove(placedImage, { pointerId: 63, clientX: 160, clientY: 240 })

    expect(placedImage).toHaveStyle({ left: '16%', top: '24%' })
    expect(dateItem).toHaveStyle({ left: '57.99999999999999%', top: '46%' })

    fireEvent.pointerUp(placedImage, { pointerId: 63, clientX: 160, clientY: 240 })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'replaceAnnotations',
      annotations: [
        expect.objectContaining({ id: 'image-1', x: 0.16, y: 0.24 }),
        expect.objectContaining({ id: 'date-1', x: 0.58, y: 0.46 }),
      ],
    })
  })

  it('nudges the selected group with one stable history action', () => {
    const { dispatch } = renderSelection(['image-1', 'date-1'])

    fireEvent.keyDown(screen.getByRole('button', { name: 'Select image annotation' }), {
      key: 'ArrowRight',
    })

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'replaceAnnotations',
      annotations: [
        expect.objectContaining({ id: 'image-1', x: 0.11 }),
        expect.objectContaining({ id: 'date-1', x: 0.53 }),
      ],
      historyGroup: 'group-date-1-image-1-keyboard-nudge',
    })
  })
})

describe('AnnotationLayer inline text editing', () => {
  const text: TextAnnotation = {
    id: 'text-1',
    pageId: 'page-1',
    kind: 'text',
    x: 0.12,
    y: 0.16,
    width: 0.3,
    height: 0.08,
    text: 'Draft note',
    color: '#182026',
    fontSize: 18,
  }

  it('edits added text directly on the page and groups the typing session', () => {
    const dispatch = vi.fn()
    render(
      <AnnotationLayer
        annotations={[text]}
        activeTool="select"
        selectedAnnotationIds={['text-1']}
        dispatch={dispatch}
        onCreate={vi.fn()}
        onDrawStart={vi.fn()}
        onDrawMove={vi.fn()}
        onDrawEnd={vi.fn()}
        draftPoints={[]}
        renderScale={1}
      />,
    )

    const editor = screen.getByRole('textbox', { name: 'Edit text' })
    expect(editor).toHaveValue('Draft note')
    fireEvent.change(editor, { target: { value: 'Approved note' } })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation',
      annotationId: 'text-1',
      patch: { text: 'Approved note' },
      historyGroup: 'annotation-text-1-text',
    })

    fireEvent.blur(editor)
    expect(dispatch).toHaveBeenCalledWith({ type: 'endHistoryGroup' })
    expect(screen.getByRole('button', { name: 'Move text' })).toBeVisible()
  })

  it('uses LeafPDF history shortcuts and finishes text explicitly', () => {
    const dispatch = vi.fn()
    render(
      <AnnotationLayer
        annotations={[text]}
        activeTool="select"
        selectedAnnotationIds={['text-1']}
        dispatch={dispatch}
        onCreate={vi.fn()}
        onDrawStart={vi.fn()}
        onDrawMove={vi.fn()}
        onDrawEnd={vi.fn()}
        draftPoints={[]}
        renderScale={1}
      />,
    )

    const editor = screen.getByRole('textbox', { name: 'Edit text' })
    expect(fireEvent.keyDown(editor, { key: 'z', metaKey: true })).toBe(false)
    expect(dispatch).toHaveBeenCalledWith({ type: 'endHistoryGroup' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'undo' })

    dispatch.mockClear()
    expect(fireEvent.keyDown(editor, { key: 'Enter' })).toBe(false)
    expect(dispatch).toHaveBeenCalledWith({ type: 'selectAnnotation', annotationId: null })

    dispatch.mockClear()
    expect(fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('puts an explicit finish action beside selected text', () => {
    const dispatch = vi.fn()
    render(
      <AnnotationLayer
        annotations={[text]}
        activeTool="select"
        selectedAnnotationIds={['text-1']}
        dispatch={dispatch}
        onCreate={vi.fn()}
        onDrawStart={vi.fn()}
        onDrawMove={vi.fn()}
        onDrawEnd={vi.fn()}
        draftPoints={[]}
        renderScale={1}
      />,
    )

    const finish = screen.getByRole('button', { name: 'Finish editing text' })
    expect(finish).toHaveAttribute('aria-keyshortcuts', 'Enter')
    expect(finish).toHaveTextContent('Done')
    fireEvent.click(finish)
    expect(dispatch).toHaveBeenCalledWith({ type: 'endHistoryGroup' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'selectAnnotation', annotationId: null })
  })

  it('selects a new source replacement once, then preserves later caret editing', () => {
    const replacement: TextAnnotation = {
      ...text,
      id: 'replacement-1',
      text: 'Syed Akrama',
      sourceReplacement: true,
    }
    const props = {
      annotations: [replacement],
      activeTool: 'select' as const,
      dispatch: vi.fn(),
      onCreate: vi.fn(),
      onDrawStart: vi.fn(),
      onDrawMove: vi.fn(),
      onDrawEnd: vi.fn(),
      draftPoints: [],
      renderScale: 1,
    }
    const view = render(<AnnotationLayer {...props} selectedAnnotationIds={['replacement-1']} />)

    const editor = screen.getByRole('textbox', { name: 'Edit text' }) as HTMLTextAreaElement
    expect(editor.selectionStart).toBe(0)
    expect(editor.selectionEnd).toBe(replacement.text.length)
    expect(view.container.querySelector('[data-source-replacement="true"]')).toBeInTheDocument()

    view.rerender(<AnnotationLayer {...props} selectedAnnotationIds={[]} />)
    editor.setSelectionRange(5, 5)
    view.rerender(<AnnotationLayer {...props} selectedAnnotationIds={['replacement-1']} />)
    expect(editor.selectionStart).toBe(5)
    expect(editor.selectionEnd).toBe(5)
  })
})
