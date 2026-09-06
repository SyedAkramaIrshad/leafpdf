import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString } from 'pdf-lib'

async function openDocumentMarks(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Document tools' }).click()
  await page.getByRole('menuitem', { name: 'Watermark & page numbers' }).click()
}

async function openPageOrganizer(page: Page) {
  await page.getByRole('button', { name: /^Open page organizer, page/ }).click()
  const organizer = page.getByRole('dialog', { name: 'Document pages' })
  await expect(organizer).toBeVisible()
  return organizer
}

async function openAdvancedEditingTools(page: Page) {
  const more = page.getByRole('button', { name: 'More editing tools' })
  if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
}

async function openMinimumWidthFind(page: Page) {
  const trigger = page.getByRole('button', { name: 'Find in PDF' })
  if (await trigger.isVisible()) {
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  }
}

async function placePendingMedia(
  page: Page,
  kind: 'image' | 'signature',
  position = { x: 320, y: 460 },
  layer: Locator = page.locator('.annotation-layer').first(),
) {
  const label = kind === 'signature' ? 'Signature' : 'Image'
  await expect(page.getByText(`Click where the ${kind} should go`)).toBeVisible()
  await layer.hover({ position })
  await expect(page.getByRole('img', { name: `${label} placement preview` })).toBeVisible()
  await layer.click({ position })
}

async function firstPageFitsCanvas(page: Page) {
  const canvas = page.locator('.canvas-scroll')
  const paper = page.locator('[data-page-id="page-1"] .page-mat')
  const [canvasBounds, paperBounds] = await Promise.all([canvas.boundingBox(), paper.boundingBox()])
  if (!canvasBounds || !paperBounds) return false
  return paperBounds.x >= canvasBounds.x - 1
    && paperBounds.x + paperBounds.width <= canvasBounds.x + canvasBounds.width + 1
}

async function normalizedAnnotationBox(annotation: Locator, layer: Locator) {
  const [annotationBounds, layerBounds] = await Promise.all([
    annotation.boundingBox(),
    layer.boundingBox(),
  ])
  if (!annotationBounds || !layerBounds) throw new Error('The selected item or its page layer is not measurable.')
  return {
    x: (annotationBounds.x - layerBounds.x) / layerBounds.width,
    y: (annotationBounds.y - layerBounds.y) / layerBounds.height,
    width: annotationBounds.width / layerBounds.width,
    height: annotationBounds.height / layerBounds.height,
  }
}

async function countDarkCanvasPixels(
  canvas: Locator,
  region: { x: number; y: number; width: number; height: number },
) {
  return canvas.evaluate((element, sample) => {
    const target = element as HTMLCanvasElement
    const context = target.getContext('2d')
    if (!context || target.clientWidth === 0 || target.clientHeight === 0) return 0
    const scaleX = target.width / target.clientWidth
    const scaleY = target.height / target.clientHeight
    const x = Math.max(0, Math.floor(sample.x * scaleX))
    const y = Math.max(0, Math.floor(sample.y * scaleY))
    const width = Math.max(1, Math.min(target.width - x, Math.ceil(sample.width * scaleX)))
    const height = Math.max(1, Math.min(target.height - y, Math.ceil(sample.height * scaleY)))
    const pixels = context.getImageData(x, y, width, height).data
    let dark = 0
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset] < 210 && pixels[offset + 1] < 210 && pixels[offset + 2] < 210) dark += 1
    }
    return dark
  }, region)
}

test('keeps the document-finishing welcome usable at 1024px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Common PDF tasks' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View LeafPDF source on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/SyedAkramaIrshad/leafpdf',
  )
  const openButton = page.getByRole('button', { name: 'Choose a PDF' })
  await expect(openButton).toBeVisible()
  const openBounds = await openButton.boundingBox()
  if (!openBounds) throw new Error('The local open action is missing.')
  expect(openBounds.y + openBounds.height).toBeLessThanOrEqual(700)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
})

test('keeps the signature desk reachable at 1024px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Add signature' }).click()
  const dialog = page.getByRole('dialog')
  const name = page.getByLabel('Name for signature')
  await expect(dialog).toBeVisible()
  await expect(name).toBeFocused()
  await name.fill('Syed Akrama Irshad')
  await page.getByRole('button', { name: 'Initials' }).click()
  const classic = page.getByRole('radio', { name: 'Classic signature style' })
  await classic.click()
  await expect(classic).toHaveAttribute('aria-checked', 'true')

  const preview = page.getByLabel('Signature preview')
  const place = page.getByRole('button', { name: 'Place signature' })
  await expect(preview).toBeInViewport()
  await place.scrollIntoViewIfNeeded()
  await expect(place).toBeInViewport()
  const [dialogBounds, placeBounds, classicBounds] = await Promise.all([
    dialog.boundingBox(),
    place.boundingBox(),
    classic.boundingBox(),
  ])
  if (!dialogBounds || !placeBounds || !classicBounds) throw new Error('The minimum-width laptop signature desk is incomplete.')
  expect(dialogBounds.x).toBeGreaterThanOrEqual(7)
  expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(1017)
  expect(placeBounds.y + placeBounds.height).toBeLessThanOrEqual(700)
  expect(classicBounds.height).toBeGreaterThanOrEqual(44)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)

  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('gives keyboard users a short route into the PDF and item properties', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await expect(page.getByRole('heading', { level: 1, name: 'mvp-fixture.pdf' })).toBeVisible()
  const pages = page.getByRole('button', { name: 'Open page organizer, page 1 of 2' })
  await expect(pages).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'PDF document' })).toBeAttached()
  await expect(page.locator('.inspector')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Skip to item properties' })).toHaveCount(0)

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const skipToPdf = page.getByRole('link', { name: 'Skip to PDF' })
  await page.keyboard.press('Tab')
  await expect(skipToPdf).toBeFocused()
  await skipToPdf.press('Enter')
  await expect(page.locator('#pdf-document')).toBeFocused()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 140, y: 180 } })
  const skipToProperties = page.getByRole('link', { name: 'Skip to item properties' })
  await expect(skipToProperties).toBeVisible()
  await skipToProperties.focus()
  await skipToProperties.press('Enter')
  await expect(page.locator('#item-properties')).toBeFocused()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.inspector')).toHaveCount(0)
  await expect(skipToProperties).toHaveCount(0)

  await pages.focus()
  await pages.press('Enter')
  const organizer = page.getByRole('dialog', { name: 'Document pages' })
  await expect(organizer).toBeVisible()
  await expect(organizer.getByRole('button', { name: 'Select page 1' })).toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Escape')
  await expect(organizer).toHaveCount(0)
  await expect(pages).toBeFocused()

  const hiddenFileTabIndexes = await page.locator('.visually-hidden[type="file"]').evaluateAll(
    (inputs) => inputs.map((input) => (input as HTMLInputElement).tabIndex),
  )
  expect(hiddenFileTabIndexes.length).toBeGreaterThan(0)
  expect(hiddenFileTabIndexes.every((tabIndex) => tabIndex === -1)).toBe(true)
  await expect(page.getByRole('group', { name: 'Page 1 editor' })).toBeVisible()
  await expect(pages).toHaveAccessibleName('Open page organizer, page 1 of 2')
})

test('shows whether the current PDF copy is saved', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const identity = page.locator('.document-identity')
  await expect(identity).toContainText('Ready to save PDF')
  await expect(identity).not.toContainText('Project saved')
  await expect(page.getByRole('button', { name: 'Save PDF' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save project' })).toHaveCount(0)
  const more = page.getByRole('button', { name: 'Document tools' })
  await more.click()
  await expect(page.getByRole('menuitem', { name: 'Save project' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
  mkdirSync('output/ui', { recursive: true })
  await page.screenshot({ path: 'output/ui/m42-paper-chrome-desktop.png', fullPage: true })

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 160, y: 180 } })
  const inlineText = page.getByLabel('Edit text')
  await inlineText.fill('PDF receipt test')
  await inlineText.press('Enter')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save PDF' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('mvp-fixture-edited.pdf')
  await expect(identity).toContainText('PDF copy saved')
  await expect(page.getByText(/Saved fillable PDF as mvp-fixture-edited\.pdf/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save again' })).toBeVisible()

  await inlineText.fill('PDF receipt test updated')
  await expect(identity).toContainText('New changes to save')
  await expect(page.getByRole('button', { name: 'Save PDF' })).toBeVisible()
  await expect(page.getByText(/Saved PDF copy as mvp-fixture-edited\.pdf/)).toHaveCount(0)
})

test('guards unfinished text before saving', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 160, y: 180 } })
  const text = page.getByLabel('Edit text')
  await expect(text).toHaveValue('Type here')
  await text.press('Enter')

  await page.getByRole('button', { name: 'Save PDF' }).click()
  const dialog = page.getByRole('dialog', { name: 'Finish this text before saving?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Review text' })).toBeFocused()

  await dialog.getByRole('button', { name: 'Review text' }).click()
  await expect(dialog).toBeHidden()
  await expect(text).toBeFocused()
  await expect(text).toHaveValue('Type here')
  await text.fill('Approved by Syed')
  await text.press('Enter')

  const reviewedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save PDF' }).click()
  await reviewedDownload
  await expect(page.locator('.document-identity')).toContainText('PDF copy saved')
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 160, y: 240 } })
  await page.getByLabel('Edit text').last().press('Enter')
  await page.getByRole('button', { name: 'Save PDF' }).click()
  await expect(dialog).toBeVisible()

  const bypassDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Save anyway' }).click()
  await bypassDownload
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Save again' })).toBeVisible()
})

test('creates a safe clickable link area and blocks an unsafe destination', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await openAdvancedEditingTools(page)
  await page.getByRole('button', { name: 'Add link' }).click()
  await expect(page.locator('.tool-placement-hint')).toContainText('Drag over the area that should open a link')
  const layer = page.locator('.annotation-layer').first()
  const bounds = await layer.boundingBox()
  if (!bounds) throw new Error('The PDF page is not measurable.')
  await page.mouse.move(bounds.x + 150, bounds.y + 180)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 430, bounds.y + 250)
  await page.mouse.up()

  const inspector = page.getByRole('complementary', { name: 'Clickable link' })
  await expect(inspector).toBeVisible()
  await expect(inspector).not.toHaveClass(/is-collapsed/)
  await expect(page.locator('.link-proof')).toHaveText('LINK')
  const destination = inspector.getByRole('textbox', { name: 'Destination', exact: true })
  await destination.fill('javascript:alert(1)')
  await expect(page.getByText(/valid http or https web address/i)).toBeVisible()

  let downloads = 0
  page.on('download', () => { downloads += 1 })
  await page.getByRole('button', { name: 'Save PDF' }).click()
  await expect(page.getByText('Add a valid link destination before saving the PDF.')).toBeVisible()
  expect(downloads).toBe(0)

  await destination.fill('example.com/offer')
  await expect(page.getByText('Ready: https://example.com/offer')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save PDF' }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const exportedPath = 'output/pdf/mvp-with-clickable-link.pdf'
  await download.saveAs(exportedPath)

  const document = await PDFDocument.load(readFileSync(exportedPath))
  const annotsValue = document.getPage(0).node.get(PDFName.of('Annots'))
  const annots = annotsValue instanceof PDFRef ? document.context.lookup(annotsValue) : annotsValue
  expect(annots).toBeInstanceOf(PDFArray)
  const dictionaries = Array.from({ length: (annots as PDFArray).size() }, (_, index) => {
    const entry = (annots as PDFArray).get(index)
    return (entry instanceof PDFRef ? document.context.lookup(entry) : entry) as PDFDict
  })
  const link = dictionaries.find((annotation) =>
    (annotation.get(PDFName.of('Subtype')) as PDFName | undefined)?.asString() === '/Link')
  expect(link).toBeDefined()
  const action = link?.get(PDFName.of('A')) as PDFDict
  expect((action.get(PDFName.of('S')) as PDFName).asString()).toBe('/URI')
  expect((action.get(PDFName.of('URI')) as PDFString).decodeText()).toBe('https://example.com/offer')
})

