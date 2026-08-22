import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test('saves and reopens a complete editable project with inserted PDFs and comments', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByLabel('Choose a PDF to insert').setInputFiles('tmp/pdfs/edge-metadata.pdf')
  await expect(page.getByText(/Inserted 2 pages from edge-metadata\.pdf/)).toBeVisible()
  await expect(page.getByText('4 pages')).toBeVisible()

  await page.getByRole('button', { name: /^Review/ }).click()
  await page.getByPlaceholder('Add a review note').fill('Portable review comment')
  await page.getByPlaceholder('Optional').fill('Syed')
  await page.getByRole('button', { name: 'Add comment' }).click()
  await expect(page.getByText('Portable review comment')).toBeVisible()

  const projectDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project' }).click()
  const project = await projectDownload
  expect(project.suggestedFilename()).toBe('mvp-fixture.leafpdf')
  mkdirSync('output/project', { recursive: true })
  const projectPath = 'output/project/mvp-fixture.leafpdf'
  await project.saveAs(projectPath)

  // A portable project contains the complete editable state, so closing after a
  // successful project save does not need a discard prompt.
  await page.getByRole('button', { name: /Close document/ }).click()
  await expect(page.getByRole('heading', { name: 'Annotate and sign PDFs.' })).toBeVisible()

  await page.locator('input[type="file"]').first().setInputFiles(projectPath)
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
  await expect(page.getByText('4 pages')).toBeVisible()
  await page.getByRole('button', { name: /^Review/ }).click()
  await expect(page.getByText('Portable review comment')).toBeVisible()
  await expect(page.getByText(/Syed/)).toBeVisible()
})

test('publishes an installable manifest with PDF and project file handlers', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest')
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.file_handlers[0].accept['application/pdf']).toContain('.pdf')
  expect(manifest.file_handlers[0].accept['application/x-leafpdf+json']).toContain('.leafpdf')
})
