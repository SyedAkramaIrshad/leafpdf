import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const baseUrl = process.env.LEAFPDF_PREVIEW_URL ?? 'http://127.0.0.1:4173/'
const outputDirectory = 'preview'

async function openPdf(page, path) {
  await page.locator('input[type="file"]').first().setInputFiles(path)
  await page.getByLabel('Rendered PDF page').first().waitFor({ state: 'visible', timeout: 30_000 })
}

async function openProjectTool(page, name) {
  await page.getByRole('button', { name: 'Document tools' }).click()
  await page.getByRole('menuitem', { name }).click()
}

async function capture() {
  mkdirSync(outputDirectory, { recursive: true })
  const browser = await chromium.launch({ headless: true })

  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
    await desktop.emulateMedia({ reducedMotion: 'reduce' })
    await desktop.goto(baseUrl, { waitUntil: 'networkidle' })
    await desktop.screenshot({ path: `${outputDirectory}/01-landing-desktop.png`, fullPage: true, animations: 'disabled' })

    await openPdf(desktop, 'tmp/pdfs/mvp-fixture.pdf')
    await desktop.screenshot({ path: `${outputDirectory}/02-workbench-desktop.png`, animations: 'disabled' })

    await openProjectTool(desktop, /^Review comments/)
    await desktop.getByPlaceholder('Add a review note').fill('Please verify the approval section before release.')
    await desktop.getByPlaceholder('Optional').fill('LeafPDF reviewer')
    await desktop.getByRole('button', { name: 'Add comment' }).click()
    await desktop.screenshot({ path: `${outputDirectory}/03-review-panel.png`, animations: 'disabled' })

    await desktop.getByRole('button', { name: 'Close comments panel' }).click()
    await openProjectTool(desktop, 'Help & shortcuts')
    await desktop.getByRole('complementary', { name: 'Finish and save' }).waitFor({ state: 'visible' })
    await desktop.screenshot({ path: `${outputDirectory}/04-help-panel.png`, animations: 'disabled' })

    const privacy = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
    await privacy.emulateMedia({ reducedMotion: 'reduce' })
    await privacy.goto(baseUrl, { waitUntil: 'networkidle' })
    await openPdf(privacy, 'tmp/pdfs/edge-metadata.pdf')
    await openProjectTool(privacy, 'Privacy check')
    await privacy.locator('.privacy-panel').waitFor({ state: 'visible' })
    await privacy.screenshot({ path: `${outputDirectory}/05-privacy-panel.png`, animations: 'disabled' })

  } finally {
    await browser.close()
  }

  console.log(`Captured LeafPDF visual preview in ${outputDirectory}/`)
}

await capture()
