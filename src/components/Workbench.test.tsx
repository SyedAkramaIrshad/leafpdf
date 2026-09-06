import { StrictMode, useEffect, useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { DiscardChangesDialog } from './DiscardChangesDialog'
import { ExportCompatibilityDialog } from './ExportCompatibilityDialog'
import { FileWelcome } from './FileWelcome'
import { HelpPanel } from './HelpPanel'
import { Inspector } from './Inspector'
import { MultiSelectionInspector } from './MultiSelectionInspector'
import { PageCanvas } from './PageCanvas'
import { PageRail } from './PageRail'
import { SignatureDialog } from './SignatureDialog'
import { SkipNavigation } from './SkipNavigation'
import { SearchReplacePopover } from './SearchReplacePopover'
import { SourceTextReplaceAction } from './SourceTextReplaceAction'
import { rangeForOccurrence } from './TextLayer'
import { ToolRail } from './ToolRail'
import { ToolPlacementHint } from './ToolPlacementHint'
import { UnfinishedTextDialog } from './UnfinishedTextDialog'
import { sourceOccurrenceForRange } from './useSourceTextSelection'
import { DEFAULT_ADDED_TEXT, type Annotation, type CreatedFormFieldAnnotation, type EditorPage, type HighlightAnnotation, type ImageAnnotation, type LinkAnnotation, type StampAnnotation, type TextAnnotation, type WhiteoutAnnotation } from '../model/editor'
import type { PendingMediaPlacement } from '../model/mediaPlacement'
import type { PreparedDetailPlacement } from '../model/personalDetails'

const editorPage: EditorPage = { id: 'page-1', kind: 'original', sourceIndex: 0, rotation: 0 }

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
      pageNumber={1}
      externalDocuments={new Map()}
      annotations={[]}
      activeTool={activeTool}
      selectedAnnotationIds={[]}
      formValues={{}}
      zoom={zoom}
      dispatch={dispatch}
    />,
  )
}

