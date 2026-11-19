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
        if (path.endsWith('/rpc')) {
          const { method } = route.request().postDataJSON()
          const result = method === 'native-authentication/read' ? { phase: 'ready', blocking: false, revision: 1, account: { type: 'chatgpt' } }
            : method === 'thread/list' ? { data: [thread], nextCursor: null }
            : ['thread/read', 'thread/resume'].includes(method) ? { thread }
            : ['model/list', 'project/list'].includes(method) ? { data: [], nextCursor: null } : {}
          return route.fulfill({ json: { result } })
        }
        if (path.endsWith('/server-requests')) return route.fulfill({ json: { data: [] } })
        if (path.endsWith('/thread-pins')) return route.fulfill({ json: { data: { threadIds: [] } } })
        return route.fulfill({ json: { data: [] } })
      })
      await page.goto('http://127.0.0.1:4173/#/thread/recovery-fixture')
      await page.waitForFunction(() => window.fixtureSocket?.onmessage)
      const emit = async (method, params) => page.evaluate(({ method, params }) => window.fixtureSocket.onmessage({ data: JSON.stringify({ method, params, atIso: new Date().toISOString() }) }), { method, params })
      await emit('ready', { ok: true })
      const draft = page.locator('textarea').first()
      await page.waitForFunction(() => !document.querySelector('.thread-composer-input')?.disabled)
      await draft.fill('unsent disposable recovery draft')
      await emit('app-server/subscriptionRecovery', { threadId: thread.id, state: 'recovering', attempt: 1 })
      await page.getByRole('status').filter({ hasText: 'Recovering' }).waitFor()
      await emit('app-server/subscriptionRecovery', { threadId: thread.id, state: 'recovered', attempt: 2 })
      await page.getByRole('status').filter({ hasText: 'Recovered' }).waitFor()
      assert.equal(await draft.inputValue(), 'unsent disposable recovery draft')
      await emit('app-server/subscriptionRecovery', { threadId: thread.id, state: 'failed', attempt: 4 })
      const retry = page.getByRole('button', { name: 'Retry subscription', exact: true })
      const resume = page.waitForRequest(request => request.url().endsWith('/codex-api/rpc')
        && request.postDataJSON()?.method === 'thread/resume')
      await retry.click()
      await resume
      await emit('turn/started', { threadId: thread.id, turn: { id: 'fixture-turn', status: 'inProgress' } })
      await emit('server/request', { id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: thread.id, turnId: 'fixture-turn' } })
      await emit('app-server/disconnected', {})
      await page.getByText('Codex App Server: Disconnected', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Refresh history', exact: true }).waitFor()
      assert.equal(await draft.inputValue(), 'unsent disposable recovery draft')
      await page.getByText('The previous approval expired with the connection.', { exact: false }).waitFor()
      await page.waitForTimeout(2200)
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), theme === 'dark')
      const colors = await page.locator('[data-connection="app-server"]').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
      assert.equal(colors.background, theme === 'dark' ? 'rgb(66, 32, 6)' : 'rgb(254, 249, 195)')
      const screenshot = `output/playwright/recovery-status-${theme}.png`
      await page.screenshot({ path: screenshot, fullPage: true })
      await emit('app-server/reconnected', {})
      await page.getByText('Codex App Server: Reconnected', { exact: true }).waitFor()
      assert.equal(await draft.inputValue(), 'unsent disposable recovery draft')
      console.log(JSON.stringify({ url: page.url(), viewport: '1440x1000', theme, colors, screenshot, assertions: 'recovering/recovered, preserved unsent draft, failed/manual retry, disconnect, expired approval, unknown outcome, reconnection and theme colors passed' }))
      await page.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
