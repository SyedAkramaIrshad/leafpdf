import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorPage } from '../model/editor'
import type { FormFieldWidget } from '../pdf/formFields'
import { FormLayer } from './FormLayer'

const page: EditorPage = {
  id: 'page-1',
  kind: 'original',
  sourceIndex: 0,
  rotation: 0,
}

const widgets: FormFieldWidget[] = [
  {
    id: 'locked', fieldName: 'locked', kind: 'text', rect: [10, 20, 110, 44],
    multiLine: false, readOnly: true, options: [], onValue: '', initialValue: '',
  },
  {
    id: 'name', fieldName: 'owner.name', kind: 'text', rect: [10, 60, 210, 84],
    multiLine: false, readOnly: false, options: [], onValue: '', initialValue: '',
  },
  {
    id: 'consent', fieldName: 'owner.consent', kind: 'checkbox', rect: [10, 100, 34, 124],
    multiLine: false, readOnly: false, options: [], onValue: 'Yes', initialValue: false,
  },
]

const pdf = {
  getPage: vi.fn(async () => ({
    getViewport: () => ({
      width: 612,
      height: 792,
      convertToViewportPoint: (x: number, y: number) => [x, 792 - y],
    }),
  })),
} as unknown as PDFDocumentProxy

describe('FormLayer field focus', () => {
  it('focuses an exact editable widget and reports its page position', async () => {
    const onFocus = vi.fn()
    const onHandled = vi.fn()
    render(
      <FormLayer
        pdf={pdf}
        page={page}
        pageSize={{ width: 612, height: 792 }}
        activeTool="select"
        formValues={{}}
        dispatch={vi.fn()}
        loadFormWidgets={vi.fn(async () => widgets)}
        focusRequest={{ requestId: 'focus-1', pageId: 'page-1', widgetId: 'consent' }}
        onFormFieldFocus={onFocus}
        onFormFocusRequestHandled={onHandled}
      />,
    )

    const consent = await screen.findByLabelText('Form field owner.consent')
    await waitFor(() => expect(consent).toHaveFocus())
    expect(onHandled).toHaveBeenCalledWith('focus-1')
    expect(onFocus).toHaveBeenCalledWith({
      pageId: 'page-1',
      widgetId: 'consent',
      index: 2,
      total: 2,
    })

    fireEvent.focus(screen.getByLabelText('Form field owner.name'))
    expect(onFocus).toHaveBeenLastCalledWith({
      pageId: 'page-1',
      widgetId: 'name',
      index: 1,
      total: 2,
    })
    expect(screen.getByLabelText('Form field locked')).toBeDisabled()
  })
})
