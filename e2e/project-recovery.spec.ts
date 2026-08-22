import { expect, test } from '@playwright/test'

async function recoveryRecord(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('leafpdf-project-recovery')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      if (!database.objectStoreNames.contains('projects')) return null
      const transaction = database.transaction('projects', 'readonly')
      const getAll = transaction.objectStore('projects').getAll()
      return await new Promise<{
        sourceCount: number
        pageCount: number
        comments: string[]
      } | null>((resolve, reject) => {
        getAll.onsuccess = () => {
          const record = getAll.result[0]
          if (!record?.project) {
            resolve(null)
            return
          }
          resolve({
            sourceCount: record.project.sources.length,
            pageCount: record.project.document.pages.length,
            comments: record.project.comments.map((comment: { body: string }) => comment.body),
          })
        }
        getAll.onerror = () => reject(getAll.error)
      })
    } finally {
      database.close()
    }
  })
}

test('recovers inserted PDFs, page order, and review comments after a reload', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

  await page.getByLabel('Choose a PDF to insert').setInputFiles('tmp/pdfs/edge-metadata.pdf')
  await expect(page.getByText('4 pages')).toBeVisible()
  await page.getByRole('button', { name: /^Review/ }).click()
  await page.getByPlaceholder('Add a review note').fill('Recovered project comment')
  await page.getByRole('button', { name: 'Add comment' }).click()

  await expect.poll(() => recoveryRecord(page), { timeout: 15_000 }).toEqual({
    sourceCount: 2,
    pageCount: 4,
    comments: ['Recovered project comment'],
  })

  page.once('dialog', (dialog) => void dialog.accept())
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Annotate and sign PDFs.' })).toBeVisible()

  await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
  const recovery = page.getByRole('dialog', { name: 'Resume your previous editing session?' })
  await expect(recovery).toBeVisible()
  await recovery.getByRole('button', { name: 'Restore edits' }).click()

  await expect(page.getByText('4 pages')).toBeVisible()
  await page.getByRole('button', { name: /^Review/ }).click()
  await expect(page.getByText('Recovered project comment')).toBeVisible()
})
