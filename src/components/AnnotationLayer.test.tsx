import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ImageAnnotation, TextAnnotation } from '../model/editor'
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

function renderLayer(dispatch = vi.fn()) {
  const view = render(
    <AnnotationLayer
      annotations={[image]}
      activeTool="select"
      selectedAnnotationId="image-1"
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

  it('previews resizing continuously and commits exactly once on release', () => {
    const { dispatch } = renderLayer()
    const resize = screen.getByRole('button', { name: 'Resize item' })
    const placedImage = screen.getByRole('button', { name: 'Select image annotation' })

    fireEvent.pointerDown(resize, { pointerId: 2, clientX: 350, clientY: 350 })
    fireEvent.pointerMove(resize, { pointerId: 2, clientX: 430, clientY: 410 })

    expect(placedImage).toHaveStyle({ width: '33%', height: '21%' })
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'replaceAnnotation' }))

    fireEvent.pointerUp(resize, { pointerId: 2, clientX: 430, clientY: 410 })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'replaceAnnotation',
      annotation: expect.objectContaining({ id: 'image-1', width: 0.33, height: 0.21 }),
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
        selectedAnnotationId="image-1"
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
        selectedAnnotationId="text-1"
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
})
