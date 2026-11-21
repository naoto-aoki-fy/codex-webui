// Requires the current checkout on 127.0.0.1:4173. Protocol traffic is stubbed.
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { chromium } = require('playwright')
const { setup, assert, thread } = require('./approved-fixture.cjs')

const output = 'output/playwright'
const viewports = [{ width: 1280, height: 900 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]
const draft = 'Keep the existing sections'
const questionMethod = 'item/tool/requestUserInput'
const secondThread = { ...thread, id: 'second-fixture', name: 'Second fixture' }

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

async function scrollToMessage(list, id) {
  await list.evaluate((element, messageId) => {
    const row = element.querySelector(`[data-message-id="${messageId}"]`)
    element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - 30
  }, id)
}

async function assertQuestionFocused(heading, jumpQuestion) {
  await jumpQuestion.waitFor({ state: 'hidden' })
  assert.deepEqual(await heading.evaluate(element => {
    const list = element.closest('.conversation-list').getBoundingClientRect()
    const heading = element.getBoundingClientRect()
    return {
      focused: document.activeElement === element,
      visible: heading.top >= list.top && heading.bottom <= list.bottom,
    }
  }), { focused: true, visible: true })
}

async function pressUpFromStart(page, list) {
  const scrollTop = await list.evaluate(async element => {
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
    // Let the initial follow-to-bottom frames settle first.
    for (let frame = 0; frame < 8; frame++) await nextFrame()
    // Suppress the setup scroll event so Ctrl+ArrowUp owns the history request.
    const suppressScroll = event => event.stopImmediatePropagation()
    element.addEventListener('scroll', suppressScroll, true)
    element.scrollTop = 0
    await nextFrame()
    await nextFrame()
    element.removeEventListener('scroll', suppressScroll, true)
    return element.scrollTop
  })
  assert.equal(scrollTop, 0)
  await page.keyboard.press('Control+ArrowUp')
  await list.getByRole('button', { name: 'Loading…', exact: true }).waitFor()
}

async function assertMessageAligned(page, messageId) {
  await page.waitForFunction(id => {
    const list = document.querySelector('.conversation-list')
    const row = list?.querySelector(`[data-message-id="${id}"]`)
    return row && Math.abs(row.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientTop) <= 1
  }, messageId)
}

function historyPage(turn, nextCursor = null) {
  return { json: { result: { data: [turn], nextCursor } } }
}

async function verify(page, viewport, theme) {
  let pendingOnReload = null
  let historyResponse = null
  let secondHistoryResponse = null
  const delayedReplies = new Map()
  const delayReply = id => {
    let release
    delayedReplies.set(id, new Promise(resolve => { release = resolve }))
    return release
  }
  const finishInterruptedReply = delayReply(263)
  const retryableAttempts = new Map()
  const turns = [
    { id: 'first-turn', status: 'completed', items: [{ type: 'agentMessage', id: 'first', text: 'Fixture start' }] },
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
  const { calls, emit, errors } = await setup(page, async (body, _page, url) => {
    if (url.pathname.endsWith('/server-requests/respond')) {
      const delayed = await delayedReplies.get(body.id)
      if (delayed) return delayed
      const privateScope = body.id === 262 || body.id === 269
      if (privateScope) {
        const attempts = (retryableAttempts.get(body.id) ?? 0) + 1
        retryableAttempts.set(body.id, attempts)
        if (attempts === 1) return { status: 502, json: {
          error: 'Question reply was not sent. Your draft is kept. You can retry.', code: 'question_reply_not_sent',
        } }
      }
      const request = ([200, 201, 204].includes(body.id) || privateScope) && body.result?.answers
      if (!request) return { json: { ok: true } }
      const turnId = body.id === 201 ? 'live' : body.id === 204 ? 'first-turn' : 'question-turn'
      const response = {
        id: 'answer-' + body.id, threadId: thread.id, turnId,
        anchorItemId: body.id === 201 ? 'live-agent' : body.id === 204 ? 'first' : 'question-agent', submittedAt: '2026-11-20T01:05:00.000Z',
        questions: privateScope ? [{ id: 'scope', heading: 'Documentation scope', provided: true }] : [
          { id: 'scope', heading: 'Documentation scope', answers: body.result.answers.scope.answers },
          { id: 'secret', heading: 'Private answer', provided: true },
        ],
      }
      emit('server/request/resolved', { id: body.id, threadId: thread.id, response })
      return { json: { ok: true, response, saved: true } }
    }
    if (url.pathname.endsWith('/server-requests/pending') && pendingOnReload) {
      return { json: { data: [pendingOnReload] } }
    }
    if (body.method === 'thread/list') return { json: { result: { data: [thread, secondThread], nextCursor: null } } }
    if (body.method === 'thread/resume' || body.method === 'thread/read') {
      const detail = body.params.threadId === secondThread.id
        ? { ...secondThread, turns: [history('second-initial')] }
        : { ...thread, turns }
      return { json: { result: { thread: detail, model: 'fixture-model', modelProvider: 'fixture', olderCursor: 'older-fixture' } } }
    }
    if (body.method === 'thread/turns/list') {
      const response = await (body.params.threadId === secondThread.id ? secondHistoryResponse : historyResponse)
      if (response && response.json.result.nextCursor !== body.params.cursor) return response
      return { json: { result: { data: [], nextCursor: null } } }
    }
    if (body.method === 'turn/interrupt') {
      emit('turn/completed', { threadId: thread.id, turn: { id: body.params.turnId, status: 'interrupted', items: [] } })
      finishInterruptedReply({ status: 502, json: { error: 'Question reply could not be confirmed. Your draft is kept.' } })
    }
    if (body.method === 'turn/start') return { json: { result: { turn: { id: 'follow-up' } } } }
  }, false)

  const panel = page.locator('.conversation-list .thread-pending-request')
  const footer = page.locator('.composer-container .thread-pending-request')
  const heading = panel.locator('[data-pending-question-heading]')
  const input = page.locator('.thread-composer-input')
  const list = page.locator('.conversation-list')
  const choice = panel.locator('.composer-dropdown-trigger')
  const other = panel.getByPlaceholder('Other answer')
  const send = panel.getByRole('button', { name: 'Send', exact: true })
  const jumpQuestion = page.getByRole('button', { name: 'Jump to question', exact: true })
  const jumpLatest = page.getByRole('button', { name: 'Jump to latest output', exact: true })
  const pager = list.getByRole('button', { name: 'Load earlier messages', exact: true })
  const waitForReply = id => page.waitForRequest(request => new URL(request.url()).pathname === '/codex-api/server-requests/respond' &&
    request.postDataJSON()?.id === id)
  const assertQuestionHidden = async () => {
    await panel.waitFor({ state: 'detached' })
    await jumpQuestion.waitFor({ state: 'detached' })
    assert.equal(await footer.locator('[data-pending-question-heading]').count(), 0)
    assert.equal(await page.getByText(/Awaiting confirmation/).count(), 0)
  }
  const clickTwice = button => button.evaluate(element => {
    // Deliver both clicks before Vue removes the card.
    element.click()
    element.click()
  })
  const bottomGap = () => list.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)
  const outerScroll = () => list.evaluate(element => {
    const positions = []
    for (let parent = element.parentElement; parent; parent = parent.parentElement) positions.push(parent.scrollTop)
    return positions
  })
  const replies = () => calls.filter(call => call.path.endsWith('/server-requests/respond'))
  const historyRequests = () => calls.filter(call => call.method === 'thread/turns/list')
  const lightness = color => {
    const oklab = color.match(/^okl(?:ab|ch)\(([\d.]+)/)
    return oklab ? Number(oklab[1]) : Number(color.match(/\d+/)?.[0]) / 255
  }

  await input.waitFor()
  await pager.waitFor()
  await list.evaluate(element => { element.scrollTop = element.scrollHeight })
  assert.ok(Math.abs(await bottomGap()) <= 1)
  pendingOnReload = questionRequest(200, 'question-turn')
  emit('server/request', pendingOnReload)
  await heading.waitFor()
  await jumpQuestion.waitFor()
  assert.ok(Math.abs(await bottomGap()) <= 1, 'an earlier question should keep the latest output in view')
  assert.equal(await jumpLatest.count(), 0)
  assert.equal(await heading.getAttribute('aria-expanded'), 'true')
  assert.equal(await footer.count(), 0)
  assert.equal(await input.isVisible(), false)
  assert.equal(await list.locator('[data-message-id="question-file-change"]').count(), 0)
  await assertPosition(panel, 'question-agent', 'Later history-0')

  await scrollToMessage(list, 'Later history-4')
  await jumpLatest.waitFor()
  const jumpBounds = await jumpQuestion.boundingBox()
  const latestBounds = await jumpLatest.boundingBox()
  assert.equal(jumpBounds.y, latestBounds.y)
  assert.ok(jumpBounds.x >= 0 && jumpBounds.x + jumpBounds.width < latestBounds.x)
  assert.ok(latestBounds.x + latestBounds.width <= viewport.width)
  for (const button of [jumpQuestion, jumpLatest]) {
    const surface = await button.evaluate(element => getComputedStyle(element).backgroundColor)
    assert.ok(theme === 'dark' ? lightness(surface) < 0.35 : lightness(surface) > 0.9, surface)
  }
  const jumpActions = join(output, `plan-mode-question-jump-actions-${viewport.width}-${theme}.png`)
  await page.waitForTimeout(2200)
  await page.screenshot({ path: jumpActions })

  const requestsBeforeClick = requests.length
  const outerPosition = await outerScroll()
  await jumpQuestion.click()
  await assertQuestionFocused(heading, jumpQuestion)
  assert.equal(await heading.getAttribute('aria-expanded'), 'true')
  assert.deepEqual(await outerScroll(), outerPosition)
  await page.waitForTimeout(200)
  assert.equal(requests.length, requestsBeforeClick, 'clicking Jump to question must not make API requests')

  await choice.click()
  await panel.getByRole('button', { name: 'Full review', exact: true }).click()
  assert.equal(await panel.getByText('Review the whole guide.').isVisible(), true)
  await other.fill(draft)
  await scrollToMessage(list, 'question-agent')
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
  for (const surface of [colors.panel, colors.question, colors.input]) {
    assert.ok(theme === 'dark' ? lightness(surface) < 0.35 : lightness(surface) > 0.9, surface)
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
  await heading.evaluate(element => element.focus({ preventScroll: true }))
  await page.keyboard.press('Enter')
  await heading.and(page.locator('[aria-expanded="false"]')).waitFor()
  assert.equal(await panel.innerText(), 'Awaiting response')
  assert.equal(await input.isVisible(), false)
  assert.equal(await heading.evaluate(element => element === document.activeElement), true)
  await page.waitForTimeout(2200)
  assert.deepEqual(await readingPosition(), positionBefore)
  await page.screenshot({ path: minimized })
  await page.keyboard.press('Space')
  await heading.and(page.locator('[aria-expanded="true"]')).waitFor()
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
  await assertPosition(panel, 'question-agent', 'Later history-0')
  assert.equal(await choice.innerText(), 'Full review')
  assert.equal(await other.inputValue(), draft)
  assert.deepEqual(replies(), [{
    path: '/codex-api/server-requests/respond',
    id: 201,
    result: { answers: { scope: { answers: ['Full review', draft] } } },
  }])

  const saved = list.locator('[data-message-id="question-response-answer-201"]')
  await saved.getByRole('heading', { name: 'Documentation scope', exact: true }).waitFor()
  assert.equal(await saved.count(), 1)
  assert.equal(await saved.getByText('Answer hidden', { exact: true }).count(), 1)
  assert.equal(await saved.getByRole('button', { name: 'Copy answers' }).count(), 1)
  assert.equal(await saved.getByRole('button', { name: /revert|fork/i }).count(), 0)
  assert.equal(await saved.evaluate(element => element.previousElementSibling.dataset.messageId), 'live-agent')
  await saved.scrollIntoViewIfNeeded()
  await page.waitForTimeout(2200)
  const answerScreenshot = join(output, `question-answer-${viewport.width}-${theme}.png`)
  await page.screenshot({ path: answerScreenshot })

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

  // A long question can have a visible Send button and an offscreen heading near pageable history.
  await scrollToMessage(list, 'Later history-4')
  await jumpLatest.waitFor()
  const laterRow = list.locator('[data-message-id="Later history-4"]')
  const laterRowTop = () => laterRow.evaluate(row => row.getBoundingClientRect().top)
  const laterPosition = await laterRowTop()
  const longQuestion = questionRequest(204, 'first-turn')
  const scope = longQuestion.params.questions[0]
  longQuestion.params.questions.push(...Array.from({ length: 12 }, (_, index) => ({
    ...scope,
    id: `section-${index}`,
    header: `Review section ${index + 1}`,
    isOther: false,
  })))
  emit('server/request', longQuestion)
  await jumpQuestion.waitFor()
  assert.ok(Math.abs(await laterRowTop() - laterPosition) <= 1, 'a question above the viewport should preserve the reading position')
  const showCardEnd = () => send.evaluate(element => {
    const list = element.closest('.conversation-list')
    list.scrollTop += element.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom + 90
  })
  await showCardEnd()
  await page.waitForFunction(() => {
    const list = document.querySelector('.conversation-list').getBoundingClientRect()
    const heading = document.querySelector('[data-pending-question-heading]').getBoundingClientRect()
    const send = document.querySelector('.conversation-list .thread-pending-request-primary').getBoundingClientRect()
    return heading.bottom < list.top && send.top >= list.top && send.bottom <= list.bottom
  })
  await jumpQuestion.waitFor()
  const requestsBeforeKeyboard = requests.length
  await jumpLatest.focus()
  await page.keyboard.press('Shift+Tab')
  assert.equal(await jumpQuestion.evaluate(element => document.activeElement === element), true)
  await page.keyboard.press('Enter')
  await assertQuestionFocused(heading, jumpQuestion)
  assert.ok(await list.evaluate(element => element.scrollTop < 200), 'jump must land inside the history-loading threshold')
  await page.waitForTimeout(200)
  assert.equal(requests.length, requestsBeforeKeyboard, 'keyboard jump must not make API requests, including pagination')
  assert.equal(await pager.count(), 1)

  await other.fill(draft)
  await heading.click()
  await jumpLatest.click()
  await jumpQuestion.waitFor()
  const requestsBeforeMinimizedJump = requests.length
  await jumpQuestion.click()
  await assertQuestionFocused(heading, jumpQuestion)
  assert.equal(await heading.getAttribute('aria-expanded'), 'false')
  assert.equal(await other.isVisible(), false)
  await page.waitForTimeout(200)
  assert.equal(requests.length, requestsBeforeMinimizedJump, 'jumping to a minimized card must not make API requests')
  await page.keyboard.press('Space')
  assert.equal(await other.inputValue(), draft)

  await showCardEnd()
  await jumpQuestion.waitFor()
  const releaseLongReply = delayReply(204)
  const longSubmitted = waitForReply(204)
  await clickTwice(send)
  await longSubmitted
  await assertQuestionHidden()
  const longAnswer = list.locator('[data-message-id="question-response-answer-204"]')
  assert.equal(await longAnswer.count(), 0)
  releaseLongReply()
  await longAnswer.waitFor()
  await assertQuestionHidden()
  await input.waitFor()
  assert.deepEqual(replies().at(-1).result.answers.scope.answers, ['Quick update', draft])
  assert.equal(replies().length, 5)

  // Start with an unused cursor after the earlier question and submission flows.
  await page.reload()
  await input.waitFor()
  await pager.waitFor()
  const historyRestored = join(output, `plan-mode-question-history-${viewport.width}-${theme}.png`)
  const historyActions = ['keyboard', 'restore', 'latest', 'focus elsewhere', 'scroll manually']
  const keyboardHistoryRestored = join(output, `plan-mode-question-keyboard-history-${viewport.width}-${theme}.png`)
  for (const [index, action] of historyActions.entries()) {
    if (index > 0) {
      await page.reload()
      await input.waitFor()
      await pager.waitFor()
    }
    const requestId = 205 + index
    const turnId = `paged-question-${requestId}`
    const anchorId = `${turnId}-anchor`
    let releaseHistory
    historyResponse = new Promise(resolve => { releaseHistory = resolve })
    const beforeHistory = historyRequests().length
    if (action === 'keyboard') {
      await pressUpFromStart(page, list)
    } else {
      await pager.evaluate(element => element.click())
      await list.getByRole('button', { name: 'Loading…', exact: true }).waitFor()
    }
    pendingOnReload = questionRequest(requestId, turnId)
    emit('server/request', pendingOnReload)
    await heading.waitFor({ state: 'attached' })
    await scrollToMessage(list, 'Earlier history-3')
    await jumpQuestion.waitFor()
    await assertPosition(panel, 'a')
    assert.equal(await list.locator(`[data-message-id="${anchorId}"]`).count(), 0)
    assert.equal(historyRequests().length, beforeHistory + 1)
    const ancestorsBefore = await outerScroll()
    await jumpQuestion.click()
    await assertQuestionFocused(heading, jumpQuestion)

    const headerMenu = page.locator('.conversation-header-menu > summary')
    if (action === 'restore') {
      // Set a draft and minimize before jumping again to the same temporary position.
      await other.fill(draft)
      await heading.click()
      await scrollToMessage(list, 'Later history-4')
      await jumpQuestion.click()
      await assertQuestionFocused(heading, jumpQuestion)
      assert.equal(await heading.getAttribute('aria-expanded'), 'false')
    } else if (action === 'latest') {
      await jumpLatest.click()
    } else if (action === 'focus elsewhere') {
      await headerMenu.evaluate(element => element.focus({ preventScroll: true }))
    } else if (action === 'scroll manually') {
      // Use a real wheel event and leave keyboard focus on the old heading.
      await list.hover()
      const start = await list.evaluate(element => element.scrollTop)
      await page.mouse.wheel(0, -120)
      await page.waitForFunction(top => document.querySelector('.conversation-list').scrollTop < top, start)
      assert.equal(await heading.evaluate(element => document.activeElement === element), true)
    }

    const anchorText = action === 'keyboard' ? `History page ${requestId}\n\n`.repeat(40) : `History page ${requestId}`
    releaseHistory(historyPage({
      id: turnId, status: 'completed', items: [{ type: 'agentMessage', id: anchorId, text: anchorText }],
    }, `before-${turnId}`))
    await pager.waitFor()
    await assertPosition(panel, anchorId, 'first')
    if (action === 'keyboard') {
      await page.waitForTimeout(2200)
      await assertQuestionFocused(heading, jumpQuestion)
      assert.deepEqual(await outerScroll(), ancestorsBefore)
      assert.equal(historyRequests().length, beforeHistory + 1, 'the keyboard history request must be the only history request')
      await page.screenshot({ path: keyboardHistoryRestored })
    } else if (action === 'restore') {
      await assertQuestionFocused(heading, jumpQuestion)
      assert.equal(await heading.getAttribute('aria-expanded'), 'false')
      assert.ok(await list.evaluate(element => element.scrollTop < 200), 'restoration must land inside the history-loading threshold')
      assert.deepEqual(await outerScroll(), ancestorsBefore)
      await page.waitForTimeout(2200)
      await page.screenshot({ path: historyRestored })
      await page.keyboard.press('Enter')
      assert.equal(await other.inputValue(), draft)
    } else {
      await jumpQuestion.waitFor()
      assert.equal(await heading.evaluate(element => document.activeElement === element), false)
      if (action === 'latest') assert.ok(Math.abs(await bottomGap()) <= 1, 'Jump to latest takes precedence over question restoration')
      if (action === 'focus elsewhere') assert.equal(await headerMenu.evaluate(element => document.activeElement === element), true)
      await page.waitForTimeout(200)
    }
    if (action !== 'keyboard') {
      assert.equal(historyRequests().length, beforeHistory + 1, `${action}: the jump and history render must share the existing page request`)
    }
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    pendingOnReload = null
    emit('server/request/resolved', { id: requestId, threadId: thread.id })
    if (action === 'restore') await panel.getByRole('button', { name: 'Dismiss draft' }).click()
    await heading.waitFor({ state: 'hidden' })
  }

  // Let an older request complete normally and keep moving without resetting navigation.
  await page.reload()
  await input.waitFor()
  await pager.waitFor()
  let releaseHistory
  historyResponse = new Promise(resolve => { releaseHistory = resolve })
  const beforeUninterrupted = historyRequests().length
  await pressUpFromStart(page, list)
  releaseHistory(historyPage(history('uninterrupted')))
  await assertMessageAligned(page, 'uninterrupted-11')
  await page.keyboard.press('Control+ArrowUp')
  await assertMessageAligned(page, 'uninterrupted-10')
  assert.equal(historyRequests().length, beforeUninterrupted + 1)

  const url = page.url()
  // Complete the first thread's request while a second shortcut is still waiting.
  await page.reload()
  await input.waitFor()
  await pager.waitFor()
  historyResponse = new Promise(resolve => { releaseHistory = resolve })
  const beforeSwitch = historyRequests().length
  await pressUpFromStart(page, list)
  await page.evaluate(id => { location.hash = `#/thread/${id}` }, secondThread.id)
  await list.locator('[data-message-id="second-initial-11"]').waitFor()
  await pager.waitFor()
  let releaseSecondHistory
  secondHistoryResponse = new Promise(resolve => { releaseSecondHistory = resolve })
  await pressUpFromStart(page, list)
  const firstResponse = page.waitForResponse(response => {
    const request = response.request()
    if (!request.url().includes('/codex-api/') || request.method() !== 'POST') return false
    const body = request.postDataJSON()
    return body.method === 'thread/turns/list' && body.params.threadId === thread.id
  })
  releaseHistory(historyPage(history('old-thread-page')))
  await (await firstResponse).finished()
  await page.waitForTimeout(200)
  const secondPosition = await list.evaluate(element => element.scrollTop)
  assert.equal(secondPosition, 0, 'the old completion must not scroll the second thread')
  await page.keyboard.press('Control+ArrowDown')
  assert.equal(await list.evaluate(element => element.scrollTop), secondPosition, 'the second shortcut must still be pending')
  releaseSecondHistory(historyPage(history('new-thread-page')))
  await assertMessageAligned(page, 'new-thread-page-11')
  assert.deepEqual(historyRequests().slice(beforeSwitch).map(call => call.params.threadId), [thread.id, secondThread.id])

  historyResponse = null
  secondHistoryResponse = null
  // Fail the original reply after navigation, with an approval replacing its panel.
  await page.evaluate(id => { location.hash = `#/thread/${id}` }, thread.id)
  await input.waitFor()
  const failedQuestion = questionRequest(260, 'question-turn')
  failedQuestion.params.questions[0].isSecret = true
  const finishFailedReply = delayReply(260)
  emit('server/request', failedQuestion)
  await heading.waitFor()
  await choice.click()
  await panel.getByRole('button', { name: 'Full review', exact: true }).click()
  await other.fill(draft)
  const failedSubmitted = waitForReply(260)
  await send.click()
  await failedSubmitted
  await assertQuestionHidden()
  emit('server/request', {
    id: 261, method: 'item/commandExecution/requestApproval',
    params: { threadId: thread.id, turnId: 'live', command: 'echo replacement' },
  })
  await footer.getByText('echo replacement', { exact: true }).waitFor()
  await page.evaluate(id => { location.hash = `#/thread/${id}` }, secondThread.id)
  await list.locator('[data-message-id="second-initial-11"]').waitFor()
  finishFailedReply({ status: 502, json: { error: 'Question reply could not be confirmed. Your draft is kept.' } })
  await page.evaluate(id => { location.hash = `#/thread/${id}` }, thread.id)
  await footer.getByText('echo replacement', { exact: true }).waitFor()
  await footer.getByRole('button', { name: 'Send', exact: true }).click()
  const unconfirmed = panel.getByRole('alert').filter({ hasText: 'Question reply could not be confirmed' })
  await unconfirmed.waitFor()
  assert.equal(await choice.innerText(), 'Full review')
  assert.equal(await other.inputValue(), draft)
  assert.equal(await other.getAttribute('type'), 'password')
  assert.equal(await panel.getByRole('button', { name: 'Retry', exact: true }).count(), 0)
  const recovered = page.waitForResponse(response => response.url().endsWith('/server-requests/pending'))
  emit('app-server/disconnected', {})
  emit('app-server/reconnected', {})
  await recovered
  await unconfirmed.waitFor()
  assert.equal(await other.inputValue(), draft)
  assert.equal(await choice.innerText(), 'Full review')
  assert.equal(replies().filter(reply => reply.id === 260).length, 1)
  assert.equal(await page.getByText('The previous approval expired with the connection.', { exact: false }).count(), 0)
  assert.equal(await list.locator('[data-message-id="question-response-answer-260"]').count(), 0)
  assert.equal(await page.evaluate(value => [localStorage, sessionStorage].some(storage =>
    Object.values(storage).some(row => row.includes(value))), draft), false)
  emit('server/request/resolved', { id: 260, threadId: thread.id })
  const dismiss = panel.getByRole('button', { name: 'Dismiss draft' })
  await dismiss.waitFor()
  const dismissColor = await dismiss.evaluate(element => getComputedStyle(element).color)
  assert.ok(theme === 'dark' ? lightness(dismissColor) > 0.65 : lightness(dismissColor) < 0.55, dismissColor)
  await panel.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
  const failedScreenshot = join(output, `question-draft-unconfirmed-${viewport.width}-${theme}.png`)
  await page.waitForTimeout(2200)
  await page.screenshot({ path: failedScreenshot })
  await dismiss.click()
  await heading.waitFor({ state: 'hidden' })

  pendingOnReload = questionRequest(262, 'question-turn')
  pendingOnReload.params.questions[0].isSecret = true
  emit('server/request', pendingOnReload)
  await heading.waitFor()
  const defaultChoice = await choice.innerText()
  await choice.click()
  await panel.getByRole('button', { name: 'Full review', exact: true }).click()
  await other.fill(draft)
  await send.click()
  await panel.getByRole('button', { name: 'Retry', exact: true }).waitFor()
  await dismiss.click()
  await send.waitFor()
  assert.equal(await panel.getByRole('alert').count(), 0)
  assert.equal(await choice.innerText(), defaultChoice)
  assert.equal(await other.inputValue(), '')
  assert.equal(retryableAttempts.get(262), 1, 'dismissing the draft does not send a reply')
  const refreshedPending = page.waitForResponse(response => response.url().endsWith('/server-requests/pending'))
  emit('app-server/reconnected', {})
  await refreshedPending
  await heading.waitFor()
  assert.equal(await other.inputValue(), '')
  await panel.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
  const dismissedScreenshot = join(output, `question-draft-dismissed-${viewport.width}-${theme}.png`)
  await page.waitForTimeout(2200)
  await page.screenshot({ path: dismissedScreenshot })
  await send.click()
  await list.locator('[data-message-id="question-response-answer-262"]').waitFor()
  assert.deepEqual(replies().filter(reply => reply.id === 262).map(reply => reply.result.answers.scope.answers), [
    ['Full review', draft], [defaultChoice],
  ])

  const retryQuestion = questionRequest(269, 'question-turn')
  retryQuestion.params.questions[0].isSecret = true
  emit('server/request', retryQuestion)
  await heading.waitFor()
  await choice.click()
  await panel.getByRole('button', { name: 'Full review', exact: true }).click()
  await other.fill(draft)
  await send.click()
  const retry = panel.getByRole('button', { name: 'Retry', exact: true })
  await retry.waitFor()
  await panel.getByRole('alert').filter({ hasText: 'Question reply was not sent' }).waitFor()
  assert.equal(await choice.innerText(), 'Full review')
  assert.equal(await other.inputValue(), draft)
  assert.equal(await other.getAttribute('type'), 'password')
  assert.equal(retryableAttempts.get(269), 1)
  const releaseRetry = delayReply(269)
  const retrySubmitted = waitForReply(269)
  await clickTwice(retry)
  await retrySubmitted
  await assertQuestionHidden()
  releaseRetry()
  const retriedAnswer = list.locator('[data-message-id="question-response-answer-269"]')
  await retriedAnswer.getByText('Answer hidden', { exact: true }).waitFor()
  await assertQuestionHidden()
  assert.deepEqual(replies().filter(reply => reply.id === 269).map(reply => reply.result.answers.scope.answers), [
    ['Full review', draft], ['Full review', draft],
  ])

  pendingOnReload = null
  const runningTurnId = 'running-after-question'
  emit('turn/started', { threadId: thread.id, turn: { id: runningTurnId, status: 'inProgress', items: [] } })
  const closedQuestion = questionRequest(263, runningTurnId)
  closedQuestion.params.questions[0].isSecret = true
  emit('server/request', closedQuestion)
  await heading.waitFor()
  const stop = page.getByRole('button', { name: 'Stop', exact: true })
  const pendingChip = page.locator('.thread-row[data-active="true"] .thread-row-request-chip[data-state="response"]')
  if (viewport.width === 1280) await pendingChip.waitFor()
  assert.equal(await stop.isVisible(), false)
  await other.fill(draft)
  const interruptedSubmitted = waitForReply(263)
  await send.click()
  await interruptedSubmitted
  await assertQuestionHidden()
  assert.equal(await stop.isVisible(), false)
  emit('server/request/resolved', { id: 263, threadId: thread.id })
  await input.waitFor()
  await stop.waitFor()
  await pendingChip.waitFor({ state: 'hidden' })
  await assertQuestionHidden()
  assert.equal(await stop.isEnabled(), true)
  assert.equal(await list.locator('[data-message-id="question-response-answer-263"]').count(), 0)
  if (await jumpLatest.isVisible()) await jumpLatest.click()
  const stopScreenshot = resolve(output, `question-submitted-stop-${viewport.width}-${theme}.png`)
  await page.waitForTimeout(2200)
  await page.screenshot({ path: stopScreenshot })
  await stop.click()
  await unconfirmed.waitFor()
  assert.deepEqual(calls.filter(call => call.method === 'turn/interrupt').map(call => call.params), [
    { threadId: thread.id, turnId: runningTurnId },
  ])
  assert.equal(replies().filter(reply => reply.id === 263).length, 1)
  assert.equal(await other.inputValue(), draft)
  assert.equal(await other.getAttribute('readonly'), '')
  assert.equal(await choice.isDisabled(), true)
  assert.equal(await retry.count(), 0)
  const nextTurn = page.waitForRequest(request => new URL(request.url()).pathname === '/codex-api/rpc' &&
    request.postDataJSON()?.method === 'turn/start')
  await input.fill('Continue after the interrupted turn')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  const nextPrompt = (await nextTurn).postDataJSON()
  assert.equal(nextPrompt.params.threadId, thread.id)
  assert.deepEqual(nextPrompt.params.input, [{ type: 'text', text: 'Continue after the interrupted turn' }])
  assert.equal(replies().filter(reply => reply.id === 263).length, 1)
  await dismiss.click()
  await panel.waitFor({ state: 'hidden' })
  await input.waitFor()
  const followUp = {
    id: 'follow-up', status: 'completed', items: [
      { id: 'follow-up-user', type: 'userMessage', content: [{ type: 'text', text: 'Continue after the interrupted turn' }] },
      { id: 'follow-up-agent', type: 'agentMessage', text: 'Follow-up complete' },
    ],
  }
  turns.push(followUp)
  emit('turn/completed', { threadId: thread.id, turn: followUp })
  await stop.waitFor({ state: 'hidden' })
  await list.locator('[data-message-id="follow-up-agent"]').waitFor()

  // Neither closure path retains a draft after its fields return to their defaults.
  for (const [id, reconnect] of [[264, false], [265, true]]) {
    emit('server/request', questionRequest(id, 'follow-up'))
    await heading.waitFor()
    await other.fill(draft)
    await other.fill(' ')
    await choice.click()
    await panel.getByRole('button', { name: 'Full review', exact: true }).click()
    await choice.click()
    await panel.getByRole('button', { name: 'Quick update', exact: true }).click()
    if (reconnect) {
      const refreshed = page.waitForResponse(response => response.url().endsWith('/server-requests/pending'))
      emit('app-server/reconnected', {})
      await refreshed
    } else {
      emit('server/request/resolved', { id, threadId: thread.id })
    }
    await panel.waitFor({ state: 'hidden' })
  }

  const unsentQuestion = questionRequest(266, 'follow-up')
  emit('server/request', unsentQuestion)
  await heading.waitFor()
  await other.fill(draft)
  await heading.click()
  emit('server/request/resolved', { id: unsentQuestion.id, threadId: thread.id })
  await heading.filter({ hasText: 'Unsent draft' }).and(page.locator('[aria-expanded="false"]')).waitFor()
  const requestsBeforeDismiss = requests.length
  await dismiss.click()
  await assertQuestionHidden()
  assert.deepEqual(requests.slice(requestsBeforeDismiss), [], 'dismissing an unsent draft must not make API requests')

  for (const [id, success] of [[267, true], [268, false]]) {
    const finishReply = delayReply(id)
    const request = questionRequest(id, 'follow-up')
    request.params.questions[0].isSecret = true
    emit('server/request', request)
    await heading.waitFor()
    await other.fill(draft)
    const submitted = waitForReply(id)
    await send.click()
    await submitted
    await assertQuestionHidden()
    emit('server/request/resolved', { id, threadId: thread.id })
    await input.waitFor()
    await assertQuestionHidden()
    // The browser only receives the delayed confirmation through the original HTTP reply.
    finishReply(success ? { json: { ok: true, saved: true, response: {
      id: 'answer-' + id, threadId: thread.id, turnId: 'follow-up', submittedAt: '2026-11-20T01:05:00.000Z',
      questions: [{ id: 'scope', heading: 'Documentation scope', provided: true }],
    } } } : { status: 502, json: { error: 'Question reply was not sent.', code: 'question_reply_not_sent' } })
    const answer = list.locator('[data-message-id="question-response-answer-' + id + '"]')
    if (success) {
      await answer.getByText('Answer hidden', { exact: true }).waitFor()
      assert.equal(await answer.count(), 1)
      assert.equal(await answer.getByText(draft, { exact: false }).count(), 0)
      await assertQuestionHidden()
    } else {
      await panel.getByRole('alert').filter({ hasText: 'Question reply was not sent' }).waitFor()
      assert.equal(await heading.innerText(), 'Unsent draft')
      assert.equal(await other.inputValue(), draft)
      assert.equal(await other.getAttribute('readonly'), '')
      assert.equal(await retry.count(), 0)
      assert.equal(await answer.count(), 0)
      await dismiss.click()
      await assertQuestionHidden()
    }
    assert.equal(replies().filter(reply => reply.id === id).length, 1)
  }

  assert.deepEqual(errors, [])
  return { url, viewport, theme, stopScreenshot, failedScreenshot, dismissedScreenshot, answerScreenshot, jumpActions, expanded, minimized, historyRestored, keyboardHistoryRestored, historyActions, colors, readingPosition: positionBefore, toggleApiRequests: 0, jumpApiRequests: 0, extraHistoryJumpRequests: 0, dismissApiRequests: 0 }
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
