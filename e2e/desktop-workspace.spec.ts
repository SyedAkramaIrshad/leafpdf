import { readFileSync } from 'node:fs'
import { expect, test, type Locator } from '@playwright/test'

async function reachable(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 })
  expect(await control.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  })).toBe(true)
}

test('keeps Find and Fields reachable while filling and signing in a narrow desktop pane', async ({ page }) => {
  await page.setViewportSize({ width: 738, height: 700 })
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/edge-form.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  const guide = page.getByRole('region', { name: 'Fillable field guide' })
  await expect(guide).toBeVisible()
  await reachable(page.getByRole('searchbox', { name: 'Find text in document' }))
  await reachable(page.getByRole('button', { name: 'Fields', exact: true }))
  await reachable(page.getByRole('button', { name: 'Fit page width' }))
  await guide.getByRole('button', { name: 'Start at first field' }).click()
  await page.getByLabel('Form field owner.name').fill('Alex Rivera')
  await page.getByRole('button', { name: 'Add signature' }).click()
  const dialog = page.getByRole('dialog')
  await page.getByLabel('Name for signature').fill('Alex Rivera')
  const place = dialog.getByRole('button', { name: 'Place signature' })
  await place.scrollIntoViewIfNeeded()
  await reachable(place)
  await place.click()
  await reachable(page.getByRole('button', { name: 'Fit page width' }))
  await page.locator('.annotation-layer').first().click({ position: { x: 90, y: 350 } })
  await expect(page.getByRole('button', { name: 'Select signature annotation' })).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
})

for (const width of [738, 1024]) {
  test(`keeps desktop editing controls usable in a ${width}px window`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    await page.goto('/')
    await reachable(page.getByRole('button', { name: 'Choose a PDF' }))
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'A very long employment agreement filename for a narrow desktop window.pdf',
      mimeType: 'application/pdf',
      buffer: readFileSync('tmp/pdfs/mvp-fixture.pdf'),
    })
    await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    for (const name of ['Undo', 'Redo', 'Document tools', 'Save PDF', 'Choose PDF output', 'Add text', 'Fit page width']) {
      await reachable(page.getByRole('button', { name, exact: true }))
    }
    await expect(page.getByRole('status', { name: 'Current zoom' })).toHaveText('100%')
    await expect(page.getByRole('button', { name: 'Fit page width' })).toHaveText('Fit width')
    await page.getByRole('button', { name: 'Document tools' }).click()
    await reachable(page.getByRole('menuitem', { name: 'Help & shortcuts' }))
    await page.keyboard.press('Escape')

    const search = page.getByRole('searchbox', { name: 'Find text in document' })
    await search.fill('PDF')
    await search.press('Enter')
    await reachable(page.getByRole('button', { name: 'Replace', exact: true }))
    await reachable(page.getByRole('button', { name: 'Next match' }))
    await reachable(page.getByRole('button', { name: 'Zoom in' }))
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await search.fill('')

    const paper = page.locator('.page-mat').first()
    const before = await paper.boundingBox()
    await page.getByRole('button', { name: 'Add text' }).click()
    await page.locator('.annotation-layer').first().click({ position: { x: 80, y: 160 } })
    await page.getByLabel('Edit text').fill('Desktop review')
    const inspector = page.locator('.inspector')
    const bounds = await inspector.boundingBox()
    expect(bounds?.height).toBeLessThanOrEqual(185)
    for (const name of ['Delete', 'Done', 'Show item properties', 'Align selected item bottom on page']) {
      await reachable(inspector.getByRole('button', { name, exact: true }))
    }
    const after = await paper.boundingBox()
    expect(after?.x).toBeCloseTo(before!.x, 0)
    expect(after?.width).toBeCloseTo(before!.width, 0)
    await page.screenshot({ path: `output/ui/desktop-workspace-${width}.png` })
    await inspector.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(page.getByLabel('Edit text')).toHaveValue('Desktop review')
    await page.getByLabel('Edit text').press('Enter')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
  })
}
