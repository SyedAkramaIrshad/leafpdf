import { describe, expect, it, vi } from 'vitest'
import type { EditorPage } from './editor'
import type { FormFieldWidget } from '../pdf/formFields'
import {
  adjacentFormFieldTarget,
  editableFormWidgets,
  firstFormFieldTarget,
  targetForFormWidget,
} from './formNavigation'

function widget(
  id: string,
  kind: FormFieldWidget['kind'] = 'text',
  readOnly = false,
): FormFieldWidget {
  return {
    id,
    fieldName: id,
    kind,
    rect: [10, 20, 110, 44],
    multiLine: false,
    readOnly,
    options: kind === 'dropdown'
      ? [{ exportValue: 'IN', displayValue: 'India' }]
      : [],
    onValue: kind === 'checkbox' ? 'Yes' : '',
    initialValue: kind === 'checkbox' ? false : '',
  }
}

const locked = widget('locked', 'text', true)
const name = widget('name')
const consent = widget('consent', 'checkbox')
const country = widget('country', 'dropdown')

const pages: EditorPage[] = [
  { id: 'external', kind: 'external', documentId: 'inserted', sourceIndex: 99, rotation: 0 },
  { id: 'blank', kind: 'blank', width: 612, height: 792, rotation: 0 },
  { id: 'page-2', kind: 'original', sourceIndex: 0, rotation: 0 },
  { id: 'page-4', kind: 'original', sourceIndex: 1, rotation: 0 },
]

function loader() {
  return vi.fn(async (sourceIndex: number) => {
    if (sourceIndex === 0) return [locked, name, consent]
    if (sourceIndex === 1) return [country]
    throw new Error(`Unexpected page ${sourceIndex}`)
  })
}

describe('form field navigation', () => {
  it('keeps editable widgets in page order and excludes read-only controls', () => {
    expect(editableFormWidgets([locked, name, consent])).toEqual([name, consent])
  })

  it('finds the first editable field without loading blank or inserted pages', async () => {
    const loadWidgets = loader()
    await expect(firstFormFieldTarget(pages, loadWidgets)).resolves.toEqual({
      pageId: 'page-2',
      widgetId: 'name',
      index: 1,
      total: 2,
    })
    expect(loadWidgets).toHaveBeenCalledTimes(1)
    expect(loadWidgets).toHaveBeenCalledWith(0)
  })

  it('moves forward within a page and then across current document order', async () => {
    const loadWidgets = loader()
    await expect(adjacentFormFieldTarget(
      pages,
      { pageId: 'page-2', widgetId: 'name' },
      'next',
      loadWidgets,
    )).resolves.toEqual({ pageId: 'page-2', widgetId: 'consent', index: 2, total: 2 })

    await expect(adjacentFormFieldTarget(
      pages,
      { pageId: 'page-2', widgetId: 'consent' },
      'next',
      loadWidgets,
    )).resolves.toEqual({ pageId: 'page-4', widgetId: 'country', index: 1, total: 1 })

    await expect(adjacentFormFieldTarget(
      pages,
      { pageId: 'page-4', widgetId: 'country' },
      'next',
      loadWidgets,
    )).resolves.toBeNull()
    expect(loadWidgets).not.toHaveBeenCalledWith(99)
  })

  it('moves backward to the last editable field on the previous original page', async () => {
    const loadWidgets = loader()
    await expect(adjacentFormFieldTarget(
      pages,
      { pageId: 'page-4', widgetId: 'country' },
      'previous',
      loadWidgets,
    )).resolves.toEqual({ pageId: 'page-2', widgetId: 'consent', index: 2, total: 2 })

    await expect(adjacentFormFieldTarget(
      pages,
      { pageId: 'page-2', widgetId: 'name' },
      'previous',
      loadWidgets,
    )).resolves.toBeNull()
  })

  it('reports one-based page position for a manually focused widget', () => {
    expect(targetForFormWidget('page-2', [locked, name, consent], 'consent')).toEqual({
      pageId: 'page-2',
      widgetId: 'consent',
      index: 2,
      total: 2,
    })
    expect(targetForFormWidget('page-2', [locked, name, consent], 'locked')).toBeNull()
    expect(targetForFormWidget('page-2', [locked, name, consent], 'missing')).toBeNull()
  })
})
