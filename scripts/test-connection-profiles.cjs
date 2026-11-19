// Credential-free browser fixture. Changing the fixture ID simulates a backend restart.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')

async function main() {
  const browser = await chromium.launch({ headless: true })
  mkdirSync('output/playwright', { recursive: true })
  try {
    for (const theme of ['light', 'dark']) {
      const viewport = { width: 1440, height: 1000 }
      const page = await browser.newPage({ viewport })
      let connectionProfile = 'machine-a'
      let activeSocket
      let bootstrapReads = 0
      await page.addInitScript(theme => {
        localStorage.setItem('codex-web-local.dark-mode.v1', theme)
        localStorage.setItem('codex-web-local.thread-draft.v1.shared-profile-thread', '"unscoped draft"')
      }, theme)
      const thread = {
        id: 'shared-profile-thread', cwd: '/remote/disposable', preview: 'Profile fixture',
        createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [],
      }
      await page.route('**/codex-api/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (path.endsWith('/connection-profile')) {
          bootstrapReads++
          return route.fulfill({ json: { connectionProfile } })
        }
        if (path.endsWith('/rpc')) {
          const { method } = route.request().postDataJSON()
          const result = method === 'thread/list' ? { data: [thread], nextCursor: null }
            : ['thread/read', 'thread/resume'].includes(method) ? { thread }
            : ['model/list', 'project/list'].includes(method) ? { data: [], nextCursor: null } : {}
          return route.fulfill({ json: { result } })
        }
        const data = path.endsWith('/thread-pins') ? { threadIds: [] } : []
        return route.fulfill({ json: { data } })
      })
      function announce(socket) {
        socket.send(JSON.stringify({
          method: 'ready', params: { backendInstanceId: 'fixture-' + connectionProfile, connectionProfile },
        }))
      }
      await page.routeWebSocket('**/codex-api/ws', socket => {
        activeSocket = socket
        setTimeout(() => announce(socket), 35)
      })
      const url = 'http://127.0.0.1:4173/?connection-profile=stale-hint#/thread/shared-profile-thread'
      await page.goto(url)
      const draft = page.locator('.thread-composer-input')
      const waitForText = text => page.waitForFunction(text => document.querySelector('.thread-composer-input')?.value === text, text)
      const saved = (profile, text) => page.waitForFunction(({ profile, text }) =>
        Object.entries(localStorage).some(([key, value]) =>
          key.startsWith(`codex-profile.${profile}.codex-web-local.thread-draft.v2.shared-profile-thread.`) && value.includes(text)), { profile, text })
      assert.equal(await draft.inputValue(), '')
      await draft.fill('machine A draft')
      await saved('machine-a', 'machine A draft')
      connectionProfile = 'machine-b'
      await Promise.all([page.waitForEvent('domcontentloaded', { timeout: 8000 }), announce(activeSocket)])
      await waitForText('')
      await draft.fill('machine B draft')
      await saved('machine-b', 'machine B draft')
      connectionProfile = 'machine-a'
      await Promise.all([page.waitForEvent('domcontentloaded', { timeout: 8000 }), announce(activeSocket)])
      await waitForText('machine A draft')
      await page.evaluate(() => { window.profileDocumentMarker = 'same' })
      announce(activeSocket)
      await page.waitForTimeout(2200)
      assert.equal(await page.evaluate(() => window.profileDocumentMarker), 'same')
      assert.equal(bootstrapReads, 3)
      await page.waitForFunction(isDark => document.documentElement.classList.contains('dark') === isDark, theme === 'dark')
      const screenshot = resolve(`output/playwright/connection-profiles-${theme}.png`)
      await page.screenshot({ path: screenshot, fullPage: true })
      console.log(JSON.stringify({ url, viewport, theme, bootstrapReads, result: 'App Server IDs isolate and restore drafts across reloads', screenshot }))
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
