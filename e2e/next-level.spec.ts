import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test('exports review comments as standard PDF annotations and imports them again', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: /^Review/ }).click()
  await page.getByPlaceholder('Add a review note').fill('Interoperable review note')
  await page.getByPlaceholder('Optional').fill('LeafPDF reviewer')
  await page.getByRole('button', { name: 'Add comment' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PDF/ }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const exportedPath = 'output/pdf/mvp-with-standard-comment.pdf'
  await download.saveAs(exportedPath)

  page.once('dialog', (dialog) => void dialog.accept())
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await page.getByRole('button', { name: /^Review/ }).click()
  await page.getByRole('button', { name: 'Import PDF comments' }).click()
  await expect(page.getByText('Interoperable review note')).toBeVisible()
  await expect(page.getByText(/LeafPDF reviewer/)).toBeVisible()
})

test('creates a sanitized copy whose metadata is no longer detected', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/edge-metadata.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Privacy' }).click()
  const privacy = page.locator('.privacy-panel')
  await expect(privacy).toBeVisible()
  await expect(privacy.getByText('Document metadata')).toBeVisible()
  await expect(privacy.getByText(/metadata is present/i)).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await privacy.getByRole('button', { name: 'Export sanitized copy' }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const sanitizedPath = 'output/pdf/edge-metadata-sanitized.pdf'
  await download.saveAs(sanitizedPath)

  await page.getByRole('button', { name: /Close document/ }).click()
  await page.locator('input[type="file"]').first().setInputFiles(sanitizedPath)
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await page.getByRole('button', { name: 'Privacy' }).click()
  await expect(page.locator('.privacy-panel').getByText(/No user-authored document metadata was detected/)).toBeVisible()
})

test('runs browser-local OCR, lets the user review it, and includes it in search', async ({ page }) => {
  await page.addInitScript(() => {
    class MockTextDetector {
      async detect() {
        return [{
          rawValue: 'Local OCR phrase',
          boundingBox: { x: 100, y: 80, width: 220, height: 36 },
        }]
      }
    }
    Object.defineProperty(window, 'TextDetector', { value: MockTextDetector, configurable: true })
  })

  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'OCR' }).click()
  await page.getByRole('button', { name: 'Recognize this page' }).click()
  await expect(page.getByRole('textbox', { name: 'OCR word 1' })).toHaveValue('Local OCR phrase')

  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('Local OCR phrase')
  await search.press('Enter')
  await expect(page.getByText(/1 match · page 1/)).toBeVisible()
})

test('compares another PDF locally and navigates changed pages', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Compare' }).click()
  await page.locator('.comparison-panel input[type="file"]').setInputFiles('tmp/pdfs/edge-metadata.pdf')
  const panel = page.locator('.comparison-panel')
  await expect(panel.getByText(/changed page/)).toBeVisible()
  await expect(panel.getByText(/text similarity/).first()).toBeVisible()
  await panel.getByRole('button', { name: /Page 1/ }).click()
  await expect(page.getByText('PAGE 1 / 2')).toBeVisible()
})
