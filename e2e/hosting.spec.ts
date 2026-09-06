import { expect, test } from '@playwright/test'

const basePath = process.env.LEAFPDF_BASE_PATH ?? '/leafpdf/'
const appUrl = new URL(basePath, 'http://127.0.0.1:4173').href

test('serves a complete scope-safe editor shell from a nested path while offline', async ({ context, page, request }) => {
  test.setTimeout(60_000)

  await page.goto(appUrl)
  await expect(page.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeVisible()

  const manifestResponse = await request.get(new URL('manifest.webmanifest', appUrl).href)
  expect(manifestResponse.ok()).toBe(true)
  expect(manifestResponse.headers()['content-type']).toMatch(/json|manifest/)
  const manifest = await manifestResponse.json()
  expect(manifest).toMatchObject({ id: '.', start_url: '.', scope: '.', display: 'standalone' })
  expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual([
    'leafpdf-icon-192.png',
    'leafpdf-icon-512.png',
    'leafpdf-icon.svg',
  ])
  expect(manifest.file_handlers[0].action).toBe('.')

  const workerState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('The page never became service-worker controlled.')), 10_000)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.clearTimeout(timeout)
          resolve()
        }, { once: true })
      })
    }
    return {
      scope: registration.scope,
      scriptUrl: registration.active?.scriptURL ?? '',
    }
  })
  expect(new URL(workerState.scope).pathname).toBe('/leafpdf/')
  expect(new URL(workerState.scriptUrl).pathname).toBe('/leafpdf/sw.js')

  const workerResponse = await request.get(new URL('sw.js', appUrl).href)
  expect(workerResponse.ok()).toBe(true)
  expect(workerResponse.headers()['content-type']).toMatch(/javascript/)
  const workerSource = await workerResponse.text()
  expect(workerSource).not.toContain('__LEAFPDF_')
  expect(workerSource).toContain('const PRECACHE_PATHS = [')

  const cacheState = await page.evaluate(async () => {
    const cacheNames = await caches.keys()
    const cacheName = cacheNames.find((name) => name.startsWith('leafpdf-app:')) ?? ''
    const requests = cacheName ? await (await caches.open(cacheName)).keys() : []
    return { cacheName, urls: requests.map((cachedRequest) => cachedRequest.url) }
  })
  expect(cacheState.cacheName).toContain('/leafpdf/')
  expect(cacheState.urls.length).toBeGreaterThan(10)

  const cachedPaths = cacheState.urls.map((url) => new URL(url).pathname)
  expect(cachedPaths.every((path) => path.startsWith('/leafpdf/'))).toBe(true)
  for (const requiredPath of [
    /\/leafpdf\/index\.html$/,
    /\/leafpdf\/manifest\.webmanifest$/,
    /\/leafpdf\/leafpdf-icon\.svg$/,
    /\/leafpdf\/assets\/index-.+\.css$/,
    /\/leafpdf\/assets\/index-.+\.js$/,
    /\/leafpdf\/assets\/pdf\.worker\.min-.+\.mjs$/,
    /\/leafpdf\/assets\/.+\.ttf$/,
  ]) expect(cachedPaths.some((path) => requiredPath.test(path))).toBe(true)
  expect(cachedPaths.some((path) => /\.(?:pdf|leafpdf)$/i.test(path))).toBe(false)

  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Finish your PDF. Keep it yours.' })).toBeVisible()

    await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
    await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()

    await page.getByRole('button', { name: 'Add text' }).click()
    await page.locator('.annotation-layer').first().click({ position: { x: 160, y: 180 } })
    const inlineText = page.getByLabel('Edit text')
    await inlineText.fill('Offline ready')
    await inlineText.press('Enter')
    await expect(inlineText).not.toBeFocused()
    await expect(inlineText).toHaveValue('Offline ready')
    await expect(page.getByRole('group', { name: 'Added text' })).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Save PDF/ }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('mvp-fixture-edited.pdf')
  } finally {
    await context.setOffline(false)
  }
})
