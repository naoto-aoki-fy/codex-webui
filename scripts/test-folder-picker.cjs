// Mocked filesystem and project writes; startup reads use the local dev server.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  fs.mkdirSync('output/playwright', { recursive: true })
  try {
    for (const [device, width, height] of [['desktop', 1440, 1000], ['phone', 375, 812], ['tablet', 768, 1024]]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height } })
        await page.addInitScript((theme) => localStorage.setItem('codex-web-local.dark-mode.v1', theme), theme)
        const listings = []; const registrations = []
        await page.route('**/codex-local-directories?*', async (route) => {
          const url = new URL(route.request().url()); listings.push(url.search)
          const path = url.searchParams.get('path')
          await route.fulfill({ json: { data: { path, parentPath: path, entries: [{ name: 'Child', path: `${path}/Child` }] } } })
        })
        await page.route('**/codex-api/project-root', async (route) => {
          const body = route.request().postDataJSON(); registrations.push(body)
          await route.fulfill({ json: { data: { path: body.path } } })
        })
        await page.route('**/codex-api/workspace-roots-state', async (route) => {
          const roots = registrations.map((entry) => entry.path)
          await route.fulfill({ json: { data: { order: roots, active: roots, labels: {}, projectOrder: roots } } })
        })
        await page.goto('http://127.0.0.1:4173/#/')
        await page.waitForLoadState('networkidle')
        const open = page.locator('.new-thread-folder-actions button').filter({ hasText: 'Select folder' })
        await open.click()
        const dialog = page.getByRole('dialog', { name: 'Select folder', exact: true })
        await dialog.locator('.new-thread-open-folder-item-main').waitFor()
        assert.equal(await dialog.getByRole('button', { name: 'New folder', exact: true }).count(), 0)
        assert.equal(listings.length, 1)
        await page.waitForFunction(() => document.activeElement?.classList.contains('new-thread-open-folder-path'))
        await dialog.getByRole('checkbox').check()
        await page.waitForFunction(() => !document.querySelector('.new-thread-open-folder-status'))
        assert.equal(listings.length, 2)
        await dialog.locator('.new-thread-open-folder-filter').fill('absent')
        await dialog.getByText('No folders match this filter.').waitFor()
        assert.equal(listings.length, 2)
        await dialog.locator('.new-thread-open-folder-filter').fill('')
        await page.waitForTimeout(2200)
        const screenshot = `output/playwright/folder-picker-${device}-${theme}.png`
        await page.screenshot({ path: screenshot, fullPage: true })
        assert.equal(await page.locator('html').evaluate((el) => el.classList.contains('dark')), theme === 'dark')
        await dialog.locator('.new-thread-open-folder-path').press('Escape')
        await dialog.waitFor({ state: 'detached' }); assert.equal(registrations.length, 0)
        await open.click(); await dialog.locator('.new-thread-open-folder-item-main').waitFor()
        await dialog.locator('.new-thread-open-folder-item-open').click()
        await dialog.waitFor({ state: 'detached' })
        assert.equal(registrations.length, 1)
        assert.deepEqual(Object.keys(registrations[0]), ['path'])
        assert.ok(registrations[0].path.endsWith('/Child'))
        assert.ok((await page.locator('.new-thread-folder-selected').innerText()).includes('/Child'))
        console.log(JSON.stringify({ device, theme, screenshot, listings: listings.length, registrations: registrations.length, result: 'PASS' }))
        await page.close()
      }
    }
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
