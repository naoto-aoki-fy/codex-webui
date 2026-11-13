// Browser fixture only: no real remote connection, attachments or mutations.
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
          constructor() { window.fixtureSocket = this; setTimeout(() => this.onopen?.({}), 0) }
          close() {} send() {}
        }
        window.WebSocket = FixtureSocket
      }, theme)
      const thread = { id: 'shared-profile-thread', cwd: '/remote/disposable', preview: 'Profile fixture', createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [] }
      await page.route('**/codex-api/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (path.endsWith('/rpc')) {
          const { method } = route.request().postDataJSON()
          const result = method === 'thread/list' ? { data: [thread], nextCursor: null }
            : ['thread/read', 'thread/resume'].includes(method) ? { thread }
            : method === 'model/list' ? { data: [], nextCursor: null } : {}
          return route.fulfill({ json: { result } })
        }
        if (path.endsWith('/workspace-roots-state')) return route.fulfill({ json: { data: { order: ['/remote/disposable'], active: ['/remote/disposable'], labels: {}, projectOrder: ['/remote/disposable'] } } })
        return route.fulfill({ json: { data: [] } })
      })
      await page.goto('http://127.0.0.1:4173/?connection-profile=legacy#/thread/shared-profile-thread')
      const ready = () => page.waitForFunction(() => window.fixtureSocket?.onmessage)
      const emitProfile = profile => page.evaluate(profile => window.fixtureSocket.onmessage({ data: JSON.stringify({ method: 'ready', params: { backendInstanceId: 'fixture-' + profile, connectionProfile: profile } }) }), profile)
      await ready()
      await page.locator('textarea').first().fill('legacy profile draft')
      await page.waitForFunction(() => localStorage.getItem('codex-web-local.thread-draft.v1.shared-profile-thread')?.includes('legacy profile draft'))
      await emitProfile('machine-b')
      await page.waitForURL('**/?connection-profile=machine-b**')
      await ready()
      assert.equal(await page.locator('textarea').first().inputValue(), '')
      await page.locator('textarea').first().fill('machine B draft')
      await page.waitForFunction(() => localStorage.getItem('codex-profile.machine-b.codex-web-local.thread-draft.v1.shared-profile-thread')?.includes('machine B draft'))
      await emitProfile('legacy')
      await page.waitForURL('**/?connection-profile=legacy**')
      await ready()
      await page.waitForFunction(() => document.querySelector('textarea')?.value === 'legacy profile draft')
      const sameDocument = await page.evaluate(() => { window.profileDocumentMarker = 'same'; return location.href })
      await emitProfile('legacy')
      await page.waitForTimeout(2200)
      assert.equal(await page.evaluate(() => window.profileDocumentMarker), 'same')
      const screenshot = `output/playwright/connection-profiles-${theme}.png`
      await page.screenshot({ path: screenshot, fullPage: true })
      console.log(JSON.stringify({ url: sameDocument, viewport: '1440x1000', theme, result: 'profile reload isolates colliding thread drafts; returning restores legacy; same-profile ready keeps document', screenshot }))
      await page.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