test('edits inline, annotates, and exports a PDF', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeVisible()

  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByText('mvp-fixture.pdf')).toBeVisible()
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 160, y: 180 } })
  const text = page.locator('.text-annotation').first()
  const inlineText = page.getByLabel('Edit text')
  await expect(text).toBeVisible()
  await expect(inlineText).toBeFocused()
  await inlineText.fill('Reviewed locally')
  await page.getByRole('button', { name: 'Show item properties' }).click()
  const fontSize = page.getByRole('spinbutton', { name: 'Font size' })
  await fontSize.fill('10')
  await fontSize.press('Enter')
  await expect(fontSize).toHaveValue('10')
  await page.getByLabel('Font family').selectOption('serif')
  await page.getByRole('button', { name: 'Bold' }).click()
  await page.getByRole('button', { name: 'Italic' }).click()
  await expect(inlineText).toHaveCSS('font-family', /Noto Serif/)
  await expect(inlineText).toHaveCSS('font-weight', '700')
  await expect(inlineText).toHaveCSS('font-style', 'italic')

  const beforeMove = await text.boundingBox()
  const moveHandleBounds = await page.getByRole('button', { name: 'Move text' }).boundingBox()
  if (!beforeMove || !moveHandleBounds) throw new Error('Inline text cannot be moved.')
  await page.mouse.move(moveHandleBounds.x + moveHandleBounds.width / 2, moveHandleBounds.y + moveHandleBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(moveHandleBounds.x + 70, moveHandleBounds.y + 40)
  const duringMove = await text.boundingBox()
  if (!duringMove) throw new Error('Inline text disappeared while moving.')
  expect(duringMove.x).toBeGreaterThan(beforeMove.x)
  expect(duringMove.y).toBeGreaterThan(beforeMove.y)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(inlineText).not.toBeFocused()

  await page.locator('input[accept="image/png,image/jpeg"]').setInputFiles({
    name: 'stamp.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await placePendingMedia(page, 'image', { x: 300, y: 260 })
  const placedImage = page.getByRole('button', { name: 'Select image annotation' })
  await expect(placedImage).toBeVisible()
  const beforeResize = await placedImage.boundingBox()
  const resizeHandle = page.getByRole('button', { name: 'Resize item', exact: true })
  const handleBounds = await resizeHandle.boundingBox()
  if (!beforeResize || !handleBounds) throw new Error('The placed image cannot be resized.')
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBounds.x + 65, handleBounds.y + 45)
  await page.mouse.up()
  const afterResize = await placedImage.boundingBox()
  if (!afterResize) throw new Error('The placed image disappeared after resizing.')
  expect(afterResize.width).toBeGreaterThan(beforeResize.width)
  expect(afterResize.height).toBeGreaterThan(beforeResize.height)

  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('tab', { name: 'Draw' }).click()
  const signatureCanvas = page.locator('.signature-dialog canvas')
  const signatureBounds = await signatureCanvas.boundingBox()
  if (!signatureBounds) throw new Error('Signature canvas is not visible.')
  await page.mouse.move(signatureBounds.x + 90, signatureBounds.y + 105)
  await page.mouse.down()
  await page.mouse.move(signatureBounds.x + 150, signatureBounds.y + 55, { steps: 8 })
  await page.mouse.move(signatureBounds.x + 220, signatureBounds.y + 112, { steps: 8 })
  await page.mouse.move(signatureBounds.x + 320, signatureBounds.y + 70, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Place signature' }).click()
  await placePendingMedia(page, 'signature', { x: 370, y: 500 })
  await expect(page.getByRole('button', { name: 'Resize item', exact: true })).toBeVisible()

  await openAdvancedEditingTools(page)
  await page.getByRole('button', { name: 'Text marks' }).click()
  await page.getByRole('menuitem', { name: 'Highlight' }).click()
  const layer = page.locator('.annotation-layer').first()
  const layerBounds = await layer.boundingBox()
  if (!layerBounds) throw new Error('The annotation layer is not visible.')
  await page.mouse.move(layerBounds.x + 90, layerBounds.y + 330)
  await page.mouse.down()
  await page.mouse.move(layerBounds.x + 280, layerBounds.y + 360)
  await page.mouse.up()
  await expect(page.locator('.highlight-annotation')).toBeVisible()

  await openAdvancedEditingTools(page)
  await page.getByRole('button', { name: 'Draw' }).click()
  await page.mouse.move(layerBounds.x + 120, layerBounds.y + 420)
  await page.mouse.down()
  await page.mouse.move(layerBounds.x + 230, layerBounds.y + 460, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('.ink-annotation')).toBeVisible()

  const organizer = await openPageOrganizer(page)
  await organizer.getByRole('button', { name: 'Rotate page 2' }).click()
  await organizer.getByRole('button', { name: 'Close page organizer' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('mvp-fixture-edited.pdf')
  mkdirSync('output/pdf', { recursive: true })
  await download.saveAs('output/pdf/mvp-fixture-edited.pdf')
})

test('requires confirmation before rebuilding a PDF that has form fields', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/edge-form.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  // Reordering cannot be expressed without rebuilding, which would drop the form.
  const organizer = await openPageOrganizer(page)
  await organizer.getByRole('button', { name: 'Move page 2 up' }).click()
  await organizer.getByRole('button', { name: 'Close page organizer' }).click()

  await page.getByRole('button', { name: /Save PDF/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Interactive form fields')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()

  // Cancelling must not produce a file.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  // Accepting exports the disclosed compatibility copy.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Export compatibility copy' }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  await download.saveAs('output/pdf/edge-form-compatibility-copy.pdf')
})

test('scrolls continuously through pages and tracks the current page', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const pages = page.getByRole('button', { name: /^Open page organizer, page/ })
  await expect(pages).toHaveAccessibleName('Open page organizer, page 1 of 2')

  // Both pages belong to one scrollable strip.
  await expect(page.locator('.strip-page')).toHaveCount(2)

  // Scrolling to the bottom makes page 2 current without any click.
  await page.locator('.canvas-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(pages).toHaveAccessibleName('Open page organizer, page 2 of 2')

  // Selecting page 1 in the organizer scrolls the strip back to it and closes the sheet.
  const organizer = await openPageOrganizer(page)
  await organizer.getByRole('button', { name: 'Select page 1', exact: true }).click()
  await expect(organizer).toHaveCount(0)
  await expect(pages).toHaveAccessibleName('Open page organizer, page 1 of 2')
  expect(await page.locator('.canvas-scroll').evaluate((element) => element.scrollTop)).toBeLessThan(200)
})

test('selects source text and finds text across pages', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  // The text layer exposes the page's real, glyph-aligned text.
  const heading = page.locator('.text-layer span', { hasText: 'LeafPDF verification document' }).first()
  await expect(heading).toBeVisible()
  await heading.dblclick()
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected.trim().length).toBeGreaterThan(0)

  // This phrase only exists on page 2; find must jump there.
  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('Move this page')
  await search.press('Enter')
  await expect(page.getByText(/1 match · page 2/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Open page organizer, page/ })).toHaveAccessibleName(
    'Open page organizer, page 2 of 2',
  )

  // A query on no page reports honestly.
  await search.fill('unfindable-needle')
  await search.press('Enter')
  await expect(page.getByText('No matches')).toBeVisible()
})

test('shows and steps through every source-text match', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('PDF')
  await search.press('Enter')

  const pageOneMatches = page.locator('[data-page-id="page-1"] .search-match')
  const activeMatch = page.locator('[data-page-id="page-1"] .search-match.is-active')
  await expect(page.getByText('2 matches · page 1 · 1 of 2')).toBeVisible()
  await expect(pageOneMatches).toHaveCount(2)
  await expect(activeMatch).toHaveCount(1)
  const first = await activeMatch.boundingBox()

  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(page.getByText('2 matches · page 1 · 2 of 2')).toBeVisible()
  const second = await activeMatch.boundingBox()
  expect(first).not.toBeNull()
  expect(second).not.toBeNull()
  expect(second?.y).not.toBe(first?.y)

  await page.getByRole('button', { name: 'Previous match' }).click()
  await expect(page.getByText('2 matches · page 1 · 1 of 2')).toBeVisible()

  await page.setViewportSize({ width: 1024, height: 700 })
  await expect(pageOneMatches).toHaveCount(2)
  await expect(page.getByText('2 matches · page 1 · 1 of 2')).toBeVisible()
  const searchWidths = await page.locator('.search-control').evaluate((control) => ({
    client: control.clientWidth,
    scroll: control.scrollWidth,
  }))
  expect(searchWidths.scroll).toBeLessThanOrEqual(searchWidths.client)
  const documentWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(documentWidths.scroll).toBeLessThanOrEqual(documentWidths.client)

  await search.fill('unfindable-needle')
  await search.press('Enter')
  await expect(page.getByText('No matches')).toBeVisible()
  await expect(page.locator('.search-match')).toHaveCount(0)
})

