import { describe, expect, it } from 'vitest'
import type { Annotation, CreatedFormFieldAnnotation } from './editor'
import {
  createCreatedFormField,
  createdFormFieldCollectionIssue,
  createdFormFieldNameIssue,
  dropdownOptionsIssue,
  nextCreatedFormFieldName,
  nextRadioOptionValue,
  radioOptionValueIssue,
} from './createdFormFields'

function field(overrides: Partial<CreatedFormFieldAnnotation> = {}): CreatedFormFieldAnnotation {
  return {
    id: 'field-1',
    pageId: 'page-1',
    kind: 'form-field',
    fieldType: 'text',
    fieldName: 'leafpdf.text.1',
    x: 0.1,
    y: 0.2,
    width: 0.32,
    height: 0.06,
    required: false,
    defaultText: '',
    multiline: false,
    ...overrides,
  } as CreatedFormFieldAnnotation
}

describe('created form fields', () => {
  it('creates exact defaults for every supported field type with deterministic names', () => {
    const text = createCreatedFormField({
      id: 'text-1', pageId: 'page-1', fieldType: 'text',
      x: 0.1, y: 0.2, width: 0.4, height: 0.08, annotations: [],
    })
    const checkbox = createCreatedFormField({
      id: 'check-1', pageId: 'page-1', fieldType: 'checkbox',
      x: 0.2, y: 0.3, width: 0.05, height: 0.05, annotations: [text],
    })
    const radio = createCreatedFormField({
      id: 'radio-1', pageId: 'page-1', fieldType: 'radio',
      x: 0.3, y: 0.4, width: 0.05, height: 0.05, annotations: [text, checkbox],
    })
    const dropdown = createCreatedFormField({
      id: 'dropdown-1', pageId: 'page-1', fieldType: 'dropdown',
      x: 0.4, y: 0.5, width: 0.3, height: 0.06, annotations: [text, checkbox, radio],
    })

    expect(text).toEqual({
      id: 'text-1', pageId: 'page-1', kind: 'form-field', fieldType: 'text',
      fieldName: 'leafpdf.text.1', x: 0.1, y: 0.2, width: 0.4, height: 0.08,
      required: false, defaultText: '', multiline: false,
    })
    expect(checkbox).toEqual({
      id: 'check-1', pageId: 'page-1', kind: 'form-field', fieldType: 'checkbox',
      fieldName: 'leafpdf.checkbox.1', x: 0.2, y: 0.3, width: 0.05, height: 0.05,
      required: false, checkedByDefault: false,
    })
    expect(radio).toEqual({
      id: 'radio-1', pageId: 'page-1', kind: 'form-field', fieldType: 'radio',
      fieldName: 'leafpdf.radio.1', x: 0.3, y: 0.4, width: 0.05, height: 0.05,
      required: false, optionValue: 'Option 1', selectedByDefault: false,
    })
    expect(dropdown).toEqual({
      id: 'dropdown-1', pageId: 'page-1', kind: 'form-field', fieldType: 'dropdown',
      fieldName: 'leafpdf.dropdown.1', x: 0.4, y: 0.5, width: 0.3, height: 0.06,
      required: false, options: ['Option 1', 'Option 2'], defaultOption: '',
    })
  })

  it('skips created and reserved names without changing field-type counters', () => {
    const annotations: Annotation[] = [
      field(),
      field({ id: 'field-3', fieldName: 'leafpdf.text.3' }),
      field({ id: 'check-1', fieldType: 'checkbox', fieldName: 'leafpdf.checkbox.1', checkedByDefault: false }),
    ]
    expect(nextCreatedFormFieldName('text', annotations)).toBe('leafpdf.text.2')
    expect(nextCreatedFormFieldName('text', annotations, ['leafpdf.text.2'])).toBe('leafpdf.text.4')
    expect(nextCreatedFormFieldName('checkbox', annotations)).toBe('leafpdf.checkbox.2')
    expect(nextCreatedFormFieldName('radio', annotations)).toBe('leafpdf.radio.1')
    expect(nextCreatedFormFieldName('dropdown', annotations)).toBe('leafpdf.dropdown.1')
  })

  it('reports malformed, duplicate, and reserved names precisely', () => {
    const annotations: Annotation[] = [field(), field({ id: 'field-2', fieldName: 'candidate' })]
    expect(createdFormFieldNameIssue('', annotations, 'field-2')).toBe('Enter a field name.')
    expect(createdFormFieldNameIssue(' candidate ', annotations, 'field-2')).toBe('Remove spaces at the start or end.')
    expect(createdFormFieldNameIssue('owner..name', annotations, 'field-2')).toBe('Each name section between dots needs text.')
    expect(createdFormFieldNameIssue(`owner.${String.fromCharCode(1)}name`, annotations, 'field-2')).toBe('Remove control characters.')
    expect(createdFormFieldNameIssue('x'.repeat(101), annotations, 'field-2')).toBe('Use 100 characters or fewer.')
    expect(createdFormFieldNameIssue('leafpdf.text.1', annotations, 'field-2')).toBe('Another created field already uses this name.')
    expect(createdFormFieldNameIssue('source.field', annotations, 'field-2', ['source.field'])).toBe('The source PDF already uses this field name.')
    expect(createdFormFieldNameIssue('candidate', annotations, 'field-2')).toBeNull()
  })

  it('allows an exact shared name only for radio choices while preserving hierarchy safety', () => {
    const radioOne = field({
      id: 'radio-1', fieldType: 'radio', fieldName: 'relocation',
      optionValue: 'Yes', selectedByDefault: false,
    })
    const radioTwo = field({
      id: 'radio-2', fieldType: 'radio', fieldName: 'relocation',
      optionValue: 'No', selectedByDefault: false,
    })
    const annotations: Annotation[] = [radioOne, radioTwo]

    expect(createdFormFieldNameIssue('relocation', annotations, 'radio-2', [], 'radio')).toBeNull()
    expect(createdFormFieldNameIssue('relocation', annotations, 'radio-2', [], 'text'))
      .toBe('Another created field already uses this name.')
    expect(createdFormFieldNameIssue('relocation.answer', annotations, 'radio-2', [], 'radio'))
      .toBe('Another created field already uses this name.')
  })

  it('generates and validates unique radio option values inside one group', () => {
    const annotations: Annotation[] = [
      field({
        id: 'radio-1', fieldType: 'radio', fieldName: 'relocation',
        optionValue: 'Option 1', selectedByDefault: false,
      }),
      field({
        id: 'radio-3', fieldType: 'radio', fieldName: 'relocation',
        optionValue: 'Option 3', selectedByDefault: false,
      }),
    ]

    expect(nextRadioOptionValue('relocation', annotations)).toBe('Option 4')
    expect(nextRadioOptionValue('relocation', [
      field({
        id: 'radio-yes', fieldType: 'radio', fieldName: 'relocation',
        optionValue: 'Yes', selectedByDefault: false,
      }),
    ])).toBe('Option 2')
    expect(radioOptionValueIssue('', 'relocation', annotations, 'radio-1')).toBe('Enter an option value.')
    expect(radioOptionValueIssue(' Option 1 ', 'relocation', annotations, 'radio-1'))
      .toBe('Remove spaces at the start or end.')
    expect(radioOptionValueIssue('Option 3', 'relocation', annotations, 'radio-1'))
      .toBe('Another choice in this group uses this value.')
    expect(radioOptionValueIssue('Yes', 'relocation', annotations, 'radio-1')).toBeNull()
  })

  it('validates ordered dropdown choices and their optional default', () => {
    expect(dropdownOptionsIssue([], '')).toBe('Add at least one choice.')
    expect(dropdownOptionsIssue(['Dubai', ''], '')).toBe('Remove blank choices.')
    expect(dropdownOptionsIssue(['Dubai', 'Dubai'], '')).toBe('Every choice needs a unique value.')
    expect(dropdownOptionsIssue(['Dubai', 'Abu Dhabi'], 'Bengaluru'))
      .toBe('Choose a default from the listed choices.')
    expect(dropdownOptionsIssue(['Dubai', 'Abu Dhabi'], 'Dubai')).toBeNull()
  })

  it('validates radio groups and cross-type field-name collisions as a collection', () => {
    const yes = field({
      id: 'yes', fieldType: 'radio', fieldName: 'relocation', optionValue: 'Yes',
      selectedByDefault: true, required: true,
    }) as Extract<CreatedFormFieldAnnotation, { fieldType: 'radio' }>
    const no = field({
      id: 'no', fieldType: 'radio', fieldName: 'relocation', optionValue: 'No',
      selectedByDefault: false, required: true,
    }) as Extract<CreatedFormFieldAnnotation, { fieldType: 'radio' }>
    expect(createdFormFieldCollectionIssue([yes, no])).toBeNull()
    expect(createdFormFieldCollectionIssue([yes, { ...no, optionValue: 'Yes' }]))
      .toBe('Radio group "relocation" has more than one choice with value "Yes".')
    expect(createdFormFieldCollectionIssue([yes, { ...no, selectedByDefault: true }]))
      .toBe('Radio group "relocation" has more than one default choice.')
    expect(createdFormFieldCollectionIssue([yes, { ...no, required: false }]))
      .toBe('Radio group "relocation" has inconsistent Required settings.')
    expect(createdFormFieldCollectionIssue([yes, field({ id: 'text-2', fieldName: 'relocation' })]))
      .toBe('Created field name "relocation" is shared by incompatible field types.')
  })
})
