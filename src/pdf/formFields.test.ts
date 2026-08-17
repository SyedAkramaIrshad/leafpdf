import { describe, expect, it } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { readPageFormFields } from './formFields'

function proxyWith(annotations: unknown[]): PDFDocumentProxy {
  return {
    getPage: () => Promise.resolve({
      getAnnotations: () => Promise.resolve(annotations),
    }),
  } as unknown as PDFDocumentProxy
}

const base = {
  subtype: 'Widget',
  rect: [10, 20, 110, 44],
}

describe('readPageFormFields', () => {
  it('maps text fields, checkboxes, radio groups, and dropdowns', async () => {
    const widgets = await readPageFormFields(proxyWith([
      { ...base, id: 'w1', fieldType: 'Tx', fieldName: 'owner.name', fieldValue: 'Prefilled', multiLine: true },
      { ...base, id: 'w2', fieldType: 'Btn', checkBox: true, fieldName: 'agrees', exportValue: 'On', fieldValue: 'On' },
      { ...base, id: 'w3', fieldType: 'Btn', radioButton: true, fieldName: 'colour', buttonValue: 'Red', fieldValue: 'Blue' },
      {
        ...base, id: 'w4', fieldType: 'Ch', fieldName: 'country', fieldValue: ['NZ'],
        options: [{ exportValue: 'NZ', displayValue: 'New Zealand' }, { exportValue: 'IN', displayValue: 'India' }],
      },
    ]), 1)

    expect(widgets).toEqual([
      {
        id: 'w1', fieldName: 'owner.name', kind: 'text', rect: [10, 20, 110, 44],
        multiLine: true, readOnly: false, options: [], onValue: '', initialValue: 'Prefilled',
      },
      {
        id: 'w2', fieldName: 'agrees', kind: 'checkbox', rect: [10, 20, 110, 44],
        multiLine: false, readOnly: false, options: [], onValue: 'On', initialValue: true,
      },
      {
        id: 'w3', fieldName: 'colour', kind: 'radio', rect: [10, 20, 110, 44],
        multiLine: false, readOnly: false, options: [], onValue: 'Red', initialValue: 'Blue',
      },
      {
        id: 'w4', fieldName: 'country', kind: 'dropdown', rect: [10, 20, 110, 44],
        multiLine: false, readOnly: false, onValue: '', initialValue: 'NZ',
        options: [
          { exportValue: 'NZ', displayValue: 'New Zealand' },
          { exportValue: 'IN', displayValue: 'India' },
        ],
      },
    ])
  })

  it('reports an unchecked checkbox as false, not as its off-state string', async () => {
    const widgets = await readPageFormFields(proxyWith([
      { ...base, id: 'w1', fieldType: 'Btn', checkBox: true, fieldName: 'agrees', exportValue: 'On', fieldValue: 'Off' },
    ]), 1)
    expect(widgets[0].initialValue).toBe(false)
  })

  it('skips everything that cannot be filled rather than crashing on it', async () => {
    const widgets = await readPageFormFields(proxyWith([
      { ...base, id: 'w1', fieldType: 'Btn', pushButton: true, fieldName: 'submit' },
      { ...base, id: 'w2', fieldType: 'Sig', fieldName: 'signature' },
      { ...base, id: 'w3', fieldType: 'Tx', fieldName: 'hidden.field', hidden: true },
      { ...base, id: 'w4', fieldType: 'Tx' }, // no field name
      { ...base, id: 'w5', fieldType: 'Tx', fieldName: 'bad.rect', rect: [1, 2, 3] },
      { ...base, id: 'w6', fieldType: 'Tx', fieldName: 'bad.rect.type', rect: [1, 2, 3, 'x'] },
      { subtype: 'Link', id: 'w7' },
      null,
      { ...base, id: 'w8', fieldType: 'Tx', fieldName: 'keeps.working', fieldValue: 7 },
    ]), 1)
    // Only the last one survives, with its non-string value treated as unset.
    expect(widgets.map(({ fieldName }) => fieldName)).toEqual(['keeps.working'])
    expect(widgets[0].initialValue).toBe('')
  })

  it('marks read-only fields so the input renders disabled', async () => {
    const widgets = await readPageFormFields(proxyWith([
      { ...base, id: 'w1', fieldType: 'Tx', fieldName: 'locked', readOnly: true },
    ]), 1)
    expect(widgets[0].readOnly).toBe(true)
  })
})
