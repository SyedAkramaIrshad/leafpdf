import { expect, test } from '@playwright/test'

/**
 * Generates the README screenshots deterministically. Not part of the test
 * suite: run on demand with
 *
 *     LEAFPDF_SCREENSHOTS=1 npx playwright test screenshots
 */
test.skip(!process.env.LEAFPDF_SCREENSHOTS, 'screenshots are generated on demand, not on every run')

test('captures the README screenshots', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Annotate and sign PDFs.' })).toBeVisible()
  await page.screenshot({ path: 'docs/screenshots/leafpdf-landing.png' })

  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  // Added text, styled.
  await page.getByRole('button', { name: 'Add text' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 118, y: 186 } })
  await page.getByLabel('Edit text').fill('Reviewed and approved')
  await page.getByLabel('Font family').selectOption('serif')
  await page.getByRole('button', { name: 'Bold' }).click()

  // A checkmark in the approval area.
  await page.getByRole('button', { name: 'Fill symbols' }).click()
  await page.getByRole('menuitem', { name: 'Add checkmark' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 640, y: 330 } })

  // A typed signature.
  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('tab', { name: 'Type' }).click()
  await page.getByLabel('Name for signature').fill('Syed Akrama')
  await page.getByRole('button', { name: 'Place signature' }).click()
  await expect(page.locator('.image-annotation').first()).toBeVisible()

  // Show find-in-document doing real work.
  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('approval')
  await search.press('Enter')
  await expect(page.getByText(/1 match/)).toBeVisible()

  // Let the strip and thumbnails settle, then shoot.
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'docs/screenshots/leafpdf-editor.jpg', type: 'jpeg', quality: 90 })
})
