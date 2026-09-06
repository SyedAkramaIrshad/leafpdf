import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib'

async function openFixture(page: Page) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
}

async function dragOnFirstPage(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const layer = page.locator('.annotation-layer').first()
  const box = await layer.boundingBox()
  if (!box) throw new Error('The first annotation layer is not measurable.')
  await page.mouse.move(box.x + from.x, box.y + from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 7 })
  await page.mouse.up()
}

async function openAdvancedEditingTools(page: Page) {
  const more = page.getByRole('button', { name: 'More editing tools' })
  if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
}

async function chooseFormTool(
  page: Page,
  name: 'Add text field' | 'Add checkbox field' | 'Add radio choice' | 'Add dropdown field',
) {
  await openAdvancedEditingTools(page)
  const forms = page.getByRole('button', { name: 'Forms' })
  await forms.scrollIntoViewIfNeeded()
  await forms.click()
  await page.getByRole('menuitem', { name }).click()
}

function annotationSubtypes(document: PDFDocument): string[] {
  const subtypes: string[] = []
  for (const page of document.getPages()) {
    const value = page.node.get(PDFName.of('Annots'))
    const annotations = value instanceof PDFRef ? document.context.lookup(value) : value
    if (!(annotations instanceof PDFArray)) continue
    for (let index = 0; index < annotations.size(); index += 1) {
      const entry = annotations.get(index)
      const annotation = entry instanceof PDFRef ? document.context.lookup(entry) : entry
      if (!(annotation instanceof PDFDict)) throw new Error(`Dangling page annotation reference: ${String(entry)}`)
      const subtype = annotation.get(PDFName.of('Subtype'))
      if (subtype instanceof PDFName) subtypes.push(subtype.asString())
    }
  }
  return subtypes
}

