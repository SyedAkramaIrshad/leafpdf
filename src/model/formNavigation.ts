import type { EditorPage } from './editor'
import type { FormFieldWidget } from '../pdf/formFields'

export interface FormFieldTarget {
  pageId: string
  widgetId: string
  /** One-based position among editable controls on this page. */
  index: number
  /** Editable controls on this page; read-only controls are excluded. */
  total: number
}

export interface FormFieldFocusRequest {
  requestId: string
  pageId: string
  widgetId: string
}

export type FormFieldDirection = 'previous' | 'next'

export type FormWidgetLoader = (
  sourceIndex: number,
) => Promise<FormFieldWidget[]>

export function editableFormWidgets(
  widgets: readonly FormFieldWidget[],
): FormFieldWidget[] {
  return widgets.filter((widget) => !widget.readOnly)
}

export function targetForFormWidget(
  pageId: string,
  widgets: readonly FormFieldWidget[],
  widgetId: string,
): FormFieldTarget | null {
  const editable = editableFormWidgets(widgets)
  const index = editable.findIndex((widget) => widget.id === widgetId)
  return index === -1
    ? null
    : { pageId, widgetId, index: index + 1, total: editable.length }
}

function targetAt(
  pageId: string,
  widgets: readonly FormFieldWidget[],
  index: number,
): FormFieldTarget {
  return {
    pageId,
    widgetId: widgets[index].id,
    index: index + 1,
    total: widgets.length,
  }
}

export async function firstFormFieldTarget(
  pages: readonly EditorPage[],
  loadWidgets: FormWidgetLoader,
): Promise<FormFieldTarget | null> {
  for (const page of pages) {
    if (page.kind !== 'original') continue
    const editable = editableFormWidgets(await loadWidgets(page.sourceIndex))
    if (editable.length > 0) return targetAt(page.id, editable, 0)
  }
  return null
}

export async function adjacentFormFieldTarget(
  pages: readonly EditorPage[],
  current: Pick<FormFieldTarget, 'pageId' | 'widgetId'>,
  direction: FormFieldDirection,
  loadWidgets: FormWidgetLoader,
): Promise<FormFieldTarget | null> {
  const currentPageIndex = pages.findIndex((page) => page.id === current.pageId)
  if (currentPageIndex === -1) return null

  const currentPage = pages[currentPageIndex]
  if (currentPage.kind === 'original') {
    const editable = editableFormWidgets(await loadWidgets(currentPage.sourceIndex))
    const currentWidgetIndex = editable.findIndex((widget) => widget.id === current.widgetId)
    const adjacentIndex = direction === 'next'
      ? currentWidgetIndex + 1
      : currentWidgetIndex - 1
    if (currentWidgetIndex !== -1 && adjacentIndex >= 0 && adjacentIndex < editable.length) {
      return targetAt(currentPage.id, editable, adjacentIndex)
    }
  }

  const step = direction === 'next' ? 1 : -1
  for (
    let pageIndex = currentPageIndex + step;
    pageIndex >= 0 && pageIndex < pages.length;
    pageIndex += step
  ) {
    const page = pages[pageIndex]
    if (page.kind !== 'original') continue
    const editable = editableFormWidgets(await loadWidgets(page.sourceIndex))
    if (editable.length === 0) continue
    return targetAt(
      page.id,
      editable,
      direction === 'next' ? 0 : editable.length - 1,
    )
  }

  return null
}