test('replaces the active Find match from the 1024px workbench', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await openMinimumWidthFind(page)
  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('PDF')
  await search.press('Enter')
  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(page.getByRole('status', { name: /2 matches · page 1 · 2 of 2/ })).toBeVisible()

  await page.getByRole('button', { name: 'Replace', exact: true }).click()
  const popover = page.getByRole('dialog', { name: 'Find and replace' })
  await expect(popover).toBeVisible()
  const bounds = await popover.boundingBox()
  if (!bounds) throw new Error('The Find & Replace popover is not measurable.')
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1024)
  await expect(popover.getByRole('textbox', { name: 'Replacement text' })).toBeVisible()
  await expect(popover.getByRole('button', { name: 'Replace this match' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  const searchWidths = await page.locator('.search-control').evaluate((control) => ({
    client: control.clientWidth,
    scroll: control.scrollWidth,
  }))
  expect(searchWidths.scroll).toBeLessThanOrEqual(searchWidths.client)

  await popover.getByRole('textbox', { name: 'Replacement text' }).fill('DOC')
  await popover.getByRole('button', { name: 'Replace this match' }).click()
  await expect(page.getByText(/Replaced 1 source match visually/)).toBeVisible()
  await expect(page.locator('.whiteout-annotation')).toHaveCount(1)
  await expect(page.locator('[data-source-replacement="true"] textarea')).toHaveValue('DOC')

  await page.keyboard.press('Control+z')
  await expect(page.locator('.whiteout-annotation')).toHaveCount(0)
  await expect(page.locator('[data-source-replacement="true"]')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.whiteout-annotation')).toHaveCount(1)
  await expect(page.locator('[data-source-replacement="true"] textarea')).toHaveValue('DOC')
})

test('replaces all source matches across pages as one honest correction', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('page')
  await search.press('Enter')
  await expect(page.getByRole('status', { name: /3 matches · page 1 · 1 of 3/ })).toBeVisible()
  await page.getByRole('button', { name: 'Replace', exact: true }).click()
  const popover = page.getByRole('dialog', { name: 'Find and replace' })
  await popover.getByRole('textbox', { name: 'Replacement text' }).fill('sheet')
  await popover.getByRole('button', { name: 'Replace all 3 source matches' }).click()

  await expect(page.getByText(/Replaced 3 source matches visually/)).toBeVisible()
  await expect(page.locator('.whiteout-annotation')).toHaveCount(3)
  const replacementEditors = page.locator('[data-source-replacement="true"] textarea')
  await expect(replacementEditors).toHaveCount(3)
  expect(await replacementEditors.evaluateAll((editors) =>
    editors.map((editor) => (editor as HTMLTextAreaElement).value),
  )).toEqual(['sheet', 'sheet', 'sheet'])
  const headingFit = await page.evaluate(() => {
    const pageTwo = document.querySelector<HTMLElement>('div[data-page-id="page-2"]')
    const source = Array.from(pageTwo?.querySelectorAll<HTMLElement>('.text-layer span') ?? [])
      .find((span) => span.textContent?.includes('Page operations'))
    const replacement = pageTwo?.querySelector<HTMLElement>('[data-source-replacement="true"]')
    const editor = replacement?.querySelector<HTMLTextAreaElement>('textarea')
    const node = source?.firstChild
    const operationsStart = node?.textContent?.indexOf('operations') ?? -1
    if (!source || !replacement || !editor || !node || operationsStart < 0) {
      throw new Error('Expected the page-two heading replacement geometry.')
    }
    const range = document.createRange()
    range.setStart(node, operationsStart)
    range.setEnd(node, node.textContent?.length ?? operationsStart)
    const operationsLeft = range.getBoundingClientRect().left
    const computed = window.getComputedStyle(editor)
    const context = document.createElement('canvas').getContext('2d')
    if (!context) throw new Error('Canvas text measurement is unavailable.')
    context.font = computed.font
    const replacementTextRight = replacement.getBoundingClientRect().left
      + context.measureText(editor.value).width
    return { operationsLeft, replacementTextRight }
  })
  expect(headingFit.replacementTextRight).toBeLessThanOrEqual(headingFit.operationsLeft)

  await page.keyboard.press('Control+z')
  await expect(page.locator('.whiteout-annotation')).toHaveCount(0)
  await expect(page.locator('[data-source-replacement="true"]')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.whiteout-annotation')).toHaveCount(3)
  await expect(page.locator('[data-source-replacement="true"] textarea')).toHaveCount(3)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save PDF' }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const exportedPath = 'output/pdf/mvp-find-replace-all.pdf'
  await download.saveAs(exportedPath)

  await page.getByRole('button', { name: 'Close document and return home' }).click()
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const reopenedSearch = page.getByRole('searchbox', { name: 'Find text in document' })
  await reopenedSearch.fill('sheet')
  await reopenedSearch.press('Enter')
  await expect(page.getByRole('status', { name: /3 matches/ })).toBeVisible()
  await reopenedSearch.fill('page')
  await reopenedSearch.press('Enter')
  await expect(page.getByRole('status', { name: /3 matches/ })).toBeVisible()
})

test('replaces selected source text as one honest correction', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await expect(page.locator('.text-layer')).toHaveCount(2)

  // A selection whose endpoints belong to different pages must never produce a
  // stale or ambiguous correction target.
  await page.locator('.text-layer span').evaluateAll((spans) => {
    const start = spans.find((span) => span.textContent?.includes('LeafPDF verification document'))
    const end = spans.find((span) => span.textContent?.includes('Page operations'))
    const startNode = start?.firstChild
    const endNode = end?.firstChild
    if (!startNode || !endNode) throw new Error('Expected source text on both pages.')
    const range = document.createRange()
    range.setStart(startNode, 0)
    range.setEnd(endNode, Math.min(4, endNode.textContent?.length ?? 0))
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await expect(page.getByRole('button', { name: 'Replace selected source text' })).toHaveCount(0)

  const heading = page.locator('.text-layer span', { hasText: 'LeafPDF verification document' }).first()
  const sourceMetrics = await heading.evaluate((element) => {
    const computed = window.getComputedStyle(element)
    const rectangle = element.getBoundingClientRect()
    return {
      fontFamily: computed.fontFamily,
      fontSize: Number.parseFloat(computed.fontSize),
      fontHeight: Number.parseFloat(computed.getPropertyValue('--font-height')),
      totalScale: Number.parseFloat(computed.getPropertyValue('--total-scale-factor')) || 0,
      width: rectangle.width,
    }
  })
  expect(sourceMetrics.totalScale).toBeGreaterThan(0)
  expect(sourceMetrics.fontSize / sourceMetrics.totalScale).toBeCloseTo(sourceMetrics.fontHeight, 1)
  expect(sourceMetrics.fontFamily).toContain('sans-serif')
  expect(sourceMetrics.width).toBeLessThan(520)
  await expect(heading).toHaveAttribute('data-source-font-weight', '700')
  await heading.evaluate((element) => {
    const node = element.firstChild
    const start = node?.textContent?.indexOf('LeafPDF') ?? -1
    if (!node || start < 0) throw new Error('Expected the LeafPDF heading text.')
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + 'LeafPDF'.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })

  const action = page.getByRole('button', { name: 'Replace selected source text' })
  await expect(action).toBeVisible()
  const actionBounds = await action.boundingBox()
  if (!actionBounds) throw new Error('The source replacement action is not measurable.')
  expect(actionBounds.x).toBeGreaterThanOrEqual(0)
  expect(actionBounds.x + actionBounds.width).toBeLessThanOrEqual(1024)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)

  // Clearing the selection clears the action; selecting again recomputes the
  // target instead of retaining stale geometry.
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
  })
  await expect(action).toHaveCount(0)
  await heading.evaluate((element) => {
    const node = element.firstChild
    if (!node) throw new Error('Expected heading text.')
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, 'LeafPDF'.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })

  await page.getByRole('button', { name: 'Replace selected source text' }).click()
  await expect(page.locator('.whiteout-annotation')).toHaveCount(1)
  const sourceReplacement = page.locator('[data-source-replacement="true"]')
  await expect(sourceReplacement).toHaveCount(1)
  expect(await sourceReplacement.locator('textarea').evaluate((element) =>
    window.getComputedStyle(element).fontFamily,
  )).toContain('Noto Sans')
  await expect(page.getByText(/Visual replacement added.*source text remains underneath/i)).toBeVisible()
  const replacement = page.getByRole('textbox', { name: 'Edit text' })
  await expect(replacement).toBeFocused()
  const initialSelection = await replacement.evaluate((element) => {
    const input = element as HTMLTextAreaElement
    return { start: input.selectionStart, end: input.selectionEnd, length: input.value.length }
  })
  expect(initialSelection).toEqual({ start: 0, end: 7, length: 7 })
  await page.keyboard.type('LeafDOC')
  await replacement.press('Enter')

  // Creation plus the first typing run is one LeafPDF history entry. Exercise
  // the keyboard path as a separate route from the visible touch history dock.
  await page.keyboard.press('Control+z')
  await expect(page.locator('.whiteout-annotation')).toHaveCount(0)
  await expect(page.locator('[data-source-replacement="true"]')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.whiteout-annotation')).toHaveCount(1)
  await expect(page.locator('[data-source-replacement="true"]')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveValue('LeafDOC')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save PDF' }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const exportedPath = 'output/pdf/mvp-with-source-replacement.pdf'
  await download.saveAs(exportedPath)

  await page.getByRole('button', { name: 'Close document and return home' }).click()
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await openMinimumWidthFind(page)
  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('LeafPDF')
  await search.press('Enter')
  await expect(page.getByRole('status', { name: /1 match · page 1/ })).toBeVisible()
  await search.fill('LeafDOC')
  await search.press('Enter')
  await expect(page.getByRole('status', { name: /1 match · page 1/ })).toBeVisible()
})

test('fills a real form field whose value survives into the exported PDF', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/edge-form.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const guide = page.getByRole('region', { name: 'Fillable field guide' })
  const fieldsTrigger = page.getByRole('button', { name: 'Fields' })
  await expect(guide).toBeVisible()
  await expect(fieldsTrigger).toHaveAttribute('aria-expanded', 'true')

  // The input is the PDF's own AcroForm field, not an overlay text box.
  const field = page.getByLabel('Form field owner.name')
  await expect(field).toBeVisible()
  await guide.getByRole('button', { name: 'Start at first field' }).click()
  await expect(field).toBeFocused()
  await expect(guide.getByText('Page 1 · Field 1 of 1')).toBeVisible()
  await field.fill('Syed Akrama')
  await guide.getByRole('button', { name: 'Next field' }).click()
  await expect(page.getByText('This is the last fillable field.')).toBeVisible()

  // No page operation happened, so this is the preserving path: no dialog.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const exportedPath = 'output/pdf/edge-form-filled.pdf'
  await download.saveAs(exportedPath)

  // Reopen the exported file: the field must come back already holding the value,
  // which proves it was written into the AcroForm, not painted over it.
  await page.getByRole('button', { name: /Close document/ }).click()
  await expect(page.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await expect(page.getByLabel('Form field owner.name')).toHaveValue('Syed Akrama')
})

test('keeps the real form field guide usable at 1024px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/edge-form.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const guide = page.getByRole('region', { name: 'Fillable field guide' })
  const trigger = page.getByRole('button', { name: 'Fields' })
  const start = guide.getByRole('button', { name: 'Start at first field' })
  await expect(guide).toBeVisible()
  const [guideBounds, startBounds] = await Promise.all([
    guide.boundingBox(),
    start.boundingBox(),
  ])
  if (!guideBounds || !startBounds) throw new Error('The minimum-width laptop form guide is incomplete.')
  expect(guideBounds.x).toBeGreaterThanOrEqual(7)
  expect(guideBounds.x + guideBounds.width).toBeLessThanOrEqual(1017)
  expect(startBounds.height).toBeGreaterThanOrEqual(44)

  await guide.getByRole('button', { name: 'Close fillable field guide' }).click()
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveCSS('position', 'static')
  const triggerBounds = await trigger.boundingBox()
  if (!triggerBounds) throw new Error('The minimum-width laptop Fields trigger is missing after closing the guide.')
  expect(triggerBounds.height).toBeGreaterThanOrEqual(34)
  expect(triggerBounds.x + triggerBounds.width).toBeLessThanOrEqual(1017)
  await trigger.click()
  await expect(guide).toBeVisible()

  await start.click()
  const field = page.getByLabel('Form field owner.name')
  await expect(field).toBeFocused()
  await expect(field).toBeInViewport()
  const next = guide.getByRole('button', { name: 'Next field' })
  const nextBounds = await next.boundingBox()
  if (!nextBounds) throw new Error('The minimum-width laptop Next field action is missing.')
  expect(nextBounds.height).toBeGreaterThanOrEqual(44)
  expect(await guide.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
})

test('finishes an offer-style PDF with text, date, checkmark, image, and signature', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const layer = page.locator('.annotation-layer').first()

  await page.getByRole('button', { name: 'Add text' }).click()
  await expect(page.getByText('Click where you want to add text')).toBeVisible()
  await layer.click({ position: { x: 130, y: 150 } })
  const name = page.getByLabel('Edit text')
  await name.fill('Alex Morgan')
  await name.press('Enter')

  await page.getByRole('button', { name: 'Add checkmark' }).click()
  await expect(page.getByText('Click where the checkmark should go')).toBeVisible()
  await layer.click({ position: { x: 310, y: 260 } })

  await page.getByRole('button', { name: 'Add date' }).click()
  await expect(page.getByText('Click where the date should go')).toBeVisible()
  await layer.click({ position: { x: 300, y: 330 } })
  await expect(page.getByRole('heading', { level: 2, name: 'Date' })).toBeVisible()
  await page.getByRole('button', { name: 'Show item properties' }).click()
  await expect(page.getByLabel('Calendar date')).toHaveValue(/\d{4}-\d{2}-\d{2}/)
  await expect(page.getByRole('button', { name: 'Day month date format' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Calendar date').fill('2026-08-29')
  await expect(page.locator('.date-stamp')).toHaveText('29 Aug 2026')
  await page.getByRole('button', { name: 'Month day date format' }).click()
  await expect(page.locator('.date-stamp')).toHaveText('Aug 29, 2026')
  await page.getByLabel('Date text').fill('29 August 2026')
  await expect(page.locator('.date-stamp')).toHaveText('29 August 2026')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.date-stamp')).toHaveText('Aug 29, 2026')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(page.locator('.date-stamp')).toHaveText('29 August 2026')

  const imageChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add image' }).click()
  const imageChooser = await imageChooserPromise
  await imageChooser.setFiles({
    name: 'offer-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await expect(page.locator('.image-annotation')).toHaveCount(0)
  await placePendingMedia(page, 'image', { x: 470, y: 230 }, layer)
  await expect(page.locator('.image-annotation')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 2, name: 'Image' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Add signature' }).click()
  const signatureName = page.getByLabel('Name for signature')
  await expect(page.getByRole('tab', { name: 'Type' })).toHaveAttribute('aria-selected', 'true')
  await expect(signatureName).toBeFocused()
  await signatureName.fill('Syed Akrama Irshad')
  await page.getByRole('button', { name: 'Initials' }).click()
  await page.getByRole('radio', { name: 'Classic signature style' }).click()
  await expect(page.getByRole('button', { name: 'Initials' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('radio', { name: 'Classic signature style' })).toHaveAttribute('aria-checked', 'true')
  await page.getByLabel('Save this signature for reuse on this device').check()
  await page.getByRole('button', { name: 'Place signature' }).click()
  await expect(page.locator('.image-annotation')).toHaveCount(1)
  await placePendingMedia(page, 'signature', { x: 300, y: 420 }, layer)
  await expect(page.locator('.image-annotation')).toHaveCount(2)
  await expect(page.getByRole('heading', { level: 2, name: 'Signature' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Select signature annotation' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Add signature' }).click()
  const savedInitials = page.getByRole('button', { name: 'Place saved signature SAI initials' })
  await expect(savedInitials).toBeVisible()
  expect(await page.locator('.saved-signatures').evaluate((saved) => {
    const tabs = saved.parentElement?.querySelector('.signature-tabs')
    return Boolean(tabs && (saved.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).toBe(true)
  await savedInitials.click()
  await expect(page.locator('.image-annotation')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(page.getByText('Signature placement cancelled.')).toBeVisible()
  await expect(page.locator('.image-annotation')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('button', { name: 'Place saved signature SAI initials' }).click()
  await expect(page.getByText('Click where the signature should go')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('.image-annotation')).toHaveCount(3)
  const keyboardSignature = await page.locator('.image-annotation').last().boundingBox()
  const firstPageSurface = await page.locator('.page-surface').first().boundingBox()
  if (!keyboardSignature || !firstPageSurface) throw new Error('The keyboard-placed signature is missing.')
  expect(keyboardSignature.width / keyboardSignature.height).toBeCloseTo(1120 / 380, 1)
  expect(keyboardSignature.x + keyboardSignature.width / 2).toBeCloseTo(firstPageSurface.x + firstPageSurface.width / 2, 0)
  expect(keyboardSignature.y + keyboardSignature.height / 2).toBeCloseTo(firstPageSurface.y + firstPageSurface.height / 2, 0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.image-annotation')).toHaveCount(2)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('mvp-fixture-edited.pdf')
})

test('keeps calendar and printed date formats reachable at 1024px', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Add date' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 120, y: 220 } })
  await page.getByRole('button', { name: 'Show item properties' }).click()
  const inspector = page.locator('.inspector')
  const calendar = page.getByLabel('Calendar date')
  await calendar.scrollIntoViewIfNeeded()
  await expect(calendar).toBeVisible()
  const calendarBounds = await calendar.boundingBox()
  if (!calendarBounds) throw new Error('The minimum-width laptop calendar date is missing.')
  expect(calendarBounds.height).toBeGreaterThanOrEqual(40)

  for (const name of ['Day month', 'Month day', 'Day first', 'ISO']) {
    const format = page.getByRole('button', { name: `${name} date format` })
    await format.scrollIntoViewIfNeeded()
    const bounds = await format.boundingBox()
    if (!bounds) throw new Error(`${name} is missing from the minimum-width laptop date proof.`)
    expect(bounds.height).toBeGreaterThanOrEqual(32)
  }

  const iso = page.getByRole('button', { name: 'ISO date format' })
  await iso.click()
  const dateValue = await calendar.inputValue()
  await expect(page.locator('.date-stamp')).toHaveText(dateValue)
  await page.getByLabel('Date text').scrollIntoViewIfNeeded()
  await expect(page.getByLabel('Date text')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
  expect(await inspector.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
})

test('places private details without retyping and saves only on explicit request', async ({ page }) => {
  const foreignRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1') foreignRequests.push(request.url())
  })

  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const layer = page.locator('.annotation-layer').first()
  const details = page.getByRole('button', { name: 'My details' })

  await details.scrollIntoViewIfNeeded()
  await details.click()
  await expect(page.getByRole('heading', { name: 'Fill without retyping' })).toBeVisible()
  await expect(page.getByText('LOCAL ONLY · Never added to a PDF until you choose Place')).toBeVisible()
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Syed Akrama Irshad')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('syed@example.com')
  await page.getByRole('textbox', { name: 'Company', exact: true }).fill('LeafPDF')
  await page.getByRole('textbox', { name: 'Address', exact: true }).fill('42 Paper Street\nBengaluru')
  await page.getByRole('button', { name: 'Save on this device' }).click()
  await expect(page.getByText('Personal details saved only in this browser.')).toBeVisible()

  await page.getByRole('button', { name: 'Place Full name' }).click()
  await expect(page.getByText('Click where Full name should go')).toBeVisible()
  await layer.click({ position: { x: 155, y: 315 } })
  const placedText = page.getByLabel('Edit text')
  await expect(placedText).toHaveCount(1)
  await expect(placedText.last()).toHaveValue('Syed Akrama Irshad')
  await placedText.last().press('Enter')

  await details.scrollIntoViewIfNeeded()
  await details.click()
  await expect(page.getByRole('textbox', { name: 'Full name', exact: true })).toHaveValue('Syed Akrama Irshad')
  await expect(page.getByRole('textbox', { name: 'Company', exact: true })).toHaveValue('LeafPDF')
  await page.getByRole('textbox', { name: 'Company', exact: true }).fill('Unsaved Draft Company')
  await page.getByRole('button', { name: 'Place Company' }).click()
  await expect(page.getByText('Click where Company should go')).toBeVisible()
  await layer.click({ position: { x: 155, y: 350 } })
  await expect(placedText).toHaveCount(2)
  await expect(placedText.last()).toHaveValue('Unsaved Draft Company')
  await placedText.last().press('Enter')

  await details.scrollIntoViewIfNeeded()
  await details.click()
  await expect(page.getByRole('textbox', { name: 'Company', exact: true })).toHaveValue('LeafPDF')
  await page.getByRole('button', { name: 'Place Address' }).click()
  await expect(page.getByText('Click where Address should go')).toBeVisible()
  await layer.click({ position: { x: 155, y: 390 } })
  await expect(placedText).toHaveCount(3)
  await expect(placedText.last()).toHaveValue('42 Paper Street\nBengaluru')
  await placedText.last().press('Enter')

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(placedText).toHaveCount(2)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(placedText).toHaveCount(3)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('mvp-fixture-edited.pdf')
  expect(foreignRequests).toEqual([])
})

test('keeps private details reachable without crowding the 1024px finishing dock', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const dock = page.getByRole('navigation', { name: 'Editing tools' })
  expect(await dock.evaluate((element) => element.scrollLeft)).toBe(0)
  for (const name of ['Select', 'Add text', 'Add date', 'Add checkmark', 'Add signature', 'Add image']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }

  const details = page.getByRole('button', { name: 'My details' })
  await details.scrollIntoViewIfNeeded()
  await details.click()
  const panel = page.locator('.details-panel')
  await expect(panel).toBeVisible()

  for (const control of [
    page.getByRole('textbox', { name: 'Full name', exact: true }),
    page.getByRole('textbox', { name: 'Address', exact: true }),
    page.getByRole('button', { name: 'Place Full name' }),
    page.getByRole('button', { name: 'Save on this device' }),
    page.getByRole('button', { name: 'Close personal details' }),
  ]) {
    await control.scrollIntoViewIfNeeded()
    const bounds = await control.boundingBox()
    if (!bounds) throw new Error('A minimum-width laptop personal-details control is missing.')
    expect(bounds.height).toBeGreaterThanOrEqual(32)
  }
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)

  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Alex Morgan')
  await page.getByRole('button', { name: 'Place Full name' }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByText('Click where Full name should go')).toBeVisible()
  await page.locator('.annotation-layer').first().click({ position: { x: 110, y: 220 } })
  await expect(page.getByLabel('Edit text')).toHaveValue('Alex Morgan')
  await page.getByLabel('Edit text').press('Enter')

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
})

test('previews an image without changing edit history until placement', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled()

  const imageInput = page.locator('input[accept="image/png,image/jpeg"]')
  const sampleImage = {
    name: 'pending-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  }
  await imageInput.setInputFiles(sampleImage)
  await expect(page.getByText('Click where the image should go')).toBeVisible()
  await page.locator('.annotation-layer').first().hover({ position: { x: 280, y: 360 } })
  await expect(page.getByRole('img', { name: 'Image placement preview' })).toBeVisible()
  await expect(page.locator('.image-annotation')).toHaveCount(0)
  await expect(undo).toBeDisabled()

  await page.keyboard.press('Escape')
  await expect(page.getByText('Image placement cancelled.')).toBeVisible()
  await expect(page.locator('.image-annotation')).toHaveCount(0)
  await expect(undo).toBeDisabled()

  await imageInput.setInputFiles(sampleImage)
  await expect(page.getByText('Click where the image should go')).toBeVisible()
  const imageLayer = page.locator('.annotation-layer').first()
  await imageLayer.hover({ position: { x: 280, y: 360 } })
  const previewBox = await page.getByRole('img', { name: 'Image placement preview' }).boundingBox()
  if (!previewBox) throw new Error('The proportional image preview is missing.')
  expect(previewBox.width / previewBox.height).toBeCloseTo(1, 1)
  await imageLayer.click({ position: { x: 280, y: 360 } })
  await expect(page.locator('.image-annotation')).toHaveCount(1)
  await expect(undo).toBeEnabled()

  const placedImage = page.locator('.image-annotation')
  const beforeResize = await placedImage.boundingBox()
  if (!beforeResize) throw new Error('The proportionally placed image is missing.')
  expect(beforeResize.width / beforeResize.height).toBeCloseTo(1, 1)

  const resize = page.getByRole('button', { name: 'Resize item', exact: true })
  const resizeBounds = await resize.boundingBox()
  if (!resizeBounds) throw new Error('The image resize handle is missing.')
  await page.mouse.move(resizeBounds.x + resizeBounds.width / 2, resizeBounds.y + resizeBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizeBounds.x + 88, resizeBounds.y + 24, { steps: 6 })
  await page.mouse.up()

  const afterResize = await placedImage.boundingBox()
  if (!afterResize) throw new Error('The image disappeared after proportional resize.')
  expect(afterResize.width).toBeGreaterThan(beforeResize.width)
  expect(afterResize.width / afterResize.height).toBeCloseTo(beforeResize.width / beforeResize.height, 2)
})

test('proofs and replaces a placed image without losing its placement', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.locator('input[accept="image/png,image/jpeg"]').first().setInputFiles('public/leafpdf-icon-192.png')
  await placePendingMedia(page, 'image', { x: 310, y: 320 })
  const imageAnnotation = page.getByRole('button', { name: 'Select image annotation' })
  const bitmap = imageAnnotation.getByAltText('Placed image')
  await expect(imageAnnotation).toHaveAttribute('data-annotation-id', /annotation-/)
  const annotationId = await imageAnnotation.getAttribute('data-annotation-id')
  const originalSource = await bitmap.getAttribute('src')
  const originalGeometry = await imageAnnotation.evaluate((element) => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }))
  expect(originalGeometry.width / originalGeometry.height).toBeCloseTo(1, 1)

  await page.getByRole('button', { name: 'Show item properties' }).click()
  const opacity = page.getByLabel('Opacity')
  await opacity.press('Home')
  for (let step = 0; step < 5; step += 1) await opacity.press('ArrowRight')
  await expect(opacity).toHaveValue('0.35')
  await expect(bitmap).toHaveCSS('opacity', '0.35')

  await page.getByRole('button', { name: 'Turn image right' }).click()
  await expect(imageAnnotation).toHaveCSS('transform', /matrix\(0, 1, -1, 0/)
  const beforeReplacement = await imageAnnotation.boundingBox()
  if (!beforeReplacement) throw new Error('The rotated image is missing before replacement.')

  await page.getByLabel('Choose replacement image').setInputFiles('docs/screenshots/leafpdf-landing.png')
  await expect(page.locator('.toast')).toContainText('Image replaced. Undo restores the previous image.')
  await expect(imageAnnotation).toHaveAttribute('data-annotation-id', annotationId ?? '')
  await expect(bitmap).toHaveCSS('opacity', '0.35')
  await expect.poll(async () => bitmap.getAttribute('src')).not.toBe(originalSource)

  const replacementSource = await bitmap.getAttribute('src')
  const afterReplacement = await imageAnnotation.boundingBox()
  if (!afterReplacement) throw new Error('The rotated image is missing after replacement.')
  expect(afterReplacement.x + afterReplacement.width / 2).toBeCloseTo(
    beforeReplacement.x + beforeReplacement.width / 2,
    0,
  )
  expect(afterReplacement.y + afterReplacement.height / 2).toBeCloseTo(
    beforeReplacement.y + beforeReplacement.height / 2,
    0,
  )
  const replacementGeometry = await imageAnnotation.evaluate((element) => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }))
  const intrinsicRatio = await bitmap.evaluate((element) => {
    const image = element as HTMLImageElement
    return image.naturalWidth / image.naturalHeight
  })
  expect(replacementGeometry.width).toBeCloseTo(originalGeometry.width, 0)
  expect(replacementGeometry.height).not.toBeCloseTo(originalGeometry.height, 0)
  expect(replacementGeometry.width / replacementGeometry.height).toBeCloseTo(intrinsicRatio, 1)
  await page.screenshot({ path: 'output/ui/m38-image-proofing-desktop.png', fullPage: true })

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => bitmap.getAttribute('src')).toBe(originalSource)
  const undoneGeometry = await imageAnnotation.evaluate((element) => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }))
  expect(undoneGeometry).toEqual(originalGeometry)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect.poll(async () => bitmap.getAttribute('src')).toBe(replacementSource)

  await page.setViewportSize({ width: 1024, height: 800 })
  await expect.poll(() => firstPageFitsCanvas(page)).toBe(true)
  await imageAnnotation.click()
  await page.getByRole('button', { name: 'Show item properties' }).click()
  for (const name of ['Turn image left', 'Straighten image', 'Turn image right', 'Replace image']) {
    const control = page.getByRole('button', { name })
    await control.scrollIntoViewIfNeeded()
    const bounds = await control.boundingBox()
    if (!bounds) throw new Error(`${name} is missing from minimum-width laptop image proofing.`)
    expect(bounds.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  await page.locator('.inspector').evaluate((element) => { element.scrollTop = 0 })
  await expect(page.getByLabel('Opacity')).toBeVisible()
  await page.screenshot({ path: 'output/ui/m38-image-proofing-desktop-minimum.png', fullPage: true })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('mvp-fixture-edited.pdf')
})

test('inserts a blank page, merges another PDF, and exports all of it', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await expect(page.getByText('2 pages')).toBeVisible()

  // Blank page lands after the selected page and becomes the selection.
  const organizer = await openPageOrganizer(page)
  await organizer.getByRole('button', { name: '+ Blank page' }).click()
  await expect(page.getByText('3 pages')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Open page organizer, page/ })).toHaveAccessibleName(
    'Open page organizer, page 2 of 3',
  )

  // Merging pulls in every page of the chosen PDF.
  await organizer.getByLabel('Choose a PDF to insert').setInputFiles('tmp/pdfs/edge-metadata.pdf')
  await expect(page.getByText(/Inserted 2 pages from edge-metadata\.pdf/)).toBeVisible()
  await expect(page.getByText('5 pages')).toBeVisible()
  await organizer.getByRole('button', { name: 'Close page organizer' }).click()

  // The source has no catalog features, so this export runs without a dialog.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const exportedPath = 'output/pdf/mvp-with-insertions.pdf'
  await download.saveAs(exportedPath)

  // Reopening the export proves the added pages are real pages of the file.
  await page.getByRole('button', { name: /Close document/ }).click()
  await expect(page.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  await expect(page.getByText('5 pages')).toBeVisible()
})

test('redacts a page so its text is gone from the exported file', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  // Sanity: the phrase exists before redaction, on page 1.
  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('verification')
  await search.press('Enter')
  await expect(page.getByText(/1 match · page 1/)).toBeVisible()

  // Cover the heading with a redaction box.
  await openAdvancedEditingTools(page)
  await page.getByRole('button', { name: 'Redact' }).click()
  const layer = page.locator('.annotation-layer').first()
  const bounds = await layer.boundingBox()
  if (!bounds) throw new Error('The annotation layer is not visible.')
  await page.mouse.move(bounds.x + 20, bounds.y + 20)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 620, bounds.y + 160)
  await page.mouse.up()
  await expect(page.locator('.redaction-annotation')).toBeVisible()

  // The fixture has no catalog features, so the rebuild needs no confirmation.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const exportedPath = 'output/pdf/mvp-redacted.pdf'
  await download.saveAs(exportedPath)

  // Reopen the export: the redacted page is a picture now — the covered phrase
  // is not just invisible, it is not in the file's text at all.
  await page.getByRole('button', { name: /Close document/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const reopenedSearch = page.getByRole('searchbox', { name: 'Find text in document' })
  await reopenedSearch.fill('verification')
  await reopenedSearch.press('Enter')
  await expect(page.getByText('No matches')).toBeVisible()

  // The untouched page keeps its selectable text.
  await reopenedSearch.fill('Move this page')
  await reopenedSearch.press('Enter')
  await expect(page.getByText(/1 match · page 2/)).toBeVisible()
})

test('covers existing content with an honest whiteout', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  const sourceCanvas = page.getByLabel('Rendered PDF page').first()
  await expect(sourceCanvas).toBeVisible()
  await expect(page.locator('.text-layer span', { hasText: 'LeafPDF verification document' }).first()).toBeVisible()

  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('verification')
  await search.press('Enter')
  await expect(page.getByText(/1 match · page 1/)).toBeVisible()

  const headingRegion = { x: 40, y: 30, width: 580, height: 110 }
  const darkPixelsBefore = await countDarkCanvasPixels(sourceCanvas, headingRegion)
  expect(darkPixelsBefore).toBeGreaterThan(100)

  await openAdvancedEditingTools(page)
  await page.getByRole('button', { name: 'Whiteout', exact: true }).click()
  await expect(page.getByText('Drag over content to cover it visually')).toBeVisible()

  const layer = page.locator('.annotation-layer').first()
  const bounds = await layer.boundingBox()
  if (!bounds) throw new Error('The annotation layer is not visible.')
  await page.mouse.move(bounds.x + 25, bounds.y + 20)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 655, bounds.y + 160)
  await page.mouse.up()

  const whiteout = page.getByRole('button', { name: 'Select whiteout annotation' })
  await expect(whiteout).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Whiteout' })).toBeVisible()
  const inspector = page.locator('.inspector')
  await page.getByRole('button', { name: 'Show item properties' }).click()
  await expect(inspector).toContainText('original text or image remains underneath')
  await expect(inspector).toContainText('Use Redact when content must be removed permanently')
  await expect(inspector.getByRole('button', { name: 'Add replacement text' })).toBeVisible()

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(inspector).toHaveCount(0)
  await whiteout.click()
  await expect(page.getByRole('heading', { level: 2, name: 'Whiteout' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const exportedPath = 'output/pdf/mvp-whiteout.pdf'
  await download.saveAs(exportedPath)

  await page.getByRole('button', { name: /Close document/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  const reopenedCanvas = page.getByLabel('Rendered PDF page').first()
  await expect(reopenedCanvas).toBeVisible()
  await expect(page.locator('.text-layer span', { hasText: 'LeafPDF verification document' }).first()).toBeVisible()

  const darkPixelsAfter = await countDarkCanvasPixels(reopenedCanvas, headingRegion)
  expect(darkPixelsAfter).toBeLessThan(Math.max(10, Math.floor(darkPixelsBefore * 0.05)))

  const reopenedSearch = page.getByRole('searchbox', { name: 'Find text in document' })
  await reopenedSearch.fill('verification')
  await reopenedSearch.press('Enter')
  await expect(page.getByText(/1 match · page 1/)).toBeVisible()
})

test('adds replacement text directly from a whiteout', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const layer = page.locator('.annotation-layer').first()
  const bounds = await layer.boundingBox()
  if (!bounds) throw new Error('The annotation layer is not visible.')

  await openAdvancedEditingTools(page)
  await page.getByRole('button', { name: 'Whiteout', exact: true }).click()
  await page.mouse.move(bounds.x + 70, bounds.y + 180)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 460, bounds.y + 235)
  await page.mouse.up()

  await page.getByRole('button', { name: 'Show item properties' }).click()
  await page.getByRole('button', { name: 'Add replacement text' }).click()
  const replacement = page.getByLabel('Edit text')
  await expect(replacement).toBeFocused()
  await expect(replacement).toHaveValue('Type here')
  await expect(page.locator('.whiteout-annotation')).toHaveCount(1)
  await expect(page.locator('.text-annotation')).toHaveCount(1)
  await expect(page.getByText('Replacement text added. Type on the page, then press Enter.')).toBeVisible()

  await replacement.fill('Corrected offer detail')
  await replacement.press('Enter')
  await expect(page.locator('.inspector')).toHaveCount(0)
  await expect(page.locator('.whiteout-annotation')).toHaveCount(1)
  await expect(page.locator('.text-annotation')).toHaveCount(1)

  // A second correction left untouched must still be caught by the existing
  // unfinished-text guard rather than silently saving “Type here”.
  await openAdvancedEditingTools(page)
  await page.getByRole('button', { name: 'Whiteout', exact: true }).click()
  await page.mouse.move(bounds.x + 80, bounds.y + 300)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 390, bounds.y + 350)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Show item properties' }).click()
  await page.getByRole('button', { name: 'Add replacement text' }).click()
  await expect(page.getByLabel('Edit text').last()).toHaveValue('Type here')

  await page.getByRole('button', { name: 'Save PDF' }).click()
  const guard = page.getByRole('dialog', { name: 'Finish this text before saving?' })
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'Cancel' }).click()
})

test('never contacts another host while opening, editing, and exporting', async ({ page }) => {
  const foreign: string[] = []
  const allowed = new URL('http://127.0.0.1:4173')

  page.on('request', (request) => {
    const url = request.url()
    if (url.startsWith('blob:') || url.startsWith('data:')) return
    try {
      if (new URL(url).host !== allowed.host) foreign.push(url)
    } catch {
      foreign.push(url)
    }
  })

  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  // Unicode text, which is the only path that loads a font file. It must come from
  // our own origin, never from Google Fonts.
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 140, y: 300 } })
  await page.getByLabel('Edit text').fill('مرحبا')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  await downloadPromise

  expect(foreign).toEqual([])
})

test('moves a selected annotation with the keyboard alone', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 160, y: 300 } })
  const annotation = page.locator('.text-annotation').first()
  const moveHandle = page.getByRole('button', { name: 'Move text' })
  await expect(annotation).toBeVisible()

  const before = await annotation.boundingBox()
  if (!before) throw new Error('The annotation is not visible.')

  // Space selects, then arrows nudge: no pointer involved.
  await moveHandle.focus()
  await page.keyboard.press(' ')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  const afterSmall = await annotation.boundingBox()
  if (!afterSmall) throw new Error('The annotation vanished after a nudge.')
  expect(afterSmall.x).toBeGreaterThan(before.x)
  expect(afterSmall.y).toBeGreaterThan(before.y)

  // Shift multiplies the step, so this move must be clearly larger.
  const smallStep = afterSmall.x - before.x
  await page.keyboard.press('Shift+ArrowRight')
  const afterLarge = await annotation.boundingBox()
  if (!afterLarge) throw new Error('The annotation vanished after a shift nudge.')
  expect(afterLarge.x - afterSmall.x).toBeGreaterThan(smallStep * 2)
})

