// Requires the current checkout on 127.0.0.1:4173. Protocol traffic is stubbed.
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { chromium } = require('playwright')
const { setup, assert, thread } = require('./approved-fixture.cjs')

const output = 'output/playwright'
const viewports = [{ width: 1280, height: 900 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]
const draft = 'Keep the existing sections'
const questionMethod = 'item/tool/requestUserInput'

function questionRequest(id, turnId) {
  return {
    id,
    method: questionMethod,
    params: {
      threadId: thread.id,
      turnId,
      questions: [{
        id: 'scope',
        header: 'Documentation scope',
        question: 'Which scope should the plan use?',
        isOther: true,
        options: [
          { label: 'Quick update', description: 'Update the setup notes.' },
          { label: 'Full review', description: 'Review the whole guide.' },
        ],
      }],
    },
  }
}

function history(turnId) {
  return {
    id: turnId,
    status: 'completed',
    items: Array.from({ length: 12 }, (_, index) => ({
      type: 'agentMessage',
      id: `${turnId}-${index}`,
      text: `${turnId} ${index}. ${'Conversation history with room to scroll. '.repeat(8)}`,
    })),
  }
}

async function assertPosition(panel, previousId, nextId = null) {
  assert.deepEqual(await panel.evaluate(element => {
    const row = element.parentElement
    return {
      parentClass: row.parentElement.className,
      previousId: row.previousElementSibling?.dataset.messageId ?? null,
      nextId: row.nextElementSibling?.dataset.messageId ?? null,
    }
  }), { parentClass: 'conversation-list', previousId, nextId })
}

async function verify(page, viewport, theme) {
  let pendingOnReload = null
  const turns = [
    history('Earlier history'),
    {
      id: 'question-turn',
      status: 'completed',
      items: [
        { type: 'userMessage', id: 'question-user', content: [{ type: 'text', text: 'Prepare a documentation plan.' }] },
        { type: 'agentMessage', id: 'question-agent', text: 'The plan depends on the documentation scope.' },
        {
          type: 'fileChange', id: 'question-file-change', status: 'completed',
          changes: [{ path: '/remote/project/guide.md', kind: { type: 'add' }, diff: 'Fixture notes' }],
        },
      ],
    },
    history('Later history'),
    { id: 'latest', status: 'completed', items: [{ type: 'agentMessage', id: 'a', text: 'Fixture answer' }] },
  ]
  const requests = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/codex-api/')) requests.push(request.url())
  })
  const { calls, emit, errors } = await setup(page, (body, _page, url) => {
    if (url.pathname.endsWith('/server-requests/respond')) return { json: { ok: true } }
    if (url.pathname.endsWith('/server-requests/pending') && pendingOnReload) {
      return { json: { data: [pendingOnReload] } }
    }
    if (body.method === 'thread/resume' || body.method === 'thread/read') {
      return { json: { result: { thread: { ...thread, turns }, model: 'fixture-model', modelProvider: 'fixture' } } }
    }
  }, false)

  const panel = page.locator('.conversation-list .thread-pending-request')
  const footer = page.locator('.composer-container .thread-pending-request')
  const heading = panel.getByRole('button', { name: 'Awaiting response', exact: true })
  const input = page.locator('.thread-composer-input')
  const list = page.locator('.conversation-list')
  const choice = panel.locator('.composer-dropdown-trigger')
  const other = panel.getByPlaceholder('Other answer')
  const send = panel.getByRole('button', { name: 'Send', exact: true })
  const replies = () => calls.filter(call => call.path.endsWith('/server-requests/respond'))

  await input.waitFor()
  emit('server/request', questionRequest(200, 'question-turn'))
  await heading.waitFor()
  assert.equal(await heading.getAttribute('aria-expanded'), 'true')
  assert.equal(await footer.count(), 0)
  assert.equal(await input.isVisible(), false)
  assert.equal(await list.locator('[data-message-id="question-file-change"]').count(), 0)
  await assertPosition(panel, 'question-agent', 'Later history-0')

  await choice.click()
  await panel.getByRole('button', { name: 'Full review', exact: true }).click()
  assert.equal(await panel.getByText('Review the whole guide.').isVisible(), true)
  await other.fill(draft)
  await list.evaluate(element => {
    const row = element.querySelector('[data-message-id="question-agent"]')
    element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - 30
  })
  await heading.evaluate(element => element.focus({ preventScroll: true }))
  await page.waitForTimeout(2200)

  const colors = await panel.evaluate(element => {
    const background = selector => getComputedStyle(element.querySelector(selector)).backgroundColor
    return {
      dark: document.documentElement.classList.contains('dark'),
      panel: background('.thread-pending-request-shell'),
      question: background('.thread-pending-request-question'),
      input: background('.thread-pending-request-input'),
      primary: background('.thread-pending-request-primary'),
      fits: element.scrollWidth <= element.clientWidth,
    }
  })
  assert.equal(colors.dark, theme === 'dark')
  assert.equal(colors.fits, true)
  const luminance = color => color.startsWith('oklch(') ? Number(color.slice(6).split(' ')[0]) :
    Number(color.match(/\d+/)?.[0]) / 255
  for (const surface of [colors.panel, colors.question, colors.input]) {
    assert.ok(theme === 'dark' ? luminance(surface) < 0.35 : luminance(surface) > 0.9, surface)
  }
  const expanded = join(output, `plan-mode-question-expanded-${viewport.width}-${theme}.png`)
  const minimized = join(output, `plan-mode-question-minimized-${viewport.width}-${theme}.png`)
  await page.screenshot({ path: expanded })

  const readingPosition = () => list.evaluate(element => ({
    scrollTop: element.scrollTop,
    precedingRowTop: element.querySelector('[data-message-id="question-agent"]').getBoundingClientRect().top,
  }))
  const positionBefore = await readingPosition()
  const requestsBefore = requests.length
  await page.keyboard.press('Enter')
  assert.equal(await heading.getAttribute('aria-expanded'), 'false')
  assert.equal(await panel.innerText(), 'Awaiting response')
  assert.equal(await input.isVisible(), false)
  assert.equal(await heading.evaluate(element => element === document.activeElement), true)
  await page.waitForTimeout(2200)
  assert.deepEqual(await readingPosition(), positionBefore)
  await page.screenshot({ path: minimized })
  await page.keyboard.press('Space')
  assert.equal(await heading.getAttribute('aria-expanded'), 'true')
  assert.equal(await heading.evaluate(element => element === document.activeElement), true)
  assert.equal(await choice.innerText(), 'Full review')
  assert.equal(await other.inputValue(), draft)
  assert.deepEqual(await readingPosition(), positionBefore)
  await page.waitForTimeout(200)
  assert.equal(requests.length, requestsBefore, 'minimize and expand must not make API requests')

  // A different request starts expanded and moves when its first message streams in.
  await heading.click()
  pendingOnReload = questionRequest(201, 'live')
  emit('server/request', pendingOnReload)
  await page.waitForFunction(() => document.querySelector('.thread-pending-request .plan-card-title')?.getAttribute('aria-expanded') === 'true')
  assert.equal(await other.inputValue(), '')
  await assertPosition(panel, 'a')
  await choice.click()
  await panel.getByRole('button', { name: 'Full review', exact: true }).click()
  await other.fill(draft)
  await heading.click()
  emit('turn/started', { threadId: thread.id, turn: { id: 'live', status: 'inProgress', items: [] } })
  emit('item/agentMessage/delta', { threadId: thread.id, turnId: 'live', itemId: 'live-agent', delta: 'A live line in the question turn.' })
  await page.getByText('A live line in the question turn.', { exact: true }).waitFor()
  await assertPosition(panel, 'live-agent')
  assert.equal(await heading.getAttribute('aria-expanded'), 'false')
  await heading.click()
  assert.equal(await choice.innerText(), 'Full review')
  assert.equal(await other.inputValue(), draft)
  await send.click()
  await panel.getByRole('button', { name: 'Quick update', exact: true }).waitFor()
  await assertPosition(panel, 'question-agent', 'Later history-0')
  assert.deepEqual(replies(), [{
    path: '/codex-api/server-requests/respond',
    id: 201,
    result: { answers: { scope: { answers: ['Full review', draft] } } },
  }])

  // Reload with the earlier request still pending.
  pendingOnReload = questionRequest(200, 'question-turn')
  await heading.click()
  await page.reload()
  await heading.waitFor()
  assert.equal(await heading.getAttribute('aria-expanded'), 'true')
  assert.equal(await input.isVisible(), false)
  await assertPosition(panel, 'question-agent', 'Later history-0')
  pendingOnReload = null
  await send.click()
  await input.waitFor()

  emit('server/request', {
    id: 202,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: thread.id, turnId: 'live', command: 'echo approved' },
  })
  await footer.getByText('echo approved', { exact: true }).waitFor()
  assert.equal(await input.isVisible(), false)
  assert.equal(await panel.count(), 0)
  await footer.getByRole('button', { name: /Yes for Session$/ }).click()
  await footer.getByRole('button', { name: 'Send', exact: true }).click()
  await input.waitFor()
  assert.deepEqual(replies().at(-1).result, { decision: 'acceptForSession' })

  emit('server/request', {
    id: 203,
    method: 'mcpServer/elicitation/request',
    params: { threadId: thread.id, serverName: 'fixture', mode: 'url', url: 'https://example.com/authorize' },
  })
  await footer.getByText('MCP server input required', { exact: true }).waitFor()
  assert.equal(await input.isVisible(), false)
  assert.equal(await panel.count(), 0)
  await footer.getByRole('button', { name: 'Cancel', exact: true }).click()
  await input.waitFor()
  assert.deepEqual(replies().at(-1).result, { action: 'cancel' })
  assert.equal(replies().length, 4)
  assert.deepEqual(errors, [])
  return { url: page.url(), viewport, theme, expanded, minimized, colors, readingPosition: positionBefore, toggleApiRequests: 0 }
}

async function main() {
  mkdirSync(output, { recursive: true })
  const browser = await chromium.launch()
  const results = []
  try {
    for (const viewport of viewports) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport, colorScheme: theme })
        try {
          results.push(await verify(page, viewport, theme))
          console.log('PASS', viewport.width, theme)
        } catch (error) {
          await page.screenshot({ path: join(output, `plan-mode-question-failure-${viewport.width}-${theme}.png`) })
          throw error
        } finally {
          await page.close()
        }
      }
    }
    writeFileSync(join(output, 'plan-mode-question-conversation-results.json'), JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
