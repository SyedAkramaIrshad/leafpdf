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
  await expect(page.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeVisible()
  await page.screenshot({ path: 'docs/screenshots/leafpdf-landing.png' })

  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  // Fill the fixture's approval area with the same everyday details featured on the landing page.
  const details = page.getByRole('button', { name: 'My details' })
  await details.scrollIntoViewIfNeeded()
  await details.click()
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Alex Morgan')
  await page.getByRole('button', { name: 'Place Full name' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 170, y: 316 } })
  const owner = page.getByLabel('Edit text')
  await expect(owner).toHaveValue('Alex Morgan')
  await page.getByRole('button', { name: 'Show item properties' }).click()
  await page.getByRole('spinbutton', { name: 'Font size' }).fill('13')
  await owner.press('Enter')

  // A status checkmark.
  await page.getByRole('button', { name: 'Add checkmark' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 170, y: 355 } })

  // An exact, human-readable date.
  await page.getByRole('button', { name: 'Add date' }).click()
  await page.locator('.annotation-layer').first().click({ position: { x: 170, y: 370 } })
  await page.getByRole('button', { name: 'Show item properties' }).click()
  await page.getByLabel('Calendar date').fill('2026-08-29')
  await page.getByRole('button', { name: 'Day month date format' }).click()
  await page.getByRole('button', { name: 'Done' }).click()

  // A typed signature.
  await page.getByRole('button', { name: 'Add signature' }).click()
  await page.getByRole('tab', { name: 'Type' }).click()
  await page.getByLabel('Name for signature').fill('Alex Morgan')
  await page.getByRole('button', { name: 'Place signature' }).click()
  const signaturePosition = { x: 300, y: 570 }
  await expect(page.getByText('Click where the signature should go')).toBeVisible()
  await page.locator('.annotation-layer').first().hover({ position: signaturePosition })
  await expect(page.getByRole('img', { name: 'Signature placement preview' })).toBeVisible()
  await page.locator('.annotation-layer').first().click({ position: signaturePosition })
  await expect(page.getByRole('heading', { level: 2, name: 'Signature' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  // Show find-in-document doing real work.
  const search = page.getByRole('searchbox', { name: 'Find text in document' })
  await search.fill('approval')
  await search.press('Enter')
  await expect(page.getByText(/1 match/)).toBeVisible()
  const dismissNotice = page.getByRole('button', { name: 'Dismiss notification' })
  if (await dismissNotice.isVisible()) await dismissNotice.click()

  // Let the strip and thumbnails settle, then shoot the finished state.
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'docs/screenshots/leafpdf-editor.jpg', type: 'jpeg', quality: 90 })
})
