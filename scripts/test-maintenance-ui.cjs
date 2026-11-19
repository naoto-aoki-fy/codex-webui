// Credential-free rendering check; all API data and notifications are fixtures.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const base = process.env.MAINTENANCE_BROWSER_BASE_URL || 'http://127.0.0.1:4173'
const marker = 'maintenance-testchat-20261115'
const thread = { id: 'maintenance-fixture', name: marker, preview: marker, projectId: 'project-id', cwd: '/fixture', createdAt: 100, updatedAt: 200, modelProvider: 'openai', source: 'cli', turns: [{ id: 'turn-1', status: 'completed', items: [
  { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: marker }] },
  { id: 'assistant-1', type: 'agentMessage', text: '**Fixture response** [sample.ts](/fixture/sample.ts)' },
] }] }
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const out = resolve('output/playwright'); mkdirSync(out, { recursive: true })
  const checks = []
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport, colorScheme: theme })
        await context.addInitScript(({ theme }) => { localStorage.setItem('codex-web-local.dark-mode.v1', theme) }, { theme })
        const page = await context.newPage()
        const errors = []
        const skillWrites = []
        const rpcCalls = [], pinnedIds = []
        const fixtureThread = structuredClone(thread)
        const pagedThread = { ...structuredClone(thread), id: 'paged-fixture', name: 'Paged fixture', turns: [] }
        let socket
        const notify = (method, params) => socket.send(JSON.stringify({ method, params }))
        page.on('pageerror', e => errors.push(e.message))
        await page.routeWebSocket('**/codex-api/ws', ws => { socket = ws; ws.send(JSON.stringify({ method: 'ready', params: { ok: true } })) })
        await page.route('**/codex-api/**', async route => {
          const path = new URL(route.request().url()).pathname
          let payload = {}
          if (path.endsWith('/thread-pins')) payload = { data: { threadIds: [...pinnedIds] } }
          else if (path.endsWith('/home-directory')) payload = { data: { path: '/fixture' } }
          else if (path.endsWith('/meta/methods')) payload = { data: require('../src/server/appServerMethods.json').methods }
          else if (path.endsWith('/skills-hub')) payload = { installed: [{ name: 'fixture-skill', path: '/fixture/skills/fixture-skill/SKILL.md', description: 'Installed fixture skill', enabled: true }] }
          else if (path.endsWith('/skills-hub/readme')) payload = { content: '# Fixture skill instructions', description: 'Installed fixture skill' }
          else if (path.endsWith('/upload-file')) payload = { path: '/fixture/disposable.txt' }
          else if (path.endsWith('/rpc')) {
            const { method, params } = route.request().postDataJSON()
            rpcCalls.push({ method, params })
            if (method === 'thread/section/move') { pinnedIds.splice(0); if (params.sectionId) pinnedIds.push(params.threadId) }
            if (method === 'skills/config/write') skillWrites.push(params)
            const result = method === 'project/list' ? { data: [{ id: 'project-id', name: 'Native fixture', roots: [{ path: '/fixture' }], metadata: {}, position: 0 }], nextCursor: null }
              : method === 'thread/list' ? { data: params?.cursor ? [pagedThread] : [fixtureThread], nextCursor: params?.cursor ? null : 'page-2' }
              : method === 'thread/read' || method === 'thread/resume' ? { thread: params?.threadId === pagedThread.id ? pagedThread : fixtureThread, model: 'fixture-model' }
              : method === 'turn/start' ? { turn: { id: 'submitted-turn', status: 'inProgress', items: [] } }
              : method === 'modelProvider/list' ? { data: [{ id: 'openai', displayName: 'OpenAI', isDefault: true }] }
              : method === 'model/list' ? { data: [{ id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture', isDefault: true, supportedReasoningEfforts: [] }], nextCursor: null }
              : method === 'config/read' ? { config: { model: 'fixture-model', model_provider: 'openai' } }
              : method === 'skills/list' ? { data: [] }
              : method === 'account/read' ? { account: { type: 'apiKey' } }
              : { data: [], nextCursor: null }
            payload = { result }
          }
          await route.fulfill({ json: payload })
        })
        await page.goto(base + '/#/thread/' + thread.id)
        await page.locator('.thread-composer-input').waitFor()
        await page.getByText('Fixture response', { exact: true }).waitFor()
        const link = page.locator('a', { hasText: 'sample.ts' }).first()
        const rendered = await link.evaluate(a => ({ href: a.getAttribute('href'), title: a.getAttribute('title'), text: a.textContent }))
        const hrefOk = Boolean(rendered.href?.includes('sample.ts'))
        const titleOk = Boolean(rendered.title?.includes('sample.ts'))
        const textOk = rendered.text === 'sample.ts'
        assert(hrefOk && titleOk && textOk, JSON.stringify(rendered))
        await page.locator('.thread-composer-input').fill('Disposable draft ' + marker)
        await page.waitForTimeout(500)
        await page.reload()
        await page.locator('.thread-composer-input').waitFor()
        await page.waitForFunction(marker => document.querySelector('.thread-composer-input')?.value === 'Disposable draft ' + marker, marker)
        // Exercise the actual upload/input/submission coordination using disposable responses.
        await page.locator('input[type=file]').setInputFiles({ name: 'disposable.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture attachment') })
        await page.getByText('disposable.txt', { exact: true }).waitFor()
        await page.reload()
        await page.getByText('disposable.txt', { exact: true }).waitFor()
        await page.locator('.thread-composer-input').dispatchEvent('keydown', { key: 'Enter', isComposing: true })
        assert.equal(rpcCalls.filter(call => call.method === 'turn/start').length, 0)
        await page.getByRole('button', { name: 'Send message', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('.thread-composer-input')?.value === '')
        const sends = rpcCalls.filter(call => call.method === 'turn/start')
        assert.equal(sends.length, 1)
        assert(JSON.stringify(sends[0].params).includes('disposable.txt'))
        assert(JSON.stringify(sends[0].params).includes(marker))
        const streamed = 'Mock streamed response ' + marker
        const turn = { id: 'submitted-turn', status: 'inProgress', items: [] }
        fixtureThread.turns.push(turn)
        notify('turn/started', { threadId: thread.id, turn: { id: turn.id } })
        notify('item/started', { threadId: thread.id, turnId: turn.id, item: { type: 'agentMessage', id: 'stream-answer', text: '' } })
        notify('item/agentMessage/delta', { threadId: thread.id, turnId: turn.id, itemId: 'stream-answer', delta: streamed })
        await page.getByText(streamed, { exact: true }).first().waitFor()
        turn.status = 'completed'
        turn.items = [{ id: 'stream-answer', type: 'agentMessage', text: streamed }]
        notify('turn/completed', { threadId: thread.id, turn })
        notify('ready', { ok: true, reconnected: true })
        await page.getByText(streamed, { exact: true }).first().waitFor()
        assert.equal(rpcCalls.filter(call => call.method === 'turn/start').length, 1)
        if (viewport.width === 1440) {
          const row = page.locator('.thread-row').filter({ hasText: marker }).first()
          await row.click({ button: 'right' })
          await page.getByRole('button', { name: 'Pin thread', exact: true }).click()
          await page.locator('.thread-row[data-pinned="true"]').waitFor()
          await page.locator('.thread-row[data-pinned="true"]').click({ button: 'right' })
          await page.getByRole('button', { name: 'Unpin thread', exact: true }).click()
          await row.click({ button: 'right' })
          await page.getByRole('button', { name: 'Rename thread', exact: true }).click()
          await page.locator('.rename-thread-input').waitFor()
          await page.getByRole('button', { name: 'Cancel', exact: true }).click()
          await page.getByRole('button', { name: 'Search threads', exact: true }).click()
          await page.locator('.sidebar-search-input').fill('unmatched-search-fixture')
          await page.getByText('No matching threads', { exact: true }).first().waitFor()
          await page.getByRole('button', { name: 'Clear search', exact: true }).click()
          await page.getByText('Paged fixture', { exact: true }).first().waitFor({ timeout: 30000 })
          await page.locator('.thread-main-button').filter({ hasText: 'Paged fixture' }).click()
          await page.waitForURL('**/#/thread/paged-fixture')
          await page.locator('.thread-main-button').filter({ hasText: marker }).click()
          await page.waitForURL('**/#/thread/' + thread.id)
          assert(rpcCalls.some(call => call.method === 'thread/list' && call.params?.cursor === 'page-2'))
        }
        await page.locator('.thread-composer-input').fill('Profile isolation ' + marker)
        await page.waitForTimeout(500)
        await page.goto(base + '/?connection-profile=isolated-fixture#/thread/' + thread.id)
        await page.locator('.thread-composer-input').waitFor()
        assert.equal(await page.locator('.thread-composer-input').inputValue(), '')
        await page.goto(base + '/#/thread/' + thread.id)
        await page.locator('.thread-composer-input').waitFor()
        await page.waitForFunction(marker => document.querySelector('.thread-composer-input')?.value === 'Profile isolation ' + marker, marker)
        assert.equal(await page.locator('html').getAttribute('lang'), 'en')
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), theme === 'dark')
        await page.waitForTimeout(2200)
        const screenshot = resolve(out, `testchat-maintenance-${viewport.width}-${theme}-cjs.png`)
        await page.screenshot({ path: screenshot, fullPage: true })
        assert.equal(await page.getByText('Malformed native pin state', { exact: true }).count(), 0)
        assert.deepEqual(errors, [])
        checks.push({ url: page.url(), viewport, theme, hrefOk, titleOk, textOk, draftAfterRefresh: true, attachmentAfterRefresh: true, profileIsolation: true, imeNoSend: true, exactlyOneSend: true, mockedStreamingReconnect: true, rpcCounts: Object.fromEntries([...new Set(rpcCalls.map(call => call.method))].map(method => [method, rpcCalls.filter(call => call.method === method).length])), screenshot })
        if (viewport.width === 1440) {
          await page.goto(base + '/#/skills')
          await page.getByText('fixture-skill', { exact: true }).click()
          await page.getByText('Fixture skill instructions', { exact: true }).waitFor()
          await page.getByRole('button', { name: 'Disable', exact: true }).click()
          await page.getByRole('button', { name: 'Enable', exact: true }).click()
          assert.deepEqual(skillWrites.map(write => write.enabled), [false, true])
          assert(skillWrites.every(write => write.path === '/fixture/skills/fixture-skill/SKILL.md'))
          await page.waitForTimeout(2200)
          await page.screenshot({ path: resolve(out, 'maintenance-skills-' + theme + '.png'), fullPage: true })
        }
        await context.close()
      }
    }
    writeFileSync(resolve(out, 'maintenance-ui.json'), JSON.stringify({ fixture: true, checks }, null, 2))
    console.log('PASS six fixture layouts: rendering, links, draft/attachment persistence, IME, exactly-once submission, mocked streaming/reconnect; desktop sidebar menus, pins, search, pagination and routing')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
