import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test('edits inline, annotates, and exports a PDF', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Annotate and sign PDFs.' })).toBeVisible()

  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByText('mvp-fixture.pdf')).toBeVisible()
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').click({ position: { x: 160, y: 180 } })
  const text = page.locator('.text-annotation')
  const inlineText = page.getByLabel('Edit text')
  await expect(text).toBeVisible()
  await expect(inlineText).toBeFocused()
  await inlineText.fill('Reviewed locally')
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

  await page.locator('input[accept="image/png,image/jpeg"]').setInputFiles({
    name: 'stamp.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })
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
  await expect(page.getByRole('button', { name: 'Resize item', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Highlight' }).click()
  const layer = page.locator('.annotation-layer')
  const layerBounds = await layer.boundingBox()
  if (!layerBounds) throw new Error('The annotation layer is not visible.')
  await page.mouse.move(layerBounds.x + 90, layerBounds.y + 330)
  await page.mouse.down()
  await page.mouse.move(layerBounds.x + 280, layerBounds.y + 360)
  await page.mouse.up()
  await expect(page.locator('.highlight-annotation')).toBeVisible()

  await page.getByRole('button', { name: 'Draw' }).click()
  await page.mouse.move(layerBounds.x + 120, layerBounds.y + 420)
  await page.mouse.down()
  await page.mouse.move(layerBounds.x + 230, layerBounds.y + 460, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('.ink-annotation')).toBeVisible()
  await expect(page.getByText('5 items added')).toBeVisible()

  await page.getByRole('button', { name: 'Rotate page 2' }).click()
  await expect(page.getByText('5 items added')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PDF/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('mvp-fixture-edited.pdf')
  mkdirSync('output/pdf', { recursive: true })
  await download.saveAs('output/pdf/mvp-fixture-edited.pdf')
})

test('requires confirmation before rebuilding a PDF that has form fields', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/edge-form.pdf')
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()

  // Reordering cannot be expressed without rebuilding, which would drop the form.
  await page.getByRole('button', { name: 'Move page 2 up' }).click()

  await page.getByRole('button', { name: /Export PDF/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Interactive form fields')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()

  // Cancelling must not produce a file.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  // Accepting exports the disclosed compatibility copy.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PDF/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Export compatibility copy' }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  await download.saveAs('output/pdf/edge-form-compatibility-copy.pdf')
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
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()

  // Unicode text, which is the only path that loads a font file. It must come from
  // our own origin, never from Google Fonts.
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').click({ position: { x: 140, y: 300 } })
  await page.getByLabel('Edit text').fill('مرحبا')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PDF/ }).click()
  await downloadPromise

  expect(foreign).toEqual([])
})

test('moves a selected annotation with the keyboard alone', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').click({ position: { x: 160, y: 300 } })
  const annotation = page.locator('.text-annotation')
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

test('traps focus inside the signature dialog and restores it on Escape', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()

  const opener = page.getByRole('button', { name: 'Add signature' })
  await opener.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog.getByRole('button', { name: 'Clear' })).toBeFocused()
  await expect(page.getByLabel('Signature drawing area')).toBeVisible()

  // Tab from the last control must wrap to the first, never escape the dialog.
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('tab', { name: 'Draw' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(opener).toBeFocused()
})

test('uses the complete fill, sign, transform, layer, marks, and recovery workflow', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()
  const layer = page.locator('.annotation-layer')
  const bounds = await layer.boundingBox()
  if (!bounds) throw new Error('The annotation layer is not visible.')

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
    await page.getByRole('button', { name: 'Shapes' }).click()
    await page.getByRole('menuitem', { name }).click()
    await page.mouse.move(bounds.x + start.x, bounds.y + start.y)
    await page.mouse.down()
    await page.mouse.move(bounds.x + end.x, bounds.y + end.y)
    await page.mouse.up()
  }
  await expect(page.locator('.shape-annotation')).toHaveCount(4)

  await page.getByRole('button', { name: 'Fill symbols' }).click()
  await page.getByRole('menuitem', { name: 'Add checkmark' }).click()
  await layer.click({ position: { x: 330, y: 245 } })
  await expect(page.locator('.stamp-annotation')).toBeVisible()
  for (const [name, position] of [
    ['Add cross', { x: 370, y: 300 }],
    ['Add dot', { x: 420, y: 345 }],
    ['Add date', { x: 280, y: 390 }],
  ] as const) {
    await page.getByRole('button', { name: 'Fill symbols' }).click()
    await page.getByRole('menuitem', { name }).click()
    await layer.click({ position })
  }
  await expect(page.locator('.stamp-annotation')).toHaveCount(4)
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.locator('.stamp-annotation')).toHaveCount(5)
  await page.getByRole('button', { name: 'Send backward' }).click()
  await page.getByRole('button', { name: 'Copy' }).click()
  await page.getByRole('button', { name: 'Paste' }).click()
  await expect(page.locator('.stamp-annotation')).toHaveCount(6)

  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('tab', { name: 'Type' }).click()
  await page.getByLabel('Name for signature').fill('Syed A')
  await page.getByLabel('Save this signature for reuse on this device').check()
  await page.getByRole('button', { name: 'Place signature' }).click()
  await expect(page.locator('.image-annotation')).toBeVisible()
  await page.getByRole('button', { name: 'Add signature' }).click()
  await expect(page.getByRole('button', { name: /Place saved signature Signature 1/ })).toBeVisible()
  await page.getByRole('button', { name: /Place saved signature Signature 1/ }).click()
  await expect(page.locator('.image-annotation')).toHaveCount(2)

  await page.getByRole('button', { name: 'Add signature' }).click()
  const drawnCanvas = page.locator('.signature-dialog canvas')
  const drawnBounds = await drawnCanvas.boundingBox()
  if (!drawnBounds) throw new Error('Drawn-signature canvas is missing.')
  await page.mouse.move(drawnBounds.x + 70, drawnBounds.y + 80)
  await page.mouse.down()
  await page.mouse.move(drawnBounds.x + 220, drawnBounds.y + 105, { steps: 6 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Place signature' }).click()

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
  await expect(page.locator('.image-annotation')).toHaveCount(4)

  await page.getByRole('button', { name: 'Document marks' }).click()
  await page.getByLabel('Watermark text').fill('INTERNAL')
  await page.getByLabel('All pages').check()
  await page.getByRole('button', { name: 'Add watermark' }).click()
  await expect.poll(() => page.getByLabel('Edit text').evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value))).toContain('INTERNAL')

  await page.getByRole('button', { name: 'Document marks' }).click()
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
  await expect(page.getByRole('heading', { name: 'Annotate and sign PDFs.' })).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  const recovery = page.getByRole('dialog', { name: /Resume your previous editing session/ })
  await expect(recovery).toBeVisible()
  await recovery.getByRole('button', { name: 'Restore edits' }).click()
  await expect(page.locator('.shape-annotation')).toHaveCount(4)
  await expect.poll(() => page.getByLabel('Edit text').evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value))).toContain('INTERNAL')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PDF/ }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  await download.saveAs('output/pdf/complete-workflow-edited.pdf')
  await expect(page.getByRole('button', { name: /Export PDF/ })).toBeEnabled()

  // Exporting the current document clears recovery; reopening the same source must
  // not offer the already-exported annotations as an unsaved session.
  await page.reload()
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()
  await expect(page.getByRole('dialog', { name: /Resume your previous editing session/ })).toBeHidden()
})

