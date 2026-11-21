const { fixtureWebuiStorage } = require('./fixture-webui-storage.cjs')
// Explicit live acceptance only. Compare an archived pre-cleanup build with current.
const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const { once } = require('node:events')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, openSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { randomUUID } = require('node:crypto')
const WebSocket = require('ws')
const { chromium } = require('playwright')
const sleep = ms => new Promise(done => setTimeout(done, ms))

;(async () => {
  assert.equal(process.env.PORTABLE_DISCOVERY_LIVE, '1', 'Explicit PORTABLE_DISCOVERY_LIVE=1 required: creates real disposable turns')
  const beforeRoot = process.env.PORTABLE_BEFORE_ROOT
  assert.ok(beforeRoot, 'Provide PORTABLE_BEFORE_ROOT containing a built git archive of de7fde9')
  assert.equal(readFileSync(join(beforeRoot, 'src/server/appServerClient.ts'), 'utf8'), execFileSync('git', ['show', 'de7fde9:src/server/appServerClient.ts'], { encoding: 'utf8' }))
  const output = resolve('output/playwright'); mkdirSync(output, { recursive: true })
  const tag = 'portable-discovery-' + randomUUID(), root = '/tmp/' + tag
  const report = { tag, baseline: 'de7fde9', current: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), versions: {}, probes: {}, browser: {}, cleanup: {} }
  const versions = [
    { label: 'before', cwd: beforeRoot, port: 4194 },
    { label: 'current', cwd: process.cwd(), port: 4173 },
  ].map(v => ({ ...v, home: mkdtempSync(join(tmpdir(), 'codexapp-discovery-' + v.label + '-')), url: 'http://127.0.0.1:' + v.port }))
  const ws = new WebSocket(process.env.CODEXUI_APP_SERVER_URL || 'ws://127.0.0.1:4500')
  const pending = new Map(); let sequence = 0
  ws.on('message', raw => { const f = JSON.parse(String(raw)), p = pending.get(f.id); if (p) { pending.delete(f.id); clearTimeout(p.timer); f.error ? p.reject(Object.assign(new Error(f.error.message), f.error)) : p.resolve(f.result) } })
  await new Promise((done, fail) => { ws.once('open', done); ws.once('error', fail) })
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC timeout: ' + method)) }, 20000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  const threads = new Set(); let projectId, browser, source, sourcePrompt, sourceAnswer
  const stop = async v => {
    if (!v.child || v.child.exitCode !== null) return
    const child = v.child; child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), sleep(3000)])
    if (child.exitCode === null) child.kill('SIGKILL')
    v.child = null
  }
  const start = async v => {
    const fd = openSync(join(v.home, 'app.log'), 'a')
    v.child = spawn(process.execPath, [join(v.cwd, 'dist-cli/index.js'), '--host', '127.0.0.1', '--port', String(v.port), '--no-open'], {
      cwd: v.cwd, env: { ...process.env, ...fixtureWebuiStorage(v.home, 'legacy'), CODEX_HOME: v.home, CODEXUI_REMOTE_INITIAL_DIRECTORY: root }, stdio: ['ignore', fd, fd],
    })
    for (let n = 0; n < 100; n++) {
      if (v.child.exitCode !== null) throw new Error('App exited: ' + readFileSync(join(v.home, 'app.log'), 'utf8').slice(-1500))
      try { const r = await fetch(v.url); if (r.ok) return } catch {}
      await sleep(100)
    }
    throw new Error('App startup timeout: ' + v.label)
  }
  const httpRpc = async (v, method, params) => {
    const response = await fetch(v.url + '/codex-api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params }) })
    const body = await response.json(); assert.ok(response.ok && !body.error, JSON.stringify(body)); return body.result
  }
  const pageIds = async (call, method, params, search = false) => {
    const ids = [], seen = new Set(); let cursor = null
    do {
      const r = await call(method, { ...params, cursor }); assert.ok(Array.isArray(r.data))
      ids.push(...r.data.map(t => search ? t.thread.id : t.id)); cursor = r.nextCursor || null
      if (cursor) { assert.ok(!seen.has(cursor), 'Repeated native cursor'); seen.add(cursor) }
      assert.ok(seen.size < 100, 'Listing budget exceeded')
    } while (cursor)
    return ids
  }
  const filters = { archived: false, limit: 50, sortKey: 'updated_at', modelProviders: [] }
  const probe = async (v, stage) => {
    const id = v.destination, call = (m, p) => httpRpc(v, m, p)
    const native = await pageIds(rpc, 'thread/list', filters)
    const project = await pageIds(rpc, 'thread/list', { ...filters, projectId })
    const scoped = await pageIds(rpc, 'thread/list', { ...filters, cwd: root })
    const database = await pageIds(rpc, 'thread/list', { ...filters, useStateDbOnly: true })
    const app = await pageIds(call, 'thread/list', filters)
    const titleFiltered = await pageIds(rpc, 'thread/list', { ...filters, searchTerm: v.title })
    const search = await pageIds(rpc, 'thread/search', { searchTerm: sourceAnswer, archived: false, limit: 100 }, true)
    const summary = (await rpc('thread/read', { threadId: id, includeTurns: true })).thread
    const result = { nativeListed: native.includes(id), projectListed: project.includes(id), cwdListed: scoped.includes(id), databaseListed: database.includes(id), appListed: app.includes(id), nativeTitleFiltered: titleFiltered.includes(id), nativeContentSearch: search.includes(id), nativeProjectId: summary.projectId, nativeTurns: summary.turns.length, nativeTurnStatuses: summary.turns.map(t => t.status), sourceControlListed: native.includes(source.thread.id) }
    report.probes[v.label + ':' + stage] = result
    assert.ok(result.sourceControlListed, 'Listing must contain the ordinary source control')
    if (stage !== 'ordinary-accepted') assert.equal(result.appListed, result.nativeListed, 'Stable native and application lists must agree')
    return result
  }
  const complete = async (call, id, prompt) => {
    const { turn } = await call('turn/start', { threadId: id, model: source.model, input: [{ type: 'text', text: prompt }] })
    for (let i = 0; i < 120; i++) {
      const thread = (await rpc('thread/read', { threadId: id, includeTurns: true })).thread
      const t = thread.turns.find(t => t.id === turn.id)
      if (t && t.status === 'completed') return thread
      if (t && ['failed', 'interrupted'].includes(t.status)) throw new Error(JSON.stringify(t.error))
      await sleep(500)
    }
    throw new Error('Turn completion deadline')
  }
  const freshUi = async (v, stage, expected) => {
    // New process, existing durable application home, and an empty browser context.
    await stop(v); await start(v)
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    const allowed = new Set(threads)
    // Do not expose unrelated user records in screenshots. Never inject test rows
    // or alter discovery filters: only remove non-test rows from actual responses.
    await page.route('**/codex-api/rpc', async route => {
      const request = route.request().postDataJSON()
      if (!['project/list', 'thread/list', 'thread/search'].includes(request.method)) return route.continue()
      const response = await route.fetch(), body = await response.json()
      if (Array.isArray(body.result?.data)) {
        body.result.data = body.result.data.filter(row => request.method === 'project/list'
          ? row.id === projectId : allowed.has(request.method === 'thread/search' ? row.thread.id : row.id))
      }
      await route.fulfill({ response, json: body })
    })
    try {
      await page.goto(v.url + '/#/')
      await page.locator('.thread-row > a').filter({ hasText: tag + ' source' }).first().waitFor({ timeout: 30000 })
      await page.waitForTimeout(2500)
      const row = page.locator('.thread-row > a').filter({ hasText: v.title })
      assert.equal(await row.count() > 0, expected, 'Fresh-start sidebar discovery: ' + v.label + '/' + stage)
      await page.getByRole('button', { name: 'Search threads', exact: true }).click()
      await page.getByRole('button', { name: 'Thread Name', exact: true }).click()
      await page.locator('.sidebar-search-input').fill(v.title)
      await page.waitForTimeout(2500)
      assert.equal(await row.count() > 0, expected, 'Fresh-start UI search discovery: ' + v.label + '/' + stage)
      const titleSearchDiscoverable = await row.count() > 0
      await page.getByRole('button', { name: 'Messages', exact: true }).click()
      await page.locator('.sidebar-search-input').fill(sourceAnswer)
      await page.waitForTimeout(2500)
      const contentSearchDiscoverable = await row.count() > 0
      await page.locator('.sidebar-search-input').fill('')
      if (expected) await row.first().waitFor({ timeout: 10000 })
      let openedFromSidebar = false, importedContentVisible = false, historyReadRaceObserved = false
      if (expected) {
        await row.first().click()
        await page.getByText(sourcePrompt, { exact: true }).first().waitFor({ timeout: 30000 })
        await page.getByText(sourceAnswer, { exact: true }).first().waitFor({ timeout: 30000 })
        openedFromSidebar = true; importedContentVisible = true
        assert.ok(page.url().includes('/thread/' + v.destination))
        await page.waitForTimeout(2500)
        if ((await page.locator('body').innerText()).includes('History changed while loading. Refresh the thread.')) {
          historyReadRaceObserved = true
          await page.reload() // Read-only refresh after discovery by sidebar; never a saved-URL shortcut.
          await page.getByText(sourcePrompt, { exact: true }).first().waitFor({ timeout: 30000 })
          await page.getByText(sourceAnswer, { exact: true }).first().waitFor({ timeout: 30000 })
          await page.waitForTimeout(2500)
        }
      } else assert.ok(!page.url().includes(v.destination), 'Must not navigate with a saved destination URL')
      const screenshots = []
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme })
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
        await page.waitForTimeout(2200)
        const screenshot = resolve(output, 'portable-discovery-' + v.label + '-' + stage + '-' + theme + '.png')
        await page.screenshot({ path: screenshot, fullPage: true }); screenshots.push(screenshot)
      }
      const visibleHistoryReadError = (await page.locator('body').innerText()).includes('History changed while loading. Refresh the thread.')
      assert.equal(visibleHistoryReadError, false, 'Read-only refresh must recover the visible history race')
      assert.deepEqual(errors, [])
      report.browser[v.label + ':' + stage] = { freshApplicationProcess: true, freshBrowserContext: true, initialUrl: v.url + '/#/', sidebarDiscoverable: expected, uiTitleSearchDiscoverable: titleSearchDiscoverable, uiContentSearchDiscoverable: contentSearchDiscoverable, openedFromSidebar, importedContentVisible, historyReadRaceObserved, visibleHistoryReadError, viewport: '1440x1000', screenshots }
    } finally { await context.close() }
  }
  try {
    const init = await rpc('initialize', { clientInfo: { name: 'portable-discoverability-comparison', version: '1' }, capabilities: { experimentalApi: true } })
    ws.send(JSON.stringify({ method: 'initialized' })); report.server = init.userAgent
    await rpc('fs/createDirectory', { path: root, recursive: true })
    projectId = (await rpc('project/create', { name: tag, roots: [{ path: root }], idempotencyKey: tag })).project.id
    source = await rpc('thread/start', { cwd: root, projectId, historyMode: 'paginated', persistExtendedHistory: true }); threads.add(source.thread.id)
    sourcePrompt = `Reply exactly ${tag}-original-answer. Do not use tools or change files.`
    sourceAnswer = tag + '-original-answer'
    await complete(rpc, source.thread.id, sourcePrompt)
    await rpc('thread/name/set', { threadId: source.thread.id, name: tag + ' source' })
    report.provider = source.modelProvider; report.model = source.model; report.filters = filters
    browser = await chromium.launch({ headless: true })
    for (const v of versions) {
      if (v.label === 'before') writeFileSync(join(v.home, '.codex-global-state.json'), JSON.stringify({ 'electron-saved-workspace-roots': [root], 'active-workspace-roots': [root], 'project-order': [root], 'electron-workspace-root-labels': { [root]: tag } }))
      await start(v)
      const prepared = await httpRpc(v, 'conversation-transfer/prepare', { threadId: source.thread.id })
      const portable = await httpRpc(v, 'conversation-transfer/create', { id: prepared.id, model: source.model, modelProvider: source.modelProvider })
      v.destination = portable.threadId; threads.add(v.destination); v.title = tag + ' ' + v.label
      await rpc('thread/name/set', { threadId: v.destination, name: v.title })
      const initial = await probe(v, 'created')
      report.versions[v.label] = { title: v.title, destinationId: v.destination, initialProjectId: initial.nativeProjectId, applicationHome: v.home }
      if (initial.nativeProjectId !== projectId) await rpc('thread/metadata/update', { threadId: v.destination, projectId })
      const bound = await probe(v, 'equal-membership')
      assert.equal(bound.nativeProjectId, projectId)
      assert.equal(bound.nativeListed, false)
      await freshUi(v, 'injected-only', false)
    }
    for (const v of versions) {
      const accepted = await httpRpc(v, 'turn/start', { threadId: v.destination, model: source.model, input: [{ type: 'text', text: `Reply exactly ${tag}-ordinary-${v.label}. Do not use tools or change files.` }] })
      assert.ok(accepted.turn.id)
      report.versions[v.label].ordinaryTurnId = accepted.turn.id
      report.versions[v.label].ordinaryAcceptedStatus = accepted.turn.status
      await probe(v, 'ordinary-accepted')
      for (let i = 0; i < 120; i++) {
        const thread = (await rpc('thread/read', { threadId: v.destination, includeTurns: true })).thread
        const turn = thread.turns.find(t => t.id === accepted.turn.id)
        if (turn?.status === 'completed') break
        if (turn && ['failed', 'interrupted'].includes(turn.status)) throw new Error(JSON.stringify(turn.error))
        assert.ok(i < 119, 'Ordinary turn timeout'); await sleep(500)
      }
      const listed = await probe(v, 'ordinary-completed')
      assert.ok(listed.nativeListed && listed.projectListed && listed.appListed)
      assert.equal(listed.nativeProjectId, projectId)
      const decorated = await httpRpc(v, 'thread/read', { threadId: v.destination, includeTurns: true })
      assert.ok(decorated.importedTranscript.some(m => m.text === sourcePrompt))
      assert.ok(decorated.importedTranscript.some(m => m.text === sourceAnswer))
      await freshUi(v, 'ordinary-completed', true)
    }
    assert.equal(threads.size, 3, 'No duplicate destination threads')
    report.conclusion = { nativeListingOmissionPreExisting: true, projectMembershipAndGroupingCause: false, injectedOnlyUiContentSearch: Object.fromEntries(versions.map(v => [v.label, report.browser[v.label + ':injected-only'].uiContentSearchDiscoverable])), completedOrdinaryTurnRestoresSidebarDiscovery: true, transitionIsAsynchronous: true }
    console.log('PASS Portable discoverability: baseline/current, native/project/app listings, fresh-start UI, first ordinary turns')
  } finally {
    if (browser) await browser.close()
    for (const threadId of threads) {
      const summary = await rpc('thread/read', { threadId, includeTurns: true }).catch(() => null)
      for (const turn of summary?.thread?.turns || []) if (turn.status === 'inProgress') await rpc('turn/interrupt', { threadId, turnId: turn.id }).catch(() => {})
      await rpc('thread/archive', { threadId }).catch(e => { report.cleanup.error = String(e) })
    }
    if (projectId) await rpc('project/delete', { projectId }).catch(e => { report.cleanup.error = String(e) })
    report.cleanup.archivedTestThreads = threads.size; report.cleanup.deletedTestProjects = projectId ? 1 : 0
    ws.close()
    for (const v of versions) await stop(v) // Only these two owned comparison processes; never the independently managed Codex server.
    writeFileSync(resolve(output, 'portable-discoverability.json'), JSON.stringify(report, null, 2))
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