describe('PDF editor controls', () => {
  it('explains the common private document-finishing workflow', () => {
    const view = render(<FileWelcome busy={false} error={null} onFile={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeInTheDocument()
    const tasks = screen.getByRole('list', { name: 'Common PDF tasks' })
    for (const task of ['Add text', 'Fill details', 'Sign', 'Add image']) {
      expect(within(tasks).getByText(task)).toBeInTheDocument()
    }
    expect(screen.getByText(/never leaves this device/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /choose a pdf/i })).toBeInTheDocument()
    const input = view.container.querySelector<HTMLInputElement>('.visually-hidden[type="file"]')
    if (!input) throw new Error('The PDF file picker is missing.')
    expect(input).toHaveAttribute('hidden')
    expect(input).toHaveAttribute('tabindex', '-1')
    expect(input).toHaveAttribute('aria-label', 'Choose a PDF or LeafPDF project')
  })

  it('prioritizes everyday finishing tools in task order', () => {
    const onTool = vi.fn()
    const onDetails = vi.fn()
    const view = render(
      <ToolRail
        activeTool="select"
        detailsOpen={false}
        onTool={onTool}
        onImage={vi.fn()}
        onSignature={vi.fn()}
        onDetails={onDetails}
      />,
    )
    const rail = screen.getByRole('navigation', { name: 'Editing tools' })
    expect(within(rail).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Select',
      'Add text',
      'My details',
      'Add date',
      'Add checkmark',
      'Add signature',
      'Add image',
      'More editing tools',
    ])
    for (const name of ['Select', 'Add text', 'My details', 'Add date', 'Add checkmark', 'Add signature', 'Add image', 'More editing tools']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('group', { name: 'Advanced editing tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit existing text' })).not.toBeInTheDocument()
    const imageInput = view.container.querySelector<HTMLInputElement>('.visually-hidden[type="file"]')
    if (!imageInput) throw new Error('The image file picker is missing.')
    expect(imageInput).toHaveAttribute('hidden')
    expect(imageInput).toHaveAttribute('tabindex', '-1')
    expect(imageInput).toHaveAttribute('aria-label', 'Choose an image to add')
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    expect(onTool).toHaveBeenCalledWith('text')
    fireEvent.click(screen.getByRole('button', { name: 'Add date' }))
    expect(onTool).toHaveBeenCalledWith('date')
    fireEvent.click(screen.getByRole('button', { name: 'Add checkmark' }))
    expect(onTool).toHaveBeenCalledWith('check')
    fireEvent.click(screen.getByRole('button', { name: 'My details' }))
    expect(onDetails).toHaveBeenCalledOnce()

    view.rerender(
      <ToolRail
        activeTool="signature"
        detailsOpen={false}
        onTool={onTool}
        onImage={vi.fn()}
        onSignature={vi.fn()}
        onDetails={onDetails}
      />,
    )
    expect(screen.getByRole('button', { name: 'Add signature' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Add image' })).toHaveAttribute('aria-pressed', 'false')

    view.rerender(
      <ToolRail
        activeTool="image"
        detailsOpen
        onTool={onTool}
        onImage={vi.fn()}
        onSignature={vi.fn()}
        onDetails={onDetails}
      />,
    )
    expect(screen.getByRole('button', { name: 'Add signature' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Add image' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'My details' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'My details' })).toHaveClass('is-active')
  })

  it('reveals every advanced editor without crowding the default lane', () => {
    const onTool = vi.fn()
    const view = render(
      <ToolRail
        activeTool="select"
        detailsOpen={false}
        onTool={onTool}
        onImage={vi.fn()}
        onSignature={vi.fn()}
        onDetails={vi.fn()}
      />,
    )
    const more = screen.getByRole('button', { name: 'More editing tools' })
    expect(more).toHaveClass('more-editing-tools-button')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveAttribute('aria-controls', 'advanced-editing-tools')
    expect(view.container.querySelector('#advanced-editing-tools')).toHaveAttribute('hidden')

    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(view.container.querySelector('#advanced-editing-tools')).not.toHaveAttribute('hidden')
    expect(screen.getByRole('group', { name: 'Advanced editing tools' })).toBeInTheDocument()
    for (const name of ['Forms', 'Text marks', 'Draw', 'Add link', 'Whiteout', 'Shapes', 'More marks', 'Redact']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(onTool).toHaveBeenCalledWith('link')
    expect(screen.queryByRole('group', { name: 'Advanced editing tools' })).not.toBeInTheDocument()

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: 'Text marks' }))
    for (const name of ['Highlight', 'Underline', 'Strikeout']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('menuitem', { name: 'Underline' }))
    expect(onTool).toHaveBeenCalledWith('underline')
    expect(screen.queryByRole('group', { name: 'Advanced editing tools' })).not.toBeInTheDocument()

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: 'Forms' }))
    for (const name of ['Add text field', 'Add checkbox field', 'Add radio choice', 'Add dropdown field']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add text field' }))
    expect(onTool).toHaveBeenCalledWith('form-text')

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: 'Shapes' }))
    for (const name of ['Add rectangle', 'Add ellipse', 'Add line', 'Add arrow']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add arrow' }))
    expect(onTool).toHaveBeenCalledWith('arrow')

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: 'More marks' }))
    for (const name of ['Add cross', 'Add dot']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('menuitem', { name: 'Add date' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Add checkmark' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add cross' }))
    expect(onTool).toHaveBeenCalledWith('cross')

    fireEvent.click(more)
    const draw = screen.getByRole('button', { name: 'Draw' })
    draw.focus()
    fireEvent.keyDown(draw, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Advanced editing tools' })).not.toBeInTheDocument()
    expect(more).toHaveFocus()

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: 'Redact' }))
    expect(onTool).toHaveBeenCalledWith('redact')
    expect(screen.queryByRole('group', { name: 'Advanced editing tools' })).not.toBeInTheDocument()
  })

  it('supports keyboard navigation inside tool palettes', async () => {
    render(
      <ToolRail
        activeTool="select"
        detailsOpen={false}
        onTool={vi.fn()}
        onImage={vi.fn()}
        onSignature={vi.fn()}
        onDetails={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More editing tools' }))
    const textMarksOpener = screen.getByRole('button', { name: 'Text marks' })
    fireEvent.click(textMarksOpener)
    const highlight = screen.getByRole('menuitem', { name: 'Highlight' })
    const underline = screen.getByRole('menuitem', { name: 'Underline' })
    const strikeout = screen.getByRole('menuitem', { name: 'Strikeout' })
    await waitFor(() => expect(highlight).toHaveFocus())
    fireEvent.keyDown(highlight, { key: 'ArrowDown' })
    expect(underline).toHaveFocus()
    fireEvent.keyDown(underline, { key: 'ArrowRight' })
    expect(strikeout).toHaveFocus()
    fireEvent.keyDown(strikeout, { key: 'Escape' })
    await waitFor(() => expect(textMarksOpener).toHaveFocus())

    const opener = screen.getByRole('button', { name: 'Shapes' })
    fireEvent.click(opener)
    const rectangle = screen.getByRole('menuitem', { name: 'Add rectangle' })
    const ellipse = screen.getByRole('menuitem', { name: 'Add ellipse' })
    await waitFor(() => expect(rectangle).toHaveFocus())
    fireEvent.keyDown(rectangle, { key: 'ArrowDown' })
    expect(ellipse).toHaveFocus()
    fireEvent.keyDown(ellipse, { key: 'Escape' })
    await waitFor(() => expect(opener).toHaveFocus())

    const marksOpener = screen.getByRole('button', { name: 'More marks' })
    fireEvent.click(marksOpener)
    const cross = screen.getByRole('menuitem', { name: 'Add cross' })
    const dot = screen.getByRole('menuitem', { name: 'Add dot' })
    await waitFor(() => expect(cross).toHaveFocus())
    fireEvent.keyDown(cross, { key: 'ArrowRight' })
    expect(dot).toHaveFocus()
    fireEvent.keyDown(dot, { key: 'Escape' })
    await waitFor(() => expect(marksOpener).toHaveFocus())

    const formsOpener = screen.getByRole('button', { name: 'Forms' })
    fireEvent.click(formsOpener)
    const textField = screen.getByRole('menuitem', { name: 'Add text field' })
    const checkboxField = screen.getByRole('menuitem', { name: 'Add checkbox field' })
    const radioField = screen.getByRole('menuitem', { name: 'Add radio choice' })
    const dropdownField = screen.getByRole('menuitem', { name: 'Add dropdown field' })
    await waitFor(() => expect(textField).toHaveFocus())
    fireEvent.keyDown(textField, { key: 'ArrowDown' })
    expect(checkboxField).toHaveFocus()
    fireEvent.keyDown(checkboxField, { key: 'ArrowDown' })
    expect(radioField).toHaveFocus()
    fireEvent.keyDown(radioField, { key: 'ArrowDown' })
    expect(dropdownField).toHaveFocus()
    fireEvent.keyDown(dropdownField, { key: 'Escape' })
    await waitFor(() => expect(formsOpener).toHaveFocus())
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
      kind: 'original' as const,
      sourceIndex: index,
      rotation: 0 as const,
    }))

    render(
      <PageRail
        pdf={{ getPage } as unknown as PDFDocumentProxy}
        pages={pages}
        selectedPageId="page-1"
        externalDocuments={new Map()}
        onInsertBlankPage={vi.fn()}
        onInsertPdf={vi.fn()}
        onSelectPage={vi.fn()}
        onClose={vi.fn()}
        dispatch={vi.fn()}
      />,
    )
    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(1))
    expect(getPage).toHaveBeenCalledWith(1)
    vi.unstubAllGlobals()
  })

  it('exposes page actions in a focus-managed organizer dialog', async () => {
    const { pdf } = stubPdf()
    const pages: EditorPage[] = [
      editorPage,
      { id: 'page-2', kind: 'original', sourceIndex: 1, rotation: 0 },
    ]
    const onInsertBlankPage = vi.fn()
    const onInsertPdf = vi.fn()
    const onSelectPage = vi.fn()
    const dispatch = vi.fn()

    function OrganizerHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open page organizer</button>
          {open && (
            <PageRail
              pdf={pdf}
              pages={pages}
              selectedPageId="page-1"
              externalDocuments={new Map()}
              onInsertBlankPage={onInsertBlankPage}
              onInsertPdf={onInsertPdf}
              onSelectPage={onSelectPage}
              onClose={() => setOpen(false)}
              dispatch={dispatch}
            />
          )}
        </>
      )
    }

    const view = render(<OrganizerHarness />)
    const opener = screen.getByRole('button', { name: 'Open page organizer' })
    opener.focus()
    fireEvent.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Document pages' })
    expect(within(dialog).getByText('2')).toBeInTheDocument()
    const close = within(dialog).getByRole('button', { name: 'Close page organizer' })
    await waitFor(() => expect(close).toHaveFocus())

    fireEvent.click(within(dialog).getByRole('button', { name: '+ Blank page' }))
    expect(onInsertBlankPage).toHaveBeenCalledOnce()
    const insertInput = view.container.querySelector<HTMLInputElement>('input[aria-label="Choose a PDF to insert"]')
    if (!insertInput) throw new Error('The insert-PDF picker is missing.')
    const inserted = new File(['pdf'], 'insert.pdf', { type: 'application/pdf' })
    fireEvent.change(insertInput, { target: { files: [inserted] } })
    expect(onInsertPdf).toHaveBeenCalledWith(inserted)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Select page 2' }))
    expect(onSelectPage).toHaveBeenCalledWith('page-2')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move page 2 up' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rotate page 2' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete page 2' }))
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'movePage', pageId: 'page-2', direction: -1 })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'rotatePage', pageId: 'page-2', degrees: 90 })
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: 'removePage', pageId: 'page-2' })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Document pages' })).not.toBeInTheDocument()
    await waitFor(() => expect(opener).toHaveFocus())

    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Close page organizer' }))
    expect(screen.queryByRole('dialog', { name: 'Document pages' })).not.toBeInTheDocument()
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('previews a page-grip drag and commits one direct reorder on drop', () => {
    const { pdf } = stubPdf()
    const pages: EditorPage[] = [
      editorPage,
      { id: 'page-2', kind: 'original', sourceIndex: 1, rotation: 0 },
      { id: 'page-3', kind: 'original', sourceIndex: 2, rotation: 0 },
    ]
    const dispatch = vi.fn()
    const view = render(
      <PageRail
        pdf={pdf}
        pages={pages}
        selectedPageId="page-1"
        externalDocuments={new Map()}
        onInsertBlankPage={vi.fn()}
        onInsertPdf={vi.fn()}
        onSelectPage={vi.fn()}
        onClose={vi.fn()}
        dispatch={dispatch}
      />,
    )

    const rectangle = (top: number, height: number): DOMRect => ({
      x: 0, y: top, top, left: 0, right: 220, bottom: top + height,
      width: 220, height, toJSON: () => ({}),
    })
    const list = view.container.querySelector<HTMLElement>('.thumbnail-list')
    if (!list) throw new Error('The page thumbnail list is missing.')
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(rectangle(0, 500))
    const cards = Array.from(view.container.querySelectorAll<HTMLElement>('.thumbnail-card'))
    cards.forEach((card, index) => {
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rectangle(index * 140, 120))
    })

    const grip = screen.getByRole('button', { name: 'Drag page 2 to reorder' })
    fireEvent.pointerDown(grip, { pointerId: 7, pointerType: 'touch', button: 0, clientY: 180 })
    expect(grip).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerMove(grip, { pointerId: 7, pointerType: 'touch', clientY: 20 })

    expect(dispatch).not.toHaveBeenCalled()
    expect(Array.from(view.container.querySelectorAll<HTMLElement>('.thumbnail-card')).map(
      (card) => card.dataset.pageReorderId,
    )).toEqual(['page-2', 'page-1', 'page-3'])

    fireEvent.pointerUp(grip, { pointerId: 7, pointerType: 'touch', clientY: 20 })
    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith({ type: 'movePageToIndex', pageId: 'page-2', targetIndex: 0 })

    dispatch.mockClear()
    const secondGrip = screen.getByRole('button', { name: 'Drag page 2 to reorder' })
    fireEvent.pointerDown(secondGrip, { pointerId: 8, pointerType: 'touch', button: 0, clientY: 180 })
    fireEvent.pointerMove(secondGrip, { pointerId: 8, pointerType: 'touch', clientY: 20 })
    fireEvent.pointerCancel(secondGrip, { pointerId: 8, pointerType: 'touch' })
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('ExportCompatibilityDialog', () => {
  const features = {
    isEncrypted: false,
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

describe('UnfinishedTextDialog', () => {
  it('renders only when unfinished text exists and focuses the safe review action', async () => {
    const view = render(
      <UnfinishedTextDialog count={0} onCancel={vi.fn()} onReview={vi.fn()} onSaveAnyway={vi.fn()} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    view.rerender(
      <UnfinishedTextDialog count={1} onCancel={vi.fn()} onReview={vi.fn()} onSaveAnyway={vi.fn()} />,
    )
    expect(screen.getByRole('dialog', { name: 'Finish this text before saving?' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText(/still says “Type here”/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review text' })).toHaveFocus())
  })

  it('reports review, explicit bypass, and Escape cancellation', () => {
    const onCancel = vi.fn()
    const onReview = vi.fn()
    const onSaveAnyway = vi.fn()
    const view = render(
      <UnfinishedTextDialog count={2} onCancel={onCancel} onReview={onReview} onSaveAnyway={onSaveAnyway} />,
    )
    expect(screen.getByText(/found 2 text boxes/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review text' }))
    expect(onReview).toHaveBeenCalledOnce()

    view.rerender(
      <UnfinishedTextDialog count={2} onCancel={onCancel} onReview={onReview} onSaveAnyway={onSaveAnyway} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }))
    expect(onSaveAnyway).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('traps focus across all three decisions', async () => {
    render(<UnfinishedTextDialog count={1} onCancel={vi.fn()} onReview={vi.fn()} onSaveAnyway={vi.fn()} />)
    const first = screen.getByRole('button', { name: 'Cancel' })
    const last = screen.getByRole('button', { name: 'Review text' })
    await waitFor(() => expect(last).toHaveFocus())

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
    await waitFor(() => expect(screen.getByLabelText('Name for signature')).toHaveFocus())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('labels the canvas and describes what the signature is not', () => {
    render(<SignatureDialog open onClose={vi.fn()} onApply={vi.fn()} />)
    expect(screen.getByLabelText('Signature preview')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Draw' }))
    expect(screen.getByLabelText('Signature drawing area')).toBeInTheDocument()
    expect(screen.getByText(/not a digital signature/i)).toBeInTheDocument()
    expect(screen.getByText(/not certificate-backed/i)).toBeInTheDocument()
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
  it('names semantic text marks and exposes line weight without changing legacy highlights', () => {
    const dispatch = vi.fn()
    const underline: HighlightAnnotation = {
      id: 'underline-1', pageId: 'page-1', kind: 'highlight', mark: 'underline',
      x: 0.1, y: 0.2, width: 0.4, height: 0.06, color: '#3157d5', opacity: 1, strokeWidth: 3,
    }
    const view = render(<Inspector annotation={underline} dispatch={dispatch} />)

    expect(screen.getByRole('heading', { name: 'Underline' })).toBeInTheDocument()
    expect(screen.getByLabelText('Weight')).toHaveValue('3')
    expect(screen.getByLabelText('Weight')).toHaveAttribute('max', '9')
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '4' } })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'underline-1', patch: { strokeWidth: 4 },
      historyGroup: 'annotation-underline-1-strokeWidth',
    })

    const legacyHighlight: HighlightAnnotation = {
      id: 'highlight-1', pageId: 'page-1', kind: 'highlight',
      x: 0.1, y: 0.2, width: 0.4, height: 0.06, color: '#ffd447', opacity: 0.42,
    }
    view.rerender(<Inspector key="highlight-1" annotation={legacyHighlight} dispatch={dispatch} />)
    expect(screen.getByRole('heading', { name: 'Highlight' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Weight')).not.toBeInTheDocument()
  })

  const annotation: TextAnnotation = {
    id: 'annotation-1', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.2,
    width: 0.3, height: 0.08, text: 'Draft', color: '#182026', fontSize: 18,
  }

  it('keeps content editing on the page instead of duplicating it in the inspector', () => {
    const dispatch = vi.fn()
    render(<Inspector annotation={annotation} dispatch={dispatch} />)

    expect(screen.queryByLabelText('Content')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Text box' })).toBeInTheDocument()
    expect(screen.getByText(/edit the words directly on the page/i)).toBeInTheDocument()
  })

  it('names source replacement text and keeps its visual-only safety warning visible', () => {
    const replacement: TextAnnotation = {
      ...annotation,
      id: 'replacement-1',
      text: 'Syed Akrama',
      sourceReplacement: true,
    }
    render(<Inspector annotation={replacement} dispatch={vi.fn()} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Replacement text' })).toBeInTheDocument()
    const safety = screen.getByRole('region', { name: 'Visual replacement safety' })
    expect(safety).toHaveTextContent('Visual correction')
    expect(safety).toHaveTextContent(/source text remains underneath/i)
    expect(safety).toHaveTextContent(/searchable, selectable, or recoverable/i)
    expect(safety).toHaveTextContent(/use Redact/i)
  })

  it('explains that media corner resizing keeps proportions locked', () => {
    const image: ImageAnnotation = {
      id: 'image-1', pageId: 'page-1', kind: 'image', x: 0.1, y: 0.2,
      width: 0.3, height: 0.2, dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png',
    }
    render(<Inspector annotation={image} dispatch={vi.fn()} />)

    expect(screen.getByText(/proportions stay locked/i)).toBeInTheDocument()
  })

  it('proofs image opacity and orientation and forwards one local replacement file', async () => {
    const image: ImageAnnotation = {
      id: 'image-1', pageId: 'page-1', kind: 'image', x: 0.1, y: 0.2,
      width: 0.3, height: 0.2, rotation: 15,
      dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png',
    }
    const dispatch = vi.fn()
    const onReplaceImage = vi.fn().mockResolvedValue(undefined)
    render(<Inspector annotation={image} dispatch={dispatch} onReplaceImage={onReplaceImage} />)

    expect(screen.getByLabelText('Opacity')).toHaveValue('1')
    fireEvent.change(screen.getByLabelText('Opacity'), { target: { value: '0.45' } })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'image-1', patch: { opacity: 0.45 },
      historyGroup: 'annotation-image-1-opacity',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Turn image left' }))
    fireEvent.click(screen.getByRole('button', { name: 'Straighten image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Turn image right' }))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'image-1', patch: { rotation: 285 },
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'image-1', patch: { rotation: 0 },
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'image-1', patch: { rotation: 105 },
    })

    const replacement = new File(['replacement'], 'replacement.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Choose replacement image'), { target: { files: [replacement] } })
    await waitFor(() => expect(onReplaceImage).toHaveBeenCalledWith(image, replacement))
  })

  it('keeps signature proofing controls but routes replacement through the signature desk', () => {
    const signature: ImageAnnotation = {
      id: 'signature-1', pageId: 'page-1', kind: 'image', role: 'signature',
      x: 0.2, y: 0.6, width: 0.38, height: 0.13,
      dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png',
    }
    const dispatch = vi.fn()
    render(<Inspector annotation={signature} dispatch={dispatch} onReplaceImage={vi.fn()} />)

    expect(screen.getByLabelText('Opacity')).toHaveValue('1')
    expect(screen.getByRole('button', { name: 'Straighten signature' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Replace image' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Choose replacement image')).not.toBeInTheDocument()
  })

  it('adds replacement text directly over a selected whiteout', () => {
    const whiteout: WhiteoutAnnotation = {
      id: 'whiteout-1', pageId: 'page-1', kind: 'whiteout',
      x: 0.12, y: 0.34, width: 0.46, height: 0.07, rotation: 4,
    }
    const dispatch = vi.fn()
    const announce = vi.fn()
    render(<Inspector annotation={whiteout} dispatch={dispatch} announce={announce} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add replacement text' }))

    expect(dispatch).toHaveBeenCalledWith({
      type: 'addAnnotation',
      annotation: expect.objectContaining({
        id: expect.any(String), pageId: 'page-1', kind: 'text',
        x: 0.12, y: 0.34, width: 0.46, height: 0.07, rotation: 4,
        text: DEFAULT_ADDED_TEXT, color: '#182026', fontSize: 18,
      }),
    })
    expect(announce).toHaveBeenCalledWith('Replacement text added. Type on the page, then press Enter.')
  })

  it('opens clickable-link controls immediately and groups destination edits', () => {
    const link: LinkAnnotation = {
      id: 'link-1', pageId: 'page-1', kind: 'link', x: 0.12, y: 0.2,
      width: 0.44, height: 0.07, targetType: 'url', target: 'example.com/offer',
    }
    const dispatch = vi.fn()
    render(<Inspector annotation={link} dispatch={dispatch} />)

    const inspector = screen.getByRole('complementary', { name: 'Clickable link' })
    expect(inspector).not.toHaveClass('is-collapsed')
    expect(screen.getByLabelText('Link type')).toHaveValue('url')
    expect(screen.getByLabelText('Destination')).toHaveValue('example.com/offer')
    expect(screen.getByText('Ready: https://example.com/offer')).toBeInTheDocument()
    expect(screen.getByText(/blue area is only an editing guide/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Link type'), { target: { value: 'email' } })
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'hello@example.com' } })
    fireEvent.blur(screen.getByLabelText('Destination'))

    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'link-1',
      patch: { targetType: 'email' }, historyGroup: 'annotation-link-1-targetType',
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'link-1',
      patch: { target: 'hello@example.com' }, historyGroup: 'annotation-link-1-target',
    })
    expect(dispatch).toHaveBeenCalledWith({ type: 'endHistoryGroup' })
  })

  it('opens created text-field properties, validates names, and exposes exact form settings', () => {
    const field: CreatedFormFieldAnnotation = {
      id: 'field-2', pageId: 'page-1', kind: 'form-field', fieldType: 'text',
      fieldName: 'leafpdf.text.2', x: 0.12, y: 0.2, width: 0.44, height: 0.07,
      required: false, defaultText: 'Your name', multiline: false,
    }
    const other: CreatedFormFieldAnnotation = {
      ...field, id: 'field-1', fieldName: 'leafpdf.text.1', defaultText: '',
    }
    const dispatch = vi.fn()
    render(<Inspector annotation={field} annotations={[other, field]} dispatch={dispatch} />)

    const inspector = screen.getByRole('complementary', { name: 'Text field' })
    expect(inspector).not.toHaveClass('is-collapsed')
    expect(screen.getByLabelText('Field name')).toHaveValue('leafpdf.text.2')
    expect(screen.getByLabelText('Default text')).toHaveValue('Your name')
    expect(screen.getByLabelText('Required field')).not.toBeChecked()
    expect(screen.getByLabelText('Multiline field')).not.toBeChecked()
    expect(screen.getByText(/stays fillable after export/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Field name'), { target: { value: 'leafpdf.text.1' } })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'field-2', patch: { fieldName: 'leafpdf.text.1' },
      historyGroup: 'annotation-field-2-fieldName',
    })
    expect(screen.getByText('Another created field already uses this name.')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Required field'))
    fireEvent.click(screen.getByLabelText('Multiline field'))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'field-2', patch: { required: true },
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'field-2', patch: { multiline: true },
    })
  })

  it('shows checkbox default state without text-only controls', () => {
    const field: CreatedFormFieldAnnotation = {
      id: 'check-1', pageId: 'page-1', kind: 'form-field', fieldType: 'checkbox',
      fieldName: 'leafpdf.checkbox.1', x: 0.12, y: 0.2, width: 0.05, height: 0.05,
      required: true, checkedByDefault: true,
    }
    render(<Inspector annotation={field} annotations={[field]} dispatch={vi.fn()} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Checkbox field' })).toBeInTheDocument()
    expect(screen.getByLabelText('Checked by default')).toBeChecked()
    expect(screen.queryByLabelText('Default text')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Multiline field')).not.toBeInTheDocument()
  })

  it('edits a radio group as one undoable unit and adds another choice', () => {
    const yes: CreatedFormFieldAnnotation = {
      id: 'radio-yes', pageId: 'page-1', kind: 'form-field', fieldType: 'radio',
      fieldName: 'relocation', optionValue: 'Yes', selectedByDefault: false,
      x: 0.12, y: 0.2, width: 0.05, height: 0.05, required: true,
    }
    const no: CreatedFormFieldAnnotation = {
      ...yes, id: 'radio-no', optionValue: 'No', selectedByDefault: true, x: 0.24,
    }
    const dispatch = vi.fn()
    const announce = vi.fn()
    render(<Inspector annotation={yes} annotations={[yes, no]} dispatch={dispatch} announce={announce} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Radio choice' })).toBeInTheDocument()
    expect(screen.getByLabelText('Group name')).toHaveValue('relocation')
    expect(screen.getByLabelText('Option value')).toHaveValue('Yes')
    expect(screen.getByLabelText('Required group')).toBeChecked()
    expect(screen.getByLabelText('Selected by default')).not.toBeChecked()
    expect(screen.getByText('Unique group name ready.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'offer.relocation' } })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'radio-yes', patch: { fieldName: 'offer.relocation' },
      historyGroup: 'radio-relocation-fieldName',
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'radio-no', patch: { fieldName: 'offer.relocation' },
      historyGroup: 'radio-relocation-fieldName',
    })

    fireEvent.click(screen.getByLabelText('Selected by default'))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'radio-no', patch: { selectedByDefault: false },
      historyGroup: 'radio-relocation-selectedByDefault',
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'radio-yes', patch: { selectedByDefault: true },
      historyGroup: 'radio-relocation-selectedByDefault',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add another choice' }))
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'duplicateAnnotation', annotationId: 'radio-yes',
    }))
    expect(announce).toHaveBeenCalledWith('Added another choice to this radio group. Undo removes it.')
  })

  it('edits ordered dropdown choices, validates them inline, and clears a removed default', () => {
    const field: CreatedFormFieldAnnotation = {
      id: 'dropdown-1', pageId: 'page-1', kind: 'form-field', fieldType: 'dropdown',
      fieldName: 'office.location', options: ['Dubai', 'Abu Dhabi'], defaultOption: 'Dubai',
      x: 0.12, y: 0.2, width: 0.3, height: 0.06, required: false,
    }
    const dispatch = vi.fn()
    const view = render(<Inspector annotation={field} annotations={[field]} dispatch={dispatch} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Dropdown field' })).toBeInTheDocument()
    expect(screen.getByLabelText('Choices, one per line')).toHaveValue('Dubai\nAbu Dhabi')
    expect(screen.getByLabelText('Default choice')).toHaveValue('Dubai')
    expect(screen.getByLabelText('Required field')).not.toBeChecked()
    expect(screen.getByText('2 unique choices ready.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Choices, one per line'), {
      target: { value: 'Dubai\nAbu Dhabi\nDubai' },
    })
    expect(screen.getByText('Every choice needs a unique value.')).toBeInTheDocument()

    view.rerender(<Inspector annotation={field} annotations={[field]} dispatch={dispatch} />)
    fireEvent.change(screen.getByLabelText('Choices, one per line'), {
      target: { value: 'Abu Dhabi\nBengaluru' },
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'dropdown-1',
      patch: { options: ['Abu Dhabi', 'Bengaluru'], defaultOption: '' },
      historyGroup: 'annotation-dropdown-1-options',
    })
  })

  it('does not reserve an empty properties region', () => {
    const view = render(<Inspector annotation={null} dispatch={vi.fn()} />)
    expect(view.container).toBeEmptyDOMElement()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('offers the properties skip link only when item properties exist', () => {
    const view = render(<SkipNavigation hasItemProperties={false} />)
    expect(screen.getByRole('link', { name: 'Skip to PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Skip to item properties' })).not.toBeInTheDocument()

    view.rerender(<SkipNavigation hasItemProperties />)
    expect(screen.getByRole('link', { name: 'Skip to item properties' })).toHaveAttribute('href', '#item-properties')
  })

  it('finishes the selected item explicitly', () => {
    const dispatch = vi.fn()
    render(<Inspector annotation={annotation} dispatch={dispatch} />)

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'endHistoryGroup' })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'selectAnnotation', annotationId: null })
  })

  it('collapses and expands item properties without changing the document', async () => {
    const dispatch = vi.fn()
    const view = render(<Inspector annotation={annotation} dispatch={dispatch} />)
    const inspector = screen.getByRole('complementary', { name: 'Text box' })
    const controlsId = 'item-properties-controls-annotation-1'

    expect(inspector).toHaveClass('is-collapsed')
    const show = screen.getByRole('button', { name: 'Show item properties' })
    expect(show).toHaveTextContent('Adjust')
    expect(show).toHaveAttribute('aria-expanded', 'false')
    expect(show).toHaveAttribute('aria-controls', controlsId)
    expect(view.container.querySelector(`#${controlsId}`)).toHaveClass('inspector-body')

    dispatch.mockClear()
    fireEvent.click(show)
    expect(inspector).not.toHaveClass('is-collapsed')
    const hide = screen.getByRole('button', { name: 'Hide item properties' })
    expect(hide).toHaveTextContent('Hide')
    expect(hide).toHaveAttribute('aria-expanded', 'true')
    expect(dispatch).not.toHaveBeenCalled()

    fireEvent.click(hide)
    expect(inspector).toHaveClass('is-collapsed')
    expect(dispatch).not.toHaveBeenCalled()

    fireEvent.click(show)
    view.rerender(<Inspector key="annotation-2" annotation={{ ...annotation, id: 'annotation-2' }} dispatch={dispatch} />)
    await waitFor(() => expect(screen.getByRole('complementary', { name: 'Text box' })).toHaveClass('is-collapsed'))
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

  it('chooses a calendar date, exact printed format, or custom date wording', () => {
    const dispatch = vi.fn()
    const date: StampAnnotation = {
      id: 'date-1', pageId: 'page-1', kind: 'stamp', stamp: 'date',
      x: 0.2, y: 0.2, width: 0.22, height: 0.05,
      label: '30 Aug 2026', dateValue: '2026-08-30', dateFormat: 'day-month',
      color: '#101827', strokeWidth: 2.5,
    }
    const view = render(<Inspector annotation={date} dispatch={dispatch} />)
    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.getByLabelText('Calendar date')).toHaveValue('2026-08-30')
    expect(screen.getByRole('button', { name: 'Day month date format' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Day month date format' })).toHaveTextContent('30 Aug 2026')

    fireEvent.click(screen.getByRole('button', { name: 'Month day date format' }))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'date-1',
      patch: { label: 'Aug 30, 2026', dateFormat: 'month-day' }, historyGroup: undefined,
    })

    view.rerender(<Inspector annotation={{ ...date, label: 'Aug 30, 2026', dateFormat: 'month-day' }} dispatch={dispatch} />)
    fireEvent.change(screen.getByLabelText('Calendar date'), { target: { value: '2027-01-05' } })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'date-1',
      patch: { dateValue: '2027-01-05', dateFormat: 'month-day', label: 'Jan 5, 2027' },
      historyGroup: 'annotation-date-1-dateValue',
    })

    fireEvent.change(screen.getByLabelText('Date text'), { target: { value: 'Effective 5 January 2027' } })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAnnotation', annotationId: 'date-1',
      patch: { label: 'Effective 5 January 2027', dateFormat: 'custom' },
      historyGroup: 'annotation-date-1-label',
    })
  })

  it('keeps legacy label-only dates custom until a calendar date is chosen', () => {
    const date: StampAnnotation = {
      id: 'legacy-date', pageId: 'page-1', kind: 'stamp', stamp: 'date',
      x: 0.2, y: 0.2, width: 0.22, height: 0.05,
      label: '29 August 2026', color: '#101827', strokeWidth: 2.5,
    }
    render(<Inspector annotation={date} dispatch={vi.fn()} />)
    expect(screen.getByLabelText('Calendar date')).toHaveValue('')
    for (const name of ['Day month', 'Month day', 'Day first', 'ISO']) {
      expect(screen.getByRole('button', { name: `${name} date format` })).toBeDisabled()
    }
    expect(screen.getByLabelText('Date text')).toHaveValue('29 August 2026')
  })

  it('calls a placed signature a signature and explains visual placement', () => {
    const signature: ImageAnnotation = {
      id: 'signature-1', pageId: 'page-1', kind: 'image', role: 'signature',
      x: 0.2, y: 0.6, width: 0.38, height: 0.13,
      dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png',
    }
    render(<Inspector annotation={signature} dispatch={vi.fn()} />)
    expect(screen.getByText('Signature')).toBeInTheDocument()
    expect(screen.getByText(/Drag to move; resize with blue corners/i)).toBeInTheDocument()
  })

  it('exposes object clipboard and layer actions', () => {
    const dispatch = vi.fn()
    const announce = vi.fn()
    render(<Inspector annotation={annotation} canPaste dispatch={dispatch} announce={announce} />)
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
    expect(announce).toHaveBeenNthCalledWith(1, 'Duplicated item. Undo removes it.')
    expect(announce).toHaveBeenNthCalledWith(2, 'Item copied. Paste creates an offset copy.')
    expect(announce).toHaveBeenNthCalledWith(3, 'Pasted a new item. Undo removes it.')
  })

  it('does not mutate editor history when the inspector unmounts', () => {
    const dispatch = vi.fn()
    const view = render(<Inspector annotation={annotation} dispatch={dispatch} />)
    dispatch.mockClear()
    view.unmount()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not end history from the Strict Mode mount lifecycle', () => {
    const dispatch = vi.fn()
    render(
      <StrictMode>
        <Inspector annotation={annotation} dispatch={dispatch} />
      </StrictMode>,
    )

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'endHistoryGroup' })
  })

})

describe('Selection inspectors', () => {
  const selectedItems: Annotation[] = [
    {
      id: 'name-1', pageId: 'page-1', kind: 'text', x: 0.12, y: 0.2,
      width: 0.28, height: 0.06, text: 'Syed Akrama', color: '#182026', fontSize: 16,
    },
    {
      id: 'date-1', pageId: 'page-1', kind: 'stamp', stamp: 'date',
      x: 0.48, y: 0.42, width: 0.2, height: 0.05,
      label: '30 Aug 2026', color: '#182026', strokeWidth: 2,
    },
    {
      id: 'check-1', pageId: 'page-1', kind: 'stamp', stamp: 'check',
      x: 0.72, y: 0.63, width: 0.05, height: 0.05,
      color: '#182026', strokeWidth: 2,
    },
  ]

  it('arms touch selection from the single-item inspector', () => {
    const onSelectMore = vi.fn()
    render(
      <Inspector
        annotation={selectedItems[0]}
        dispatch={vi.fn()}
        multiSelectMode={false}
        onSelectMore={onSelectMore}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show item properties' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select more items' }))

    expect(onSelectMore).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('complementary', { name: 'Text box' })).toHaveClass('is-collapsed')
  })

  it('aligns and removes a group with one action per selection operation', () => {
    const dispatch = vi.fn()
    const announce = vi.fn()
    const onAddMore = vi.fn()
    const onDone = vi.fn()
    render(
      <MultiSelectionInspector
        annotations={selectedItems}
        dispatch={dispatch}
        onAddMore={onAddMore}
        onDone={onDone}
        announce={announce}
      />,
    )

    expect(screen.getByRole('heading', { name: '3 items' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('3 items selected')
    for (const name of ['Left', 'Center', 'Right', 'Top', 'Middle', 'Bottom']) {
      expect(screen.getByRole('button', { name: `Align selected items ${name.toLowerCase()}` })).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('button', { name: 'Align selected items left' }))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'replaceAnnotations',
      annotations: selectedItems.map((item) => expect.objectContaining({ id: item.id, x: 0.12 })),
    })
    expect(announce).toHaveBeenCalledWith('Aligned 3 items left.')

    fireEvent.click(screen.getByRole('button', { name: 'Add another' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onAddMore).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Delete 3 items' }))
    expect(dispatch).toHaveBeenCalledWith({
      type: 'removeAnnotations', annotationIds: ['name-1', 'date-1', 'check-1'],
    })
  })
})

describe('Tool placement guidance', () => {
  it('explains where the armed finishing tool will act', () => {
    const view = render(<ToolPlacementHint tool="check" />)
    expect(screen.getByRole('status')).toHaveTextContent('Click where the checkmark should go')
    view.rerender(<ToolPlacementHint tool="signature" />)
    expect(screen.getByRole('status')).toHaveTextContent('Click where the signature should go')
    expect(screen.getByRole('status')).toHaveTextContent('Enter center')
    expect(screen.getByRole('status')).toHaveTextContent('Esc cancel')
    view.rerender(<ToolPlacementHint tool="image" />)
    expect(screen.getByRole('status')).toHaveTextContent('Click where the image should go')
    expect(screen.getByRole('status')).toHaveTextContent('Enter center')
    view.rerender(<ToolPlacementHint tool="link" />)
    expect(screen.getByRole('status')).toHaveTextContent('Drag over the area that should open a link')
    view.rerender(<ToolPlacementHint tool="underline" />)
    expect(screen.getByRole('status')).toHaveTextContent('Drag across the area to underline')
    view.rerender(<ToolPlacementHint tool="strikeout" />)
    expect(screen.getByRole('status')).toHaveTextContent('Drag across the area to strike out')
    view.rerender(<ToolPlacementHint tool="text" preparedDetail={{
      id: 'fullName', label: 'Full name', text: 'Alex Morgan', width: 0.32, height: 0.07, fontSize: 14,
    }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Click where Full name should go')
    view.rerender(<ToolPlacementHint tool="form-text" />)
    expect(screen.getByRole('status')).toHaveTextContent('Drag where people should type')
    view.rerender(<ToolPlacementHint tool="form-checkbox" />)
    expect(screen.getByRole('status')).toHaveTextContent('Drag where the checkbox should go')
    view.rerender(<ToolPlacementHint tool="form-radio" />)
    expect(screen.getByRole('status')).toHaveTextContent('Drag where this radio choice should go')
    view.rerender(<ToolPlacementHint tool="form-dropdown" />)
    expect(screen.getByRole('status')).toHaveTextContent('Drag where the dropdown should go')
    expect(screen.getByRole('status')).toHaveTextContent('Esc cancel')
    view.rerender(<ToolPlacementHint tool="select" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('Source text replacement action', () => {
  it('anchors an honest, keyboard-reachable correction action to the selection', () => {
    const onReplace = vi.fn()
    render(<SourceTextReplaceAction left={120} top={80} onReplace={onReplace} />)

    const action = screen.getByRole('button', { name: 'Replace selected source text' })
    expect(action).toHaveStyle({ left: '120px', top: '80px' })
    expect(action).toHaveTextContent('Aa→')
    expect(action).toHaveTextContent('Replace selected text')
    expect(action).toHaveTextContent('visual correction')
    expect(fireEvent.pointerDown(action)).toBe(false)
    fireEvent.click(action)
    expect(onReplace).toHaveBeenCalledOnce()
  })
})

describe('Search occurrence selection geometry', () => {
  it('round-trips exact offsets across adjacent pdf.js text spans', () => {
    const layer = document.createElement('div')
    layer.className = 'text-layer'
    const first = document.createElement('span')
    first.setAttribute('role', 'presentation')
    first.dataset.sourceTextStart = '0'
    first.dataset.sourceTextEnd = '4'
    first.textContent = 'Leaf'
    const second = document.createElement('span')
    second.setAttribute('role', 'presentation')
    second.dataset.sourceTextStart = '4'
    second.dataset.sourceTextEnd = '12'
    second.textContent = 'PDF text'
    layer.append(first, second)

    const range = rangeForOccurrence(layer, { start: 3, end: 8 })
    expect(range?.toString()).toBe('fPDF ')
    expect(sourceOccurrenceForRange(range!, layer)).toEqual({ start: 3, end: 8 })
    expect(rangeForOccurrence(layer, { start: 40, end: 44 })).toBeNull()
  })
})

describe('Find and replace popover', () => {
  it('explains source-only replacement and exposes current, all, progress, and stop actions', () => {
    const onReplaceThis = vi.fn()
    const onReplaceAll = vi.fn()
    const onStop = vi.fn()

    function IdleHarness() {
      const [replacementText, setReplacementText] = useState('')
      return (
        <SearchReplacePopover
          query="page"
          replacementText={replacementText}
          onReplacementTextChange={setReplacementText}
          sourceMatches={3}
          totalMatches={4}
          currentIsSource
          busy={false}
          progress={null}
          onReplaceThis={onReplaceThis}
          onReplaceAll={onReplaceAll}
          onStop={onStop}
          onClose={vi.fn()}
        />
      )
    }

    const view = render(<IdleHarness />)
    expect(screen.getByRole('dialog', { name: 'Find and replace' })).toBeInTheDocument()
    expect(screen.getByText('page')).toBeInTheDocument()
    expect(screen.getByText(/1 OCR-only match cannot be replaced automatically/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement text' }), {
      target: { value: 'sheet' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Replace this match' }))
    expect(onReplaceThis).toHaveBeenCalledWith('sheet')
    fireEvent.click(screen.getByRole('button', { name: 'Replace all 3 source matches' }))
    expect(onReplaceAll).toHaveBeenCalledWith('sheet')

    view.rerender(
      <SearchReplacePopover
        query="page"
        replacementText="sheet"
        onReplacementTextChange={vi.fn()}
        sourceMatches={3}
        totalMatches={3}
        currentIsSource={false}
        busy
        progress={{ index: 2, total: 3 }}
        onReplaceThis={onReplaceThis}
        onReplaceAll={onReplaceAll}
        onStop={onStop}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2')
    expect(screen.getByText('Replacing 2 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop replacing' }))
    expect(onStop).toHaveBeenCalledOnce()

    view.rerender(
      <SearchReplacePopover
        query="OCR phrase"
        replacementText="text"
        onReplacementTextChange={vi.fn()}
        sourceMatches={0}
        totalMatches={1}
        currentIsSource={false}
        busy={false}
        progress={null}
        onReplaceThis={onReplaceThis}
        onReplaceAll={onReplaceAll}
        onStop={onStop}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Replace this match' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replace all 0 source matches' })).toBeDisabled()
  })
})

describe('Finishing help', () => {
  it('explains the finish route, output choice, shortcuts, privacy, and source', () => {
    const onClose = vi.fn()
    render(<HelpPanel open onClose={onClose} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Finish and save' })).toBeInTheDocument()
    expect(screen.getByText('Add what is missing')).toBeInTheDocument()
    expect(screen.getByText(/When Fields appears.*Start, Previous, or Next.*real editable controls/i)).toBeInTheDocument()
    expect(screen.getByText(/optional blank fields never block saving/i)).toBeInTheDocument()
    expect(screen.getByText(/Fields navigates controls already in the PDF; Forms creates new Text, Checkbox, Radio, or Dropdown controls/i)).toBeInTheDocument()
    expect(screen.getByText(/Open My details.*Full name, Email, Phone, Company, or Address.*without retyping/i)).toBeInTheDocument()
    expect(screen.getByText(/Draft details work without saving.*Save on this device is explicit and browser-only/i)).toBeInTheDocument()
    expect(screen.getByText(/only text you choose to Place enters a project or PDF/i)).toBeInTheDocument()
    expect(screen.getByText(/Date stays one-click.*calendar date.*four exact printed formats/i)).toBeInTheDocument()
    expect(screen.getByText(/type any wording in Date text/i)).toBeInTheDocument()
    expect(screen.getByText(/Replace this or Replace all/)).toBeInTheDocument()
    expect(screen.getByText(/complete Replace all batch is one Undo/)).toBeInTheDocument()
    expect(screen.getByText(/OCR-only matches stay searchable but cannot be replaced automatically/)).toBeInTheDocument()
    expect(screen.getByText(/drag Whiteout.*Add replacement text.*type directly on the page/i)).toBeInTheDocument()
    expect(screen.getByText(/Whiteout does not remove.*use Redact for permanent removal/i)).toBeInTheDocument()
    expect(screen.getByText(/Sign opens on Type with full-name or initials styles and saved local signatures first/i)).toBeInTheDocument()
    expect(screen.getByText(/visual marks, not certificate-backed signatures/i)).toBeInTheDocument()
    expect(screen.getByText(/For Sign or Image, preview it, then click where it belongs/i)).toBeInTheDocument()
    expect(screen.getByText('Choose Done')).toBeInTheDocument()
    expect(screen.getByText(/Selecting an item keeps the paper in place/i)).toBeInTheDocument()
    expect(screen.getByText(/Adjust reveals its controls/i)).toBeInTheDocument()
    expect(screen.getByText('Save PDF')).toBeInTheDocument()
    expect(screen.getByText(/portable editable project/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Save fillable PDF' })).toBeInTheDocument()
    expect(screen.getByText(/leaving real form controls editable/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Save flattened PDF' })).toBeInTheDocument()
    expect(screen.getByText(/not encrypted or tamper-proof/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View LeafPDF source on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/SyedAkramaIrshad/leafpdf',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close finishing help' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('PageCanvas render lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('previews a pending signature without history and reports only the placement click', () => {
    const dispatch = vi.fn()
    const onPlaceMedia = vi.fn()
    const pendingMedia: PendingMediaPlacement = {
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      role: 'signature',
      width: 0.32,
      aspectRatio: 1120 / 380,
    }
    const view = render(
      <PageCanvas
        pdf={{} as PDFDocumentProxy}
        page={{ id: 'page-1', kind: 'blank', width: 612, height: 792, rotation: 0 }}
        pageNumber={1}
        externalDocuments={new Map()}
        annotations={[]}
        activeTool="signature"
        selectedAnnotationIds={[]}
        zoom={1}
        formValues={{}}
        dispatch={dispatch}
        pendingMedia={pendingMedia}
        onPlaceMedia={onPlaceMedia}
      />,
    )
    const surface = view.container.querySelector<HTMLElement>('.page-surface')
    const layer = view.container.querySelector<HTMLElement>('.annotation-layer')
    if (!surface || !layer) throw new Error('The editable page surface is missing.')
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 800,
      width: 600, height: 800, toJSON: () => ({}),
    })

    fireEvent.pointerMove(layer, { clientX: 300, clientY: 400 })
    const preview = view.container.querySelector<HTMLElement>('[data-media-role="signature"]')
    expect(preview).toHaveTextContent('SIGNATURE')
    const previewWidth = Number.parseFloat(preview?.style.width ?? '') / 100
    const previewHeight = Number.parseFloat(preview?.style.height ?? '') / 100
    expect((previewWidth * 612) / (previewHeight * 792)).toBeCloseTo(1120 / 380)
    expect(dispatch).not.toHaveBeenCalled()

    fireEvent.pointerUp(layer, { clientX: 300, clientY: 400 })
    expect(onPlaceMedia).toHaveBeenCalledTimes(1)
    const [pageId, point, placementSurface] = onPlaceMedia.mock.calls[0]
    expect(pageId).toBe('page-1')
    expect(point).toEqual({ x: 0.5, y: 0.5 })
    expect(placementSurface.width / placementSurface.height).toBeCloseTo(612 / 792)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('places prepared personal text with exact model geometry and one completion', () => {
    const dispatch = vi.fn()
    const onPlacePreparedDetail = vi.fn()
    const preparedDetail: PreparedDetailPlacement = {
      id: 'email', label: 'Email', text: 'alex@example.com', width: 0.38, height: 0.07, fontSize: 14,
    }
    const view = render(
      <PageCanvas
        pdf={{} as PDFDocumentProxy}
        page={{ id: 'page-1', kind: 'blank', width: 612, height: 792, rotation: 0 }}
        pageNumber={1}
        externalDocuments={new Map()}
        annotations={[]}
        activeTool="text"
        selectedAnnotationIds={[]}
        zoom={1}
        formValues={{}}
        dispatch={dispatch}
        preparedDetail={preparedDetail}
        onPlacePreparedDetail={onPlacePreparedDetail}
      />,
    )
    const surface = view.container.querySelector<HTMLElement>('.page-surface')
    const layer = view.container.querySelector<HTMLElement>('.annotation-layer')
    if (!surface || !layer) throw new Error('The editable page surface is missing.')
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000,
      width: 1000, height: 1000, toJSON: () => ({}),
    })

    fireEvent.pointerUp(layer, { clientX: 200, clientY: 300 })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'addAnnotation',
      annotation: expect.objectContaining({
        id: expect.any(String), pageId: 'page-1', kind: 'text',
        x: 0.2, y: 0.3, width: 0.38, height: 0.07,
        text: 'alex@example.com', color: '#182026', fontSize: 14,
      }),
    })
    expect(onPlacePreparedDetail).toHaveBeenCalledOnce()
  })

  it('keeps ordinary text placement unchanged', () => {
    const dispatch = vi.fn()
    const onPlacePreparedDetail = vi.fn()
    const view = render(
      <PageCanvas
        pdf={{} as PDFDocumentProxy}
        page={{ id: 'page-1', kind: 'blank', width: 612, height: 792, rotation: 0 }}
        pageNumber={1}
        externalDocuments={new Map()}
        annotations={[]}
        activeTool="text"
        selectedAnnotationIds={[]}
        zoom={1}
        formValues={{}}
        dispatch={dispatch}
        onPlacePreparedDetail={onPlacePreparedDetail}
      />,
    )
    const surface = view.container.querySelector<HTMLElement>('.page-surface')
    const layer = view.container.querySelector<HTMLElement>('.annotation-layer')
    if (!surface || !layer) throw new Error('The editable page surface is missing.')
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000,
      width: 1000, height: 1000, toJSON: () => ({}),
    })

    fireEvent.pointerUp(layer, { clientX: 200, clientY: 300 })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'addAnnotation',
      annotation: expect.objectContaining({
        width: 0.32, height: 0.07, text: DEFAULT_ADDED_TEXT, color: '#182026', fontSize: 18,
      }),
    })
    expect(onPlacePreparedDetail).not.toHaveBeenCalled()
  })

  it('creates a selected empty web link from a dragged page area', () => {
    const dispatch = vi.fn()
    const view = render(
      <PageCanvas
        pdf={{} as PDFDocumentProxy}
        page={{ id: 'page-1', kind: 'blank', width: 612, height: 792, rotation: 0 }}
        pageNumber={1}
        externalDocuments={new Map()}
        annotations={[]}
        activeTool="link"
        selectedAnnotationIds={[]}
        zoom={1}
        formValues={{}}
        dispatch={dispatch}
      />,
    )
    const surface = view.container.querySelector<HTMLElement>('.page-surface')
    const layer = view.container.querySelector<HTMLElement>('.annotation-layer')
    if (!surface || !layer) throw new Error('The editable page surface is missing.')
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000,
      width: 1000, height: 1000, toJSON: () => ({}),
    })

    fireEvent.pointerDown(layer, { clientX: 100, clientY: 200 })
    fireEvent.pointerUp(layer, { clientX: 420, clientY: 280 })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'addAnnotation',
      annotation: expect.objectContaining({
        id: expect.any(String), pageId: 'page-1', kind: 'link',
        x: 0.1, y: 0.2, width: expect.closeTo(0.32, 8), height: expect.closeTo(0.08, 8),
        targetType: 'url', target: '',
      }),
    })
  })

  it('creates semantic underline and strikeout marks from dragged page areas', () => {
    const dispatch = vi.fn()
    const props = {
      pdf: {} as PDFDocumentProxy,
      page: { id: 'page-1', kind: 'blank' as const, width: 612, height: 792, rotation: 0 as const },
      pageNumber: 1,
      externalDocuments: new Map(),
      annotations: [],
      selectedAnnotationIds: [],
      zoom: 1,
      formValues: {},
      dispatch,
    }
    const view = render(<PageCanvas {...props} activeTool="underline" />)
    const surface = view.container.querySelector<HTMLElement>('.page-surface')
    const layer = view.container.querySelector<HTMLElement>('.annotation-layer')
    if (!surface || !layer) throw new Error('The editable page surface is missing.')
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000,
      width: 1000, height: 1000, toJSON: () => ({}),
    })

    fireEvent.pointerDown(layer, { clientX: 100, clientY: 200 })
    fireEvent.pointerUp(layer, { clientX: 500, clientY: 280 })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'addAnnotation',
      annotation: expect.objectContaining({
        kind: 'highlight', mark: 'underline', x: 0.1, y: 0.2,
        width: 0.4, height: 0.08, color: '#3157d5', opacity: 1, strokeWidth: 2,
      }),
    })

    dispatch.mockClear()
    view.rerender(<PageCanvas {...props} activeTool="strikeout" />)
    fireEvent.pointerDown(layer, { clientX: 200, clientY: 400 })
    fireEvent.pointerUp(layer, { clientX: 620, clientY: 480 })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'addAnnotation',
      annotation: expect.objectContaining({
        kind: 'highlight', mark: 'strikeout', x: 0.2, y: 0.4,
        width: 0.42, height: expect.closeTo(0.08, 8), color: '#b54434', opacity: 1, strokeWidth: 2,
      }),
    })
  })

  it('creates all real form-field annotation types from dragged page areas', () => {
    const dispatch = vi.fn()
    const textField: CreatedFormFieldAnnotation = {
      id: 'existing-field', pageId: 'page-1', kind: 'form-field', fieldType: 'text',
      fieldName: 'leafpdf.text.1', x: 0.05, y: 0.05, width: 0.2, height: 0.05,
      required: false, defaultText: '', multiline: false,
    }
    const props = {
      pdf: {} as PDFDocumentProxy,
      page: { id: 'page-1', kind: 'blank' as const, width: 612, height: 792, rotation: 0 as const },
      pageNumber: 1,
      externalDocuments: new Map(),
      annotations: [textField],
      allAnnotations: [textField],
      selectedAnnotationIds: [],
      zoom: 1,
      formValues: {},
      dispatch,
    }
    const view = render(<PageCanvas {...props} activeTool="form-text" />)
    const surface = view.container.querySelector<HTMLElement>('.page-surface')
    const layer = view.container.querySelector<HTMLElement>('.annotation-layer')
    if (!surface || !layer) throw new Error('The editable page surface is missing.')
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000,
      width: 1000, height: 1000, toJSON: () => ({}),
    })

    fireEvent.pointerDown(layer, { clientX: 100, clientY: 200 })
    fireEvent.pointerUp(layer, { clientX: 500, clientY: 280 })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'addAnnotation',
      annotation: expect.objectContaining({
        kind: 'form-field', fieldType: 'text', fieldName: 'leafpdf.text.2',
        x: 0.1, y: 0.2, width: 0.4, height: 0.08,
        required: false, defaultText: '', multiline: false,
      }),
    })

    dispatch.mockClear()
    view.rerender(<PageCanvas {...props} activeTool="form-checkbox" />)
    fireEvent.pointerDown(layer, { clientX: 600, clientY: 300 })
    fireEvent.pointerUp(layer, { clientX: 650, clientY: 370 })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'addAnnotation',
      annotation: expect.objectContaining({
        kind: 'form-field', fieldType: 'checkbox', fieldName: 'leafpdf.checkbox.1',
        x: 0.6, y: 0.3, width: 0.07, height: 0.07,
        required: false, checkedByDefault: false,
      }),
    })

    dispatch.mockClear()
    view.rerender(<PageCanvas {...props} activeTool="form-radio" />)
    fireEvent.pointerDown(layer, { clientX: 300, clientY: 400 })
    fireEvent.pointerUp(layer, { clientX: 340, clientY: 460 })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'addAnnotation',
      annotation: expect.objectContaining({
        kind: 'form-field', fieldType: 'radio', fieldName: 'leafpdf.radio.1',
        x: 0.3, y: 0.4, width: 0.06, height: 0.06,
        required: false, optionValue: 'Option 1', selectedByDefault: false,
      }),
    })

    dispatch.mockClear()
    view.rerender(<PageCanvas {...props} activeTool="form-dropdown" />)
    fireEvent.pointerDown(layer, { clientX: 200, clientY: 500 })
    fireEvent.pointerUp(layer, { clientX: 400, clientY: 540 })
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'addAnnotation',
      annotation: expect.objectContaining({
        kind: 'form-field', fieldType: 'dropdown', fieldName: 'leafpdf.dropdown.1',
        x: 0.2, y: 0.5, width: 0.2, height: 0.04,
        required: false, options: ['Option 1', 'Option 2'], defaultOption: '',
      }),
    })
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
        pageNumber={1}
        externalDocuments={new Map()}
        activeTool="select"
        selectedAnnotationIds={[]}
        zoom={1.5}
        formValues={{}}
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