test('shows alignment guides, snaps one drag, and lets Option or Alt bypass them', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const layer = page.locator('.annotation-layer').first()
  const placementLayerBounds = await layer.boundingBox()
  if (!placementLayerBounds) throw new Error('The annotation layer is not visible.')

  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('tab', { name: 'Type' }).click()
  await page.getByLabel('Name for signature').fill('Alignment Test')
  await page.getByRole('button', { name: 'Place signature' }).click()
  await placePendingMedia(page, 'signature', {
    x: placementLayerBounds.width * 0.25,
    y: placementLayerBounds.height * 0.35,
  }, layer)

  const signature = page.getByRole('button', { name: 'Select signature annotation' })
  const guide = page.locator('.alignment-guide.is-vertical')
  const initial = await signature.boundingBox()
  const selectedLayerBounds = await layer.boundingBox()
  if (!initial || !selectedLayerBounds) throw new Error('The placed signature is not visible.')

  // Selecting the placed signature reveals the adaptive inspector and shifts the
  // paper in screen space. All drag geometry must use that current coordinate frame.
  const pageCenterX = selectedLayerBounds.x + selectedLayerBounds.width / 2
  const initialCenterX = initial.x + initial.width / 2
  const initialCenterY = initial.y + initial.height / 2
  const nearCenterX = pageCenterX - 4
  const initialNormalized = {
    x: (initial.x - selectedLayerBounds.x) / selectedLayerBounds.width,
    y: (initial.y - selectedLayerBounds.y) / selectedLayerBounds.height,
  }

  await page.mouse.move(initialCenterX, initialCenterY)
  await page.mouse.down()
  await page.mouse.move(nearCenterX, initialCenterY, { steps: 8 })
  await expect(guide).toBeVisible()
  const snappedPreview = await signature.boundingBox()
  if (!snappedPreview) throw new Error('The signature preview disappeared while dragging.')
  expect(Math.abs(snappedPreview.x + snappedPreview.width / 2 - pageCenterX)).toBeLessThanOrEqual(1)
  await page.mouse.up()
  await expect(guide).toHaveCount(0)

  const snapped = await signature.boundingBox()
  if (!snapped) throw new Error('The snapped signature disappeared.')
  expect(Math.abs(snapped.x + snapped.width / 2 - pageCenterX)).toBeLessThanOrEqual(1)

  await page.keyboard.press('ControlOrMeta+z')
  const undone = await signature.boundingBox()
  const undoneLayerBounds = await layer.boundingBox()
  if (!undone || !undoneLayerBounds) throw new Error('Undo removed the signature instead of restoring its position.')
  expect(Math.abs((undone.x - undoneLayerBounds.x) / undoneLayerBounds.width - initialNormalized.x)).toBeLessThanOrEqual(0.002)
  expect(Math.abs((undone.y - undoneLayerBounds.y) / undoneLayerBounds.height - initialNormalized.y)).toBeLessThanOrEqual(0.002)

  // Undo deliberately deselects the item and returns to the paper-focused grid.
  // Reselect without moving it, then start the Alt drag in the stable selected frame.
  await signature.focus()
  await page.keyboard.press(' ')
  await expect(page.locator('.inspector')).toBeVisible()
  const reselected = await signature.boundingBox()
  const reselectedLayerBounds = await layer.boundingBox()
  if (!reselected || !reselectedLayerBounds) throw new Error('The signature could not be reselected for free movement.')
  const reselectedCenterX = reselected.x + reselected.width / 2
  const reselectedCenterY = reselected.y + reselected.height / 2
  const reselectedPageCenterX = reselectedLayerBounds.x + reselectedLayerBounds.width / 2
  const freeTargetX = reselectedPageCenterX - 4
  await page.keyboard.down('Alt')
  await page.mouse.move(reselectedCenterX, reselectedCenterY)
  await page.mouse.down()
  await page.mouse.move(freeTargetX, reselectedCenterY, { steps: 8 })
  await expect(guide).toHaveCount(0)
  await page.mouse.up()
  await page.keyboard.up('Alt')

  const freeMove = await signature.boundingBox()
  if (!freeMove) throw new Error('The freely moved signature disappeared.')
  const freeCenterX = freeMove.x + freeMove.width / 2
  expect(Math.abs(freeCenterX - freeTargetX)).toBeLessThanOrEqual(1.5)
  expect(Math.abs(freeCenterX - reselectedPageCenterX)).toBeGreaterThan(2)
})

