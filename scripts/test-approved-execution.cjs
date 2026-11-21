const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { chromium } = require('playwright')
const { setup, thread, assert } = require('./approved-fixture.cjs')

const row = (page, id) => page.locator(`[data-message-id="${id}"]`)
const button = (container, name) => container.getByRole('button', { name, exact: true })
const search = (id, query, results) => ({ id, type: 'webSearch', query, results })
const mcp = (id, status, result) => ({ id, type: 'mcpToolCall', server: 'fixture', tool: 'live', status, arguments: {}, result })
const command = (id, command) => ({ id, type: 'commandExecution', command, status: 'completed', exitCode: 0 })
const historyCalls = calls => calls.filter(call => ['thread/read', 'thread/resume', 'thread/turns/list'].includes(call.method))
const assertExpanded = async (control, expected) => assert.equal(await control.getAttribute('aria-expanded'), String(expected))

async function openHistoryFixture(page) {
  const older = [
    { id: 'oldest', status: 'completed', items: [search('oldest-search', 'Oldest search')] },
    { id: 'old', status: 'completed', items: [search('old-a', 'Older first'), search('old-b', 'Older second')] },
  ]
  const latest = [{ id: 'recent', status: 'completed', items: [
    search('question-a', 'Before question'), search('question-b', 'After question'),
    { type: 'agentMessage', id: 'recent-reply', text: 'Fixture answer' },
  ] }]
  const responses = [{
    id: 'execution-answer', threadId: thread.id, turnId: 'recent', anchorItemId: 'question-a',
    submittedAt: '2026-11-20T01:05:00.000Z', questions: [{ id: 'keep', heading: 'Keep searching?', answers: ['Yes'] }],
  }]
  const retrieved = []
  const fixture = await setup(page, body => {
    const { method } = body
    if ((method === 'thread/read' && body.params?.includeTurns) || method === 'thread/resume') {
      retrieved.push({ method, turns: latest.length, items: latest.flatMap(turn => turn.items).length })
      return { json: { result: {
        thread: { ...thread, turns: latest }, questionResponses: responses, olderCursor: 'older-execution',
        model: 'fixture-model', modelProvider: 'fixture',
      } } }
    }
    if (method === 'thread/turns/list') {
      retrieved.push({ method, turns: older.length, items: older.flatMap(turn => turn.items).length })
      return { json: { result: { data: [...older].reverse(), nextCursor: null } } }
    }
  }, false)
  return { ...fixture, retrieved }
}

async function loadOlderHistory(page, fixture) {
  assert.equal(await row(page, 'old-a').count(), 0)
  assert.equal(fixture.calls.filter(call => call.method === 'thread/turns/list').length, 0)
  await button(page, 'Load earlier messages').click()
  await row(page, 'old-a').waitFor()
  assert.deepEqual(fixture.calls.filter(call => call.method === 'thread/turns/list').map(call => call.params), [
    { threadId: thread.id, cursor: 'older-execution', limit: 10, itemsView: 'full', sortDirection: 'desc' },
  ])
}

async function verifyHistory(page) {
  const fixture = await openHistoryFixture(page)
  const ids = () => page.locator('.conversation-item[data-message-id]').evaluateAll(rows => rows.map(row => row.dataset.messageId))
  const recent = ['question-a', 'question-response-execution-answer', 'question-b', 'recent-reply']
  assert.deepEqual(await ids(), recent)
  await row(page, 'question-response-execution-answer').getByText('Keep searching?').waitFor()
  await button(row(page, 'question-a'), 'Before question').waitFor()
  await button(row(page, 'question-b'), 'After question').waitFor()

  await loadOlderHistory(page, fixture)
  assert.deepEqual(await ids(), ['oldest-search', 'old-a', ...recent])
  const olderGroup = button(row(page, 'old-a'), '2 web searches')
  await assertExpanded(olderGroup, false)
  await olderGroup.click()
  await button(row(page, 'oldest-search'), 'Oldest search').waitFor()
  assert.deepEqual(await row(page, 'old-a').locator('.execution-details .cmd-group-label').allTextContents(), ['Older first', 'Older second'])
  assert.equal(await row(page, 'old-b').count(), 1)
  assert.equal(await button(page, 'Load earlier messages').count(), 0)
  assert.deepEqual(fixture.errors, [])
  console.log('History entries retrieved:', JSON.stringify(fixture.retrieved))
}

