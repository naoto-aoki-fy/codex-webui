// Run against the current worktree's Vite server on 4173.
const { chromium } = require('playwright')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { setup, thread, assert } = require('./approved-fixture.cjs')

const output = resolve('output/playwright')
const first = { ...thread, name: 'サイドバー recent', cwd: '/current/共有', id: thread.id }
const longPath = '/workspace/parent-path-only/' + 'long-directory-name-'.repeat(5) + '/共有'
const old = { ...thread, name: 'サイドバー', cwd: longPath, id: 'older-search-thread', projectId: null }
const last = { ...thread, name: 'Find サイドバー', cwd: '/older/older-location', id: 'last-search-thread', projectId: null }
const message = { ...thread, name: 'Only a message matches', id: 'message-search-thread', projectId: null }
const registry = [
  { id: 'p', name: 'Existing', roots: [{ path: first.cwd }], position: 0 },
  { id: 'empty-a', name: '空 Project', roots: [{ path: '/registered/empty + #' }, { path: '/registered/登録済み' }], position: 1 },
  { id: 'empty-b', name: '空 Project', roots: [{ path: '/registered/empty + #' }], position: 2 },
]
const rpc = result => ({ json: { result } })
const list = (data, nextCursor = null) => rpc({ data, nextCursor })
const hits = (data, nextCursor = null) => list(data.map(thread => ({ thread })), nextCursor)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const queryOf = href => Object.fromEntries(new URLSearchParams(href.split('?')[1]))
const historyCalls = calls => calls.filter(call => ['thread/read', 'thread/resume', 'thread/turns/list'].includes(call.method))

