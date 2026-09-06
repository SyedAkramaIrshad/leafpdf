import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

async function openAdvancedEditingTools(page: Page) {
  const more = page.getByRole('button', { name: 'More editing tools' })
  if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
}

test('burns a rotated redaction into the same pixels shown by the editor', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  const layer = page.locator('.annotation-layer').first()
  const placementLayerBounds = await layer.boundingBox()
  if (!placementLayerBounds) throw new Error('The annotation layer is not visible.')

  // Draw in a deliberately empty part of the fixture, leaving enough room on the
  // left for a near-right-angle rotation around the box's top-left pivot.
  await openAdvancedEditingTools(page)
  await page.getByRole('button', { name: 'Redact' }).click()
  await page.mouse.move(placementLayerBounds.x + 260, placementLayerBounds.y + 470)
  await page.mouse.down()
  await page.mouse.move(placementLayerBounds.x + 500, placementLayerBounds.y + 550)
  await page.mouse.up()

  const redaction = page.locator('.redaction-annotation')
  await expect(redaction).toBeVisible()
  const unrotated = await redaction.boundingBox()
  const selectedLayerBounds = await layer.boundingBox()
  if (!unrotated || !selectedLayerBounds) throw new Error('The redaction box is not measurable.')

  // The selected redaction opens the adaptive inspector, so derive export sample
  // points from the page's current screen-space bounds rather than the placement frame.
  const pivotX = (unrotated.x - selectedLayerBounds.x) / selectedLayerBounds.width
  const pivotY = (unrotated.y - selectedLayerBounds.y) / selectedLayerBounds.height
  const width = unrotated.width / selectedLayerBounds.width
  const height = unrotated.height / selectedLayerBounds.height

  const handle = page.getByRole('button', { name: 'Rotate item' })
  const handleBounds = await handle.boundingBox()
  if (!handleBounds) throw new Error('The redaction rotation handle is missing.')

  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2,
  )
  await page.mouse.down()
  // The transform pivot is the redaction's top-left. Browser handle geometry can
  // make this a few degrees beyond 90; the pixel proof below uses the exact angle
  // actually displayed rather than assuming an idealized pointer result.
  await page.mouse.move(unrotated.x, unrotated.y + unrotated.width / 2, { steps: 8 })
  await page.mouse.up()

  const transform = await redaction.evaluate((element) => (element as HTMLElement).style.transform)
  const match = /rotate\((-?[\d.]+)deg\)/.exec(transform)
  if (!match) throw new Error(`The redaction did not expose a rotation: ${transform}`)
  const angle = Number(match[1])
  expect(angle).toBeGreaterThan(70)
  expect(angle).toBeLessThan(120)

  const radians = angle * Math.PI / 180
  const localCenterX = width / 2
  const localCenterY = height / 2
  const expectedBlack = {
    x: pivotX + Math.cos(radians) * localCenterX - Math.sin(radians) * localCenterY,
    y: pivotY + Math.sin(radians) * localCenterX + Math.cos(radians) * localCenterY,
  }
  // This point was covered by the old axis-aligned implementation but is well
  // outside the rotated box. It should remain the fixture's white background.
  const expectedWhite = {
    x: pivotX + width * 0.72,
    y: pivotY + height * 0.5,
  }

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const exportedPath = 'output/pdf/rotated-redaction-edited.pdf'
  await download.saveAs(exportedPath)

  await page.getByRole('button', { name: /Close document/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  const canvas = page.getByLabel('Rendered PDF page').first()
  await expect(canvas).toBeVisible()

  // The canvas element becomes visible before PDF.js finishes its asynchronous
  // paint. Poll the exact exported pixels so this proves geometry rather than a
  // transient blank canvas; a wrong export still times out with false values.
  await expect.poll(() => canvas.evaluate((node, points) => {
    const target = node as HTMLCanvasElement
    const context = target.getContext('2d')
    if (!context) throw new Error('The exported page canvas has no 2D context.')
    const sample = (point: { x: number; y: number }) => {
      const x = Math.max(0, Math.min(target.width - 1, Math.round(point.x * target.width)))
      const y = Math.max(0, Math.min(target.height - 1, Math.round(point.y * target.height)))
      return Array.from(context.getImageData(x, y, 1, 1).data)
    }
    const black = sample(points.black)
    const white = sample(points.white)
    return {
      blackRgb: black.slice(0, 3).every((channel) => channel < 20),
      blackAlpha: black[3] === 255,
      whiteRgb: white.slice(0, 3).every((channel) => channel > 225),
    }
  }, { black: expectedBlack, white: expectedWhite }), { timeout: 5_000 }).toEqual({
    blackRgb: true,
    blackAlpha: true,
    whiteRgb: true,
  })
})
