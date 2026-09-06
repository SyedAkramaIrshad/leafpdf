import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

async function openProjectTool(page: import('@playwright/test').Page, name: string | RegExp) {
  await page.getByRole('button', { name: 'Document tools' }).click()
  await page.getByRole('menuitem', { name }).click()
}

test('opens project tools from Document with full keyboard navigation', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 140, y: 180 } })
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()

  const more = page.getByRole('button', { name: 'Document tools' })
  await expect(more).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Privacy check' })).toHaveCount(0)

  await more.click()
  const saveProject = page.getByRole('menuitem', { name: 'Save project' })
  const review = page.getByRole('menuitem', { name: 'Review comments' })
  const privacy = page.getByRole('menuitem', { name: 'Privacy check' })
  await expect(saveProject).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(review).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(privacy).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('menuitem', { name: 'Help & shortcuts' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
  await expect(privacy).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()

  await more.click()
  await page.getByRole('menuitem', { name: 'Privacy check' }).click()
  await expect(page.locator('.privacy-panel')).toBeVisible()
})

test('explains how to finish, save, export, and inspect the source', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 140, y: 180 } })
  await page.getByRole('button', { name: 'Show item properties' }).click()
  await page.getByRole('button', { name: 'Duplicate' }).click()
  const toast = page.locator('.toast')
  await expect(toast).toBeVisible()

  await openProjectTool(page, 'Help & shortcuts')
  const help = page.getByRole('complementary', { name: 'Finish and save' })
  await expect(help).toBeVisible()
  const helpBounds = await help.boundingBox()
  const toastBounds = await toast.boundingBox()
  if (!helpBounds || !toastBounds) throw new Error('Help and its completion notice must both be measurable.')
  expect(toastBounds.x + toastBounds.width).toBeLessThanOrEqual(helpBounds.x - 8)
  for (const step of ['Add what is missing', 'Choose Done', 'Save PDF']) {
    await expect(help.getByText(step, { exact: true }).first()).toBeVisible()
  }
  await expect(help).toContainText('Open My details to place Full name, Email, Phone, Company, or Address without retyping.')
  await expect(help).toContainText('Save on this device is explicit and browser-only')
  await expect(help.getByRole('heading', { level: 3, name: 'Save project' })).toBeVisible()
  await expect(help.getByRole('heading', { level: 3, name: 'Save fillable PDF' })).toBeVisible()
  await expect(help.getByRole('heading', { level: 3, name: 'Save flattened PDF' })).toBeVisible()
  await expect(help.getByRole('link', { name: 'View LeafPDF source on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/SyedAkramaIrshad/leafpdf',
  )

  await help.getByRole('button', { name: 'Close finishing help' }).click()
  await expect(help).toHaveCount(0)

  await page.keyboard.press('Shift+/')
  await expect(page.getByRole('complementary', { name: 'Finish and save' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Finish and save' })).toHaveCount(0)

  const find = page.getByRole('searchbox', { name: 'Find text in document' })
  await find.fill('')
  await find.pressSequentially('?')
  await expect(find).toHaveValue('?')
  await expect(page.getByRole('complementary', { name: 'Finish and save' })).toHaveCount(0)
})

test('exports review comments as standard PDF annotations and imports them again', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await openProjectTool(page, /^Review comments/)
  await page.getByPlaceholder('Add a review note').fill('Interoperable review note')
  await page.getByPlaceholder('Optional').fill('LeafPDF reviewer')
  await page.getByRole('button', { name: 'Add comment' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save PDF/ }).click()
  const download = await downloadPromise
  mkdirSync('output/pdf', { recursive: true })
  const exportedPath = 'output/pdf/mvp-with-standard-comment.pdf'
  await download.saveAs(exportedPath)

  page.once('dialog', (dialog) => void dialog.accept())
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(exportedPath)
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await openProjectTool(page, /^Review comments/)
  await page.getByRole('button', { name: 'Import PDF comments' }).click()
  await expect(page.getByText('Interoperable review note')).toBeVisible()
  await expect(page.getByText(/LeafPDF reviewer/)).toBeVisible()
})

test('creates a sanitized copy whose metadata is no longer detected', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/edge-metadata.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await openProjectTool(page, 'Privacy check')
  const privacy = page.locator('.privacy-panel')
  await expect(privacy).toBeVisible()
  await expect(privacy.getByText('Document metadata', { exact: true })).toBeVisible()
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
  await openProjectTool(page, 'Privacy check')
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

  await openProjectTool(page, 'Recognize text (OCR)')
  await page.getByRole('button', { name: 'Recognize this page' }).click()
  await expect(page.getByRole('textbox', { name: 'OCR word 1' })).toHaveValue('Local OCR phrase')

  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('Local OCR phrase')
  await search.press('Enter')
  await expect(page.getByText('1 match · page 1 · 1 of 1')).toBeVisible()
  await expect(page.locator('.search-match')).toHaveCount(0)
  await page.getByRole('button', { name: 'Replace', exact: true }).click()
  const replace = page.getByRole('dialog', { name: 'Find and replace' })
  await expect(replace.getByText(/1 OCR-only match cannot be replaced automatically/)).toBeVisible()
  await replace.getByRole('textbox', { name: 'Replacement text' }).fill('Reviewed OCR phrase')
  await expect(replace.getByRole('button', { name: 'Replace this match' })).toBeDisabled()
  await expect(replace.getByRole('button', { name: 'Replace all 0 source matches' })).toBeDisabled()
  await expect(page.locator('.whiteout-annotation')).toHaveCount(0)
  await expect(page.locator('[data-source-replacement="true"]')).toHaveCount(0)
})

test('compares another PDF locally and navigates changed pages', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await openProjectTool(page, 'Compare PDFs')
  await page.locator('.comparison-panel input[type="file"]').setInputFiles('tmp/pdfs/edge-metadata.pdf')
  const panel = page.locator('.comparison-panel')
  await expect(panel.getByText(/changed page/)).toBeVisible()
  await expect(panel.getByText(/text similarity/).first()).toBeVisible()
  await panel.getByRole('button', { name: /Page 1/ }).click()
  await expect(page.getByRole('button', { name: /^Open page organizer, page/ })).toHaveAccessibleName(
    'Open page organizer, page 1 of 2',
  )
})
