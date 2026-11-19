const { chromium } = require('playwright')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { transpileModule, ModuleKind } = require('typescript')
const { setup, assert } = require('./approved-fixture.cjs')

// Load the production guard against an isolated native protocol fixture.
function loadServerModule(name) {
  const module = { exports: {} }
  const source = readFileSync(join(__dirname, '../src/server', name + '.ts'), 'utf8')
  const { outputText } = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: 9 } })
  new Function('exports', 'require', 'module', outputText)(module.exports, path => {
    if (path === './publicAccount.js') return loadServerModule('publicAccount')
    return require(path)
  }, module)
  return module.exports
}
const { NativeAuthenticationStateMachine } = loadServerModule('nativeAuthenticationState')

async function until(predicate) {
  for (let index = 0; index < 150; index++) {
    if (predicate()) return
    await new Promise(done => setTimeout(done, 20))
  }
  throw new Error('Timed out waiting for backend account state')
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const [width, height] of [[1280, 900], [375, 812], [768, 1024]]) {
      let signedIn = false
      let loginSequence = 0
      let workspace = 'workspace-1'
      const upstreamCalls = []
      const page = await browser.newPage({ viewport: { width, height } })
      let client
      const guard = new NativeAuthenticationStateMachine(async (method, params) => {
        upstreamCalls.push(method)
        if (method === 'account/read') return {
          account: signedIn ? { type: 'chatgpt', email: 'fixture@example.invalid', workspaceName: 'Fixture workspace', accessToken: 'PRIVATE_FIXTURE_TOKEN' } : null,
          requiresOpenaiAuth: true,
        }
        if (method === 'accountSession/list') return {
          activeSessionId: 'session-1',
          sessions: [{ sessionId: 'session-1', isActive: true, userId: 'user-1', selectedWorkspaceAccountId: workspace }],
        }
        if (method === 'account/login/start') {
          const loginId = 'fixture-' + ++loginSequence
          return params.type === 'chatgptDeviceCode'
            ? { type: params.type, loginId, verificationUrl: 'https://example.invalid/login', userCode: 'FIXTURE-CODE', accessToken: 'PRIVATE_FIXTURE_TOKEN' }
            : { type: params.type, loginId, authUrl: 'https://example.invalid/login' }
        }
        if (method === 'account/login/cancel') return { status: 'canceled' }
        if (method === 'account/logout') { signedIn = false; return {} }
        throw new Error('Unexpected upstream request ' + method)
      }, state => client?.emit('native-authentication/state', state))

      client = await setup(page, async body => {
        try {
          let result
          if (body.method === 'native-authentication/read') result = await guard.read()
          else if (body.method === 'native-authentication/reconcile') result = await guard.reconcile(body.params)
          else if (body.method === 'account/login/start') result = await guard.start(body.params)
          else if (body.method === 'account/login/cancel') result = await guard.cancel(body.params)
          else if (body.method === 'account/logout') result = await guard.logout()
          else if (body.method === 'thread/loaded/list') result = { data: ['approved-fixture'], nextCursor: null }
          else return
          assert(!JSON.stringify(result).includes('PRIVATE_FIXTURE_TOKEN'))
          return { json: { result } }
        } catch (error) {
          return { status: 502, json: { error: error.message, rpcCode: error.code } }
        }
      }, false)
      client.emit('ready', { ok: true })
      const settings = page.getByRole('dialog', { name: 'Settings' })
      const openAccount = async () => {
        await page.getByRole('button', { name: 'Open native sign-in controls' }).click()
        await settings.waitFor()
      }
      const start = async () => {
        await settings.getByLabel('I confirm sign-in on this App Server.').check()
        await settings.getByRole('button', { name: 'Start native sign-in' }).click()
        await settings.getByRole('link', { name: 'Open native sign-in page' }).waitFor()
      }

      await until(() => guard.snapshot().phase === 'signedOut')
      await openAccount()
      await start()
      await page.reload()
      await page.getByText('Fixture answer', { exact: true }).waitFor()
      await page.waitForTimeout(250)
      client.emit('ready', { ok: true, reconnected: true })
      await openAccount()
      const cancel = settings.getByRole('button', { name: 'Cancel native sign-in' })
      await cancel.waitFor()
      assert.equal(await settings.getByRole('link', { name: 'Open native sign-in page' }).count(), 0)
      await cancel.click()
      await until(() => guard.snapshot().phase === 'signedOut')
      assert.deepEqual(client.calls.find(call => call.method === 'account/login/cancel').params, { loginId: 'fixture-1' })

      await settings.getByRole('button', { name: 'ChatGPT browser sign-in' }).click()
      await settings.getByRole('button', { name: 'ChatGPT device-code sign-in', exact: true }).click()
      await start()
      await settings.getByText('FIXTURE-CODE', { exact: true }).waitFor()
      guard.observe('account/login/completed', { loginId: 'unrelated', success: true })
      assert.equal(guard.snapshot().phase, 'pending')
      signedIn = true
      guard.observe('account/login/completed', { loginId: 'fixture-2', success: true })
      await settings.getByText('Signed in to Codex', { exact: true }).waitFor()
      assert.equal(await settings.getByText('FIXTURE-CODE', { exact: true }).count(), 0)

      const before = upstreamCalls.filter(method => method === 'account/read').length
      for (let index = 0; index < 20; index++) guard.observe('account/updated', {})
      await until(() => guard.snapshot().phase === 'ready')
      assert.equal(upstreamCalls.filter(method => method === 'account/read').length - before, 1)

      workspace = 'workspace-2'
      guard.observe('account/updated', {})
      await settings.getByRole('button', { name: 'Use this account' }).waitFor()
      assert(await page.locator('.thread-composer-input').isDisabled())
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme)
        await settings.getByRole('button', { name: 'Use this account' }).scrollIntoViewIfNeeded()
        await page.waitForTimeout(2200)
        await page.screenshot({ path: `output/playwright/auth-context-change-${width}-${theme}.png` })
      }
      await settings.getByLabel('I confirm this account and workspace.').check()
      await settings.getByRole('button', { name: 'Use this account' }).click()
      await settings.getByText('Signed in to Codex', { exact: true }).waitFor()
      await settings.getByRole('button', { name: 'Logout' }).click()
      await settings.getByRole('button', { name: 'Start native sign-in' }).waitFor()
      assert(await page.locator('.thread-composer-input').isDisabled())
      assert.equal(client.calls.filter(call => call.method === 'thread/loaded/list').length, 2)
      assert(!client.calls.some(call => ['account/read', 'turn/start', 'configRequirements/read'].includes(call.method)))
      assert.deepEqual(client.errors, [])
      guard.dispose()
      await page.close()
      console.log(`PASS ${width}×${height}: native sign-in, pending reload and cancellation, workspace acknowledgment, logout, and one read per burst`)
    }
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
