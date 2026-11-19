// Run against the current worktree's Vite server on 4173. Uses isolated browser
// contexts and fixture props; never deletes a real native Project.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')

const baseUrl = 'http://127.0.0.1:4173'
const outputDir = resolve('output/playwright')
const fixture = `<!doctype html><html><body>
<div class="sidebar" style="width:320px;padding:16px"><div id="app"></div></div>
<script type="module">
import { createApp, h, ref } from '/node_modules/.vite/deps/vue.js'
import Sidebar from '/src/components/sidebar/SidebarThreadTree.vue'
import '/src/style.css'
const ids = ref(['disposable-project'])
const groups = ref([
  { projectName: 'disposable-project', threads: [] },
  { projectName: '__codexapp_unassigned__', threads: [] },
  { projectName: 'stale-project', threads: [] },
])
createApp({ setup() { return () => h('div', [
  h(Sidebar, { groups: groups.value, removableProjectIds: ids.value,
    projectDisplayNameById: { 'disposable-project': 'Disposable project', '__codexapp_unassigned__': 'Unassigned' },
    selectedThreadId: '', activeProjectName: null, isLoading: false,
    isThreadListFullyLoaded: true, searchQuery: '', searchMatchedThreadIds: null,
    onRemoveProject(id) { document.querySelector('#result').textContent = id },
  }),
  h('button', { id: 'invalidate', onClick() { ids.value = [] } }, 'Invalidate fixture project'),
  h('output', { id: 'result' }),
]) } }).mount('#app')
</script></body></html>`

async function main() {
  mkdirSync(outputDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const page = await context.newPage()
      const errors = []
      const apiRequests = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('request', request => {
        if (request.url().includes('/codex-api/')) apiRequests.push(request.url())
      })
      // Keep a silent fixture socket open to avoid real notification traffic.
      await page.routeWebSocket('**/codex-api/ws', () => {})
      await page.route('**/codex-api/**', route => {
        if (route.request().url().endsWith('/codex-api/connection-profile')) return route.fulfill({ json: { connectionProfile: 'browser-fixture' } })
        if (!route.request().url().endsWith('/thread-pins')) {
          errors.push('Unexpected API request: ' + route.request().url())
          return route.abort()
        }
        return route.fulfill({ json: { data: { threadIds: [] } } })
      })
      await page.route('**/__sidebar-project-menu', route => route.fulfill({
        contentType: 'text/html', body: fixture.replace('<html>', '<html class="' + theme + '">'),
      }))
      const url = baseUrl + '/__sidebar-project-menu'
      await page.goto(url)
      const project = page.locator('[data-project-name="disposable-project"]')
      await project.waitFor()
      for (const id of ['__codexapp_unassigned__', 'stale-project']) {
        const group = page.locator('[data-project-name="' + id + '"]')
        assert.equal(await group.locator('.project-menu-trigger').count(), 0)
        await group.locator('.project-header-row').click({ button: 'right' })
        assert.equal(await page.locator('.project-menu-panel').count(), 0)
      }
      await project.hover()
      await project.locator('.project-menu-trigger').click()
      const remove = project.getByRole('button', { name: 'Remove', exact: true })
      assert.equal(await remove.isVisible(), true)
      assert.equal(await remove.isEnabled(), true)
      assert.equal(await project.locator('.project-menu-panel > button').count(), 1)
      await page.waitForTimeout(2500)
      const screenshot = resolve(outputDir, 'sidebar-project-menu-' + theme + '.png')
      await page.screenshot({ path: screenshot })
      const requestCount = apiRequests.length
      await remove.click()
      assert.equal(await page.locator('#result').textContent(), 'disposable-project')
      assert.equal(await page.locator('.project-menu-panel').count(), 0)
      assert.equal(apiRequests.length, requestCount, 'Menu interaction must not fetch data')
      await project.locator('.project-header-row').click({ button: 'right' })
      assert.equal(await remove.isVisible(), true)
      await page.locator('#invalidate').click()
      assert.equal(await project.locator('.project-menu-trigger').count(), 0)
      assert.equal(await page.locator('.project-menu-panel').count(), 0)
      await project.locator('.project-header-row').click({ button: 'right' })
      assert.equal(await page.locator('.project-menu-panel').count(), 0)
      assert.deepEqual(errors, [])
      console.log(JSON.stringify({ theme, url, viewport: '1280x900', screenshot,
        result: 'visible/interactable Remove, exact emitted ID, dismissal, invalid-group guards pass',
        apiRequests: apiRequests.length, menuApiRequests: apiRequests.length - requestCount }))
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
