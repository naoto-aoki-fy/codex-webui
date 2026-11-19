const { chromium } = require('playwright')
const { mkdirSync } = require('node:fs')
const { setup, assert } = require('./approved-fixture.cjs')

;(async () => {
  mkdirSync('output/playwright', { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const [width, height] of [[1280, 900], [375, 812], [768, 1024]]) {
      let signedIn = false
      let loginSequence = 0
      const page = await browser.newPage({ viewport: { width, height } })
      const fixture = await setup(page, ({ method, params }) => {
        let result
        if (method === 'account/read') {
          assert.deepEqual(params, { refreshToken: false })
          result = {
            account: signedIn ? { type: 'chatgpt', email: 'fixture@example.invalid', workspaceName: 'Fixture workspace' } : null,
            requiresOpenaiAuth: true,
          }
        } else if (method === 'thread/loaded/list') {
          result = { data: ['approved-fixture'], nextCursor: null }
        } else if (method === 'account/login/start') {
          const loginId = 'fixture-' + ++loginSequence
          result = params.type === 'chatgptDeviceCode'
            ? { type: params.type, loginId, verificationUrl: 'https://example.invalid/login', userCode: 'FIXTURE-CODE' }
            : { type: params.type, loginId, authUrl: 'https://example.invalid/login' }
        } else if (method === 'account/login/cancel') {
          assert.deepEqual(params, { loginId: 'fixture-1' })
          result = { status: 'canceled' }
        } else if (method === 'account/logout') {
          signedIn = false
          fixture.emit('account/updated', { authMode: null })
          result = {}
        } else if (method === 'turn/start') {
          return { status: 502, json: { error: 'Sign in on the App Server to send messages', rpcCode: -32600 } }
        } else {
          return
        }
        return { json: { result } }
      }, false)
      fixture.emit('ready', { ok: true })
      const settings = page.getByRole('dialog', { name: 'Settings' })
      const startButton = settings.getByRole('button', { name: 'Start native sign-in' })
      const openAccount = async () => {
        const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true })
        if (await expand.count()) await expand.click()
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await settings.waitFor()
      }
      const closeAccount = async () => {
        await settings.getByRole('button', { name: 'Close dialog' }).click()
        const collapse = page.locator('.mobile-drawer').getByRole('button', { name: 'Collapse sidebar', exact: true })
        if (width < 768 && await collapse.count()) await collapse.click()
      }
      const start = async () => {
        await settings.getByLabel('I confirm sign-in on this App Server.').check()
        await startButton.click()
        await settings.getByRole('link', { name: 'Open native sign-in page' }).waitFor()
      }
      const submit = async text => {
        const turn = page.waitForResponse(response => {
          const request = response.request()
          return request.method() === 'POST' && request.url().endsWith('/codex-api/rpc') && request.postDataJSON().method === 'turn/start'
        })
        await page.locator('.thread-composer-input').fill(text)
        await page.getByRole('button', { name: 'Send message', exact: true }).click()
        assert.equal((await turn).status(), 502)
        await page.getByText(/Sign in on the App Server to send messages/).first().waitFor()
        assert.equal(await page.getByText(/Submission outcome unknown/).count(), 0)
      }

      await submit('Signed-out submission')
      assert.equal(fixture.calls.filter(call => call.method === 'account/read').length, 0)
      await openAccount()
      await start()
      await closeAccount()
      await submit('Submission during login')
      await openAccount()
      await settings.getByRole('button', { name: 'Cancel native sign-in' }).click()
      await startButton.waitFor()

      await settings.getByRole('button', { name: 'ChatGPT browser sign-in' }).click()
      await settings.getByRole('button', { name: 'ChatGPT device-code sign-in', exact: true }).click()
      await start()
      const code = settings.getByText('FIXTURE-CODE', { exact: true })
      await code.waitFor()
      fixture.emit('account/login/completed', { loginId: 'unrelated', success: true })
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme)
        await code.scrollIntoViewIfNeeded()
        await page.waitForTimeout(2200)
        const panel = await settings.evaluate(el => getComputedStyle(el).backgroundColor)
        assert.equal(panel.includes('255, 255, 255'), theme === 'light')
        await page.screenshot({ path: `output/playwright/native-account-${width}-${theme}.png` })
      }

      fixture.emit('account/login/completed', { loginId: 'fixture-2', success: false, error: 'Device authorization denied' })
      await settings.getByRole('alert').filter({ hasText: 'Device authorization denied' }).waitFor()
      await start()
      signedIn = true
      fixture.emit('account/updated', { authMode: 'chatgpt' })
      fixture.emit('account/login/completed', { loginId: 'fixture-3', success: true })
      await settings.getByText('Signed in to Codex', { exact: true }).waitFor()
      await settings.getByText('Fixture workspace', { exact: true }).waitFor()
      assert.equal(await code.count(), 0)

      await settings.getByRole('button', { name: 'Logout' }).click()
      await startButton.waitFor()
      await closeAccount()
      const accountReads = fixture.calls.filter(call => call.method === 'account/read').length
      fixture.emit('app-server/disconnected', null)
      fixture.emit('app-server/reconnected', null)
      await submit('Submission after reconnect')
      assert.equal(fixture.calls.filter(call => call.method === 'account/read').length, accountReads)
      assert.equal(fixture.calls.filter(call => call.method === 'turn/start').length, 3)
      assert.equal(await page.getByText(/Verifying native account state/).count(), 0)
      assert.deepEqual(fixture.errors, [])
      await page.close()
      console.log(`PASS ${width}×${height}: signed-out and pending-login sends, native sign-in and cancellation, native errors, logout, reconnect and both themes`)
    }
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