async function verifyRows(page, viewport, theme) {
  const { calls, emit, errors } = await setup(page, () => undefined, false)
  const notify = (method, params, turnId = 'live') => emit(method, { threadId: thread.id, turnId, ...params })
  const start = (item, turnId) => notify('item/started', { item }, turnId)
  const complete = item => notify('item/completed', { item })

  const tool = row(page, 'm').locator('.execution-details')
  const toolButton = button(tool, 'MCP · fixture · lookup')
  await assertExpanded(toolButton, false)
  await toolButton.click()
  const toolDetails = await tool.locator('pre').innerText()
  assert.match(toolDetails, /Status: completed/)
  assert.match(toolDetails, /Arguments:[\s\S]+"q": "safe"/)
  assert.match(toolDetails, /Structured fixture result/)
  assert.match(toolDetails, /<script>window.BAD=true<\/script> token=\[redacted\]/)
  assert.doesNotMatch(toolDetails, /HIDDEN_META|STRUCTURED_SECRET|INTERNAL_DIAGNOSTIC/)
  assert.equal(await tool.locator('pre script').count(), 0)
  assert.equal(await page.evaluate(() => window.BAD), undefined)
  await toolButton.click()

  const standalone = button(row(page, 'w'), 'fixture query')
  await assertExpanded(standalone, false)
  await standalone.click()
  await row(page, 'w').getByText('Results: Empty result', { exact: false }).waitFor()
  await standalone.click()
  const reads = historyCalls(calls).length

  start(search('before-tool', 'Before MCP'))
  start(mcp('live-m', 'inProgress'))
  notify('item/mcpToolCall/progress', { itemId: 'live-m', message: 'Working fixture' })
  start(search('before-command', 'Before commands'))
  start(command('command-a', 'pwd'))
  start(command('command-b', 'git status --short'))
  start(search('live-a', 'First live search'))
  const first = button(row(page, 'live-a'), 'First live search')
  await first.click()
  const longQuery = 'Second live search ' + 'with a long query '.repeat(25).trim()
  start(search('live-b', longQuery))
  start(search('live-c', ''))
  const group = button(row(page, 'live-a'), '3 web searches')
  await group.waitFor()
  await assertExpanded(group, true)
  await assertExpanded(first, true)
  await first.click()
  await assertExpanded(group, true)
  assert.equal(await row(page, 'live-a').locator('pre').count(), 0)
  const second = button(row(page, 'live-b'), longQuery)
  const third = button(row(page, 'live-c'), 'Web search')
  assert.deepEqual(await row(page, 'live-a').locator('.execution-details button .cmd-group-label').allTextContents(),
    ['First live search', longQuery, 'Web search'])
  await third.click()
  await row(page, 'live-c').getByText('Results: Unavailable', { exact: false }).waitFor()
  await second.click()
  await assertExpanded(third, false)
  await assertExpanded(second, true)
  assert.equal(await row(page, 'live-a').locator('pre').count(), 1)
  assert.ok(await second.locator('.cmd-group-label').evaluate(label => {
    const style = getComputedStyle(label)
    return label.scrollWidth > label.clientWidth && style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap'
  }))
  assert.equal(await second.locator('.cmd-group-label').getAttribute('title'), longQuery)
  complete(search('live-b', longQuery, [{ title: '<b>Public result</b>', snippet: 'Fixture result text' }]))
  await row(page, 'live-b').getByText('<b>Public result</b>', { exact: false }).waitFor()
  assert.equal(await row(page, 'live-b').locator('pre b').count(), 0)
  await assertExpanded(second, true)
  await group.click()
  await assertExpanded(group, false)
  assert.equal(await row(page, 'live-a').locator('.execution-details').count(), 0)

  notify('item/agentMessage/delta', { itemId: 'later-agent', delta: 'Ordering answer' })
  start(search('after-response', 'After response'))
  start(search('other-turn', 'Different turn'), 'other-live')
  await button(row(page, 'other-turn'), 'Different turn').waitFor()
  const relevant = ['before-tool', 'live-m', 'before-command', 'command-b', 'live-a', 'later-agent', 'after-response', 'other-turn']
  const ids = await page.locator('.conversation-item[data-message-id]').evaluateAll((rows, relevantIds) =>
    rows.map(row => row.dataset.messageId).filter(id => relevantIds.includes(id)), relevant)
  assert.deepEqual(ids, relevant)

  const liveTool = button(row(page, 'live-m'), 'MCP · fixture · live')
  const commands = row(page, 'command-b').getByRole('button', { name: /^.*2 commands/ })
  const measure = target => target.evaluate(el => {
    const style = getComputedStyle(el)
    const label = el.querySelector('.cmd-group-label')
    const row = el.closest('.conversation-item')
    return {
      x: el.getBoundingClientRect().left, labelX: label.getBoundingClientRect().left,
      height: el.getBoundingClientRect().height, lineHeight: getComputedStyle(label).lineHeight,
      margins: [style.marginBlockStart, style.marginBlockEnd, style.marginInlineStart, style.marginInlineEnd],
      parentGap: getComputedStyle(row.parentElement).rowGap, background: style.backgroundColor,
      color: getComputedStyle(label).color, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    }
  })
  await commands.waitFor()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
  const commandStyle = await measure(commands)
  assert.equal(commandStyle.theme, theme)
  assert.deepEqual(commandStyle.margins, ['0px', '0px', '0px', '0px'])
  for (const control of [standalone, group, liveTool]) assert.deepEqual(await measure(control), commandStyle)

  await liveTool.click()
  await row(page, 'live-m').getByText('Progress: Working fixture', { exact: false }).waitFor()
  complete(mcp('live-m', 'completed', { content: [] }))
  await row(page, 'live-m').getByText('Status: completed', { exact: false }).waitFor()
  await assertExpanded(liveTool, true)
  assert.equal(await row(page, 'live-m').count(), 1)
  assert.equal(await historyCalls(calls).length, reads)
  await group.click()
  await assertExpanded(second, true)
  await liveTool.evaluate(el => {
    const list = el.closest('.conversation-list')
    list.scrollTop += el.getBoundingClientRect().top - list.getBoundingClientRect().top - 8
  })
  const detailsWidth = await row(page, 'live-b').locator('pre').evaluate(pre => {
    pre.scrollTop = pre.scrollHeight
    return pre.scrollWidth - pre.clientWidth
  })
  assert.equal(detailsWidth, 0, 'Search details fit the conversation width')
  await page.mouse.move(0, 0)
  await page.waitForTimeout(2200)
  const path = resolve('output/playwright', `approved-06-${viewport.width}-${theme}.png`)
  await page.screenshot({ path })
  assert.deepEqual(errors, [])
  console.log(`PASS ${viewport.width}x${viewport.height} ${theme}`, page.url(), commandStyle, path)
}

async function main() {
  mkdirSync('output/playwright', { recursive: true })
  const browser = await chromium.launch()
  try {
    const historyPage = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try { await verifyHistory(historyPage) } finally { await historyPage.close() }
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport, colorScheme: theme, hasTouch: viewport.width <= 768, isMobile: viewport.width <= 768 })
        try { await verifyRows(page, viewport, theme) } finally { await page.close() }
      }
    }
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
