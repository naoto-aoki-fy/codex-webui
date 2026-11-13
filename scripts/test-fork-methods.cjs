// Mocked browser regression checks. Start the current worktree on port 4173 first.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const baseUrl = 'http://127.0.0.1:4173'
const output = resolve('output/playwright')
mkdirSync(output, { recursive: true })
const sourceTurn = n => ({ id: `t${n}`, status: 'completed', items: [
  { id: `u${n}`, type: 'userMessage', content: [{ type: 'text', text: `Original question ${n}` }] },
  { id: `a${n}`, type: 'agentMessage', text: `Original answer ${n}` },
] })
const source = { id: 'source', name: 'Fork methods source', preview: 'Fork methods source', cwd: '/workspace',
  createdAt: 1700000000, updatedAt: 1700000001, modelProvider: 'P', model: 'A', status: { type: 'idle' },
  turns: Array.from({ length: 3 }, (_, n) => sourceTurn(n)),
}
const mutations = new Set(['conversation-transfer/create', 'thread/fork', 'thread/fork-at-response', 'thread/start', 'thread/inject_items', 'turn/start'])

async function check(browser, entry, method, { prepareFails = false, nativeFails = false, pendingPreparation = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const calls = []
  const conversation = structuredClone(source)
  const preparations = []
  const snapshots = new Map()
  const destinations = new Map()
  let snapshotNumber = 0
  let rejectNative = nativeFails
  await page.route('**/codex-api/**', async route => {
    const request = route.request()
    if (request.url().includes('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': mock\n\n' })
    const body = request.postDataJSON()
    const rpc = body?.method
    const params = body?.params || {}
    if (rpc) calls.push({ method: rpc, params })
    let result = {}
    if (rpc === 'thread/list') result = { data: [conversation, ...[...destinations.values()].map(row => row.thread)], nextCursor: null }
    if (rpc === 'thread/read' || rpc === 'thread/resume') result = destinations.get(params.threadId) || { thread: conversation, model: 'A', modelProvider: 'P' }
    if (rpc === 'modelProvider/list') result = { data: [{ id: 'P', displayName: 'Source', isDefault: true }, { id: 'Q', displayName: 'Destination' }] }
    if (rpc === 'model/providerCatalog' || rpc === 'model/list') result = { data: [{ id: params.provider === 'Q' ? 'C' : 'A', displayName: params.provider === 'Q' ? 'C' : 'A' }] }
    if (rpc === 'account/read') result = { account: { type: 'apiKey' } }
    if (rpc === 'config/read') result = { config: { model: 'A', model_provider: 'P' } }
    if (rpc === 'threadSection/list') result = { data: [] }
    if (rpc === 'conversation-transfer/prepare') {
      if (prepareFails) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'History exceeds the 8 MiB transfer request limit. No thread was created.' }) })
      const turns = structuredClone(params.turnIndex === undefined ? conversation.turns : conversation.turns.slice(0, params.turnIndex + 1))
      const id = `snapshot-${++snapshotNumber}`
      snapshots.set(id, turns)
      if (pendingPreparation) await new Promise(resolve => preparations.push({ id, resolve }))
      result = { id, warnings: ['Images and execution state are omitted.'], messageCount: turns.length * 2 }
    }
    if (rpc === 'conversation-transfer/cancel') snapshots.delete(params.id)
    if (rpc === 'thread/fork' || rpc === 'thread/fork-at-response') {
      if (rejectNative) {
        rejectNative = false
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Method not found: thread/fork' }) })
      }
      assert.equal(params.modelProvider, undefined)
      assert.equal(params.model, undefined)
      const turns = rpc === 'thread/fork' ? conversation.turns : conversation.turns.slice(0, params.forkFromTurnIndex + 1)
      const destination = { thread: { ...conversation, id: 'native', turns }, model: 'A', modelProvider: 'P' }
      destinations.set('native', destination)
      result = { ...destination, forkCutoff: { sourceThreadId: 'source', turnIndex: params.forkFromTurnIndex,
        turnId: turns.at(-1).id, turnCount: turns.length } }
    }
    if (rpc === 'conversation-transfer/create') {
      const turns = snapshots.get(params.id)
      assert(turns, 'prepared portable snapshot required')
      const importedTranscript = turns.flatMap(turn => turn.items.map(item => ({ role: item.type === 'userMessage' ? 'user' : 'assistant',
        text: item.text || item.content[0].text, source: 'source (P / A)',
      })))
      destinations.set('imported', { thread: { ...conversation, id: 'imported', turns: [] }, model: params.model,
        modelProvider: params.modelProvider, importedTranscript, importStage: 'ready' })
      result = { threadId: 'imported', model: params.model, modelProvider: params.modelProvider, warnings: [] }
    }
    if (rpc === 'turn/start') result = { turn: { id: 'explicit-turn', status: 'inProgress', items: [] } }
    // Keep the confirmation pending long enough to exercise duplicate clicks.
    if (mutations.has(rpc)) await new Promise(resolve => setTimeout(resolve, 150))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) })
  })
  async function releasePreparation() {
    assert.equal(preparations.length, 1)
    const preparation = preparations.shift()
    const cancelled = page.waitForRequest(request => {
      const body = request.postDataJSON()
      return body?.method === 'conversation-transfer/cancel' && body.params.id === preparation.id
    })
    preparation.resolve()
    await cancelled
  }
  async function openPicker() {
    if (entry === 'response') await page.getByRole('button', { name: 'Fork thread from this response', exact: true }).first().click()
    else {
      const row = page.locator('.thread-row').filter({ hasText: 'Fork methods source' }).first()
      await row.hover()
      await row.getByTitle('thread_menu', { exact: true }).click()
      await page.getByRole('button', { name: 'Create chat fork', exact: true }).click()
    }
    await page.getByRole('dialog', { name: 'Transfer conversation' }).waitFor()
    assert.equal(await page.locator('.transfer-picker').getByRole('button', { name: 'Portable Transfer', exact: true }).count(), 1)
  }
  async function selectMethod(value) {
    const dialog = page.locator('.transfer-picker')
    await dialog.locator('.composer-dropdown-trigger').first().click()
    await dialog.getByRole('listbox').getByRole('button', { name: value === 'native' ? 'Native Fork' : 'Portable Transfer', exact: true }).click()
  }
  async function selectProvider() {
    await page.getByRole('button', { name: 'Provider / model', exact: true }).click()
    await page.getByRole('listbox').getByRole('button', { name: 'Q — C', exact: true }).click()
  }
  await page.goto(`${baseUrl}/#/thread/source`)
  await page.getByText('Original answer 0', { exact: true }).waitFor()
  await page.locator('textarea').fill('Unsent source draft')
  await openPicker()
  await selectMethod(method)
  if (method === 'native') assert.equal(await page.getByRole('button', { name: 'Provider / model', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(calls.filter(call => mutations.has(call.method)).length, 0, 'cancel must not create or generate')
  assert.equal(await page.locator('textarea').inputValue(), 'Unsent source draft')
  if (pendingPreparation) await releasePreparation()
  await openPicker()
  await selectMethod(method)
  if (method === 'portable') await selectProvider()
  if (entry === 'response') conversation.turns.push(sourceTurn(3))
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
    await page.waitForTimeout(2200)
    const path = resolve(output, `fork-methods-${entry}-${method}-${theme}.png`)
    await page.screenshot({ path })
    const background = await page.locator('.transfer-picker').evaluate(el => getComputedStyle(el).backgroundColor)
    assert.equal(background, theme === 'dark' ? 'rgb(32, 33, 36)' : 'rgb(255, 255, 255)')
  }
  await page.getByRole('button', { name: method === 'native' ? 'Create native fork' : 'Create conversation', exact: true }).dblclick()
  let effectiveMethod = method
  if (nativeFails) {
    await page.getByRole('alert').filter({ hasText: 'Native Fork failed' }).waitFor()
    assert.equal(calls.filter(call => call.method === 'conversation-transfer/create').length, 0, 'no silent fallback')
    await selectMethod('portable')
    await selectProvider()
    await page.getByRole('button', { name: 'Create conversation', exact: true }).click()
    effectiveMethod = 'portable'
  }
  const destinationId = effectiveMethod === 'native' ? 'native' : 'imported'
  await page.waitForURL(`**/#/thread/${destinationId}`)
  if (pendingPreparation) await releasePreparation()
  await page.getByText('Original answer 0', { exact: effectiveMethod === 'native' }).waitFor()
  await page.reload()
  await page.getByText('Original answer 0', { exact: effectiveMethod === 'native' }).waitFor()
  assert.equal((await page.locator('body').innerText()).includes('[Imported context from'), effectiveMethod === 'portable')
  assert.equal((await page.locator('body').innerText()).includes('Original answer 2'), entry === 'full')
  assert.equal((await page.locator('body').innerText()).includes('Original answer 3'), false)
  const creationCalls = calls.filter(call => mutations.has(call.method))
  assert.equal(creationCalls.length, nativeFails ? 2 : 1, 'one creation per explicit confirmation')
  assert.equal(creationCalls.at(-1).method, effectiveMethod === 'native' ? (entry === 'full' ? 'thread/fork' : 'thread/fork-at-response') : 'conversation-transfer/create')
  await page.locator('textarea').fill('Explicit next message')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '')
  const sends = calls.filter(call => call.method === 'turn/start')
  assert.equal(sends.length, 1)
  assert.equal(sends[0].params.model, effectiveMethod === 'native' ? 'A' : 'C')
  assert.equal(calls.filter(call => ['thread/start', 'thread/inject_items'].includes(call.method)).length, 0, 'portable creation is mocked at the backend service boundary')
  assert.deepEqual(errors, [])
  const report = { entry, method, prepareFails, nativeFails, pendingPreparation, url: page.url(), viewport: { width: 1280, height: 900 },
    creationCalls, explicitSends: sends.length, importedAfterReload: effectiveMethod === 'portable', assertions: 'passed' }
  await context.close()
  return report
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const reports = []
    for (const entry of ['full', 'response']) for (const method of ['portable', 'native']) reports.push(await check(browser, entry, method))
    reports.push(await check(browser, 'response', 'native', { prepareFails: true }))
    reports.push(await check(browser, 'full', 'native', { nativeFails: true }))
    reports.push(await check(browser, 'response', 'native', { pendingPreparation: true }))
    writeFileSync(resolve(output, 'fork-methods-results.json'), JSON.stringify(reports, null, 2))
    console.log(JSON.stringify(reports, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