test('traps focus inside the signature dialog and restores it on Escape', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const opener = page.getByRole('button', { name: 'Add signature' })
  await opener.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  const name = page.getByLabel('Name for signature')
  await expect(name).toBeFocused()
  await expect(page.getByLabel('Signature preview')).toBeVisible()
  await name.fill('Focus Test')

  // Tab from the last control must wrap to the first, never escape the dialog.
  const place = dialog.getByRole('button', { name: 'Place signature' })
  await place.focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('tab', { name: 'Type' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(place).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(opener).toBeFocused()
})

test('uses the complete fill, sign, transform, layer, marks, and recovery workflow', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const layer = page.locator('.annotation-layer').first()
  const bounds = await layer.boundingBox()
  if (!bounds) throw new Error('The annotation layer is not visible.')

  await openAdvancedEditingTools(page)
  await page.getByRole('button', { name: 'Shapes' }).click()
  await page.getByRole('menuitem', { name: 'Add rectangle' }).click()
  await page.mouse.move(bounds.x + 90, bounds.y + 110)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 250, bounds.y + 190)
  await page.mouse.up()
  await expect(page.locator('.shape-annotation')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resize item from top left' })).toBeVisible()

  const rotate = page.getByRole('button', { name: 'Rotate item' })
  const rotateBounds = await rotate.boundingBox()
  if (!rotateBounds) throw new Error('Rotation handle is missing.')
  await page.mouse.move(rotateBounds.x + 8, rotateBounds.y + 8)
  await page.mouse.down()
  await page.mouse.move(rotateBounds.x + 90, rotateBounds.y + 45, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.shape-annotation')).toHaveCSS('transform', /matrix|rotate/)

  for (const [name, start, end] of [
    ['Add ellipse', { x: 280, y: 115 }, { x: 390, y: 180 }],
    ['Add line', { x: 90, y: 215 }, { x: 240, y: 260 }],
    ['Add arrow', { x: 275, y: 215 }, { x: 420, y: 265 }],
  ] as const) {
    await openAdvancedEditingTools(page)
    await page.getByRole('button', { name: 'Shapes' }).click()
    await page.getByRole('menuitem', { name }).click()
    await page.mouse.move(bounds.x + start.x, bounds.y + start.y)
    await page.mouse.down()
    await page.mouse.move(bounds.x + end.x, bounds.y + end.y)
    await page.mouse.up()
  }
  await expect(page.locator('.shape-annotation')).toHaveCount(4)

  await page.getByRole('button', { name: 'Add checkmark' }).click()
  await layer.click({ position: { x: 330, y: 245 } })
  await expect(page.locator('.stamp-annotation')).toBeVisible()
  for (const [name, position] of [
    ['Add cross', { x: 370, y: 300 }],
    ['Add dot', { x: 420, y: 345 }],
  ] as const) {
    await openAdvancedEditingTools(page)
    await page.getByRole('button', { name: 'More marks' }).click()
    await page.getByRole('menuitem', { name }).click()
    await layer.click({ position })
  }
  await page.getByRole('button', { name: 'Add date' }).click()
  await layer.click({ position: { x: 280, y: 390 } })
  await expect(page.locator('.stamp-annotation')).toHaveCount(4)
  await page.getByRole('button', { name: 'Show item properties' }).click()
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.locator('.stamp-annotation')).toHaveCount(5)
  await page.getByRole('button', { name: 'Show item properties' }).click()
  await page.getByRole('button', { name: 'Send backward' }).click()
  await page.getByRole('button', { name: 'Copy' }).click()
  await page.getByRole('button', { name: 'Paste' }).click()
  await expect(page.locator('.stamp-annotation')).toHaveCount(6)

  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('tab', { name: 'Type' }).click()
  await page.getByLabel('Name for signature').fill('Syed A')
  await page.getByLabel('Save this signature for reuse on this device').check()
  await page.getByRole('button', { name: 'Place signature' }).click()
  await placePendingMedia(page, 'signature', { x: 260, y: 470 }, layer)
  await expect(page.locator('.image-annotation')).toBeVisible()
  await page.getByRole('button', { name: 'Add signature' }).click()
  await expect(page.getByRole('button', { name: /Place saved signature Syed A/ })).toBeVisible()
  await page.getByRole('button', { name: /Place saved signature Syed A/ }).click()
  await placePendingMedia(page, 'signature', { x: 430, y: 470 }, layer)
  await expect(page.locator('.image-annotation')).toHaveCount(2)

  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('tab', { name: 'Draw' }).click()
  const drawnCanvas = page.locator('.signature-dialog canvas')
  const drawnBounds = await drawnCanvas.boundingBox()
  if (!drawnBounds) throw new Error('Drawn-signature canvas is missing.')
  await page.mouse.move(drawnBounds.x + 70, drawnBounds.y + 80)
  await page.mouse.down()
  await page.mouse.move(drawnBounds.x + 220, drawnBounds.y + 105, { steps: 6 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Place signature' }).click()
  await placePendingMedia(page, 'signature', { x: 260, y: 560 }, layer)

  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('tab', { name: 'Upload' }).click()
  await page.getByLabel('Upload signature image').setInputFiles({
    name: 'signature.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await expect(page.getByRole('button', { name: 'Place signature' })).toBeEnabled()
  await page.getByRole('button', { name: 'Place signature' }).click()
  await placePendingMedia(page, 'signature', { x: 430, y: 560 }, layer)
  await expect(page.locator('.image-annotation')).toHaveCount(4)

  await openDocumentMarks(page)
  await page.getByLabel('Watermark text').fill('INTERNAL')
  await page.getByLabel('All pages').check()
  await page.getByRole('button', { name: 'Add watermark' }).click()
  await expect.poll(() => page.getByLabel('Edit text').evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value))).toContain('INTERNAL')

  await openDocumentMarks(page)
  await page.getByRole('tab', { name: 'Page numbers' }).click()
  await page.getByLabel('Number format').selectOption('page-of-total')
  await page.getByLabel('Bottom right').check()
  await page.getByRole('button', { name: 'Add page numbers' }).click()
  await expect.poll(() => page.getByLabel('Edit text').evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value))).toContain('Page 1 of 2')

  // Wait for the real IndexedDB record instead of assuming the debounce completed.
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('leafpdf-local-store')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const transaction = database.transaction('sessions', 'readonly')
      const records = transaction.objectStore('sessions').getAll()
      return await new Promise<string[]>((resolve, reject) => {
        records.onsuccess = () => resolve(records.result.flatMap((record) =>
          record.document.annotations
            .filter((annotation: { kind: string }) => annotation.kind === 'text')
            .map((annotation: { text: string }) => annotation.text),
        ))
        records.onerror = () => reject(records.error)
      })
    } finally {
      database.close()
    }
  })).toContain('INTERNAL')
  page.once('dialog', (dialog) => void dialog.accept())
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  const recovery = page.getByRole('dialog', { name: /Resume your previous editing session/ })
  await expect(recovery).toBeVisible()
  await recovery.getByRole('button', { name: 'Restore edits' }).click()
  await expect(page.locator('.shape-annotation')).toHaveCount(4)
  await expect.poll(() => page.getByLabel('Edit text').evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value))).toContain('INTERNAL')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  await download.saveAs('output/pdf/complete-workflow-edited.pdf')
  await expect(page.getByRole('button', { name: /Save again/ })).toBeEnabled()

  // Exporting the current document clears recovery; reopening the same source must
  // not offer the already-exported annotations as an unsaved session.
  await page.reload()
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await expect(page.getByRole('dialog', { name: /Resume your previous editing session/ })).toBeHidden()
})

