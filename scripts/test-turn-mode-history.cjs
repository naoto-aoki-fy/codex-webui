const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { chromium } = require('playwright')
const { setup, thread, assert } = require('./approved-fixture.cjs')

const url = 'http://127.0.0.1:4173/#/thread/' + thread.id
const prompt = 'Use the same prompt for both turns.'
const output = resolve('output/playwright')
const userItem = id => ({ type: 'userMessage', id, content: [{ type: 'text', text: prompt }] })
const defaultTurn = {
  id: 'default-native', status: 'completed',
  items: [{ ...userItem('default-prompt'), startedAtMs: 1795136100000 },
    { type: 'agentMessage', id: 'first-reply', text: 'Fixture answer', completedAtMs: 1795136104000 }],
  generationMetadata: { model: 'fixture-model', modelSource: 'execution', effort: 'none', effortSource: 'execution' },
}
const planTurn = { id: 'plan-native', status: 'inProgress', items: [userItem('plan-prompt')] }
const response = {
  id: 'saved-answer', threadId: thread.id, turnId: planTurn.id, anchorItemId: 'plan-prompt', submittedAt: '2026-11-20T01:05:00.000Z',
  questions: [
    { id: 'scope', heading: 'Scope', answers: ['Full review', 'Keep the examples'] },
    { id: 'private', heading: 'Private answer', provided: true },
  ],
}

