// Disposable browser fixture: no remote mutations or real transport faults.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  fs.mkdirSync('output/playwright', { recursive: true })
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      await page.addInitScript(theme => {
        localStorage.setItem('codex-web-local.dark-mode.v1', theme)
        class FixtureSocket {
          static OPEN = 1
          readyState = 1
          constructor(url) { this.url = url; window.fixtureSocket = this; setTimeout(() => this.onopen?.({}), 0) }
          close() {} send() {}
        }
        window.WebSocket = FixtureSocket
      }, theme)
      const thread = { id: 'recovery-fixture', cwd: '/remote/disposable', preview: 'Recovery fixture', createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [] }
      await page.route('**/codex-api/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (path.endsWith('/connection-diagnostics')) return route.fulfill({ json: { data: { profile: 'fixture-profile', generation: 2, directory: '/remote/disposable', capabilities: { 'fs/getMetadata': { support: 'supported', diagnosis: 'available', detail: 'Read-only fixture metadata probe succeeded' }, 'fs/writeFile': { support: 'unknown', diagnosis: 'unprobed', detail: 'Writes are never performed solely to probe' } }, git: { available: true, detail: 'git version fixture' } } } })
        if (path.endsWith('/uploads')) return route.fulfill({ json: { trackedBytes: 123, capacityBytes: 1048576, unknownSizeCount: 1, capacityWarning: false, cleanup: { reason: 'No deletion capability verified' }, uploads: [{ path: '/remote/uploads/fixture', profile: 'fixture-profile', status: 'unknown' }] } })
        if (path.endsWith('/rpc')) {
          const { method } = route.request().postDataJSON()
          const result = method === 'thread/list' ? { data: [thread], nextCursor: null }
            : ['thread/read', 'thread/resume'].includes(method) ? { thread }
            : method === 'model/list' ? { data: [], nextCursor: null } : {}
          return route.fulfill({ json: { result } })
        }
        if (path.endsWith('/workspace-roots-state')) return route.fulfill({ json: { data: { order: ['/remote/disposable'], active: ['/remote/disposable'], labels: {}, projectOrder: ['/remote/disposable'] } } })
        if (path.endsWith('/server-requests')) return route.fulfill({ json: { data: [] } })
        if (path.endsWith('/thread-pins')) return route.fulfill({ json: { data: { threadIds: [] } } })
        if (path.endsWith('/methods')) return route.fulfill({ json: { data: [] } })
        return route.fulfill({ json: { data: [] } })
      })
      await page.goto('http://127.0.0.1:4173/#/thread/recovery-fixture')
      await page.waitForFunction(() => window.fixtureSocket?.onmessage)
      const emit = async (method, params) => page.evaluate(({ method, params }) => window.fixtureSocket.onmessage({ data: JSON.stringify({ method, params, atIso: new Date().toISOString() }) }), { method, params })
      const draft = page.locator('textarea').first()
      await draft.fill('unsent disposable recovery draft')
      await emit('app-server/subscriptionRecovery', { threadId: thread.id, state: 'recovering', attempt: 1 })
      await page.getByRole('status').filter({ hasText: 'Recovering' }).waitFor()
      await emit('app-server/subscriptionRecovery', { threadId: thread.id, state: 'recovered', attempt: 2 })
      await page.getByRole('status').filter({ hasText: 'Recovered' }).waitFor()
      assert.equal(await draft.inputValue(), 'unsent disposable recovery draft')
      await emit('app-server/subscriptionRecovery', { threadId: thread.id, state: 'failed', attempt: 4 })
      await page.getByRole('button', { name: 'Retry subscription', exact: true }).waitFor()
      await emit('turn/started', { threadId: thread.id, turn: { id: 'fixture-turn', status: 'inProgress' } })
      await emit('server/request', { id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: thread.id, turnId: 'fixture-turn' } })
      await emit('app-server/disconnected', {})
      await page.getByText('Codex App Server: Disconnected', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Refresh history', exact: true }).waitFor()
      assert.equal(await draft.inputValue(), 'unsent disposable recovery draft')
      await page.getByText('The previous approval expired with the connection.', { exact: false }).waitFor()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByText('Warnings and diagnostics (0)', { exact: true }).click()
      await page.getByRole('button', { name: 'Check remote compatibility', exact: true }).click()
      await page.getByText('Connection profile: fixture-profile', { exact: false }).waitFor()
      await page.getByText('Managed uploads:', { exact: false }).click()
      await page.getByText('/remote/uploads/fixture', { exact: false }).waitFor()
      await page.waitForTimeout(2200)
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), theme === 'dark')
      const colors = await page.locator('[data-connection="app-server"]').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
      assert.equal(colors.background, theme === 'dark' ? 'rgb(66, 32, 6)' : 'rgb(254, 249, 195)')
      const screenshot = `output/playwright/recovery-status-${theme}.png`
      await page.screenshot({ path: screenshot, fullPage: true })
      console.log(JSON.stringify({ url: page.url(), viewport: '1440x1000', theme, colors, screenshot, assertions: 'recovering/recovered, preserved unsent draft, failed/manual retry, disconnect, expired approval, unknown outcome, compatibility, inventory and theme colors passed' }))
      await page.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