test('keeps document marks reachable at the 1024px minimum viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const more = page.getByRole('button', { name: 'Document tools' })
  await expect(more).toBeVisible()
  await openDocumentMarks(page)
  await expect(page.getByRole('dialog', { name: 'Add marks to this PDF' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
})

test('keeps history controls available at the minimum laptop width', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const undo = page.getByRole('button', { name: 'Undo' })
  const redo = page.getByRole('button', { name: 'Redo' })
  await expect(undo).toBeVisible()
  await expect(redo).toBeVisible()
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()
  const topbar = page.locator('.topbar')
  const dock = page.getByRole('navigation', { name: 'Editing tools' })
  const topbarBounds = await topbar.boundingBox()
  const dockBounds = await dock.boundingBox()
  const undoBounds = await undo.boundingBox()
  const redoBounds = await redo.boundingBox()
  if (!topbarBounds || !dockBounds || !undoBounds || !redoBounds) throw new Error('Minimum-width laptop history controls are not measurable.')
  for (const bounds of [undoBounds, redoBounds]) {
    expect(bounds.width).toBeGreaterThanOrEqual(36)
    expect(bounds.height).toBeGreaterThanOrEqual(34)
    expect(bounds.y).toBeGreaterThanOrEqual(topbarBounds.y)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(topbarBounds.y + topbarBounds.height + 1)
  }
  expect(undoBounds.x).toBeLessThan(redoBounds.x)
  const fileNameBounds = await page.locator('.document-identity h1').boundingBox()
  const savePdfBounds = await page.getByRole('button', { name: 'Save PDF' }).boundingBox()
  if (!fileNameBounds || !savePdfBounds) throw new Error('Minimum-width laptop file and save controls are not measurable.')
  expect(fileNameBounds.width).toBeGreaterThanOrEqual(88)
  expect(savePdfBounds.width).toBeGreaterThanOrEqual(100)
  expect(savePdfBounds.x + savePdfBounds.width).toBeLessThanOrEqual(1024)
  await expect(page.locator('.statusbar')).toBeHidden()
  expect(dockBounds.y + dockBounds.height).toBeCloseTo(700, 0)

  await expect(page.getByRole('button', { name: 'Save project' })).toHaveCount(0)
  const more = page.getByRole('button', { name: 'Document tools' })
  await more.click()
  await expect(page.getByRole('menuitem', { name: 'Save project' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()

  await page.getByRole('button', { name: 'Add checkmark' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 100, y: 160 } })
  await expect(page.locator('.stamp-annotation')).toHaveCount(1)
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(page.locator('.stamp-annotation')).toHaveCount(0)
  await expect(redo).toBeEnabled()
  await redo.click()
  await expect(page.locator('.stamp-annotation')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
})

test('keeps paper controls and Find visible at the minimum laptop width', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const toolbar = page.locator('.stage-toolbar')
  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await expect(search).toBeVisible()
  for (const control of [
    page.getByRole('button', { name: /^Open page organizer, page/ }),
    search,
    page.getByRole('button', { name: 'Zoom out' }),
    page.getByRole('button', { name: 'Fit page width' }),
    page.getByRole('button', { name: 'Zoom in' }),
  ]) {
    const bounds = await control.boundingBox()
    if (!bounds) throw new Error('A minimum-width laptop paper control is missing.')
    expect(bounds.height).toBeGreaterThanOrEqual(34)
  }
  const toolbarBounds = await toolbar.boundingBox()
  if (!toolbarBounds) throw new Error('Minimum-width laptop paper controls are missing.')
  expect(toolbarBounds.height).toBeLessThanOrEqual(50)

  const searchBounds = await search.boundingBox()
  if (!searchBounds) throw new Error('Minimum-width laptop Find field is missing.')
  expect(searchBounds.height).toBeGreaterThanOrEqual(34)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  mkdirSync('output/ui', { recursive: true })
  await page.screenshot({ path: 'output/ui/m42-paper-chrome-desktop-minimum.png', fullPage: true })

})

test('protects unsaved edits and collapses a typing session into one undo', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  // A clean session closes without any prompt.
  await page.getByRole('button', { name: /Close document/ }).click()
  await expect(page.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeVisible()

  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 140, y: 200 } })
  await expect(page.locator('.text-annotation')).toBeVisible()

  // Type a whole word; every keystroke is a separate dispatch.
  const content = page.getByLabel('Edit text')
  await content.fill('')
  await content.pressSequentially('Reviewed', { delay: 15 })
  await expect(content).toHaveValue('Reviewed')

  // One undo must reverse the entire typing session, not one character.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByLabel('Edit text')).toHaveValue('Type here')

  // Closing with unsaved edits must ask first.
  await page.getByRole('button', { name: /Close document/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Continue editing' })).toBeFocused()

  await dialog.getByRole('button', { name: 'Continue editing' }).click()
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: /Close document/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeVisible()
})

test('keeps the main thread responsive while exporting a 100-page PDF', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/edge-100-pages.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await expect(page.getByText('100 pages')).toBeVisible()

  // Arabic text forces the heaviest export path: fontkit loads, the Arabic font is
  // parsed, shaped, and subset. If anything blocks the UI, this is where it shows.
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 120, y: 160 } })
  await expect(page.locator('.text-annotation')).toBeVisible()
  await page.getByLabel('Edit text').fill('مرحبا بالعالم')

  // A second script embeds a second font, so the export spans a window long enough
  // for a starved 100 ms interval to be unmistakable.
  const organizer = await openPageOrganizer(page)
  await organizer.getByRole('button', { name: 'Select page 2', exact: true }).click()
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.strip-page[data-page-number="2"] .annotation-layer').click({ position: { x: 120, y: 200 } })
  await page.locator('.strip-page[data-page-number="2"]').getByLabel('Edit text').fill('नमस्ते दुनिया')

  // An Arabic watermark on every page keeps the export window measurable: the
  // production build finishes a bare 100-page export in under 200 ms, which is
  // shorter than the 300 ms this test needs to detect starvation at all. One
  // script only — a single annotation resolves to a single font, so text mixing
  // Arabic with Devanagari in one box is refused by design.
  await openDocumentMarks(page)
  await page.getByLabel('Watermark text').fill('مرحبا بالعالم مرحبا')
  await page.getByLabel('All pages').check()
  await page.getByRole('button', { name: 'Add watermark' }).click()
  await expect(page.getByText(/Watermark added to 100 pages/)).toBeVisible()

  // A 100 ms interval can only keep ticking if the main thread is never blocked.
  await page.evaluate(() => {
    const counter = { ticks: 0 }
    const stamps: number[] = [performance.now()]
    ;(window as unknown as { __ticks: typeof counter }).__ticks = counter
    const handle = window.setInterval(() => { counter.ticks += 1; stamps.push(performance.now()) }, 100)
    ;(window as unknown as { __stop: () => void }).__stop = () => window.clearInterval(handle)
    ;(window as unknown as { __t: unknown }).__t = {
      get elapsed() { return stamps.at(-1)! - stamps[0] },
      get maxGap() { return Math.max(...stamps.slice(1).map((v, i) => v - stamps[i])) },
    }
  })

  const downloadPromise = page.waitForEvent('download')
  const startedAt = Date.now()
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  const exportWallMs = Date.now() - startedAt
  const ticks = await page.evaluate(() => {
    const win = window as unknown as { __ticks: { ticks: number }; __stop: () => void }
    win.__stop()
    return win.__ticks.ticks
  })

  const { elapsed, maxGap } = await page.evaluate(
    () => (window as unknown as { __t: { elapsed: number; maxGap: number } }).__t,
  )

  // Starvation is only measurable when the export outlasts a few 100 ms tick
  // windows. On fast hardware the whole export can finish inside ~250 ms — a
  // span the user cannot perceive as a freeze — so the tick assertions would be
  // sampling noise. Slower machines, including CI runners, take the strict path.
  if (exportWallMs > 300) {
    // Compared against wall-clock time, not against its own timestamps: a blocked main
    // thread would still show a long `elapsed` but almost no ticks.
    const tickableWindows = Math.floor(exportWallMs / 100)
    expect(ticks).toBeGreaterThanOrEqual(tickableWindows - 1)
    expect(ticks).toBeGreaterThanOrEqual(3)
    // A synchronous export would leave one gap as long as the export itself,
    // so the bound is relative to the export, with a floor for scheduler
    // jitter on busy CI runners (a 100 ms timer has been observed 254 ms late
    // there while ticks kept flowing).
    expect(maxGap).toBeLessThan(Math.max(400, exportWallMs / 2))
    expect(elapsed).toBeGreaterThan(0)
  } else {
    testInfo.annotations.push({
      type: 'note',
      description: `Export finished in ${exportWallMs}ms — too fast for starvation to be measurable on this machine.`,
    })
  }
  mkdirSync('output/pdf', { recursive: true })
  await download.saveAs('output/pdf/edge-100-pages-edited.pdf')
})

test('drags ink by its points and keeps a signature inside the page', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const layer = page.locator('.annotation-layer').first()
  const layerBounds = await layer.boundingBox()
  if (!layerBounds) throw new Error('The annotation layer is not visible.')

  await openAdvancedEditingTools(page)
  await page.getByRole('button', { name: 'Draw' }).click()
  await page.mouse.move(layerBounds.x + 150, layerBounds.y + 200)
  await page.mouse.down()
  await page.mouse.move(layerBounds.x + 230, layerBounds.y + 250, { steps: 10 })
  await page.mouse.move(layerBounds.x + 300, layerBounds.y + 210, { steps: 10 })
  await page.mouse.up()

  const polyline = page.locator('.ink-annotation polyline')
  await expect(polyline).toBeVisible()
  const pointsBeforeDrag = await polyline.getAttribute('points')

  await page.locator('.tool-button[aria-label="Select"]').click()
  await page.mouse.move(layerBounds.x + 230, layerBounds.y + 250)
  await page.mouse.down()
  await page.mouse.move(layerBounds.x + 330, layerBounds.y + 330, { steps: 10 })
  await page.mouse.up()

  const pointsAfterDrag = await polyline.getAttribute('points')
  expect(pointsAfterDrag).not.toBe(pointsBeforeDrag)

  // A drawn signature is an image annotation; drag it far past the bottom-right corner.
  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('tab', { name: 'Draw' }).click()
  const signatureCanvas = page.locator('.signature-dialog canvas')
  const signatureBounds = await signatureCanvas.boundingBox()
  if (!signatureBounds) throw new Error('Signature canvas is not visible.')
  await page.mouse.move(signatureBounds.x + 80, signatureBounds.y + 100)
  await page.mouse.down()
  await page.mouse.move(signatureBounds.x + 200, signatureBounds.y + 60, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Place signature' }).click()
  await placePendingMedia(page, 'signature', { x: 300, y: 540 }, layer)

  const signature = page.getByRole('button', { name: 'Select signature annotation' })
  const signatureBoundsOnPage = await signature.boundingBox()
  if (!signatureBoundsOnPage) throw new Error('The placed signature is not visible.')
  await page.mouse.move(
    signatureBoundsOnPage.x + signatureBoundsOnPage.width / 2,
    signatureBoundsOnPage.y + signatureBoundsOnPage.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(layerBounds.x + layerBounds.width + 400, layerBounds.y + layerBounds.height + 400, { steps: 12 })
  await page.mouse.up()

  const movedBounds = await signature.boundingBox()
  if (!movedBounds) throw new Error('The moved signature is not visible.')
  expect(movedBounds.x + movedBounds.width).toBeLessThanOrEqual(layerBounds.x + layerBounds.width + 1)
  expect(movedBounds.y + movedBounds.height).toBeLessThanOrEqual(layerBounds.y + layerBounds.height + 1)
  expect(movedBounds.x).toBeGreaterThanOrEqual(layerBounds.x - 1)
  expect(movedBounds.y).toBeGreaterThanOrEqual(layerBounds.y - 1)
})

test('undoes a pasted text box from the focused editor', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 140, y: 200 } })
  const editors = page.getByLabel('Edit text')
  await editors.first().fill('Syed Akrama')
  await page.getByRole('button', { name: 'Show item properties' }).click()
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible()
  await page.getByRole('button', { name: 'Copy' }).click()
  await page.getByRole('button', { name: 'Paste' }).click()
  await expect(editors).toHaveCount(2)
  await expect(editors.nth(1)).toBeFocused()

  await editors.nth(1).press('ControlOrMeta+z')

  await expect(editors).toHaveCount(1)
  await expect(editors.first()).toHaveValue('Syed Akrama')
})