async function verify(page, theme, viewport) {
  let accepted = false
  let reload = false
  let retryAttempts = 0
  let release
  let emit
  const held = new Promise(resolve => { release = resolve })
  const fixture = await setup(page, async (body, _page, requestUrl) => {
    if (requestUrl.pathname.endsWith('/server-requests/respond')) {
      if (body.id === 302) return { status: 502, json: { error: 'Question reply could not be confirmed. Your draft is kept.' } }
      if (body.id === 303) return { json: { ok: true, response: { ...response, id: 'unsaved-answer' }, saved: false } }
      if (body.id === 304) {
        if (++retryAttempts === 1) return { status: 502, json: {
          error: 'Question reply was not sent. Your draft is kept. You can retry.', code: 'question_reply_not_sent',
        } }
        return { json: { ok: true, response: { ...response, id: 'retried-answer' }, saved: true } }
      }
    }
    if (body.method === 'turn/start') {
      await held
      accepted = true
      return { json: { result: { turn: { id: planTurn.id } } } }
    }
    if (body.method === 'thread/read' || body.method === 'thread/resume') {
      if (reload) setTimeout(() => emit('turn/generationMetadata', { threadId: thread.id, turnId: planTurn.id,
        generationMetadata: { collaborationMode: 'plan', collaborationModeSource: 'submitted' },
      }), 300)
      const turns = accepted ? [defaultTurn, planTurn] : [defaultTurn]
      return { json: { result: {
        thread: { ...thread, turns, status: { type: accepted ? 'active' : 'idle' } },
        model: 'fixture-model', modelProvider: 'fixture', ...(reload ? { questionResponses: [response] } : {}),
      } } }
    }
  }, false)
  emit = fixture.emit
  assert.equal(page.url(), url)
  const badge = page.locator('.message-plan-badge')
  const attach = page.getByRole('button', { name: 'Add attachments and settings' })
  await attach.click()
  await page.getByRole('switch', { name: 'Enable plan mode' }).click()
  await page.keyboard.press('Escape')
  await page.locator('.thread-composer-input').fill(prompt)
  await page.locator('.thread-composer-submit').click()
  await badge.waitFor()
  assert.match(await badge.locator('xpath=ancestor::li').getAttribute('data-message-id'), /^optimistic-user:/)
  assert.equal(await badge.innerText(), 'Plan')
  assert.equal(fixture.calls.filter(call => call.method === 'turn/start').length, 1)
  assert.equal(fixture.calls.find(call => call.method === 'turn/start').params.collaborationMode.mode, 'plan')

  release()
  const planRow = page.locator('[data-message-id="plan-prompt"]')
  await planRow.getByText('Plan', { exact: true }).waitFor()
  assert.equal(await badge.count(), 1)
  assert.equal(await page.locator('[data-message-id="default-prompt"] .message-plan-badge').count(), 0)

  reload = true
  await page.reload()
  await planRow.getByText('Plan', { exact: true }).waitFor()
  const answer = page.locator('[data-message-id="question-response-saved-answer"]')
  await answer.getByText('Answer hidden', { exact: true }).waitFor()
  assert.equal(await answer.evaluate(row => row.previousElementSibling.dataset.messageId), 'plan-prompt')
  emit('server/request/resolved', { id: 200, threadId: thread.id, response })
  assert.equal(await answer.count(), 1)
  const colors = await badge.evaluate(el => ({
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    background: getComputedStyle(el).backgroundColor,
  }))
  assert.equal(colors.theme, theme)
  assert.notEqual(colors.background, 'rgba(0, 0, 0, 0)')
  assert.equal(await page.getByText('fixture-model · reasoning: none', { exact: true }).count(), 1)
  assert.equal(await page.locator('[data-message-id="first-reply"] time').getAttribute('datetime'), new Date(1795136104000).toISOString())
  const copy = answer.getByRole('button', { name: 'Copy answers' })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await copy.click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()),
    'Scope\nFull review\nKeep the examples\n\nPrivate answer\nAnswer hidden')
  await answer.scrollIntoViewIfNeeded()
  await page.waitForTimeout(2200)
  const path = resolve(output, `turn-mode-history-${viewport.width}-${theme}.png`)
  await page.screenshot({ path })
  const historyCalls = () => fixture.calls.filter(call => ['thread/resume', 'thread/read', 'thread/turns/list'].includes(call.method)).length
  await page.waitForTimeout(700)
  const before = historyCalls()
  emit('turn/generationMetadata', { threadId: thread.id, turnId: planTurn.id,
    generationMetadata: { collaborationMode: null, collaborationModeSource: 'execution' },
  })
  await badge.waitFor({ state: 'hidden' })
  assert.equal(historyCalls(), before)

  const pendingQuestion = id => emit('server/request', { id, method: 'item/tool/requestUserInput',
    params: { threadId: thread.id, turnId: planTurn.id, questions: [{ id: 'scope', header: 'Scope', isOther: true }] },
  })
  const pending = page.locator('.conversation-list .thread-pending-request')
  pendingQuestion(302)
  await pending.getByPlaceholder('Other answer').fill('Keep this draft')
  await pending.getByRole('button', { name: 'Send', exact: true }).click()
  await pending.getByRole('alert').getByText('Question reply could not be confirmed. Your draft is kept.').waitFor()
  assert.equal(await pending.getByPlaceholder('Other answer').inputValue(), 'Keep this draft')
  assert.equal(fixture.calls.filter(call => call.id === 302).length, 1)
  await pending.getByRole('button', { name: 'Dismiss draft' }).click()
  pendingQuestion(303)
  await pending.getByPlaceholder('Other answer').fill('Attempt that cannot be saved')
  await pending.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('alert').getByText('Answer submitted. WebUI could not save it to history.').waitFor()
  await page.locator('[data-message-id="question-response-unsaved-answer"]').getByText('Answer hidden').waitFor()
  pendingQuestion(304)
  await pending.getByPlaceholder('Other answer').fill('Manual retry draft')
  await pending.getByRole('button', { name: 'Send', exact: true }).click()
  const retry = pending.getByRole('button', { name: 'Retry', exact: true })
  await retry.waitFor()
  assert.equal(await pending.getByPlaceholder('Other answer').inputValue(), 'Manual retry draft')
  assert.equal(retryAttempts, 1)
  await retry.click()
  await page.locator('[data-message-id="question-response-retried-answer"]').waitFor()
  assert.deepEqual(fixture.calls.filter(call => call.id === 304).map(call => call.result), [
    { answers: { scope: { answers: ['Manual retry draft'] } } },
    { answers: { scope: { answers: ['Manual retry draft'] } } },
  ])
  if (viewport.width === 1280 && theme === 'light') {
    const second = await page.context().browser().newPage({ viewport })
    try {
      await setup(second, body => {
        if (body.method !== 'thread/read' && body.method !== 'thread/resume') return
        return { json: { result: { thread: { ...thread, turns: [defaultTurn, planTurn] },
          questionResponses: [response], model: 'fixture-model', modelProvider: 'fixture' } } }
      }, false)
      const restored = second.locator('[data-message-id="question-response-saved-answer"]')
      await restored.getByText('Answer hidden').waitFor()
      assert.equal(await restored.evaluate(row => row.previousElementSibling.dataset.messageId), 'plan-prompt')
      assert.equal(await restored.count(), 1)
    } finally { await second.close() }
  }
  assert.deepEqual(fixture.errors, [])
  console.log('PASS', theme, viewport.width + 'x' + viewport.height, url, path)
}

async function main() {
  mkdirSync(output, { recursive: true })
  const browser = await chromium.launch()
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport, colorScheme: theme, hasTouch: viewport.width <= 768, isMobile: viewport.width <= 768 })
        try { await verify(page, theme, viewport) }
        finally { await page.close() }
      }
    }
  } finally { await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
