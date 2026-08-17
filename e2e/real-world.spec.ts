import { existsSync, mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/**
 * Real-world documents, not synthetic fixtures. They are not committed; fetch
 * them from their official sources into tmp/pdfs/real/ to enable these tests:
 *
 *   curl -sSLo tmp/pdfs/real/fw9.pdf https://www.irs.gov/pub/irs-pdf/fw9.pdf
 *   curl -sSLo tmp/pdfs/real/pdf-spec.pdf https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf
 *
 * fw9.pdf: 6 pages, 27 hierarchically named AcroForm fields, XFA hybrid.
 * pdf-spec.pdf: 756 pages, outlines, page labels, structure tree, OpenAction.
 */
const W9 = 'tmp/pdfs/real/fw9.pdf'
const SPEC = 'tmp/pdfs/real/pdf-spec.pdf'

test.describe('IRS W-9 (XFA-hybrid AcroForm)', () => {
  test.skip(!existsSync(W9), 'fw9.pdf not downloaded')

  test('fills hierarchical fields and the values survive the export', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[type="file"]').first().setInputFiles(W9)
    await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
    await expect(page.getByText('6 pages')).toBeVisible()

    // The name line (f1_01) and one federal-classification checkbox (c1_1[0]).
    const nameField = page.getByLabel('Form field topmostSubform[0].Page1[0].f1_01[0]')
    await expect(nameField).toBeVisible()
    await nameField.fill('Syed Akrama Irshad')
    const checkbox = page.getByLabel('Form field topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[0]', { exact: true }).first()
    await checkbox.check()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Export PDF/ }).click()
    const download = await downloadPromise
    mkdirSync('output/pdf', { recursive: true })
    await download.saveAs('output/pdf/fw9-filled.pdf')

    // Reopen our own export: the value must come back out of the real field.
    await page.getByRole('button', { name: /Close document/ }).click()
    await page.locator('input[type="file"]').first().setInputFiles('output/pdf/fw9-filled.pdf')
    await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
    await expect(page.getByLabel('Form field topmostSubform[0].Page1[0].f1_01[0]')).toHaveValue('Syed Akrama Irshad')
    await expect(page.getByLabel('Form field topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[0]', { exact: true }).first()).toBeChecked()
  })
})

test.describe('PDF 32000 specification (756 pages, full catalog)', () => {
  test.skip(!existsSync(SPEC), 'pdf-spec.pdf not downloaded')

  test('opens, scrolls, and searches 756 pages, and refuses export because it is encrypted', async ({ page }) => {
    test.setTimeout(300_000)
    await page.goto('/')
    await page.locator('input[type="file"]').first().setInputFiles(SPEC)
    await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText('756 pages')).toBeVisible()

    // This document is a permissions-only encrypted PDF (empty user password):
    // it displays everywhere, but no honest editor can rewrite it without
    // decrypting. LeafPDF must say so up front and disable export.
    await expect(page.getByText(/This PDF is encrypted/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Export PDF/ })).toBeDisabled()

    // Viewing still works at full depth: deep navigation through the rail...
    await page.getByRole('button', { name: 'Select page 400', exact: true }).click()
    await expect(page.getByText('PAGE 400 / 756')).toBeVisible()

    // ...and find-in-document across a real 756-page book.
    const search = page.getByRole('searchbox', { name: 'Find text in document' })
    await search.fill('smooth shading')
    await search.press('Enter')
    await expect(page.getByText(/match/, { exact: false }).first()).toBeVisible({ timeout: 120_000 })
  })
})
