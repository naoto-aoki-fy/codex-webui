// Credential-free real-browser concurrency tests. Requires the current Vite server.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const base = 'http://127.0.0.1:4173'
const payload = text => ({ text, imageUrls: ['data:image/png;base64,AAAA'], fileAttachments: [{ label: 'a', path: '/a', fsPath: '/a' }], skills: [{ name: 'skill', path: '/skill' }], apps: [{ id: 'app', name: 'App' }] })
async function fixture(context) {
  const errors = [], calls = []
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  const threads = ['a', 'b'].map(id => ({ id, name: `Persistence ${id}`, cwd: '/remote/project', preview: `Conversation ${id}`, createdAt: 1, updatedAt: 1, status: { type: 'idle' } }))
  await context.route('**/codex-api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = {}; try { body = route.request().postDataJSON() || {} } catch {}
    calls.push(body)
    let result = {}
    if (body.method === 'native-authentication/read') result = { phase: 'ready', blocking: false, revision: 1 }
    if (body.method === 'thread/list') result = { data: threads, nextCursor: null }
    if (['thread/read', 'thread/resume'].includes(body.method)) result = { thread: { ...threads.find(t => t.id === body.params.threadId), turns: [] }, model: 'A', modelProvider: 'fixture' }
    if (body.method === 'model/list') result = { data: [{ id: 'A', model: 'A', isDefault: true }, { id: 'B', model: 'B' }], nextCursor: null }
    if (body.method === 'config/read') result = { config: { model: 'A', model_provider: 'fixture' } }
    if (body.method === 'skills/list') result = { data: [] }
    let json = { result }
    if (path.endsWith('/workspace-roots-state')) json = { data: { projectMode: 'native', nativeProjects: [{ id: 'p', name: 'Project', roots: [{ path: '/remote/project' }], position: 0, metadata: {} }], order: ['/remote/project'], active: [], labels: {}, projectOrder: ['p'] } }
    if (path.endsWith('/pending') || path.endsWith('/methods')) json = { data: [] }
    if (path.endsWith('/thread-pins')) json = { data: { threadIds: [] } }
    await route.fulfill({ json })
  })
  await context.routeWebSocket('**/codex-api/ws', ws => { setTimeout(() => ws.send(JSON.stringify({ method: 'ready', params: { backendInstanceId: 'fixture' } })), 50) })
  return { errors, calls }
}
async function open(context, thread = 'a', profile = 'legacy') {
  const page = await context.newPage()
  await page.goto(`${base}/?connection-profile=${profile}#/thread/${thread}`)
  await page.locator('.thread-composer-input').waitFor()
  return page
}
async function moduleCall(page, module, method, args = []) {
  return page.evaluate(async ({ module, method, args }) => (await import(`/src/utils/${module}.ts`))[method](...args), { module, method, args })
}
async function concurrency(browser, fallback) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  if (fallback) await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }))
  const observed = await fixture(context)
  const a = await open(context, 'a'), b = await open(context, 'b')
  await a.evaluate(() => {
    localStorage.setItem('codex-web-local.queue-submissions.v1', JSON.stringify({ legacy: 'old-client' }))
    localStorage.setItem('codex-web-local.prompt-library.v1', JSON.stringify({ presets: [{ id: 'legacy', name: 'Legacy', text: 'Existing user preset' }], history: ['Existing history'] }))
  })
  assert.deepEqual(await moduleCall(a, 'queueSubmissionReceipts', 'readQueueSubmissionReceipts'), { legacy: 'old-client' })
  await moduleCall(a, 'queueSubmissionReceipts', 'writeQueueSubmissionReceipt', ['legacy', null, 'old-client'])
  assert.deepEqual(await moduleCall(b, 'queueSubmissionReceipts', 'readQueueSubmissionReceipts'), {})
  assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('codex-web-local.queue-submissions.v1')).legacy), 'old-client')
  await Promise.all([a.locator('.thread-composer-input').fill('a own draft'), b.locator('.thread-composer-input').fill('b own draft')])
  await Promise.all([a.reload(), b.reload()])
  assert.equal(await a.locator('.thread-composer-input').inputValue(), 'a own draft')
  assert.equal(await b.locator('.thread-composer-input').inputValue(), 'b own draft')
  assert(a.url().endsWith('/a')); assert(b.url().endsWith('/b'))
  await b.goto(`${base}/?connection-profile=legacy#/thread/a`)
  await Promise.all([a.locator('.thread-composer-input').fill('same thread A'), b.locator('.thread-composer-input').fill('same thread B')])
  await Promise.all([a.reload(), b.reload()])
  assert.equal(await a.locator('.thread-composer-input').inputValue(), 'same thread A')
  assert.equal(await b.locator('.thread-composer-input').inputValue(), 'same thread B')
  await a.locator('.thread-composer-input').fill('')
  await b.reload(); assert.equal(await b.locator('.thread-composer-input').inputValue(), 'same thread B')

  // Simulate Duplicate Tab copying sessionStorage into a new document.
  const inherited = await b.evaluate(() => Object.entries(sessionStorage))
  const duplicate = await context.newPage()
  await duplicate.addInitScript(entries => { if (!sessionStorage.getItem('fixture-copy-done')) { for (const [k, v] of entries) sessionStorage.setItem(k, v); sessionStorage.setItem('fixture-copy-done', '1') } }, inherited)
  await duplicate.goto(b.url())
  assert.equal(await duplicate.locator('.thread-composer-input').inputValue(), 'same thread B')
  await Promise.all([b.locator('.thread-composer-input').fill('original tab'), duplicate.locator('.thread-composer-input').fill('duplicated tab')])
  await Promise.all([b.reload(), duplicate.reload()])
  assert.equal(await b.locator('.thread-composer-input').inputValue(), 'original tab')
  assert.equal(await duplicate.locator('.thread-composer-input').inputValue(), 'duplicated tab')
  await moduleCall(b, 'composerDraftStorage', 'persistDraftForThread', ['structured', payload('complete payload')])
  await b.reload()
  assert.deepEqual(await moduleCall(b, 'composerDraftStorage', 'loadPersistedDraftForThread', ['structured']), payload('complete payload'))

  // True simultaneous cross-page lock requests, including IndexedDB fallback.
  const burstStart = Date.now()
  await Promise.all(Array.from({ length: 16 }, (_, i) => moduleCall(i % 2 ? a : b, 'queueSubmissionReceipts', 'writeQueueSubmissionReceipt', [`queue-${i}`, `client-${i}`])))
  const receipts = await moduleCall(a, 'queueSubmissionReceipts', 'readQueueSubmissionReceipts')
  assert.equal(Object.keys(receipts).length, 16)
  console.log(JSON.stringify({ fixture: true, receiptTransactions: 16, burstMs: Date.now() - burstStart, retainedReceipts: Object.keys(receipts).length, webLocksDisabled: fallback }))
  const same = await Promise.allSettled([moduleCall(a, 'queueSubmissionReceipts', 'writeQueueSubmissionReceipt', ['same', 'first']), moduleCall(b, 'queueSubmissionReceipts', 'writeQueueSubmissionReceipt', ['same', 'second'])])
  assert.equal(same.filter(r => r.status === 'fulfilled').length, 1)
  await moduleCall(a, 'queueSubmissionReceipts', 'writeQueueSubmissionReceipt', ['queue-0', null, 'wrong'])
  assert.equal((await moduleCall(b, 'queueSubmissionReceipts', 'readQueueSubmissionReceipts'))['queue-0'], 'client-0')
  await Promise.all([moduleCall(a, 'queueSubmissionReceipts', 'writeQueueSubmissionReceipt', ['queue-0', null, 'client-0']), moduleCall(b, 'queueSubmissionReceipts', 'writeQueueSubmissionReceipt', ['queue-1', null, 'client-1'])])
  await a.reload()
  assert.equal(Object.keys(await moduleCall(a, 'queueSubmissionReceipts', 'readQueueSubmissionReceipts')).length, 15)

  for (const key of ['selected-model-by-context.v2', 'collaboration-mode-by-context.v2']) {
    const root = `codex-web-local.${key}`
    const valueA = key.startsWith('selected-model') ? 'provider-model:["fixture","B"]' : 'plan'
    const valueB = key.startsWith('selected-model') ? 'provider-model:["fixture","A"]' : 'plan'
    await Promise.all([moduleCall(a, 'browserPreferenceRecords', 'savePreferenceRecords', [root, { a: valueA }, {}]), moduleCall(b, 'browserPreferenceRecords', 'savePreferenceRecords', [root, { b: valueB }, {}])])
    assert.deepEqual(await moduleCall(a, 'browserPreferenceRecords', 'readPreferenceRecords', [root, {}]), { a: valueA, b: valueB })
    if (key.startsWith('selected-model')) await b.locator('.thread-composer .composer-dropdown-trigger').filter({ hasText: /^B$/ }).waitFor()
  }
  // Recovering a copy archives the currently edited payload before replacement.
  await b.getByRole('button', { name: 'Recover saved drafts', exact: true }).click()
  await b.getByRole('button', { name: 'Recover copy: same thread A', exact: true }).first().click()
  assert.equal(await b.locator('.thread-composer-input').inputValue(), 'same thread A')
  assert((await moduleCall(b, 'composerDraftStorage', 'recoverableDrafts', ['a'])).some(row => row.draft.text === 'original tab'))
  await b.reload(); assert.equal(await b.locator('.thread-composer-input').inputValue(), 'same thread A')
  // Real storage events refresh ordinary UI settings without moving either route.
  const url = b.url()
  await a.evaluate(() => localStorage.setItem('codex-web-local.dark-mode.v1', 'dark'))
  await b.waitForFunction(() => document.documentElement.classList.contains('dark'))
  assert.equal(b.url(), url)
  await b.getByRole('button', { name: 'Add attachments and settings', exact: true }).click()
  await b.getByRole('button', { name: 'Prompts & commands', exact: true }).click()
  await a.getByRole('button', { name: 'Add attachments and settings', exact: true }).click()
  await a.getByRole('button', { name: 'Prompts & commands', exact: true }).click()
  for (const [page, name] of [[a, 'A'], [b, 'B']]) {
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name)
    await page.getByRole('textbox', { name: 'Preset text', exact: true }).fill(`${name} text`)
  }
  await Promise.all([a.getByRole('button', { name: 'Save text preset', exact: true }).click(), b.getByRole('button', { name: 'Save text preset', exact: true }).click()])
  await b.getByRole('button', { name: 'Use preset A', exact: true }).waitFor()
  await b.getByRole('button', { name: 'Use preset B', exact: true }).waitFor()
  assert.equal((await moduleCall(a, 'promptLibrary', 'loadPromptLibrary')).presets.length, 3)
  assert.equal(await moduleCall(a, 'promptLibrary', 'promptHistoryEnabled'), false)
  await moduleCall(a, 'promptLibrary', 'recordSubmittedPrompt', ['off by default'])
  assert.deepEqual((await moduleCall(a, 'promptLibrary', 'loadPromptLibrary')).history, ['Existing history'])
  await b.getByRole('button', { name: 'Enable recent prompt history', exact: true }).click()
  await b.getByRole('button', { name: 'Close prompts', exact: true }).click()
  await moduleCall(a, 'promptLibrary', 'recordSubmittedPrompt', ['opted-in text'])
  await b.getByRole('button', { name: 'Add attachments and settings', exact: true }).click()
  await b.getByRole('button', { name: 'Prompts & commands', exact: true }).click()
  await b.getByRole('button', { name: 'opted-in text', exact: true }).waitFor()
  await b.getByRole('button', { name: 'Clear recent prompt history', exact: true }).click()
  await b.getByRole('button', { name: 'opted-in text', exact: true }).waitFor({ state: 'detached' })
  assert.equal((await moduleCall(a, 'promptLibrary', 'loadPromptLibrary')).presets.length, 3)
  assert.equal(await a.evaluate(() => localStorage.getItem('codex-web-local.prompt-library.v1')), null)
  assert.equal(observed.calls.filter(c => c.method === 'thread/queue/add' || c.method === 'turn/start').length, 0)

  if (!fallback && process.env.PERSISTENCE_SCREENSHOTS !== '0') {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      await b.setViewportSize(viewport)
      for (const theme of ['light', 'dark']) {
        await a.evaluate(theme => localStorage.setItem('codex-web-local.dark-mode.v1', theme), theme)
        await b.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark')
        await b.waitForTimeout(2200)
        const screenshot = `output/playwright/browser-persistence-${viewport.width}-${theme}.png`
        await b.screenshot({ path: screenshot, fullPage: true })
        console.log(JSON.stringify({ url: b.url(), viewport, theme, screenshot, result: 'prompt presets, opt-in and cross-tab settings visible' }))
      }
    }
  }
  await a.goto(`${base}/?connection-profile=legacy#/`)
  assert(a.url().endsWith('#/'))
  assert.equal(await a.locator('.thread-composer-input').inputValue(), '')
  assert.deepEqual(observed.errors, [])
  const named = await open(context, 'a', 'named')
  assert.deepEqual(await moduleCall(named, 'queueSubmissionReceipts', 'readQueueSubmissionReceipts'), {})
  assert.deepEqual(await moduleCall(named, 'promptLibrary', 'loadPromptLibrary'), { presets: [], history: [] })
  assert.equal(await moduleCall(named, 'composerDraftStorage', 'loadPersistedDraftForThread', ['structured']), null)
  await moduleCall(named, 'queueSubmissionReceipts', 'writeQueueSubmissionReceipt', ['named-only', 'named-client'])
  assert.equal((await moduleCall(b, 'queueSubmissionReceipts', 'readQueueSubmissionReceipts'))['named-only'], undefined)
  await named.close()
  const before = await moduleCall(b, 'queueSubmissionReceipts', 'readQueueSubmissionReceipts')
  await b.evaluate(() => Object.defineProperty(window, 'indexedDB', { value: undefined }))
  const denied = await Promise.allSettled([moduleCall(b, 'queueSubmissionReceipts', 'writeQueueSubmissionReceipt', ['unsafe', 'never-sent']), moduleCall(b, 'promptLibrary', 'clearPromptHistory')])
  assert(denied.every(result => result.status === 'rejected'))
  assert.deepEqual(await moduleCall(a, 'queueSubmissionReceipts', 'readQueueSubmissionReceipts'), before)
  await context.close()
  console.log(`PASS real-tab navigation, drafts, duplicate identity, structured reload, receipts, presets and storage events (IndexedDB transactions; Web Locks ${fallback ? 'disabled' : 'available'})`)
}
;(async () => {
  fs.mkdirSync('output/playwright', { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try { await concurrency(browser, false); await concurrency(browser, true) } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
