// Deterministic UI faults: isolates browser transports and never mutates a real server.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = 'http://127.0.0.1:4173'

;(async () => {
  fs.mkdirSync('output/playwright', { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const transport of ['ws', 'sse']) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      const requests = []
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.clock.install({ time: new Date('2026-11-16T00:00:00Z') })
      await page.clock.pauseAt(new Date('2026-11-16T00:00:01Z'))
      await page.addInitScript(({ theme, transport }) => {
        localStorage.setItem('codex-web-local.dark-mode.v1', theme)
        window.fixtureTransports = []
        class FixtureSocket {
          static OPEN = 1
          readyState = 1
          constructor(url) {
            this.url = url
            if (String(url).includes('/codex-api/ws')) { window.fixtureTransports.push(this); window.fixtureTransport = this }
          }
          close() { this.fixtureClosed = true } send() {}
        }
        class FixtureEvents extends EventTarget {
          static CLOSED = 2
          readyState = 1
          constructor() { super(); window.fixtureTransports.push(this); window.fixtureTransport = this }
          close() { this.fixtureClosed = true }
        }
        window.WebSocket = FixtureSocket
        window.EventSource = FixtureEvents
        window.fixtureCurrent = () => window.fixtureTransports.filter(stream => !stream.fixtureClosed)
        window.fixtureReady = () => {
          for (const stream of window.fixtureCurrent()) {
            stream.onopen?.({})
            if (stream instanceof FixtureSocket) stream.onmessage({ data: '{"method":"ready","params":{"ok":true}}' })
            else stream.dispatchEvent(new MessageEvent('ready', { data: '{"ok":true}' }))
          }
        }
        window.fixtureEmit = (method, params) => {
          for (const stream of window.fixtureCurrent()) stream.onmessage({ data: JSON.stringify({ method, params }) })
        }
        window.fixtureFault = () => {
          for (const stream of window.fixtureCurrent()) {
            if (stream instanceof FixtureSocket) { stream.fixtureClosed = true; stream.onclose({}) }
            else { stream.readyState = 0; stream.onerror({}) }
          }
        }
        window.fixtureNetwork = online => {
          Object.defineProperty(navigator, 'onLine', { configurable: true, value: online })
          window.dispatchEvent(new Event(online ? 'online' : 'offline'))
        }
      }, { theme, transport })
      const thread = { id: 'connection-fixture', cwd: '/remote/disposable', preview: 'Connection status fixture', createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [] }
      await page.route('**/codex-api/**', async route => {
        if (route.request().url().endsWith('/codex-api/connection-profile')) return route.fulfill({ json: { connectionProfile: 'browser-fixture' } })
        const pathname = new URL(route.request().url()).pathname
        const body = route.request().postDataJSON()
        requests.push({ path: pathname, method: body?.method || route.request().method() })
        if (pathname.endsWith('/rpc')) {
          const method = body.method
          const result = method === 'thread/list' ? { data: [thread], nextCursor: null }
            : ['thread/read', 'thread/resume'].includes(method) ? { thread }
            : ['model/list', 'project/list'].includes(method) ? { data: [], nextCursor: null } : {}
          return route.fulfill({ json: { result } })
        }
        if (pathname.endsWith('/thread-pins')) return route.fulfill({ json: { data: { threadIds: [] } } })
        return route.fulfill({ json: { data: [] } })
      })
      await page.goto(`${base}/#/thread/${thread.id}`)
      await page.waitForFunction(() => window.fixtureCurrent?.().length === 2 && window.fixtureCurrent().every(stream => stream.onmessage))
      if (transport === 'sse') await page.evaluate(() => window.fixtureFault())
      await page.evaluate(() => window.fixtureReady())
      const row = layer => page.locator(`[data-connection="${layer}"]`)
      const emit = (method, params) => page.evaluate(({ method, params }) => window.fixtureEmit(method, params), { method, params })
      // runFor flushes Vue updates; ordinary locators wait for pending history reads.
      const advance = ms => page.clock.runFor(ms)
      await page.locator('textarea').first().fill('preserved unsent connection draft')
      if (transport === 'sse') await advance(3000) // Initial rejected WS recovers through SSE.
      assert.equal(await page.locator('.connection-recovery-status').count(), 0)
      await emit('app-server/reconnected', {}) // Initial healthy events are silent.
      assert.equal(await row('app-server').count(), 0)
      await page.evaluate(() => window.fixtureFault())
      await row('browser').getByText('WebUI Backend: Disconnected', { exact: true }).waitFor()
      if (transport === 'ws') {
        await advance(1000)
        await page.evaluate(() => window.fixtureCurrent().forEach(stream => stream.onopen?.({})))
      }
      await advance(6000)
      assert.match(await row('browser').innerText(), /Disconnected/)
      await emit('app-server/disconnected', {})
      await emit('app-server/subscriptionRecovery', { threadId: thread.id, state: 'recovering' })
      await row('subscription').waitFor()
      await advance(6000)
      assert.match(await row('subscription').innerText(), /Recovering/)
      await emit('app-server/subscriptionRecovery', { threadId: thread.id, state: 'failed' })
      await row('subscription').getByRole('button', { name: 'Retry subscription', exact: true }).click()
      await emit('app-server/subscriptionRecovery', { threadId: thread.id, state: 'recovered' })
      await advance(3000)
      assert.equal(await row('subscription').count(), 0)
      assert.equal(await row('browser').count(), 1)
      assert.equal(await row('app-server').count(), 1)
      await page.evaluate(() => window.fixtureReady())
      await row('browser').getByText('WebUI Backend: Reconnected', { exact: true }).waitFor()
      const successBackground = await row('browser').evaluate(el => getComputedStyle(el).backgroundColor)
      assert.equal(successBackground, theme === 'dark' ? 'rgb(5, 46, 22)' : 'rgb(220, 252, 231)')
      await page.waitForTimeout(2200)
      const successScreenshot = path.resolve(`output/playwright/connection-status-${transport}-${theme}-success.png`)
      await page.screenshot({ path: successScreenshot, fullPage: true })
      await advance(2999)
      assert.equal(await row('browser').count(), 1)
      await advance(1)
      assert.equal(await row('browser').count(), 0)
      assert.equal(await row('app-server').count(), 1)
      await emit('app-server/reconnected', {})
      await row('app-server').getByText('Codex App Server: Reconnected', { exact: true }).waitFor()
      await advance(1000)
      await emit('app-server/reconnected', {}) // Duplicate does not extend the timer.
      await advance(2000)
      assert.equal(await row('app-server').count(), 0)
      // Both timers must survive stale success deadlines and rapid repeated cycles.
      for (let cycle = 0; cycle < 2; cycle++) {
        await emit('app-server/disconnected', {})
        await page.evaluate(() => window.fixtureNetwork(false))
        await advance(6000)
        assert.equal(await row('browser').count(), 1)
        assert.equal(await row('app-server').count(), 1)
        await page.evaluate(() => window.fixtureNetwork(true))
        await advance(100)
        assert.match(await row('browser').innerText(), /Disconnected.*Reconnecting/s)
        const retired = await page.evaluate(() => { window.retiredTransport = window.fixtureTransports.find(stream => stream.fixtureClosed); return Boolean(window.retiredTransport) })
        if (retired) await page.evaluate(() => window.retiredTransport.onmessage?.({ data: '{"method":"ready"}' }))
        assert.match(await row('browser').innerText(), /Disconnected/)
        await page.evaluate(() => window.fixtureReady())
        await emit('app-server/transportState', { state: 'connected' })
        await advance(1000)
      }
      await emit('app-server/disconnected', {})
      await page.evaluate(() => window.fixtureNetwork(false))
      await advance(6000)
      assert.match(await row('browser').innerText(), /Disconnected/)
      assert.match(await row('app-server').innerText(), /Disconnected/)
      assert.equal(await page.locator('textarea').first().inputValue(), 'preserved unsent connection draft')
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), theme === 'dark')
      const colors = await row('browser').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
      assert.equal(colors.background, theme === 'dark' ? 'rgb(66, 32, 6)' : 'rgb(254, 249, 195)')
      await page.waitForTimeout(2200)
      const warningScreenshot = path.resolve(`output/playwright/connection-status-${transport}-${theme}.png`)
      await page.screenshot({ path: warningScreenshot, fullPage: true })
      // Suspended-tab recovery uses the existing coalesced lifecycle replacement.
      await page.evaluate(() => window.fixtureNetwork(true))
      await advance(100)
      await page.evaluate(() => window.fixtureReady())
      await emit('app-server/transportState', { state: 'connected' })
      await advance(3000)
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      assert.match(await row('browser').innerText(), /Disconnected.*Reconnecting/s)
      await advance(100)
      const activeTransportCount = await page.evaluate(() => window.fixtureCurrent().length)
      assert.equal(activeTransportCount, 2, 'desktop and sidebar retain only their existing subscriptions')
      const recoveryStart = requests.length
      await page.evaluate(() => window.fixtureReady())
      await row('browser').getByText('WebUI Backend: Reconnected', { exact: true }).waitFor()
      // Network reads are async; allow them to settle before measuring dismissal.
      await page.waitForTimeout(500)
      const recoveryRequests = requests.slice(recoveryStart)
      const requestsBeforeDismissal = requests.length
      await advance(3000)
      assert.equal(await page.locator('.connection-recovery-status').count(), 0)
      assert.equal(requests.length, requestsBeforeDismissal, 'dismissal must not issue network requests')
      await page.waitForTimeout(2200)
      const healthyScreenshot = path.resolve(`output/playwright/connection-status-${transport}-${theme}-healthy.png`)
      await page.screenshot({ path: healthyScreenshot, fullPage: true })
      assert.equal(requests.some(r => ['turn/start', 'turn/steer'].includes(r.method) || r.path.endsWith('/respond') || r.path.endsWith('/reconnect')), false)
      assert.deepEqual(errors, [])
      const report = { url: page.url(), viewport: '1440x1000', theme, transport, colors, warningScreenshot, successScreenshot, healthyScreenshot, recoveryRequests, activeTransportCount, dismissalRequests: requests.length - requestsBeforeDismissal, assertions: 'independent faults, subscription failure/recovery/manual retry, 3s success dismissal, prolonged warnings, offline/online cycles, stale callbacks, duplicate success, suspended tab, drafts, no replay, themes' }
      fs.writeFileSync(`output/playwright/connection-status-${transport}-${theme}.json`, JSON.stringify(report, null, 2))
      console.log(JSON.stringify(report))
      await page.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
