import { useEffect, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { DiscardChangesDialog } from './DiscardChangesDialog'
import { ExportCompatibilityDialog } from './ExportCompatibilityDialog'
import { FileWelcome } from './FileWelcome'
import { Inspector } from './Inspector'
import { PageCanvas } from './PageCanvas'
import { PageRail } from './PageRail'
import { SignatureDialog } from './SignatureDialog'
import { ToolRail } from './ToolRail'
import type { EditorPage, TextAnnotation } from '../model/editor'

const editorPage: EditorPage = { id: 'page-1', sourceIndex: 0, rotation: 0 }

function stubPdf(overrides: {
  getTextContent?: ReturnType<typeof vi.fn>
  cancel?: ReturnType<typeof vi.fn>
  commonObjs?: { has: (name: string) => boolean; get: (name: string) => unknown }
} = {}) {
  const cancel = overrides.cancel ?? vi.fn()
  const getTextContent = overrides.getTextContent ?? vi.fn().mockResolvedValue({ items: [], styles: {} })
  const getOperatorList = vi.fn().mockResolvedValue({ fnArray: [], argsArray: [] })
  // A never-settling render promise keeps the task "in flight" so cancellation is observable.
  const render = vi.fn(() => ({ promise: new Promise<void>(() => {}), cancel }))
  const getPage = vi.fn().mockResolvedValue({
    rotate: 0,
    getViewport: () => ({ width: 612, height: 792, scale: 1.16, transform: [1, 0, 0, -1, 0, 792] }),
    render,
    getTextContent,
    getOperatorList,
    commonObjs: overrides.commonObjs ?? { has: () => false, get: vi.fn() },
  })
  return { pdf: { getPage } as unknown as PDFDocumentProxy, cancel, getTextContent, render, getPage }
}

function renderPageCanvas(
  pdf: PDFDocumentProxy,
  activeTool: 'select',
  zoom = 1,
  dispatch = vi.fn(),
) {
  return render(
    <PageCanvas
      pdf={pdf}
      page={editorPage}
      annotations={[]}
      activeTool={activeTool}
      selectedAnnotationId={null}
      zoom={zoom}
      dispatch={dispatch}
    />,
  )
}

describe('PDF editor controls', () => {
  it('explains the local-first empty state', () => {
    render(<FileWelcome busy={false} error={null} onFile={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /annotate and sign pdfs/i })).toBeInTheDocument()
    expect(screen.getByText(/stays on this device/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /choose a pdf/i })).toBeInTheDocument()
  })

  it('exposes each annotation tool with an accessible label', () => {
    const onTool = vi.fn()
    render(
      <ToolRail
        activeTool="select"
        onTool={onTool}
        onImage={vi.fn()}
        onSignature={vi.fn()}
      />,
    )
    for (const name of ['Select', 'Add text', 'Highlight', 'Draw', 'Add image', 'Add signature']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Edit existing text' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    expect(onTool).toHaveBeenCalledWith('text')

    fireEvent.click(screen.getByRole('button', { name: 'Shapes' }))
    for (const name of ['Add rectangle', 'Add ellipse', 'Add line', 'Add arrow']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add arrow' }))
    expect(onTool).toHaveBeenCalledWith('arrow')

    fireEvent.click(screen.getByRole('button', { name: 'Fill symbols' }))
    for (const name of ['Add checkmark', 'Add cross', 'Add dot', 'Add date']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add checkmark' }))
    expect(onTool).toHaveBeenCalledWith('check')
  })

  it('supports keyboard navigation inside tool palettes', async () => {
    render(
      <ToolRail
        activeTool="select"
        onTool={vi.fn()}
        onImage={vi.fn()}
        onSignature={vi.fn()}
      />,
    )
    const opener = screen.getByRole('button', { name: 'Shapes' })
    fireEvent.click(opener)
    const rectangle = screen.getByRole('menuitem', { name: 'Add rectangle' })
    const ellipse = screen.getByRole('menuitem', { name: 'Add ellipse' })
    await waitFor(() => expect(rectangle).toHaveFocus())
    fireEvent.keyDown(rectangle, { key: 'ArrowDown' })
    expect(ellipse).toHaveFocus()
    fireEvent.keyDown(ellipse, { key: 'Escape' })
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('renders only the selected thumbnail before other pages become visible', async () => {
    class IdleIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
      root = null
      rootMargin = '0px'
      thresholds = [0]
    }
    vi.stubGlobal('IntersectionObserver', IdleIntersectionObserver)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    const renderTask = { promise: Promise.resolve(), cancel: vi.fn() }
    const getPage = vi.fn().mockResolvedValue({
      rotate: 0,
      getViewport: () => ({ width: 90, height: 120 }),
      render: () => renderTask,
    })
    const pages = Array.from({ length: 30 }, (_, index) => ({
      id: `page-${index + 1}`,
      sourceIndex: index,
      rotation: 0 as const,
    }))

    render(<PageRail pdf={{ getPage } as unknown as PDFDocumentProxy} pages={pages} selectedPageId="page-1" dispatch={vi.fn()} />)
    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(1))
    expect(getPage).toHaveBeenCalledWith(1)
    vi.unstubAllGlobals()
  })
})

describe('ExportCompatibilityDialog', () => {
  const features = {
    hasMetadata: true,
    hasOutlines: true,
    hasAttachments: false,
    hasAcroForm: true,
    hasDigitalSignatures: true,
    additionalFeatures: ['Tagged-PDF structure (accessibility)'],
  }

  it('renders nothing until a confirmation is required', () => {
    render(<ExportCompatibilityDialog features={null} onCancel={vi.fn()} onAccept={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists every feature at risk and focuses Cancel by default', async () => {
    render(<ExportCompatibilityDialog features={features} onCancel={vi.fn()} onAccept={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Bookmarks and outline entries')).toBeInTheDocument()
    expect(screen.getByText('Interactive form fields')).toBeInTheDocument()
    expect(screen.getByText('An existing digital signature')).toBeInTheDocument()
    expect(screen.queryByText('Embedded file attachments')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
  })

  it('reports both choices to the caller', () => {
    const onCancel = vi.fn()
    const onAccept = vi.fn()
    render(<ExportCompatibilityDialog features={features} onCancel={onCancel} onAccept={onAccept} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export compatibility copy' }))
    expect(onAccept).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('traps focus inside the modal in both directions', async () => {
    render(<ExportCompatibilityDialog features={features} onCancel={vi.fn()} onAccept={vi.fn()} />)
    const first = screen.getByRole('button', { name: 'Cancel' })
    const last = screen.getByRole('button', { name: 'Export compatibility copy' })
    await waitFor(() => expect(first).toHaveFocus())

    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })
})

describe('SignatureDialog', () => {
  it('closes on Escape even when a parent re-renders during the same key press', async () => {
    const onClose = vi.fn()

    // Reproduces a real defect: a sibling window listener re-rendered the parent
    // mid-dispatch, which recreated the dialog's own listener and removed it before
    // the browser reached it, so Escape was silently swallowed.
    function Host() {
      const [, bump] = useState(0)
      useEffect(() => {
        const rerenderOnKey = () => bump((value) => value + 1)
        window.addEventListener('keydown', rerenderOnKey)
        return () => window.removeEventListener('keydown', rerenderOnKey)
      }, [])
      return <SignatureDialog open onClose={onClose} onApply={vi.fn()} />
    }

    render(<Host />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clear' })).toHaveFocus())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('labels the canvas and describes what the signature is not', () => {
    render(<SignatureDialog open onClose={vi.fn()} onApply={vi.fn()} />)
    expect(screen.getByLabelText('Signature drawing area')).toBeInTheDocument()
    expect(screen.getByText(/not a digital signature/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })
})

describe('DiscardChangesDialog', () => {
  it('stays closed until unsaved edits exist', () => {
    render(<DiscardChangesDialog open={false} onContinue={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('defaults focus to continuing, and maps Escape to it', async () => {
    const onContinue = vi.fn()
    const onDiscard = vi.fn()
    render(<DiscardChangesDialog open onContinue={onContinue} onDiscard={onDiscard} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue editing' })).toHaveFocus())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(onDiscard).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('says the original file is untouched', () => {
    render(<DiscardChangesDialog open onContinue={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.getByText(/original\s+file on disk is unchanged/i)).toBeInTheDocument()
  })

  it('traps focus inside the modal in both directions', async () => {
    render(<DiscardChangesDialog open onContinue={vi.fn()} onDiscard={vi.fn()} />)
    const first = screen.getByRole('button', { name: 'Continue editing' })
    const last = screen.getByRole('button', { name: 'Discard changes' })
    await waitFor(() => expect(first).toHaveFocus())

    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })
})

describe('Inspector history grouping', () => {
  const annotation: TextAnnotation = {
    id: 'annotation-1', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.2,
    width: 0.3, height: 0.08, text: 'Draft', color: '#182026', fontSize: 18,
  }

  it('keeps content editing on the page instead of duplicating it in the inspector', () => {
    const dispatch = vi.fn()
    render(<Inspector annotation={annotation} dispatch={dispatch} />)

    expect(screen.queryByLabelText('Content')).not.toBeInTheDocument()
    expect(screen.getByText(/edit the words directly on the page/i)).toBeInTheDocument()
  })

  it('shows an exact font size and supports typing, buttons, and wheel changes', () => {
    const dispatch = vi.fn()
    render(<Inspector annotation={annotation} dispatch={dispatch} />)

    const size = screen.getByLabelText('Font size')
    expect(size).toHaveValue(18)

    fireEvent.change(size, { target: { value: '10' } })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation',
      annotationId: 'annotation-1',
      patch: { fontSize: 10 },
      historyGroup: 'annotation-annotation-1-size',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Increase font size' }))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ patch: { fontSize: 11 } }))

    fireEvent.wheel(size, { deltaY: 100 })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ patch: { fontSize: 10 } }))

    fireEvent.change(size, { target: { value: '999' } })
    fireEvent.blur(size)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ patch: { fontSize: 96 } }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'endHistoryGroup' })
  })

  it('formats added text with family, weight, and style controls', () => {
    const dispatch = vi.fn()
    render(<Inspector annotation={annotation} dispatch={dispatch} />)

    fireEvent.change(screen.getByLabelText('Font family'), { target: { value: 'serif' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }))

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ patch: { fontFamily: 'serif' } }))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ patch: { fontWeight: 700 } }))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ patch: { fontStyle: 'italic' } }))
  })

  it('exposes object clipboard and layer actions', () => {
    const dispatch = vi.fn()
    render(<Inspector annotation={annotation} canPaste dispatch={dispatch} />)
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bring forward' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send backward' }))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'duplicateAnnotation', annotationId: 'annotation-1' }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'copyAnnotation', annotationId: 'annotation-1' })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'pasteAnnotation', pageId: 'page-1' }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'bringForward', annotationId: 'annotation-1' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'sendBackward', annotationId: 'annotation-1' })
  })

  it('ends the group when the inspector unmounts', () => {
    const dispatch = vi.fn()
    const view = render(<Inspector annotation={annotation} dispatch={dispatch} />)
    dispatch.mockClear()
    view.unmount()
    expect(dispatch).toHaveBeenCalledWith({ type: 'endHistoryGroup' })
  })

})

