// Mocked browser regression checks. Start the current worktree on port 4173 first.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const baseUrl = 'http://127.0.0.1:4173'
const output = resolve('output/playwright')
mkdirSync(output, { recursive: true })
const sourceTurn = n => ({ id: `t${n}`, status: 'completed', items: [
  { id: `u${n}`, type: 'userMessage', content: [{ type: 'text', text: `Original question ${n}` }, { type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRwAAAABJRU5ErkJggg==' }] },
  { id: `cmd${n}`, type: 'commandExecution', command: 'historical command', cwd: '/workspace', status: 'completed', aggregatedOutput: 'TOOL_ONLY_SECRET', exitCode: 0, commandActions: [] },
  { id: `reason${n}`, type: 'reasoning', content: ['REASONING_ONLY_SECRET'], summary: [], encrypted_content: 'REASONING_ONLY_SECRET' },
  { id: `a${n}`, type: 'agentMessage', text: `Original answer ${n}` },
] })
const textTranscript = (turns, provider = 'P') => turns.flatMap(turn => turn.items.flatMap(item => {
  const text = item.type === 'userMessage'
    ? item.content.filter(content => content.type === 'text').map(content => content.text).join('\n')
    : item.type === 'agentMessage' ? item.text : ''
  return text.trim() ? [{ role: item.type === 'userMessage' ? 'user' : 'assistant', text, source: `source (${provider} / A)` }] : []
}))
const source = { id: 'source', name: 'Fork methods source', preview: 'Fork methods source', cwd: '/workspace',
  createdAt: 1700000000, updatedAt: 1700000001, modelProvider: 'P', model: 'A', status: { type: 'idle' },
  turns: Array.from({ length: 3 }, (_, n) => sourceTurn(n)),
}
const mutations = new Set(['conversation-transfer/create', 'thread/fork', 'thread/fork-at-response', 'thread/start', 'thread/inject_items', 'turn/start'])

async function check(browser, entry, method, { prepareFails = false, nativeFails = false, pendingPreparation = false, importedOnly = false, sameProvider = false, providers = ['P', 'Q'], composerProvider = 'P' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const calls = []
  const conversation = { ...structuredClone(source), modelProvider: composerProvider }
  if (importedOnly) conversation.turns = []
  const importedPrefix = textTranscript([sourceTurn(0)], composerProvider)
  const preparations = []
  const snapshots = new Map()
  const destinations = new Map()
  let snapshotNumber = 0
  let rejectNative = nativeFails
  let skillHubReads = 0
  const defaultProvider = providers.find(provider => provider !== conversation.modelProvider) || providers[0]
  const providerLabel = provider => ({ P: 'Source', Q: 'Destination', R: 'Third provider' })[provider]
  const initialProvider = providers.includes(composerProvider) ? composerProvider : defaultProvider
  const destinationProvider = sameProvider ? composerProvider : defaultProvider
  const destinationDefault = destinationProvider === 'P' ? 'A' : 'C'
  await page.route('**/codex-api/**', async route => {
    const request = route.request()
    if (request.url().includes('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': mock\n\n' })
    if (request.url().endsWith('/thread-pins')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { threadIds: [] } }) })
    if (request.url().endsWith('/skills-hub')) {
      skillHubReads++
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ installed: [{ name: 'Review skill', description: 'Existing skill configuration', path: '/skills/review/SKILL.md', enabled: true }] }) })
    }
    if (request.url().includes('/skills-hub/readme')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: '# Review skill' }) })
    const body = request.postDataJSON()
    const rpc = body?.method
    const params = body?.params || {}
    if (rpc) calls.push({ method: rpc, params })
    let result = {}
    if (rpc === 'thread/list') result = { data: [conversation, ...[...destinations.values()].map(row => row.thread)], nextCursor: null }
    if (rpc === 'thread/read' || rpc === 'thread/resume') result = destinations.get(params.threadId) || { thread: conversation, model: 'A', modelProvider: composerProvider, ...(importedOnly ? { importedTranscript: importedPrefix, importStage: 'ready' } : {}) }
    if (rpc === 'modelProvider/list') result = { data: providers.map(id => ({ id, displayName: providerLabel(id), isDefault: id === 'P' })) }
    if (rpc === 'model/list') result = { data: params.modelProvider !== 'P'
      ? [{ id: 'A', displayName: 'Alternate', priority: 9 }, { id: 'C', displayName: 'C', priority: 0, isDefault: true }, { id: 'D', displayName: 'D', priority: 1 }]
      : [{ id: 'A', displayName: 'A', priority: 0 }, { id: 'P-only', displayName: 'P only', priority: 1 }] }
    if (rpc === 'account/read') result = { account: { type: 'apiKey' } }
    if (rpc === 'native-authentication/read') result = { phase: 'ready', blocking: false, revision: 1 }
    if (rpc === 'config/read') result = { config: { model: 'A', model_provider: 'P' } }
    if (rpc === 'model-preferences/read') result = { schemaVersion: 1, revision: 1,
      preferred: { providerId: 'P', modelId: 'A', reasoningEffort: '', collaborationMode: 'default' },
      lastUsed: null, reasoningByModel: {}, modelUsage: {} }
    if (rpc === 'threadSection/list') result = { data: [] }
    if (rpc === 'conversation-transfer/prepare') {
      if (prepareFails) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'History exceeds the 8 MiB transfer request limit. No thread was created.' }) })
      const turns = structuredClone(params.revertTarget ? conversation.turns.slice(0, conversation.turns.findIndex(turn => turn.id === params.revertTarget.turnId)) : importedOnly ? [sourceTurn(0)] : params.turnIndex === undefined ? conversation.turns : conversation.turns.slice(0, params.turnIndex + 1))
      if (entry === 'revert') assert.deepEqual(params.revertTarget, { turnId: 't1', messageId: 'u1' })
      const id = `snapshot-${++snapshotNumber}`
      snapshots.set(id, turns)
      if (pendingPreparation) await new Promise(resolve => preparations.push({ id, resolve }))
      result = { id, warnings: [], messageCount: turns.length * 2, sourceModelProvider: conversation.modelProvider }
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
      assert.equal(params.modelProvider, destinationProvider)
      assert.equal(params.model, destinationDefault, 'creation must use the provider default, not the shared source model')
      const turns = snapshots.get(params.id)
      assert(turns, 'prepared portable snapshot required')
      const importedTranscript = textTranscript(turns, composerProvider)
      destinations.set('imported', { thread: { ...conversation, id: 'imported', turns: [] }, model: params.model,
        modelProvider: params.modelProvider, importedTranscript, importStage: 'ready' })
      result = { threadId: 'imported', model: params.model, modelProvider: params.modelProvider, warnings: [], ...(entry === 'revert' ? { draftText: 'Original question 1' } : {}) }
    }
    if (rpc === 'turn/start') result = { turn: { id: 'explicit-turn', status: 'inProgress', items: [] } }
    // Keep the confirmation pending long enough to exercise duplicate clicks.
    if (mutations.has(rpc)) await new Promise(resolve => setTimeout(resolve, 150))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result }) })
  })
  async function releasePreparation(cancelled = false) {
    assert.equal(preparations.length, 1)
    const preparation = preparations.shift()
    const cancellation = cancelled ? page.waitForRequest(request => {
      const body = request.postDataJSON()
      return body?.method === 'conversation-transfer/cancel' && body.params.id === preparation.id
    }) : Promise.resolve()
    preparation.resolve()
    await cancellation
  }
  async function splitButton() {
    if (entry === 'full') {
      const row = page.locator('.thread-row').filter({ hasText: 'Fork methods source' }).first()
      if (!await page.locator('.thread-menu-panel').count()) {
        await row.hover()
        await row.getByTitle('thread_menu', { exact: true }).click()
      }
      return page.locator('.thread-menu-panel .fork-split-button')
    }
    const split = entry === 'revert' ? page.locator('.message-toolbar .message-revert-split').nth(1) : page.locator('.message-toolbar .fork-split-button').first()
    await split.hover()
    return split
  }
  async function openOptions() {
    const split = await splitButton()
    const before = calls.length
    await split.getByRole('button', { name: entry === 'revert' ? 'Revert options' : 'Fork options', exact: true }).click()
    await split.getByRole('listbox').waitFor()
    assert.equal(calls.slice(before).filter(call => mutations.has(call.method) || call.method === 'conversation-transfer/prepare').length, 0, 'opening the arrow must do no work')
    assert.equal(await split.getByRole('button', { name: entry === 'revert' ? 'Fork and Revert (Native)' : 'Native Fork', exact: true }).count(), 1)
    assert.equal(await split.getByRole('button', { name: entry === 'revert' ? 'Portable Fork and Revert' : 'Portable Fork', exact: true }).count(), 1)
    return split
  }
  async function choosePortable() {
    const split = await openOptions()
    await split.getByRole('button', { name: entry === 'revert' ? 'Portable Fork and Revert' : 'Portable Fork', exact: true }).click()
    await page.getByRole('dialog', { name: 'Transfer conversation' }).waitFor()
    assert.equal(await page.locator('.transfer-picker').getByText('Native Fork', { exact: true }).count(), 0)
    assert.equal((await page.locator('.transfer-picker').innerText()).includes('omitted'), false)
    if (!pendingPreparation && !prepareFails) await page.locator('.transfer-picker').getByRole('button', { name: providerLabel(initialProvider), exact: true }).waitFor()
    if (prepareFails) await page.getByRole('alert').filter({ hasText: '8 MiB' }).waitFor()
    assert.equal(await page.locator('.transfer-picker .composer-dropdown').count(), pendingPreparation ? 0 : 1)
    assert.equal(await page.locator('.transfer-picker').getByText(/skills/i).count(), 0)
    assert.equal(await page.locator('.transfer-skills, #transfer-skills-body').count(), 0)
    assert.equal(await page.locator('.transfer-picker .skills-hub').count(), 0)
    assert.equal(skillHubReads, 0, 'portable dialog must not load the Skills manager')
    assert.equal(calls.filter(call => call.method === 'skills/config/write').length, 0, 'portable dialog must not change skill configuration')
  }
  async function selectProvider() {
    const picker = page.locator('.transfer-picker')
    await picker.getByRole('button', { name: providerLabel(initialProvider), exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Create conversation', exact: true }).isEnabled(), true)
    await picker.locator('.composer-dropdown-trigger').click()
    assert.deepEqual(await picker.getByRole('listbox').getByRole('button').allTextContents(), providers.map(providerLabel))
    assert.equal(await picker.locator('.composer-dropdown-option.is-selected').innerText(), providerLabel(initialProvider))
    await picker.getByRole('listbox').getByRole('button', { name: providerLabel(destinationProvider), exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Create conversation', exact: true }).isEnabled(), true)
  }
  await page.goto(`${baseUrl}/#/thread/source`)
  await page.getByText('Original answer 0', { exact: true }).waitFor()
  const composerModelLabel = composerProvider === 'P' ? 'A' : 'Alternate'
  await page.getByRole('button', { name: composerModelLabel, exact: true }).click()
  const sourceModels = composerProvider === 'P' ? ['A', 'P only'] : ['Alternate', 'C', 'D']
  await page.getByRole('listbox').getByRole('button', { name: sourceModels[1], exact: true }).waitFor()
  assert.deepEqual(await page.getByRole('listbox').getByRole('button').allTextContents(), sourceModels)
  await page.keyboard.press('Escape')
  await page.locator('textarea').fill('Unsent source draft')
  // Verify menu styling and shared Revert dropdown wiring on the actual source UI.
  const options = await openOptions()
  if (importedOnly) {
    assert.equal(await options.locator('.fork-split-main').isDisabled(), true)
    assert.match(await options.locator('.fork-split-main').getAttribute('title'), /no native turn boundary/)
    assert.equal(await options.getByRole('button', { name: 'Native Fork', exact: true }).isDisabled(), true)
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
    await page.waitForTimeout(2200)
    await page.screenshot({ path: resolve(output, `fork-split-${entry}-${importedOnly ? 'imported' : 'source'}-${theme}.png`) })
    const menuBackground = await options.locator('.composer-dropdown-menu').evaluate(el => getComputedStyle(el).backgroundColor)
    assert.notEqual(menuBackground, 'rgba(0, 0, 0, 0)')
    if (theme === 'dark') assert.notEqual(menuBackground, 'rgb(255, 255, 255)')
  }
  await page.keyboard.press('Escape')
  if (entry === 'full') await page.keyboard.press('Escape')
  assert.equal(calls.filter(call => mutations.has(call.method)).length, 0)
  let effectiveMethod = method === 'native-menu' ? 'native' : method
  if (method === 'portable') {
    await choosePortable()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    if (pendingPreparation) await releasePreparation(true)
    assert.equal(calls.filter(call => mutations.has(call.method)).length, 0, 'cancel must not create or generate')
    assert.equal(await page.locator('textarea').inputValue(), 'Unsent source draft')
    assert.equal(await page.locator('.thread-composer').getByRole('button', { name: composerModelLabel, exact: true }).count(), 1, 'cancel must preserve the composer selection')
    assert.equal(calls.filter(call => ['config/value/write', 'config/batchWrite', 'model-preferences/update'].includes(call.method)).length, 0, 'opening and cancellation must not write global preferences')
    await choosePortable()
    if (pendingPreparation) await releasePreparation()
    if (prepareFails) {
      await page.getByRole('alert').filter({ hasText: '8 MiB' }).waitFor()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      const split = await splitButton()
      await split.locator('.fork-split-main').dblclick()
      effectiveMethod = 'native'
    } else {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
        await page.waitForTimeout(2200)
        const background = await page.locator('.transfer-picker').evaluate(el => getComputedStyle(el).backgroundColor)
        assert.notEqual(background, 'rgba(0, 0, 0, 0)')
        if (theme === 'dark') assert.notEqual(background, 'rgb(255, 255, 255)')
        await page.screenshot({ path: resolve(output, `portable-provider-${entry}-${composerProvider}-${theme}.png`) })
      }
      await selectProvider()
      if (entry === 'response') conversation.turns.push(sourceTurn(3))
      await page.getByRole('button', { name: 'Create conversation', exact: true }).dblclick()
    }
  } else {
    assert.equal(calls.filter(call => call.method === 'conversation-transfer/prepare').length, 0, 'native must never prepare portable history')
    if (entry === 'response') conversation.turns.push(sourceTurn(3))
    if (method === 'native-menu') {
      const split = await openOptions()
      await split.getByRole('button', { name: 'Native Fork', exact: true }).click()
    } else {
      const split = await splitButton()
      await split.locator('.fork-split-main').dblclick()
    }
    assert.equal(await page.getByRole('dialog', { name: 'Transfer conversation' }).count(), 0, 'native main action must not open the picker')
    if (nativeFails) {
      await page.getByText('Native Fork failed:', { exact: false }).first().waitFor()
      assert.equal(calls.filter(call => call.method === 'conversation-transfer/create').length, 0, 'no silent fallback')
      await choosePortable()
      await selectProvider()
      await page.getByRole('button', { name: 'Create conversation', exact: true }).click()
      effectiveMethod = 'portable'
    }
  }
  const destinationId = effectiveMethod === 'native' ? 'native' : 'imported'
  await page.waitForURL(`**/#/thread/${destinationId}`)
  await page.getByText('Original answer 0', { exact: true }).waitFor()
  assert.equal((await page.locator('body').innerText()).includes('[Imported context from'), false)
  const resumedResponse = page.waitForResponse(response => {
    const body = response.request().postDataJSON()
    return body?.method === 'thread/resume' && body.params.threadId === destinationId
  })
  await page.reload()
  const resumed = (await (await resumedResponse).json()).result
  assert.equal(!!resumed.importedTranscript, effectiveMethod === 'portable')
  if (effectiveMethod === 'portable') {
    assert.equal(resumed.importStage, 'ready')
    assert.equal(resumed.importedTranscript[1].source, `source (${composerProvider} / A)`)
    assert.equal(resumed.importedTranscript[1].text, 'Original answer 0')
    assert.equal(JSON.stringify(resumed.importedTranscript).includes('TOOL_ONLY_SECRET'), false)
    assert.equal(JSON.stringify(resumed.importedTranscript).includes('REASONING_ONLY_SECRET'), false)
    const rendered = await page.locator('body').innerText()
    for (const marker of ['Historical tool observation', 'TOOL_ONLY_SECRET', 'REASONING_ONLY_SECRET', 'Attachment omitted', 'Excluded historical item']) assert.equal(rendered.includes(marker), false)
  } else {
    assert.equal(resumed.thread.turns.some(turn => turn.items.some(item => item.type === 'commandExecution')), true, 'native history must remain unchanged')
  }
  await page.getByText('Original answer 0', { exact: true }).waitFor()
  assert.equal((await page.locator('body').innerText()).includes('[Imported context from'), false)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
    await page.waitForTimeout(2200)
    await page.screenshot({ path: resolve(output, `fork-messages-${entry}-${effectiveMethod}-${theme}.png`) })
  }
  if (entry === 'revert') {
    assert.equal(await page.locator('textarea').inputValue(), 'Original question 1', 'restored draft survives reload')
    assert.equal(await page.locator('.message-row[data-role="user"]').filter({ hasText: 'Original question 1' }).count(), 0)
    assert.equal((await page.locator('body').innerText()).includes('Original answer 1'), false)
    assert.equal(calls.filter(call => call.method === 'turn/start').length, 0, 'restoring a draft must not generate')
    assert.deepEqual(destinations.get('imported').importedTranscript.map(message => message.text), ['Original question 0', 'Original answer 0'])
    await page.goto(`${baseUrl}/#/thread/source`)
    await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Unsent source draft')
    await page.getByText('Original answer 2', { exact: true }).waitFor()
    assert.equal(conversation.turns.length, 3)
    await page.goto(`${baseUrl}/#/thread/imported`)
    await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Original question 1')
    await page.locator('textarea').fill('Edited restored prompt\n**Still a draft**')
    await page.goto(`${baseUrl}/#/thread/source`)
    await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Unsent source draft')
    await page.goto(`${baseUrl}/#/thread/imported`)
    await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Edited restored prompt\n**Still a draft**')
    await page.reload()
    await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Edited restored prompt\n**Still a draft**')
    assert.equal(calls.filter(call => call.method === 'turn/start').length, 0)
  }
  assert.equal((await page.locator('body').innerText()).includes('Original answer 2'), entry === 'full')
  assert.equal((await page.locator('body').innerText()).includes('Original answer 3'), false)
  const creationCalls = calls.filter(call => mutations.has(call.method))
  assert.equal(creationCalls.length, nativeFails ? 2 : 1, 'one creation per explicit confirmation')
  assert.equal(creationCalls.at(-1).method, effectiveMethod === 'native' ? (entry === 'full' ? 'thread/fork' : 'thread/fork-at-response') : 'conversation-transfer/create')
  const selectedModel = effectiveMethod === 'native' ? 'A' : destinationDefault
  await page.getByRole('button', { name: selectedModel, exact: true }).click()
  const labels = await page.getByRole('listbox').getByRole('button').allTextContents()
  assert.deepEqual(new Set(labels), new Set(effectiveMethod === 'native' || destinationProvider === 'P' ? ['A', 'P only'] : ['Alternate', 'C', 'D']))
  if (entry === 'full' && effectiveMethod === 'portable' && destinationProvider !== 'P') {
    await page.waitForTimeout(2200)
    await page.screenshot({ path: resolve(output, 'provider-models-destination-dark.png') })
  }
  await page.keyboard.press('Escape')
  let continuationModel = selectedModel
  if (entry === 'full' && effectiveMethod === 'portable' && destinationProvider !== 'P') {
    await page.getByRole('button', { name: 'C', exact: true }).click()
    await page.getByRole('listbox').getByRole('button', { name: 'D', exact: true }).click()
    await page.getByRole('button', { name: 'D', exact: true }).waitFor()
    continuationModel = 'D'
  }
  await page.locator('textarea').fill('Explicit next message')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '')
  const sends = calls.filter(call => call.method === 'turn/start')
  assert.equal(sends.length, 1)
  assert.equal(sends[0].params.model, continuationModel)
  assert.equal(calls.filter(call => ['thread/start', 'thread/inject_items'].includes(call.method)).length, 0, 'portable creation is mocked at the backend service boundary')
  assert.deepEqual(errors, [])
  const report = { entry, method, prepareFails, nativeFails, pendingPreparation, importedOnly, sameProvider, providers, composerProvider, initialProvider, destinationProvider, url: page.url(), viewport: { width: 1280, height: 900 },
    creationCalls, explicitSends: sends.length, importMetadataAfterReload: !!resumed.importedTranscript, displayPrefixes: false, assertions: 'passed' }
  await context.close()
  return report
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const reports = []
    const cases = []
    for (const entry of ['full', 'response']) for (const method of ['portable', 'native', 'native-menu']) cases.push([entry, method])
    cases.push(['response', 'portable', { prepareFails: true }], ['full', 'native', { nativeFails: true }],
      ['response', 'portable', { pendingPreparation: true }], ['response', 'portable', { importedOnly: true }], ['response', 'portable', { sameProvider: true }])
    for (const providers of [['P'], ['P', 'Q', 'R'], ['R', 'P', 'Q']]) cases.push(['response', 'portable', { providers }])
    cases.push(['full', 'portable', { composerProvider: 'Q' }], ['response', 'portable', { composerProvider: 'Q' }])
    cases.push(['revert', 'portable'], ['revert', 'portable', { pendingPreparation: true }])
    const selected = process.env.FORK_TEST_CASES?.split(',').map(Number)
    for (const [index, args] of cases.entries()) {
      if (selected && !selected.includes(index)) continue
      const result = await check(browser, ...args)
      reports.push(result)
      console.log('PASS', index, result.entry, result.method, JSON.stringify(args[2] || {}))
    }
    const suffix = selected ? `-${selected.join('-')}` : ''
    writeFileSync(resolve(output, `fork-methods-results${suffix}.json`), JSON.stringify(reports, null, 2))
    console.log(JSON.stringify(reports, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