test('finishes added text with Enter and keeps Shift+Enter for a new line', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 140, y: 200 } })
  const editor = page.getByLabel('Edit text')
  await editor.fill('Offer accepted')
  await editor.press('Shift+Enter')
  await expect(editor).toHaveValue('Offer accepted\n')
  await expect(editor).toBeFocused()

  await editor.press('Enter')

  await expect(editor).not.toBeFocused()
  await expect(editor).toHaveValue('Offer accepted\n')
})

test('shows explicit text completion on desktop without obscuring page content', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await page.getByRole('button', { name: 'Add text' }).click()
  const layer = page.locator('.annotation-layer').first()
  await layer.click({ position: { x: 160, y: 500 } })
  const secondEditor = page.getByLabel('Edit text').last()
  await secondEditor.fill('Visibly finished')
  const finish = page.getByRole('button', { name: 'Finish editing text' })
  const toolbar = page.getByRole('toolbar', { name: 'Text editing' })
  await expect(toolbar).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Move text' })).toBeVisible()
  await expect(finish).toBeVisible()
  await expect(finish).toHaveAttribute('aria-keyshortcuts', 'Enter')
  mkdirSync('output/ui', { recursive: true })
  await page.screenshot({ path: 'output/ui/m39-text-finish-desktop.png', fullPage: true })
  await finish.click()
  await expect(secondEditor).not.toBeFocused()
  await expect(toolbar).toHaveCount(0)
})

test('shows explicit text completion on a minimum-width laptop without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await expect.poll(() => firstPageFitsCanvas(page)).toBe(true)
  const layer = page.locator('.annotation-layer').first()
  await layer.scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Add text' }).click()
  await layer.click({ position: { x: 80, y: 210 } })
  const minimumWidthEditor = page.getByLabel('Edit text').last()
  await minimumWidthEditor.fill('Choose Done to finish')
  const minimumWidthFinish = page.getByRole('button', { name: 'Finish editing text' })
  await expect(minimumWidthFinish).toBeVisible()
  const minimumWidthFinishBounds = await minimumWidthFinish.boundingBox()
  if (!minimumWidthFinishBounds) throw new Error('The minimum-width laptop text finish action is not measurable.')
  expect(minimumWidthFinishBounds.height).toBeGreaterThanOrEqual(32)
  expect(minimumWidthFinishBounds.x).toBeGreaterThanOrEqual(0)
  expect(minimumWidthFinishBounds.x + minimumWidthFinishBounds.width).toBeLessThanOrEqual(1024)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  await page.screenshot({ path: 'output/ui/m39-text-finish-desktop-minimum.png', fullPage: true })
  await minimumWidthFinish.click()
  await expect(minimumWidthEditor).not.toBeFocused()
  await expect(minimumWidthFinish).toHaveCount(0)
})

test('moves and aligns selected finishing items as one layout', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const layer = page.locator('.annotation-layer').first()

  await page.getByRole('button', { name: 'Add text' }).click()
  await layer.click({ position: { x: 120, y: 640 } })
  await page.getByLabel('Edit text').fill('Syed Akrama')
  await page.getByLabel('Edit text').press('Enter')

  await page.getByRole('button', { name: 'Add date' }).click()
  await layer.click({ position: { x: 165, y: 275 } })
  const date = page.getByRole('button', { name: 'Select date annotation' })

  await page.getByRole('button', { name: 'Add checkmark' }).click()
  await layer.click({ position: { x: 365, y: 345 } })
  const check = page.getByRole('button', { name: 'Select checkmark annotation' })

  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByLabel('Name for signature').fill('Syed Akrama Irshad')
  await page.getByRole('button', { name: 'Place signature' }).click()
  await placePendingMedia(page, 'signature', { x: 255, y: 440 }, layer)
  const signature = page.getByRole('button', { name: 'Select signature annotation' })

  await date.click({ modifiers: ['Shift'] })
  await check.click({ modifiers: ['Shift'] })

  await expect(page.getByRole('heading', { name: '3 items' })).toBeVisible()
  await expect(page.getByText('3 items selected', { exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: '3 selected items' })).toBeVisible()
  await expect(page.locator('.transform-controls')).toHaveCount(0)
  await expect(page.getByRole('toolbar', { name: 'Text editing' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Align selected items left' }).click()
  const aligned = await Promise.all([
    normalizedAnnotationBox(date, layer),
    normalizedAnnotationBox(check, layer),
    normalizedAnnotationBox(signature, layer),
  ])
  expect(Math.max(...aligned.map(({ x }) => x)) - Math.min(...aligned.map(({ x }) => x))).toBeLessThanOrEqual(0.003)

  const grip = page.getByRole('button', { name: 'Move 3 selected items' })
  const gripBounds = await grip.boundingBox()
  if (!gripBounds) throw new Error('The selected-group move grip is missing.')
  await page.mouse.move(gripBounds.x + gripBounds.width / 2, gripBounds.y + gripBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    gripBounds.x + gripBounds.width / 2 + 46,
    gripBounds.y + gripBounds.height / 2 + 34,
    { steps: 8 },
  )
  await page.mouse.up()

  const moved = await Promise.all([
    normalizedAnnotationBox(date, layer),
    normalizedAnnotationBox(check, layer),
    normalizedAnnotationBox(signature, layer),
  ])
  const dx = moved.map((box, index) => box.x - aligned[index].x)
  const dy = moved.map((box, index) => box.y - aligned[index].y)
  expect(Math.max(...dx) - Math.min(...dx)).toBeLessThanOrEqual(0.003)
  expect(Math.max(...dy) - Math.min(...dy)).toBeLessThanOrEqual(0.003)
  expect(Math.abs(dx[0]) + Math.abs(dy[0])).toBeGreaterThan(0.01)

  mkdirSync('output/ui', { recursive: true })
  await page.screenshot({ path: 'output/ui/m40-group-layout-desktop.png', fullPage: true })

  await page.keyboard.press('ControlOrMeta+z')
  const undone = await Promise.all([
    normalizedAnnotationBox(date, layer),
    normalizedAnnotationBox(check, layer),
    normalizedAnnotationBox(signature, layer),
  ])
  for (let index = 0; index < undone.length; index += 1) {
    expect(Math.abs(undone[index].x - aligned[index].x)).toBeLessThanOrEqual(0.003)
    expect(Math.abs(undone[index].y - aligned[index].y)).toBeLessThanOrEqual(0.003)
  }
  await expect(page.getByRole('group', { name: '3 selected items' })).toHaveCount(0)
})

test('selects more finishing items on a minimum-width laptop', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await expect.poll(() => firstPageFitsCanvas(page)).toBe(true)
  const layer = page.locator('.annotation-layer').first()
  await layer.scrollIntoViewIfNeeded()
  const minimumWidthLayerBounds = await layer.boundingBox()
  if (!minimumWidthLayerBounds) throw new Error('The minimum-width laptop annotation layer is not measurable.')

  await page.getByRole('button', { name: 'Add date' }).click()
  await layer.click({ position: { x: minimumWidthLayerBounds.width * 0.3, y: minimumWidthLayerBounds.height * 0.52 } })
  const date = page.getByRole('button', { name: 'Select date annotation' })

  await page.getByRole('button', { name: 'Add checkmark' }).click()
  await layer.click({ position: { x: minimumWidthLayerBounds.width * 0.68, y: minimumWidthLayerBounds.height * 0.7 } })
  const check = page.getByRole('button', { name: 'Select checkmark annotation' })

  await page.getByRole('button', { name: 'Show item properties' }).click()
  await page.getByRole('button', { name: 'Select more items' }).click()
  await date.click()

  await expect(page.getByRole('heading', { name: '2 items' })).toBeVisible()
  await expect(page.getByRole('group', { name: '2 selected items' })).toBeVisible()
  const controls = [
    page.getByRole('button', { name: 'Add another' }),
    page.getByRole('button', { name: 'Done' }),
    ...['left', 'center', 'right', 'top', 'middle', 'bottom'].map((name) =>
      page.getByRole('button', { name: `Align selected items ${name}` })),
    page.getByRole('button', { name: 'Delete 2 items' }),
  ]
  for (const control of controls) {
    const bounds = await control.boundingBox()
    if (!bounds) throw new Error(`A minimum-width laptop group control is missing: ${await control.getAttribute('aria-label') ?? await control.textContent()}`)
    expect(bounds.height).toBeGreaterThanOrEqual(36)
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1024)
  }

  await page.getByRole('button', { name: 'Align selected items top' }).click()
  const [dateAligned, checkAligned] = await Promise.all([
    normalizedAnnotationBox(date, layer),
    normalizedAnnotationBox(check, layer),
  ])
  expect(Math.abs(dateAligned.y - checkAligned.y)).toBeLessThanOrEqual(0.003)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)

  const dismissToast = page.getByRole('button', { name: 'Dismiss notification' })
  if (await dismissToast.isVisible()) await dismissToast.click()
  await page.locator('.canvas-scroll').evaluate((element) => {
    element.scrollTop += 82
  })

  mkdirSync('output/ui', { recursive: true })
  await page.screenshot({ path: 'output/ui/m40-group-layout-desktop-minimum.png', fullPage: true })

  await page.getByRole('button', { name: 'Delete 2 items' }).click()
  await expect(date).toHaveCount(0)
  await expect(check).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByRole('button', { name: 'Select date annotation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Select checkmark annotation' })).toBeVisible()
})

test('keeps everyday finishing tools primary and advanced editing discoverable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const primary = [
    'Select', 'Add text', 'My details', 'Add date',
    'Add checkmark', 'Add signature', 'Add image', 'More editing tools',
  ]
  for (const name of primary) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  for (const name of ['Forms', 'Text marks', 'Draw', 'Add link', 'Whiteout', 'Shapes', 'More marks', 'Redact']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  }

  mkdirSync('output/ui', { recursive: true })
  await page.screenshot({ path: 'output/ui/m41-finishing-lane-desktop.png', fullPage: true })

  await openAdvancedEditingTools(page)
  await expect(page.getByRole('group', { name: 'Advanced editing tools' })).toBeVisible()
  await page.getByRole('button', { name: 'Whiteout', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Advanced editing tools' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'More editing tools' })).toHaveClass(/has-active-tool/)
})

test('keeps the minimum-width laptop finishing lane short and reveals more editing on demand', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await expect.poll(() => firstPageFitsCanvas(page)).toBe(true)

  const more = page.getByRole('button', { name: 'More editing tools' })
  await more.scrollIntoViewIfNeeded()
  const bounds = await more.boundingBox()
  if (!bounds) throw new Error('The minimum-width laptop advanced editing disclosure is missing.')
  expect(bounds.height).toBeGreaterThanOrEqual(40)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)

  mkdirSync('output/ui', { recursive: true })
  await page.screenshot({ path: 'output/ui/m41-finishing-lane-desktop-minimum.png', fullPage: true })

  await more.click()
  const forms = page.getByRole('button', { name: 'Forms' })
  await forms.scrollIntoViewIfNeeded()
  await expect(forms).toBeVisible()
  await more.click()
  await expect(forms).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
})

test('opens a responsive page organizer without shrinking the paper', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const stage = page.locator('.document-stage')
  const stageClosed = await stage.boundingBox()
  if (!stageClosed) throw new Error('The paper stage is missing.')
  expect(stageClosed.width).toBeGreaterThan(1200)
  await expect(page.getByRole('dialog', { name: 'Document pages' })).toHaveCount(0)

  const trigger = page.getByRole('button', { name: /^Open page organizer, page/ })
  await expect(trigger).toHaveAccessibleName('Open page organizer, page 1 of 2')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  const organizer = page.getByRole('dialog', { name: 'Document pages' })
  await expect(organizer).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(organizer.getByRole('button', { name: 'Select page 1' })).toHaveAttribute('aria-current', 'page')
  await expect(organizer.getByRole('button', { name: '+ Blank page' })).toBeVisible()
  await expect(organizer.getByRole('button', { name: '+ Insert PDF' })).toBeVisible()
  const stageOpen = await stage.boundingBox()
  if (!stageOpen) throw new Error('The paper stage disappeared behind the organizer.')
  expect(stageOpen.width).toBe(stageClosed.width)
  await page.screenshot({ path: 'output/ui/m33-page-organizer-desktop.png', fullPage: true })

  await organizer.getByRole('button', { name: 'Close page organizer' }).click()
  await expect(organizer).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await page.setViewportSize({ width: 1024, height: 800 })
  await trigger.click()
  await expect(organizer).toBeVisible()
  const minimumWidthControls = [
    organizer.getByRole('button', { name: 'Close page organizer' }),
    organizer.getByRole('button', { name: '+ Blank page' }),
    organizer.getByRole('button', { name: '+ Insert PDF' }),
    organizer.getByRole('button', { name: 'Move page 1 down' }),
    organizer.getByRole('button', { name: 'Rotate page 1' }),
    organizer.getByRole('button', { name: 'Delete page 1' }),
  ]
  for (const control of minimumWidthControls) {
    const bounds = await control.boundingBox()
    if (!bounds) throw new Error('A desktop-minimum page-organizer control is missing.')
    expect(bounds.width).toBeGreaterThanOrEqual(34)
    expect(bounds.height).toBeGreaterThanOrEqual(34)
  }

  await organizer.getByRole('button', { name: '+ Blank page' }).click()
  await expect(organizer.getByRole('button', { name: 'Select page 2' })).toHaveAttribute('aria-current', 'page')
  await organizer.getByRole('button', { name: 'Rotate page 2' }).click()
  await organizer.getByRole('button', { name: 'Move page 2 down' }).click()
  await expect(organizer.getByRole('button', { name: 'Select page 3' })).toHaveAttribute('aria-current', 'page')
  await page.screenshot({ path: 'output/ui/m33-page-organizer-desktop-minimum.png', fullPage: true })
  await organizer.getByRole('button', { name: 'Delete page 3' }).click()
  await organizer.getByRole('button', { name: 'Select page 2' }).click()
  await expect(organizer).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  expect(errors).toEqual([])
})

