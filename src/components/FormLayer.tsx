import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { readPageFormFields, type FormFieldWidget } from '../pdf/formFields'
import type { EditorAction, EditorPage, FormValue, Tool } from '../model/editor'
import {
  targetForFormWidget,
  type FormFieldFocusRequest,
  type FormFieldTarget,
  type FormWidgetLoader,
} from '../model/formNavigation'

interface FormLayerProps {
  pdf: PDFDocumentProxy
  page: EditorPage
  /** CSS pixel size of the rendered page, used to give inputs a readable font. */
  pageSize: { width: number; height: number }
  activeTool: Tool
  formValues: Record<string, FormValue>
  dispatch: (action: EditorAction) => void
  loadFormWidgets?: FormWidgetLoader
  focusRequest?: FormFieldFocusRequest | null
  onFormFieldFocus?: (target: FormFieldTarget) => void
  onFormFocusRequestHandled?: (requestId: string) => void
}

interface PlacedWidget {
  widget: FormFieldWidget
  /** Position as fractions of the page box, valid for the current rotation. */
  box: { x: number; y: number; width: number; height: number }
}

/**
 * Renders the source PDF's own fillable form fields as live inputs aligned over
 * the rendered page. Values are written into the editor document, so filling
 * participates in undo/redo, the dirty flag, and local recovery, and the export
 * writes them into the real AcroForm fields — not as overlaid text.
 */
