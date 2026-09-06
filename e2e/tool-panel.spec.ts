import { expect, test, type Locator } from '@playwright/test'

async function expectReachable(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 })
  expect(await control.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return target !== null && element.contains(target)
  })).toBe(true)
}

for (const width of [1024, 1440]) {
  test(`advanced tools keep the everyday tools reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    await page.goto('/')
    await page.locator('input[type="file"]').first().setInputFiles('tmp/pdfs/mvp-fixture.pdf')
    await expect(page.getByLabel('Rendered PDF page').first()).toBeVisible()
    const more = page.getByRole('button', { name: 'More editing tools' })
    await more.click()
    await page.getByRole('button', { name: 'Shapes', exact: true }).click()
    await page.screenshot({ path: `output/ui/tool-panel-${width}.png` })
    for (const name of ['Add rectangle', 'Add ellipse', 'Add line', 'Add arrow']) {
      await expectReachable(page.getByRole('menuitem', { name, exact: true }))
    }
    for (const name of ['Select', 'Add text', 'My details', 'Add signature', 'More editing tools']) {
      await expectReachable(page.getByRole('button', { name, exact: true }))
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Shapes', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(more).toBeFocused()
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    await page.getByRole('button', { name: 'Forms', exact: true }).click()
    await expectReachable(page.getByRole('menuitem', { name: 'Add dropdown field' }))
    await page.getByRole('button', { name: 'Add text', exact: true }).click()
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await page.locator('.annotation-layer').first().click({ position: { x: 100, y: 160 } })
    await expect(page.locator('.text-annotation')).toHaveCount(1)
  })
}