test('drags page thumbnails into a new one-step undoable order', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const pageOrder = (organizer: Locator) => organizer.locator('.thumbnail-card').evaluateAll(
    (cards) => cards.map((card) => (card as HTMLElement).dataset.pageReorderId),
  )
  const dragSecondAboveFirst = async (organizer: Locator) => {
    const grip = organizer.getByRole('button', { name: 'Drag page 2 to reorder' })
    const firstCard = organizer.locator('.thumbnail-card').first()
    const [gripBounds, firstBounds] = await Promise.all([grip.boundingBox(), firstCard.boundingBox()])
    if (!gripBounds || !firstBounds) throw new Error('The page grip or first thumbnail is missing.')
    await page.mouse.move(gripBounds.x + gripBounds.width / 2, gripBounds.y + gripBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(firstBounds.x + firstBounds.width / 2, firstBounds.y + 12, { steps: 8 })
    await page.mouse.up()
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  let organizer = await openPageOrganizer(page)
  await expect(organizer.getByText('Drag grip · arrows move one step')).toBeVisible()
  expect(await pageOrder(organizer)).toEqual(['page-1', 'page-2'])
  await dragSecondAboveFirst(organizer)
  await expect.poll(() => pageOrder(organizer)).toEqual(['page-2', 'page-1'])
  await expect(organizer.locator('[data-page-reorder-id="page-1"] .thumbnail-preview')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.canvas-scroll > [data-page-id="page-1"]')).toBeInViewport()
  await page.screenshot({ path: 'output/ui/m34-page-drag-desktop.png', fullPage: true })

  await organizer.getByRole('button', { name: 'Close page organizer' }).click()
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeEnabled()
  await undo.click()
  organizer = await openPageOrganizer(page)
  await expect.poll(() => pageOrder(organizer)).toEqual(['page-1', 'page-2'])
  await expect(page.locator('.canvas-scroll > [data-page-id="page-1"]')).toBeInViewport()
  await organizer.getByRole('button', { name: 'Close page organizer' }).click()

  await page.setViewportSize({ width: 1024, height: 800 })
  organizer = await openPageOrganizer(page)
  const minimumWidthGrip = organizer.getByRole('button', { name: 'Drag page 2 to reorder' })
  const minimumWidthGripBounds = await minimumWidthGrip.boundingBox()
  if (!minimumWidthGripBounds) throw new Error('The minimum-width laptop page grip is missing.')
  expect(minimumWidthGripBounds.width).toBeGreaterThanOrEqual(40)
  expect(minimumWidthGripBounds.height).toBeGreaterThanOrEqual(40)
  await dragSecondAboveFirst(organizer)
  await expect.poll(() => pageOrder(organizer)).toEqual(['page-2', 'page-1'])
  await page.screenshot({ path: 'output/ui/m34-page-drag-desktop-minimum.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  expect(errors).toEqual([])
})

test('keeps the PDF stable while item properties open across supported laptop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const grid = page.locator('.workbench-grid')
  const stage = page.locator('.document-stage')
  const paper = page.locator('.page-mat').first()
  await expect(grid).toHaveClass(/is-paper-focused/)
  await expect(page.locator('.inspector')).toHaveCount(0)
  const paperFocusedStage = await stage.boundingBox()
  const paperFocusedPaper = await paper.boundingBox()
  if (!paperFocusedStage || !paperFocusedPaper) throw new Error('The paper-focused laptop geometry is missing.')

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 140, y: 200 } })
  const inspector = page.locator('.inspector')
  await expect(grid).toHaveClass(/has-item-properties/)
  await expect(inspector).toBeVisible()
  await expect(inspector).toHaveClass(/is-collapsed/)
  const adjust = page.getByRole('button', { name: 'Show item properties' })
  await expect(adjust).toHaveText('Adjust')

  const selectedStage = await stage.boundingBox()
  const selectedPaper = await paper.boundingBox()
  if (!selectedStage || !selectedPaper) throw new Error('Selected laptop geometry is missing.')
  expect(selectedStage.width).toBeCloseTo(paperFocusedStage.width, 0)
  expect(selectedPaper.x).toBeCloseTo(paperFocusedPaper.x, 0)
  expect(selectedPaper.width).toBeCloseTo(paperFocusedPaper.width, 0)

  await adjust.click()
  await expect(inspector).not.toHaveClass(/is-collapsed/)
  const expandedStage = await stage.boundingBox()
  const expandedPaper = await paper.boundingBox()
  if (!expandedStage || !expandedPaper) throw new Error('Expanded laptop geometry is missing.')
  expect(expandedStage.width).toBeCloseTo(paperFocusedStage.width, 0)
  expect(expandedPaper.x).toBeCloseTo(paperFocusedPaper.x, 0)
  expect(expandedPaper.width).toBeCloseTo(paperFocusedPaper.width, 0)

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(inspector).toHaveCount(0)

  await page.setViewportSize({ width: 1440, height: 980 })
  await page.locator('.annotation').first().click()
  await expect(inspector).toHaveClass(/is-collapsed/)
  await page.screenshot({ path: 'output/ui/m35-properties-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Done' }).click()

  await page.setViewportSize({ width: 1024, height: 800 })
  await expect.poll(() => firstPageFitsCanvas(page)).toBe(true)
  await page.locator('.annotation').first().click()
  await expect(inspector).toHaveClass(/is-collapsed/)
  const minimumWidthInspector = await inspector.boundingBox()
  const minimumWidthAdjust = await page.getByRole('button', { name: 'Show item properties' }).boundingBox()
  const minimumWidthDone = await page.getByRole('button', { name: 'Done' }).boundingBox()
  if (!minimumWidthInspector || !minimumWidthAdjust || !minimumWidthDone) throw new Error('Compact minimum-width laptop properties slip is missing.')
  expect(minimumWidthInspector.height).toBeLessThanOrEqual(240)
  expect(minimumWidthAdjust.height).toBeGreaterThanOrEqual(36)
  expect(minimumWidthDone.height).toBeGreaterThanOrEqual(36)
  await page.screenshot({ path: 'output/ui/m35-properties-desktop-minimum.png', fullPage: true })
  await page.getByRole('button', { name: 'Show item properties' }).click()
  const expandedMinimumWidthInspector = await inspector.boundingBox()
  if (!expandedMinimumWidthInspector) throw new Error('Expanded minimum-width laptop properties sheet is missing.')
  expect(expandedMinimumWidthInspector.height).toBeGreaterThan(minimumWidthInspector.height + 80)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
})

test('preserves explicit zoom at the minimum laptop width', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const fit = page.getByRole('button', { name: 'Fit page width' })
  await expect(fit).toHaveAttribute('aria-pressed', 'false')
  const zoom = page.getByRole('status', { name: 'Current zoom' })
  await expect(fit).toHaveText('Fit width')
  await expect(zoom).toHaveText('100%')

  await page.setViewportSize({ width: 1024, height: 800 })
  await expect(fit).toHaveAttribute('aria-pressed', 'false')
  await expect(zoom).toHaveText('100%')

  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(fit).toHaveAttribute('aria-pressed', 'false')
  await expect(zoom).toHaveText('100%')

  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).toHaveText('115%')
  await page.setViewportSize({ width: 1024, height: 800 })
  await expect(fit).toHaveAttribute('aria-pressed', 'false')
  await expect(zoom).toHaveText('115%')

  await fit.click()
  await expect(fit).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => firstPageFitsCanvas(page)).toBe(true)
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect(fit).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => firstPageFitsCanvas(page)).toBe(true)
})

test('keeps desktop tool names readable without ellipsis', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await openAdvancedEditingTools(page)
  for (const name of ['Text marks', 'Whiteout']) {
    const label = page.getByRole('button', { name, exact: true }).locator('.tool-button-label')
    await expect(label).toBeVisible()
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
})

test('creates semantic text review marks and keeps their palette usable on a minimum-width laptop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 980 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await openAdvancedEditingTools(page)
  const textMarks = page.getByRole('button', { name: 'Text marks', exact: true })
  await textMarks.click()
  const palette = page.getByRole('menu', { name: 'Text review marks' })
  await expect(palette).toBeVisible()
  for (const name of ['Highlight', 'Underline', 'Strikeout']) {
    await expect(palette.getByRole('menuitem', { name, exact: true })).toBeVisible()
  }
  await palette.getByRole('menuitem', { name: 'Underline' }).click()
  await expect(page.locator('.tool-placement-hint')).toContainText('Drag across the area to underline')

  const layer = page.locator('.annotation-layer').first()
  let layerBounds = await layer.boundingBox()
  if (!layerBounds) throw new Error('The annotation layer is not visible.')
  await page.mouse.move(layerBounds.x + 100, layerBounds.y + 260)
  await page.mouse.down()
  await page.mouse.move(layerBounds.x + 360, layerBounds.y + 300)
  await page.mouse.up()
  const underline = page.getByRole('button', { name: 'Select underline annotation' })
  await expect(underline).toBeVisible()
  await expect(underline.locator('[data-text-mark="underline"]')).toBeVisible()

  await page.getByRole('button', { name: 'Show item properties' }).click()
  const weight = page.getByLabel('Weight')
  await expect(weight).toHaveValue('2')
  await weight.press('Home')
  for (let step = 0; step < 6; step += 1) await weight.press('ArrowRight')
  await expect(weight).toHaveValue('4')
  await page.screenshot({ path: 'output/ui/m37-text-marks-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Undo' }).click()
  const undoneStrokeWidth = Number(await underline.locator('line').getAttribute('stroke-width'))
  expect(undoneStrokeWidth).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Redo' }).click()
  const redoneStrokeWidth = Number(await underline.locator('line').getAttribute('stroke-width'))
  expect(redoneStrokeWidth).toBeCloseTo(undoneStrokeWidth * 2, 8)

  await page.setViewportSize({ width: 1024, height: 800 })
  await expect.poll(() => firstPageFitsCanvas(page)).toBe(true)
  await openAdvancedEditingTools(page)
  await textMarks.scrollIntoViewIfNeeded()
  await textMarks.click()
  await expect(palette).toBeVisible()
  for (const name of ['Highlight', 'Underline', 'Strikeout']) {
    const item = palette.getByRole('menuitem', { name, exact: true })
    const bounds = await item.boundingBox()
    if (!bounds) throw new Error(`${name} is missing from the minimum-width laptop Text marks palette.`)
    expect(bounds.height).toBeGreaterThanOrEqual(36)
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1024)
  }
  await palette.getByRole('menuitem', { name: 'Strikeout' }).click()
  await expect(page.locator('.tool-placement-hint')).toContainText('Drag across the area to strike out')

  layerBounds = await layer.boundingBox()
  if (!layerBounds) throw new Error('The fitted minimum-width laptop paper is missing.')
  await page.mouse.move(layerBounds.x + layerBounds.width * 0.2, layerBounds.y + layerBounds.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(layerBounds.x + layerBounds.width * 0.72, layerBounds.y + layerBounds.height * 0.56)
  await page.mouse.up()
  const strikeout = page.getByRole('button', { name: 'Select strikeout annotation' })
  await expect(strikeout).toBeVisible()
  await expect(strikeout.locator('[data-text-mark="strikeout"]')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  await page.screenshot({ path: 'output/ui/m37-text-marks-desktop-minimum.png', fullPage: true })
})

test('keeps the paper visible while dragging a signature on a minimum-width laptop', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fit page width' })).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => firstPageFitsCanvas(page)).toBe(true)

  const layer = page.locator('.annotation-layer').first()
  const layerBounds = await layer.boundingBox()
  if (!layerBounds) throw new Error('The fitted minimum-width laptop paper is missing.')
  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('tab', { name: 'Type' }).click()
  await page.getByLabel('Name for signature').fill('Alex Morgan')
  await page.getByRole('button', { name: 'Place signature' }).click()
  await placePendingMedia(page, 'signature', {
    x: layerBounds.width * 0.35,
    y: layerBounds.height * 0.34,
  }, layer)

  const inspector = page.locator('.inspector')
  await expect(inspector).toHaveClass(/is-collapsed/)
  const slipBounds = await inspector.boundingBox()
  if (!slipBounds) throw new Error('The compact properties slip is missing.')
  expect(slipBounds.height).toBeLessThanOrEqual(240)
  expect(slipBounds.x).toBeGreaterThan(layerBounds.x + layerBounds.width / 2)

  const signature = page.getByRole('button', { name: 'Select signature annotation' })
  const before = await signature.boundingBox()
  if (!before) throw new Error('The minimum-width laptop signature is missing.')
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 25, before.y + before.height / 2 + 15, { steps: 8 })
  await page.mouse.up()
  const after = await signature.boundingBox()
  if (!after) throw new Error('The minimum-width laptop signature disappeared after dragging.')
  expect(after.x).toBeGreaterThan(before.x + 10)
  expect(after.y).toBeGreaterThan(before.y + 5)
  await expect(inspector).toHaveClass(/is-collapsed/)
  await expect.poll(() => firstPageFitsCanvas(page)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
})
