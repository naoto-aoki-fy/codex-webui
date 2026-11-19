// Isolated App Server responses for the full folder picker and project flow.
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
        const projects = [
          { id: 'workspace-a', name: 'Workspace A', roots: [{ path: '/fixture' }], position: 0 },
          { id: 'workspace-b', name: 'Workspace B', roots: [{ path: '/fixture/other' }], position: 1 },
        ]
        const calls = []
        await page.routeWebSocket('**/codex-api/ws', () => {})
        await page.route('**/codex-api/**', async (route) => {
          if (!route.request().url().endsWith('/rpc')) return route.fulfill({ json: { data: [] } })
          const { method, params } = route.request().postDataJSON()
          calls.push({ method, params })
          let result = { data: [], nextCursor: null }
          if (method === 'project/list') result = { data: projects, nextCursor: null }
          if (method === 'fs/getMetadata') result = { isDirectory: true, isFile: false }
          if (method === 'project/create') {
            registrations.push(params)
            const project = { id: 'new-project', name: params.name, roots: params.roots, position: projects.length }
            projects.push(project)
            result = { project }
          }
          if (method === 'project/update') {
            const project = projects.find(project => project.id === params.projectId)
            project.name = params.name
            result = { project }
          }
          if (method === 'project/move') {
            const [project] = projects.splice(projects.findIndex(project => project.id === params.projectId), 1)
            projects.splice(params.beforeProjectId ? projects.findIndex(project => project.id === params.beforeProjectId) : projects.length, 0, project)
          }
          if (method === 'project/delete') projects.splice(projects.findIndex(project => project.id === params.projectId), 1)
          if (method === 'native-authentication/read') result = { phase: 'ready', blocking: false, revision: 1 }
          return route.fulfill({ json: { result } })
        })
        await page.goto('http://127.0.0.1:4173/#/')
        await page.waitForLoadState('networkidle')
        assert.equal(calls.filter(call => call.method === 'project/list').length, 1)
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
        assert.match(registrations[0].idempotencyKey, /^[0-9a-f-]{36}$/)
        assert.deepEqual(registrations[0].roots, [{ path: '/fixture/Child' }])
        await page.waitForURL('**projectId=new-project')
        assert.equal(await page.locator('.new-thread-folder-selected').getAttribute('title'), '/fixture/Child')
        assert.equal(calls.filter(call => call.method === 'fs/getMetadata').length, 1)
        if (device === 'desktop') {
          const project = page.locator('[data-project-name="new-project"]')
          const openProjectMenu = async () => {
            await project.hover()
            await project.locator('.project-menu-trigger').click()
          }
          await openProjectMenu()
          await page.getByRole('button', { name: 'Rename', exact: true }).click()
          const rename = page.getByRole('dialog', { name: 'Project name' })
          await rename.getByRole('textbox').fill('Renamed project')
          await rename.getByRole('button', { name: 'Save' }).click()
          await project.getByText('Renamed project').waitFor()
          await openProjectMenu()
          await page.getByRole('button', { name: 'Move up', exact: true }).click()
          const order = () => page.locator('.project-group').evaluateAll(rows => rows.map(row => row.dataset.projectName))
          await page.waitForFunction(() => document.querySelectorAll('.project-group')[1]?.dataset.projectName === 'new-project')
          await page.reload()
          await project.getByText('Renamed project').waitFor()
          assert.deepEqual(await order(), ['workspace-a', 'new-project', 'workspace-b'])
          await openProjectMenu()
          await page.waitForTimeout(2200)
          await page.screenshot({ path: `output/playwright/project-menu-${theme}.png`, fullPage: true })
          await page.getByRole('button', { name: 'Remove', exact: true }).click()
          await project.waitFor({ state: 'detached' })
          assert.deepEqual(await order(), ['workspace-a', 'workspace-b'])
        }
        console.log(JSON.stringify({ device, theme, screenshot, listings: listings.length, registrations: registrations.length, result: 'PASS' }))
        await page.close()
      }
    }
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