async function run(browser, viewport, theme, exerciseRequests) {
  const context = await browser.newContext({ viewport, colorScheme: theme, hasTouch: viewport.width < 768 })
  context.setDefaultTimeout(6500)
  try {
    const page = await context.newPage()
    let failLast = exerciseRequests
    let releaseOlder
    let releaseMessage
    let releaseStale
    let paging = 0
    let maxPaging = 0
    const items = [{ type: 'agentMessage', id: 'a', text: 'Fixture answer' }]
    const { calls, errors, emit } = await setup(page, async ({ method, params }) => {
      if (method === 'project/list') return list(registry)
      if (method === 'thread/list') {
        if (!params?.cursor) return exerciseRequests ? list([first], 'older') : list([first, old, last])
        maxPaging = Math.max(maxPaging, ++paging)
        try {
          if (params.cursor === 'older') {
            await new Promise(resolve => { releaseOlder = resolve })
            return list([old], 'last')
          }
          if (failLast) {
            failLast = false
            return { status: 502, json: { error: 'Fixture pagination failure' } }
          }
          return list([last])
        } finally {
          paging--
        }
      }
      if (method === 'thread/search') {
        if (params.searchTerm === 'unsupported') return { status: 502, json: { rpcCode: -32601, error: 'Method not found' } }
        if (params.searchTerm === 'network-error') return { status: 503, json: { error: 'Fixture connection unavailable' } }
        if (params.searchTerm === 'stale') {
          await new Promise(resolve => { releaseStale = resolve })
          return hits([{ ...old, name: 'Stale response' }], 'stale-next')
        }
        if (params.searchTerm === '本文だけ') {
          if (params.cursor) {
            await new Promise(resolve => { releaseMessage = resolve })
            return hits([message, last])
          }
          return hits([message], 'more-messages')
        }
        return hits([])
      }
      if (method === 'thread/read' || method === 'thread/resume') {
        const target = [first, old, last, message].find(row => row.id === params.threadId)
        if (target) return rpc({ thread: { ...target, turns: [{ id: 't', status: 'completed', items }] }, model: 'fixture-model', modelProvider: 'fixture' })
      }
    }, false)

    async function openSidebar() {
      const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true })
      if (await expand.isVisible()) await expand.click()
    }
    await openSidebar()
    const toggle = page.getByRole('button', { name: 'Search threads', exact: true })
    const field = page.getByRole('textbox', { name: 'Search sidebar' })
    const targets = page.getByRole('group', { name: 'Search target' })
    const picks = targets.getByRole('button')
    const pick = name => targets.getByRole('button', { name, exact: true })
    const results = page.getByRole('list', { name: 'Search results' })
    const row = name => results.getByRole('link').filter({ hasText: name })
    const noResults = page.getByText('No results found', { exact: true })
    const moreCalls = () => calls.filter(call => call.method === 'thread/list' && call.params.cursor).map(call => call.params.cursor)
    const messages = () => calls.filter(call => call.method === 'thread/search').map(call => [call.params.searchTerm, call.params.cursor])
    const assertFocused = async locator => assert.equal(await locator.evaluate(el => el === document.activeElement), true)

    const organize = page.getByRole('button', { name: 'Organize threads' })
    await organize.waitFor()
    if (viewport.width < 1440) {
      await organize.click()
      await page.getByRole('button', { name: viewport.width === 768 ? 'By Folder' : 'Chronological list' }).click()
    }
    await toggle.click()
    await field.waitFor()
    await assertFocused(field)
    assert.deepEqual(await picks.allTextContents(), ['Messages', 'Thread Name', 'Project', 'Folder'])
    assert.equal(await pick('Messages').getAttribute('aria-pressed'), 'true')

    const beforeSearch = calls.length
    if (exerciseRequests) {
      emit('turn/started', { threadId: first.id, turn: { id: 't', status: 'inProgress' } })
      await pick('Thread Name').press('Space')
      await field.fill('サイドバー')
      await row(first.name).waitFor()
      await page.getByText('Waiting for responses to finish…', { exact: true }).waitFor()
      assert.deepEqual(moreCalls(), [])
      emit('turn/completed', { threadId: first.id, turn: { id: 't', status: 'completed' } })

      await results.getByRole('link').filter({ hasText: first.name }).waitFor()
      await pick('Folder').click()
      assert.equal(await field.inputValue(), 'サイドバー')
      await field.fill('共有')
      await row(first.cwd.split('/').at(-1)).first().waitFor()
      for (let i = 0; i < 100 && !releaseOlder; i++) await pause(25)
      assert(releaseOlder, 'Name search did not start the existing older cursor')
      assert.deepEqual(moreCalls(), ['older'])
      releaseOlder()
      await page.getByText('Fixture pagination failure', { exact: false }).waitFor()
      assert.equal(await results.getByRole('link').count(), 2)
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.getByText('Loading more threads…', { exact: true }).waitFor({ state: 'hidden' })
      assert.deepEqual(moreCalls(), ['older', 'last', 'last'])
      assert.equal(maxPaging, 1)
      // Header refresh on turn completion does not rescan the cursors.
      await page.waitForFunction(() => !document.querySelector('.sidebar-search-error'))
      assert.equal(messages().length, 0)
    }

    const cachedStart = calls.length
    await pick('Thread Name').click()
    await field.fill('サイドバー')
    await row(last.name).waitFor()
    assert.deepEqual(await results.locator('.thread-row-title').allTextContents(), [old.name, first.name, last.name])
    assert.equal(await page.getByRole('button', { name: 'Organize threads' }).count(), 0)
    // A result keeps the existing menu and actions.
    const olderRow = results.locator('.thread-row').filter({ has: page.getByText(old.name, { exact: true }) })
    await olderRow.getByRole('button', { name: 'Thread actions' }).press('Enter')
    await page.getByRole('button', { name: 'Open in new tab', exact: true }).waitFor()
    await page.keyboard.press('Escape')

    await pick('Project').click()
    await field.fill('空 Project')
    await row('empty-b').waitFor()
    assert.deepEqual(queryOf(await row('empty-b').getAttribute('href')), { cwd: '/registered/empty + #', projectId: 'empty-b' })

    await pick('Folder').click()
    await field.fill('parent-path-only')
    await noResults.waitFor()
    await field.fill('登録済み')
    assert.deepEqual(queryOf(await row('登録済み').getAttribute('href')), { cwd: '/registered/登録済み' })
    await field.fill('older-location')
    assert.deepEqual(queryOf(await row('older-location').getAttribute('href')), { cwd: last.cwd })
    await field.fill('共有')
    await row(longPath).waitFor()
    assert.deepEqual(await results.locator('.sidebar-search-location-detail').allTextContents(), [first.cwd, longPath])
    await page.waitForTimeout(2250)
    const screenshot = resolve(output, `sidebar-search-${viewport.width}-${theme}.png`)
    await page.screenshot({ path: screenshot })
    const testedUrl = page.url()
    const colors = await pick('Folder').evaluate(el => {
      const location = document.querySelector('.sidebar-search-location-detail')
      return {
        button: getComputedStyle(el).backgroundColor,
        wrapper: getComputedStyle(el.closest('aside')).backgroundColor,
        wraps: getComputedStyle(location).overflowWrap === 'anywhere',
        fits: location.scrollWidth <= location.clientWidth,
      }
    })
    assert.match(colors.button, theme === 'dark' ? /oklch\(0\.2|rgb\(39, 39, 42\)/ : /oklch\(0\.9|rgb\(244, 244, 245\)/)
    assert.equal(colors.wraps && colors.fits, true)
    const cachedRequests = calls.slice(cachedStart).filter(call => ['thread/list', 'project/list', 'thread/search'].includes(call.method))
    // Turn completion may refresh the live head, but must never replay an older cursor.
    const searchRequests = cachedRequests.filter(call => call.method !== 'thread/list' || call.params?.cursor)
    assert.deepEqual(searchRequests, [])
    assert.deepEqual(historyCalls(calls.slice(beforeSearch)).filter(call => call.params.threadId !== first.id), [])

    await page.getByRole('button', { name: 'Clear search' }).click()
    assert.equal(await pick('Folder').getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Organize threads' }).waitFor()
    await pick('Folder').press('Escape')
    await field.waitFor({ state: 'hidden' })
    await assertFocused(toggle)
    await toggle.press('Enter')
    assert.equal(await pick('Messages').getAttribute('aria-pressed'), 'true')

    if (exerciseRequests) {
      await field.fill('stale')
      for (let i = 0; i < 100 && !releaseStale; i++) await pause(25)
      assert(releaseStale)
      await pick('Thread Name').click()
      await field.fill('サイドバー')
      await row(last.name).waitFor()
      releaseStale()
      await field.fill('temporary')
      await pick('Messages').click()
      await field.fill('本文だけ')
      await row(message.name).waitFor()
      assert.equal(await results.getByRole('link').count(), 1)
      for (let i = 0; i < 100 && !releaseMessage; i++) await pause(25)
      assert(releaseMessage)
      releaseMessage()
      await row(last.name).waitFor()
      assert.deepEqual(messages(), [['stale', null], ['本文だけ', null], ['本文だけ', 'more-messages']])
      assert.deepEqual(historyCalls(calls.slice(beforeSearch)).filter(call => call.params.threadId !== first.id), [])
      await row(message.name).press('Enter')
      await page.waitForURL('**/#/thread/' + message.id)
      await page.getByText('Fixture answer', { exact: true }).waitFor()
      assert(historyCalls(calls.slice(beforeSearch)).some(call => call.params.threadId === message.id))

      await field.fill('unsupported')
      await page.getByText('Message search requires a Codex server', { exact: false }).waitFor()
      await field.fill('network-error')
      await page.getByText('Fixture connection unavailable', { exact: false }).waitFor()
      await pick('Thread Name').click()
      await field.fill(old.name)
      await results.getByRole('link').first().click()
      await page.waitForURL('**/#/thread/' + old.id)

      await pick('Project').click()
      await field.fill('空 Project')
      await row('empty-b').click()
      await page.getByText('Selected folder', { exact: false }).waitFor()
      assert.deepEqual(queryOf(page.url()), { cwd: '/registered/empty + #', projectId: 'empty-b' })
    }

    await pick('Folder').click()
    await field.fill('共有')
    await row(longPath).click()
    await page.waitForURL(url => queryOf(url.href).cwd === longPath)
    assert.deepEqual(queryOf(page.url()), { cwd: longPath })
    assert.equal(await page.locator('.new-thread-folder-selected').getAttribute('title'), longPath)
    await page.locator('.mobile-drawer').waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    return {
      theme, viewport, testedUrl, screenshot, colors,
      cachedNameSearchRpcs: searchRequests.length, maxConcurrentOlderPageRpcs: maxPaging,
      olderListCursors: moreCalls(), messageQueriesAndCursors: messages(),
      candidateHistoryReadsBeforeSelection: 0,
    }
  } finally {
    await context.close()
  }
}

async function main() {
  mkdirSync(output, { recursive: true })
  const browser = await chromium.launch()
  try {
    const report = []
    for (const [width, height] of [[1440, 900], [768, 1024], [375, 812]]) {
      for (const theme of ['light', 'dark']) {
        report.push(await run(browser, { width, height }, theme, width === 1440 && theme === 'light'))
      }
    }
    writeFileSync(resolve(output, 'sidebar-search.json'), JSON.stringify(report, null, 2))
    console.log('PASS Sidebar search in six layouts, including destination routing, cursor reuse and retry, and stale message cancellation')
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