test('keeps document marks reachable at the 320px minimum viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()
  const marks = page.getByRole('button', { name: 'Marks' })
  await expect(marks).toBeVisible()
  await marks.click()
  await expect(page.getByRole('dialog', { name: 'Add marks to this PDF' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('protects unsaved edits and collapses a typing session into one undo', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()

  // A clean session closes without any prompt.
  await page.getByRole('button', { name: /Close document/ }).click()
  await expect(page.getByRole('heading', { name: 'Annotate and sign PDFs.' })).toBeVisible()

  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').click({ position: { x: 140, y: 200 } })
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
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()

  await page.getByRole('button', { name: /Close document/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByRole('heading', { name: 'Annotate and sign PDFs.' })).toBeVisible()
})

test('keeps the main thread responsive while exporting a 100-page PDF', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/edge-100-pages.pdf')
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()
  await expect(page.getByText('100 pages')).toBeVisible()

  // Arabic text forces the heaviest export path: fontkit loads, the Arabic font is
  // parsed, shaped, and subset. If anything blocks the UI, this is where it shows.
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').click({ position: { x: 120, y: 160 } })
  await expect(page.locator('.text-annotation')).toBeVisible()
  await page.getByLabel('Edit text').fill('مرحبا بالعالم')

  // A second script embeds a second font, so the export spans a window long enough
  // for a starved 100 ms interval to be unmistakable.
  await page.getByRole('button', { name: 'Select page 2', exact: true }).click()
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').click({ position: { x: 120, y: 200 } })
  await page.getByLabel('Edit text').fill('नमस्ते दुनिया')

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
  await page.getByRole('button', { name: /Export PDF/ }).click()
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

  // The window must be long enough for starvation to be detectable at all.
  expect(exportWallMs).toBeGreaterThan(300)
  // Compared against wall-clock time, not against its own timestamps: a blocked main
  // thread would still show a long `elapsed` but almost no ticks.
  const tickableWindows = Math.floor(exportWallMs / 100)
  expect(ticks).toBeGreaterThanOrEqual(tickableWindows - 1)
  expect(ticks).toBeGreaterThanOrEqual(3)
  // A synchronous export would leave one gap as long as the export itself.
  expect(maxGap).toBeLessThan(250)
  expect(elapsed).toBeGreaterThan(0)
  mkdirSync('output/pdf', { recursive: true })
  await download.saveAs('output/pdf/edge-100-pages-edited.pdf')
})

test('drags ink by its points and keeps an image inside the page', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page')).toBeVisible()

  const layer = page.locator('.annotation-layer')
  const layerBounds = await layer.boundingBox()
  if (!layerBounds) throw new Error('The annotation layer is not visible.')

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
  const signatureCanvas = page.locator('.signature-dialog canvas')
  const signatureBounds = await signatureCanvas.boundingBox()
  if (!signatureBounds) throw new Error('Signature canvas is not visible.')
  await page.mouse.move(signatureBounds.x + 80, signatureBounds.y + 100)
  await page.mouse.down()
  await page.mouse.move(signatureBounds.x + 200, signatureBounds.y + 60, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Place signature' }).click()

  const image = page.getByRole('button', { name: 'Select image annotation' })
  const imageBounds = await image.boundingBox()
  if (!imageBounds) throw new Error('The placed image is not visible.')
  await page.mouse.move(imageBounds.x + imageBounds.width / 2, imageBounds.y + imageBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(layerBounds.x + layerBounds.width + 400, layerBounds.y + layerBounds.height + 400, { steps: 12 })
  await page.mouse.up()

  const movedBounds = await image.boundingBox()
  if (!movedBounds) throw new Error('The moved image is not visible.')
  expect(movedBounds.x + movedBounds.width).toBeLessThanOrEqual(layerBounds.x + layerBounds.width + 1)
  expect(movedBounds.y + movedBounds.height).toBeLessThanOrEqual(layerBounds.y + layerBounds.height + 1)
  expect(movedBounds.x).toBeGreaterThanOrEqual(layerBounds.x - 1)
  expect(movedBounds.y).toBeGreaterThanOrEqual(layerBounds.y - 1)
})