export function FormLayer({
  pdf,
  page,
  pageSize,
  activeTool,
  formValues,
  dispatch,
  loadFormWidgets,
  focusRequest = null,
  onFormFieldFocus,
  onFormFocusRequestHandled,
}: FormLayerProps) {
  const [placed, setPlaced] = useState<PlacedWidget[]>([])
  const fieldRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    let active = true
    const locate = async () => {
      try {
        // Only the opened document's own fields are fillable: values are keyed
        // by field name, and a merged PDF's names could collide with them. An
        // inserted page's fields are dropped at export and disclosed as such.
        if (page.kind !== 'original') {
          setPlaced([])
          return
        }
        const widgets = loadFormWidgets
          ? await loadFormWidgets(page.sourceIndex)
          : await readPageFormFields(pdf, page.sourceIndex + 1)
        if (!active || widgets.length === 0) {
          if (active) setPlaced([])
          return
        }
        const sourcePage = await pdf.getPage(page.sourceIndex + 1)
        const viewport = sourcePage.getViewport({ scale: 1, rotation: (sourcePage.rotate + page.rotation) % 360 })
        if (!active) return
        setPlaced(widgets.map((widget) => {
          // The widget rectangle is in PDF user space; convert both corners into
          // the rotated view space the canvas is rendered in.
          const [ax, ay] = viewport.convertToViewportPoint(widget.rect[0], widget.rect[1])
          const [bx, by] = viewport.convertToViewportPoint(widget.rect[2], widget.rect[3])
          return {
            widget,
            box: {
              x: Math.min(ax, bx) / viewport.width,
              y: Math.min(ay, by) / viewport.height,
              width: Math.abs(bx - ax) / viewport.width,
              height: Math.abs(by - ay) / viewport.height,
            },
          }
        }))
      } catch {
        // A page whose annotations cannot be read simply offers no form inputs;
        // everything else about the page keeps working.
        if (active) setPlaced([])
      }
    }
    void locate()
    return () => { active = false }
  }, [loadFormWidgets, pdf, page])

  useEffect(() => {
    if (!focusRequest || focusRequest.pageId !== page.id) return
    const target = fieldRefs.current.get(focusRequest.widgetId)
    if (!target) return
    target.focus()
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
    onFormFocusRequestHandled?.(focusRequest.requestId)
  }, [focusRequest, onFormFocusRequestHandled, page.id, placed])

  if (placed.length === 0) return null

  const valueFor = (widget: FormFieldWidget): FormValue =>
    formValues[widget.fieldName] ?? widget.initialValue

  const setValue = (widget: FormFieldWidget, value: FormValue, historyGroup?: string) =>
    dispatch({ type: 'setFormValue', fieldName: widget.fieldName, value, historyGroup })

  const endGroup = () => dispatch({ type: 'endHistoryGroup' })
  const rememberField = (widgetId: string) => (element: HTMLElement | null) => {
    if (element) fieldRefs.current.set(widgetId, element)
    else fieldRefs.current.delete(widgetId)
  }
  const reportFocus = (widget: FormFieldWidget) => {
    const target = targetForFormWidget(
      page.id,
      placed.map((entry) => entry.widget),
      widget.id,
    )
    if (target) onFormFieldFocus?.(target)
  }

  return (
    // The layer itself never intercepts the pointer: annotation tools keep
    // working around the fields, and while a drawing tool is active the inputs
    // stand aside entirely so a stroke can pass straight over them.
    <div className={`form-layer ${activeTool === 'select' ? '' : 'form-layer-passthrough'}`}>
      {placed.map(({ widget, box }) => {
        const style = {
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.width * 100}%`,
          height: `${box.height * 100}%`,
          fontSize: `${Math.max(10, Math.min(28, box.height * pageSize.height * 0.58))}px`,
        }
        const key = `${widget.fieldName}:${widget.id}`
        if (widget.kind === 'text') {
          const value = String(valueFor(widget))
          const group = `form-${widget.fieldName}`
          return widget.multiLine
            ? (
              <textarea
                key={key}
                ref={rememberField(widget.id)}
                className="form-field-input"
                style={style}
                data-form-widget-id={widget.id}
                value={value}
                aria-label={`Form field ${widget.fieldName}`}
                disabled={widget.readOnly}
                onFocus={() => reportFocus(widget)}
                onChange={(event) => setValue(widget, event.target.value, group)}
                onBlur={endGroup}
              />
            )
            : (
              <input
                key={key}
                ref={rememberField(widget.id)}
                type="text"
                className="form-field-input"
                style={style}
                data-form-widget-id={widget.id}
                value={value}
                aria-label={`Form field ${widget.fieldName}`}
                disabled={widget.readOnly}
                onFocus={() => reportFocus(widget)}
                onChange={(event) => setValue(widget, event.target.value, group)}
                onBlur={endGroup}
              />
            )
        }
        if (widget.kind === 'checkbox') {
          return (
            <input
              key={key}
              ref={rememberField(widget.id)}
              type="checkbox"
              className="form-field-checkbox"
              style={style}
              data-form-widget-id={widget.id}
              checked={valueFor(widget) === true}
              aria-label={`Form field ${widget.fieldName}`}
              disabled={widget.readOnly}
              onFocus={() => reportFocus(widget)}
              onChange={(event) => setValue(widget, event.target.checked)}
            />
          )
        }
        if (widget.kind === 'radio') {
          return (
            <input
              key={key}
              ref={rememberField(widget.id)}
              type="radio"
              className="form-field-checkbox"
              style={style}
              data-form-widget-id={widget.id}
              name={`form-radio-${widget.fieldName}`}
              checked={valueFor(widget) === widget.onValue}
              aria-label={`Form field ${widget.fieldName}, option ${widget.onValue}`}
              disabled={widget.readOnly}
              onFocus={() => reportFocus(widget)}
              onChange={() => setValue(widget, widget.onValue)}
            />
          )
        }
        return (
          <select
            key={key}
            ref={rememberField(widget.id)}
            className="form-field-input"
            style={style}
            data-form-widget-id={widget.id}
            value={String(valueFor(widget))}
            aria-label={`Form field ${widget.fieldName}`}
            disabled={widget.readOnly}
            onFocus={() => reportFocus(widget)}
            onChange={(event) => setValue(widget, event.target.value)}
          >
            {/* An empty entry keeps an unset dropdown representable. */}
            {widget.options.every((option) => option.exportValue !== String(valueFor(widget))) && (
              <option value={String(valueFor(widget))}>{String(valueFor(widget))}</option>
            )}
            {widget.options.map((option) => (
              <option key={option.exportValue} value={option.exportValue}>{option.displayValue}</option>
            ))}
          </select>
        )
      })}
    </div>
  )
}
