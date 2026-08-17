import { existsSync, mkdirSync, statSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const FIXTURE = 'tmp/pdfs/large-78mb.pdf'

/**
 * Establishes what the enforced file-size limit actually buys: a file of this size
 * opens, edits, and exports without error, in this much wall-clock time.
 *
 * It deliberately asserts nothing about memory. `performance.memory` cannot measure
 * this: a PDF's bytes live in ArrayBuffer storage that is external to
 * `usedJSHeapSize`, and the same code path reported 228 MB and 17 MB depending only on
 * when the sample was taken. The export worker cannot be measured either —
 * `performance.memory` does not exist in a dedicated worker, CDP
 * `SystemInfo.getProcessInfo` carries no memory, and `Performance.getMetrics` covers
 * only the page's isolate. The heap figures below are logged as a weak signal, never
 * asserted, and must not be quoted as a memory guarantee.
 *
 * The fixture is ~100 MB and is not kept in the tree, so this skips by default.
 * Generate it and run this in one step with `npm run test:e2e:large`.
 */
test.describe(() => {
  test.skip(!existsSync(FIXTURE), `Missing ${FIXTURE} — run: npm run test:e2e:large`)
  test.setTimeout(300_000)

  const readHeapMb = (page: import('@playwright/test').Page) => page.evaluate(() => {
    const perf = performance as unknown as { memory?: { usedJSHeapSize: number } }
    return perf.memory ? Math.round(perf.memory.usedJSHeapSize / (1024 * 1024)) : null
  })

  test('opens and exports a PDF near the enforced size limit', async ({ page }) => {
    const sizeMb = statSync(FIXTURE).size / (1024 * 1024)
    const consoleErrors: string[] = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('pageerror', (error) => consoleErrors.push(String(error)))

    await page.goto('/')
    const openedAt = Date.now()
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE)
    await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible({ timeout: 180_000 })
    const openMs = Date.now() - openedAt
    const heapAfterOpen = await readHeapMb(page)

    await page.getByRole('button', { name: 'Add text' }).click()
    await page.locator('.annotation-layer').first().click({ position: { x: 120, y: 160 } })
    await expect(page.locator('.text-annotation')).toBeVisible()

    const downloadPromise = page.waitForEvent('download', { timeout: 240_000 })
    const exportedAt = Date.now()
    await page.getByRole('button', { name: /Export PDF/ }).click()
    const download = await downloadPromise
    const exportMs = Date.now() - exportedAt

    mkdirSync('output/pdf', { recursive: true })
    await download.saveAs('output/pdf/large-78mb-edited.pdf')
    const outMb = statSync('output/pdf/large-78mb-edited.pdf').size / (1024 * 1024)
    const heapAfterExport = await readHeapMb(page)

    console.log(
      `LARGE-FILE: in=${sizeMb.toFixed(1)}MB open=${openMs}ms export=${exportMs}ms `
      + `out=${outMb.toFixed(1)}MB errors=${consoleErrors.length}`,
    )
    console.log(
      `LARGE-FILE-HEAP (indicative only, not asserted): page after open=${heapAfterOpen}MB, `
      + `after export=${heapAfterExport}MB; export worker heap is not measurable`,
    )

    // What this test actually guarantees.
    expect(consoleErrors).toEqual([])
    // The export must be a real document of comparable size, not a truncated stub.
    expect(outMb).toBeGreaterThan(sizeMb * 0.5)
  })
})