test('creates, exports, reopens, fills, and resaves native PDF form fields', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await openFixture(page)

  await openAdvancedEditingTools(page)
  const forms = page.getByRole('button', { name: 'Forms' })
  await forms.click()
  const textItem = page.getByRole('menuitem', { name: 'Add text field' })
  const checkboxItem = page.getByRole('menuitem', { name: 'Add checkbox field' })
  await expect(textItem).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(checkboxItem).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Drag where people should type')).toBeVisible()

  await dragOnFirstPage(page, { x: 125, y: 210 }, { x: 390, y: 252 })
  await expect(page.locator('.form-field-annotation')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 2, name: 'Text field' })).toBeVisible()
  await expect(page.getByLabel('Field name')).toHaveValue('leafpdf.text.1')
  await page.getByLabel('Default text').fill('Applicant')
  await page.getByLabel('Required field').check()
  await page.getByLabel('Multiline field').check()
  await expect(page.getByText('Unique field name ready.')).toBeVisible()
  await expect(page.locator('.form-field-proof-type')).toHaveText('TEXT FIELD')

  // This is the exact copy/undo complaint path: duplicate once, Undo must remove
  // that duplicate, Redo must restore it, and a final Undo returns to one field.
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.locator('.form-field-annotation')).toHaveCount(2)
  await expect(page.getByLabel('Field name')).toHaveValue('leafpdf.text.2')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.form-field-annotation')).toHaveCount(1)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(page.locator('.form-field-annotation')).toHaveCount(2)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.form-field-annotation')).toHaveCount(1)

  // The user's original failure used the explicit Copy and Paste controls.
  // Re-select the surviving field because Undo correctly cleared the deleted
  // duplicate's selection, then prove one Undo removes only the pasted copy.
  await page.locator('.form-field-annotation').click()
  await page.getByRole('button', { name: 'Copy' }).click()
  await page.getByRole('button', { name: 'Paste' }).click()
  await expect(page.locator('.form-field-annotation')).toHaveCount(2)
  await expect(page.getByLabel('Field name')).toHaveValue('leafpdf.text.2')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.form-field-annotation')).toHaveCount(1)

  await chooseFormTool(page, 'Add checkbox field')
  await expect(page.getByText('Drag where the checkbox should go')).toBeVisible()
  await dragOnFirstPage(page, { x: 125, y: 350 }, { x: 166, y: 391 })
  await expect(page.locator('.form-field-annotation')).toHaveCount(2)
  await expect(page.getByRole('heading', { level: 2, name: 'Checkbox field' })).toBeVisible()
  await expect(page.getByLabel('Field name')).toHaveValue('leafpdf.checkbox.1')
  await page.getByLabel('Checked by default').check()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('complementary', { name: 'Checkbox field' })).toHaveCount(0)

  await chooseFormTool(page, 'Add radio choice')
  await expect(page.getByText('Drag where this radio choice should go')).toBeVisible()
  await dragOnFirstPage(page, { x: 125, y: 440 }, { x: 166, y: 481 })
  await expect(page.locator('.form-field-annotation')).toHaveCount(3)
  await expect(page.getByRole('heading', { level: 2, name: 'Radio choice' })).toBeVisible()
  await page.getByLabel('Group name').fill('relocation')
  await page.getByLabel('Option value').fill('Yes')
  await page.getByLabel('Required group').check()
  await page.getByRole('button', { name: 'Add another choice' }).click()
  await expect(page.locator('.form-field-annotation')).toHaveCount(4)
  await expect(page.getByLabel('Group name')).toHaveValue('relocation')
  await expect(page.getByLabel('Option value')).toHaveValue('Option 2')
  await page.getByLabel('Option value').fill('No')
  await page.getByLabel('Selected by default').check()

  // Copying a radio choice adds another option to the same group, but one Undo
  // must remove only that pasted choice and leave the two-choice group intact.
  await page.getByRole('button', { name: 'Copy' }).click()
  await page.getByRole('button', { name: 'Paste' }).click()
  await expect(page.locator('.form-field-annotation')).toHaveCount(5)
  await expect(page.getByLabel('Group name')).toHaveValue('relocation')
  await expect(page.getByLabel('Option value')).toHaveValue('Option 3')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.form-field-annotation')).toHaveCount(4)
  await expect(page.getByText('Undid last change.')).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss notification' }).click()

  await chooseFormTool(page, 'Add dropdown field')
  await expect(page.getByText('Drag where the dropdown should go')).toBeVisible()
  await dragOnFirstPage(page, { x: 125, y: 535 }, { x: 390, y: 577 })
  await expect(page.locator('.form-field-annotation')).toHaveCount(5)
  await expect(page.getByRole('heading', { level: 2, name: 'Dropdown field' })).toBeVisible()
  await page.getByLabel('Field name').fill('office.location')
  await page.getByLabel('Choices, one per line').fill('Dubai\nAbu Dhabi\nBengaluru')
  await expect(page.getByText('3 unique choices ready.')).toBeVisible()
  await page.getByLabel('Default choice').selectOption('Dubai')
  await page.getByLabel('Required field').check()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('complementary', { name: 'Dropdown field' })).toHaveCount(0)

  mkdirSync('output/ui', { recursive: true })
  await page.screenshot({ path: 'output/ui/m31-form-builder-desktop.png', fullPage: true })
  const outputTrigger = page.getByRole('button', { name: 'Choose PDF output' })
  await outputTrigger.click()
  await expect(page.getByRole('menu', { name: 'PDF output' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Save fillable PDF' })).toBeFocused()
  await expect(page.getByText('Flattening removes form controls. It is not encryption.')).toBeVisible()
  await page.screenshot({ path: 'output/ui/m32-save-output-desktop.png', fullPage: true })
  await page.keyboard.press('Escape')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save PDF' }).click()
  const download = await downloadPromise
  mkdirSync('tmp/pdfs', { recursive: true })
  const exportedPath = 'tmp/pdfs/m32-authored-form.pdf'
  await download.saveAs(exportedPath)

  const exported = await PDFDocument.load(readFileSync(exportedPath))
  const exportedForm = exported.getForm()
  expect(exportedForm.getTextField('leafpdf.text.1').getText()).toBe('Applicant')
  expect(exportedForm.getTextField('leafpdf.text.1').isRequired()).toBe(true)
  expect(exportedForm.getTextField('leafpdf.text.1').isMultiline()).toBe(true)
  expect(exportedForm.getCheckBox('leafpdf.checkbox.1').isChecked()).toBe(true)
  expect(exportedForm.getRadioGroup('relocation').getOptions()).toEqual(['Yes', 'No'])
  expect(exportedForm.getRadioGroup('relocation').getSelected()).toBe('No')
  expect(exportedForm.getRadioGroup('relocation').isRequired()).toBe(true)
  expect(exportedForm.getRadioGroup('relocation').acroField.getWidgets()).toHaveLength(2)
  expect(exportedForm.getDropdown('office.location').getOptions()).toEqual(['Dubai', 'Abu Dhabi', 'Bengaluru'])
  expect(exportedForm.getDropdown('office.location').getSelected()).toEqual(['Dubai'])
  expect(exportedForm.getDropdown('office.location').isRequired()).toBe(true)

  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const reopenedText = page.getByLabel('Form field leafpdf.text.1')
  const reopenedCheckbox = page.getByLabel('Form field leafpdf.checkbox.1')
  const reopenedRadioYes = page.getByLabel('Form field relocation, option Yes')
  const reopenedRadioNo = page.getByLabel('Form field relocation, option No')
  const reopenedDropdown = page.getByLabel('Form field office.location')
  await expect(reopenedText).toHaveValue('Applicant')
  await expect(reopenedCheckbox).toBeChecked()
  await expect(reopenedRadioYes).not.toBeChecked()
  await expect(reopenedRadioNo).toBeChecked()
  await expect(reopenedDropdown).toHaveValue('Dubai')
  await reopenedText.fill('Browser verified')
  await reopenedCheckbox.uncheck()
  await reopenedRadioYes.check()
  await reopenedDropdown.selectOption('Abu Dhabi')

  const resavePromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save PDF' }).click()
  const resave = await resavePromise
  mkdirSync('output/pdf', { recursive: true })
  const resavedPath = 'output/pdf/m32-fillable-fields.pdf'
  await resave.saveAs(resavedPath)
  const resaved = await PDFDocument.load(readFileSync(resavedPath))
  expect(resaved.getForm().getTextField('leafpdf.text.1').getText()).toBe('Browser verified')
  expect(resaved.getForm().getCheckBox('leafpdf.checkbox.1').isChecked()).toBe(false)
  expect(resaved.getForm().getRadioGroup('relocation').getSelected()).toBe('Yes')
  expect(resaved.getForm().getDropdown('office.location').getSelected()).toEqual(['Abu Dhabi'])

  const flattenedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Choose PDF output' }).click()
  await page.getByRole('menuitem', { name: 'Save flattened PDF' }).click()
  const flattened = await flattenedDownload
  expect(flattened.suggestedFilename()).toBe('m32-authored-form-flattened.pdf')
  const flattenedPath = 'output/pdf/m32-flattened-fields.pdf'
  await flattened.saveAs(flattenedPath)
  const flattenedPdf = await PDFDocument.load(readFileSync(flattenedPath))
  const acroFormValue = flattenedPdf.catalog.get(PDFName.of('AcroForm'))
  const acroForm = acroFormValue instanceof PDFRef
    ? flattenedPdf.context.lookup(acroFormValue)
    : acroFormValue
  if (!(acroForm instanceof PDFDict)) throw new Error('Flattened output lost its appearance-supporting form dictionary.')
  const fieldsValue = acroForm.get(PDFName.of('Fields'))
  const fields = fieldsValue instanceof PDFRef ? flattenedPdf.context.lookup(fieldsValue) : fieldsValue
  expect(fields).toBeInstanceOf(PDFArray)
  expect((fields as PDFArray).size()).toBe(0)
  expect(annotationSubtypes(flattenedPdf)).not.toContain('/Widget')

  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(flattenedPath)
  const flattenedCanvas = page.getByLabel('Rendered PDF page').first()
  await expect(flattenedCanvas).toBeVisible()
  const nonWhiteSamples = await flattenedCanvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return 0
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let painted = 0
    const stride = Math.max(4, Math.floor(canvas.width / 80))
    for (let y = 0; y < canvas.height; y += stride) {
      for (let x = 0; x < canvas.width; x += stride) {
        const index = (y * canvas.width + x) * 4
        if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) painted += 1
      }
    }
    return painted
  })
  expect(nonWhiteSamples).toBeGreaterThan(100)
  await expect(page.getByLabel(/^Form field /)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Fields' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('keeps field authoring reachable and usable at 1024px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await openFixture(page)
  const outputTrigger = page.getByRole('button', { name: 'Choose PDF output' })
  await outputTrigger.click()
  await expect(page.getByRole('menu', { name: 'PDF output' })).toBeVisible()
  const triggerBounds = await outputTrigger.boundingBox()
  const menuBounds = await page.getByRole('menu', { name: 'PDF output' }).boundingBox()
  if (!triggerBounds || !menuBounds) throw new Error('The desktop-minimum PDF output control is not measurable.')
  expect(triggerBounds.height).toBeGreaterThanOrEqual(44)
  expect(menuBounds.x).toBeGreaterThanOrEqual(0)
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(1024)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  mkdirSync('output/ui', { recursive: true })
  await page.screenshot({ path: 'output/ui/m32-save-output-desktop-minimum.png', fullPage: true })
  await page.keyboard.press('Escape')

  await openAdvancedEditingTools(page)
  const forms = page.getByRole('button', { name: 'Forms' })
  await forms.scrollIntoViewIfNeeded()
  await forms.click()
  await expect(page.getByRole('menuitem')).toHaveCount(4)
  await page.getByRole('menuitem', { name: 'Add dropdown field' }).click()
  await dragOnFirstPage(page, { x: 50, y: 180 }, { x: 180, y: 222 })

  await expect(page.getByRole('heading', { level: 2, name: 'Dropdown field' })).toBeVisible()
  await expect(page.getByLabel('Choices, one per line')).toBeVisible()
  const done = page.getByRole('button', { name: 'Done' })
  const adjust = page.getByRole('button', { name: 'Hide item properties' })
  for (const control of [done, adjust]) {
    const bounds = await control.boundingBox()
    if (!bounds) throw new Error('A desktop-minimum inspector control is not measurable.')
    expect(bounds.height).toBeGreaterThanOrEqual(36)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  await page.screenshot({ path: 'output/ui/m31-form-builder-desktop-minimum.png', fullPage: true })
  await done.click()
  await expect(page.getByRole('complementary', { name: 'Dropdown field' })).toHaveCount(0)
})