describe('PageCanvas render lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cancels the superseded render task when zoom changes', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    const { pdf, cancel, render: renderTask } = stubPdf()

    const view = renderPageCanvas(pdf, 'select', 1)
    await waitFor(() => expect(renderTask).toHaveBeenCalledTimes(1))

    view.rerender(
      <PageCanvas
        pdf={pdf}
        page={editorPage}
        annotations={[]}
        activeTool="select"
        selectedAnnotationId={null}
        zoom={1.5}
        dispatch={vi.fn()}
      />,
    )
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(renderTask).toHaveBeenCalledTimes(2))
  })

  it('caps canvas pixels for an oversized page and says quality was reduced', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    // A page far past the 16-megapixel budget even at scale 1 (about 36 megapixels).
    const getPage = vi.fn().mockResolvedValue({
      rotate: 0,
      getViewport: () => ({ width: 6000, height: 6000, scale: 1.16, transform: [1, 0, 0, -1, 0, 6000] }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
    })

    renderPageCanvas({ getPage } as unknown as PDFDocumentProxy, 'select')

    const canvas = await screen.findByLabelText<HTMLCanvasElement>('Rendered PDF page')
    await waitFor(() => expect(canvas.width).toBeGreaterThan(0))
    // The clamp must actually bite: scale below 1 is required here.
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(16_000_000)
    expect(canvas.width).toBeLessThan(6000)
    // CSS size still describes the full page, so export coordinates are unaffected.
    expect(canvas.style.width).toBe('6000px')
    expect(await screen.findByText('Preview quality reduced for this large page')).toBeInTheDocument()
  })

  it('keeps the pixel cap absolute even for an absurdly large page', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    // 100,000 x 100,000 CSS pixels is 10 billion, far past any scale floor. A minimum
    // output scale would silently reintroduce an over-budget canvas here.
    const getPage = vi.fn().mockResolvedValue({
      rotate: 0,
      getViewport: () => ({ width: 100_000, height: 100_000, scale: 1.16, transform: [1, 0, 0, -1, 0, 100_000] }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
    })

    renderPageCanvas({ getPage } as unknown as PDFDocumentProxy, 'select')
    const canvas = await screen.findByLabelText<HTMLCanvasElement>('Rendered PDF page')
    await waitFor(() => expect(canvas.width).toBeGreaterThan(0))
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(16_000_000)
  })

  it('still produces a usable canvas for a degenerate viewport', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    // A zero-area viewport must not divide by zero into a NaN canvas size.
    const getPage = vi.fn().mockResolvedValue({
      rotate: 0,
      getViewport: () => ({ width: 0, height: 0, scale: 1.16, transform: [1, 0, 0, -1, 0, 0] }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
    })

    renderPageCanvas({ getPage } as unknown as PDFDocumentProxy, 'select')
    const canvas = await screen.findByLabelText<HTMLCanvasElement>('Rendered PDF page')
    await waitFor(() => expect(canvas.width).toBeGreaterThanOrEqual(1))
    expect(Number.isFinite(canvas.width)).toBe(true)
    expect(Number.isFinite(canvas.height)).toBe(true)
  })

  it('does not claim reduced quality for a page inside the pixel budget', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    const { pdf } = stubPdf()
    renderPageCanvas(pdf, 'select')

    await screen.findByLabelText('Rendered PDF page')
    expect(screen.queryByText('Preview quality reduced for this large page')).not.toBeInTheDocument()
  })

  it('reports a genuine render failure without reporting cancellations', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    const getPage = vi.fn().mockResolvedValue({
      rotate: 0,
      getViewport: () => ({ width: 612, height: 792, scale: 1.16, transform: [1, 0, 0, -1, 0, 792] }),
      render: () => ({ promise: Promise.reject(new Error('broken page stream')), cancel: vi.fn() }),
      getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
    })

    renderPageCanvas({ getPage } as unknown as PDFDocumentProxy, 'select')
    expect(await screen.findByRole('alert')).toHaveTextContent('This page could not be rendered.')
  })

})
