// Build first. APPROVED_DIST_ROOT=. intercepts assets from this checkout as well as protocol calls.
const { chromium } = require('playwright')
const { setup, thread, assert, openToolsDialog, openComposerEntry, enableQueueMode } = require('./approved-fixture.cjs')
const { goalObjective, assertGoalSettingsLayout, openGoalStatusMenu, captureGoalSettings } = require('./goal-settings-fixture.cjs')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const base = 'http://127.0.0.1:4173'
const longDraft = 'Full-screen writing fixture\n' + 'Keep this draft and all composer settings.\n'.repeat(20)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOcQAAAAASUVORK5CYII=', 'base64')
async function withinViewport(locator, viewport) {
  const box = await locator.boundingBox()
  assert(box, 'element is visible')
  assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, JSON.stringify(box))
  assert(await locator.evaluate(el => {
    const r = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  }), 'element is not covered')
  return box
}

async function assertGoalRow(page, viewport, label) {
  const goal = page.getByRole('button', { name:label, exact:true })
  await goal.waitFor()
  const row = page.locator('.thread-composer .thread-composer-active-mode')
  const plan = row.getByRole('button', { name:'Plan ×', exact:true })
  const queue = row.getByRole('button', { name:'Queue ×', exact:true })
  assert.equal(await row.getByRole('button', { name:label, exact:true }).count(), 1)
  assert.equal(await page.locator('.thread-goal-summary').count(), 1)
  assert.equal(await goal.innerText(), label)
  assert.equal(await goal.getAttribute('title'), null)
  assert.equal(await goal.getAttribute('aria-haspopup'), 'dialog')
  const [planBox, queueBox, goalBox] = await Promise.all([plan, queue, goal].map(chip => withinViewport(chip, viewport)))
  assert.equal(planBox.y, queueBox.y)
  assert.equal(queueBox.y, goalBox.y)
  assert(planBox.x + planBox.width <= queueBox.x && queueBox.x + queueBox.width <= goalBox.x, 'the chips have separate targets')
  assert(goalBox.y + goalBox.height <= (await page.locator('.thread-composer-input').boundingBox()).y, 'Goal is above the input')
  return goal
}

async function assertEditorClearance(input, controls, viewport) {
  const textRight = await input.evaluate(el => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight))
  for (const control of controls) {
    const box = await withinViewport(control, viewport)
    assert(box.x >= textRight, 'editor control clears the text area')
  }
}

async function assertNativeLineBreak(input, calls) {
  await input.fill('firstsecond')
  await input.evaluate(el => el.setSelectionRange(5, 5))
  const before = calls.length
  await input.press('Enter')
  assert.equal(await input.inputValue(), 'first\nsecond')
  assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd]), [6, 6])
  assert.equal(calls.length, before, 'inserting a line break adds no API calls')
}

const submissionMethods = ['thread/start', 'turn/start', 'turn/steer', 'thread/queue/add']
const rejection = { status:400, json:{ error:'Fixture rejected the message' } }
const acceptedTurn = { json:{ result:{ turn:{ id:'accepted-turn', status:'inProgress', items:[] } } } }

async function beginExpandedSubmission(page, calls, hold, { text, label, shortcut, method = 'turn/start', createsThread = false }) {
  const input = page.locator('.thread-composer-input')
  await input.fill(text)
  await page.getByRole('button', { name:'Expand composer', exact:true }).click()
  const submit = page.getByRole('button', { name:label, exact:true })
  await page.waitForFunction(label => {
    const button = document.querySelector('.thread-composer-submit')
    return button?.getAttribute('aria-label') === label && !button.disabled
  }, label)
  const before = calls.length
  const release = hold()
  const request = page.waitForRequest(request => request.method() === 'POST'
    && request.url().endsWith('/codex-api/rpc') && request.postDataJSON().method === method)
  if (shortcut) await input.press(shortcut)
  else await submit.click()
  const { params } = (await request).postDataJSON()
  await page.locator('.content-root:not(.is-composer-expanded)').waitFor()
  assert.equal(await input.inputValue(), text, 'draft is intact while the response is held')
  assert.equal(await page.locator('.thread-composer-submit').isDisabled(), true)
  const assertSingleSubmission = () => assert.deepEqual(
    calls.slice(before).map(call => call.method).filter(method => submissionMethods.includes(method)),
    createsThread ? ['thread/start', method] : [method],
  )
  assertSingleSubmission()
  return { params, release, assertSingleSubmission }
}

async function waitForSubmitEnabled(page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('.thread-composer-submit')
    return button && !button.disabled
  })
}

async function setVisualViewport(page, bounds) {
  await page.evaluate(bounds => {
    if (bounds) {
      Object.defineProperties(window.visualViewport, {
        height: { configurable:true, value:bounds.height },
        offsetTop: { configurable:true, value:bounds.offsetTop },
      })
    } else {
      delete window.visualViewport.height
      delete window.visualViewport.offsetTop
    }
    window.visualViewport.dispatchEvent(new Event('resize'))
  }, bounds)
}

async function scrollToGoalActions(body) {
  assert(await body.evaluate(el => {
    el.scrollTop = el.scrollHeight
    const actions = el.querySelector('.thread-goal-actions').getBoundingClientRect()
    const remaining = el.getBoundingClientRect().bottom - actions.bottom
    return Math.abs(remaining - parseFloat(getComputedStyle(el).paddingBottom)) < 1
  }), 'the action row retains the body padding at the end of the scroll')
}

;(async () => {
  mkdirSync('output/playwright', { recursive:true })
  const browser = await chromium.launch({ headless:true, channel:process.env.PLAYWRIGHT_CHANNEL })
  const results = []
  let activePage
  try {
    for (const viewport of [{ width:1280, height:900 }, { width:375, height:812 }, { width:768, height:1024 }]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport })
        activePage = page
        const apiRequests = []
        page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/codex-api/')) apiRequests.push(request.url()) })
        let uploadPath = '/remote/uploads/fullscreen.txt'
        let pendingSubmission
        let createdThreadCount = 0
        let releaseAcceptedHistory
        const acceptedHistory = new Promise(resolve => { releaseAcceptedHistory = resolve })
        const holdSubmission = () => {
          let release
          pendingSubmission = new Promise(resolve => { release = resolve })
          return response => { pendingSubmission = undefined; release(response) }
        }
        await page.route('**/codex-local-image?*', route => route.fulfill({ contentType:'image/png', body:png }))
        let savedGoal = { threadId:thread.id, objective:goalObjective, status:'active', tokensUsed:1200, tokenBudget:5000, timeUsedSeconds:12 }
        let rejectGoalSave = false
        const { calls, errors, emit } = await setup(page, async (body, _page, url) => {
          if (url.pathname.endsWith('/upload-file')) return { json:{ path:uploadPath } }
          if (url.pathname.endsWith('/server-requests/respond')) return { json:{ ok:true } }
          if (body.method === 'model/list') return { json:{ result:{ data:['fixture-model', 'fixture-alternative'].map(model => ({ id:model, model, supportedReasoningEfforts:['low','high'], defaultReasoningEffort:'low' })), nextCursor:null } } }
          if (body.method === 'skills/list') return { json:{ result:{ data:[{ cwd:'/remote/project', skills:[{ name:'fullscreen-skill', description:'Full-screen skill', path:'/remote/skills/fullscreen-skill/SKILL.md', enabled:true }], errors:[] }] } } }
          if (body.method === 'thread/goal/get' && body.params.threadId === thread.id) {
            return { json:{ result:{ goal:savedGoal } } }
          }
          if (body.method === 'thread/goal/set') {
            if (rejectGoalSave) return { status:400, json:{ error:'Fixture rejected the Goal save' } }
            savedGoal = { ...savedGoal, ...body.params }
            return { json:{ result:{ goal:savedGoal } } }
          }
          if (body.method === 'thread/start') {
            const created = { ...thread, id:`fullscreen-new-${++createdThreadCount}`, name:'New fullscreen fixture', projectId:body.params.projectId }
            return { json:{ result:{ thread:created, model:'fixture-model', modelProvider:'fixture' } } }
          }
          if (['thread/read', 'thread/resume'].includes(body.method) && body.params.threadId?.startsWith('fullscreen-new-')) {
            if (body.params.threadId === 'fullscreen-new-2' && body.params.includeTurns) await acceptedHistory
            return { json:{ result:{ thread:{ ...thread, id:body.params.threadId, name:'New fullscreen fixture', turns:[] }, model:'fixture-model', modelProvider:'fixture' } } }
          }
          if (body.method === 'thread/queue/list') return { json:{ result:{ data:[], nextCursor:null } } }
          if (['turn/start', 'turn/steer', 'thread/queue/add'].includes(body.method)) {
            assert(pendingSubmission, 'unexpected extra submission')
            return pendingSubmission
          }
        }, false)
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
        const input = page.locator('.thread-composer-input')
        const expand = page.getByRole('button', { name:'Expand composer', exact:true })
        const exit = page.getByRole('button', { name:'Exit full screen composer', exact:true })
        const minimize = page.getByRole('button', { name:'Minimize message input', exact:true })
        const restore = page.getByRole('button', { name:'Show message input', exact:true })
        assert.equal(await input.inputValue(), '')
        await assertEditorClearance(input, [minimize, expand], viewport)
        await expand.click()
        await assertEditorClearance(input, [exit], viewport)
        await assertNativeLineBreak(input, calls)
        await exit.click()
        await minimize.click()
        assert.equal(await expand.isVisible(), false)
        await restore.click()
        await input.fill('Short draft fixture')
        await assertEditorClearance(input, [minimize, expand], viewport)
        await input.fill(longDraft)
        await assertEditorClearance(input, [minimize, expand], viewport)
        await enableQueueMode(page)
        const attachMenu = page.getByRole('button', { name:'Add attachments and settings', exact:true })
        await attachMenu.click()
        await page.getByRole('switch', { name:'Enable plan mode', exact:true }).click()
        await attachMenu.click()
        const activeGoal = await assertGoalRow(page, viewport, 'Goal: active')
        const goalSettings = page.getByRole('dialog', { name:'Goal settings', exact:true })
        const objective = goalSettings.getByRole('textbox', { name:'Goal objective', exact:true })
        const beforeInlineSettings = apiRequests.length
        await activeGoal.press('Enter')
        await goalSettings.waitFor()
        assert.equal(await objective.inputValue(), goalObjective)
        assert.equal(await objective.evaluate(el => el === document.activeElement), true)
        await assertGoalSettingsLayout(goalSettings, theme, 'active')
        await (await openGoalStatusMenu(goalSettings)).getByRole('button', { name:'usage limited', exact:true }).click()
        await assertGoalSettingsLayout(goalSettings, theme, 'usage limited')
        const inlineSettingsScreenshot = await captureGoalSettings(page, 'inline', viewport, theme)
        await goalSettings.getByRole('button', { name:'Cancel', exact:true }).click()
        await goalSettings.waitFor({ state:'hidden' })
        assert.equal(await activeGoal.evaluate(el => el === document.activeElement), true)
        assert.equal(apiRequests.length, beforeInlineSettings, 'inline Goal settings adds no API calls')
        const inlineGoalScreenshot = resolve(`output/playwright/composer-goal-inline-${viewport.width}-${theme}.png`)
        await page.waitForTimeout(2200)
        await page.screenshot({ path:inlineGoalScreenshot })
        await input.evaluate(el => { window.fullscreenInput = el; el.setSelectionRange(12, 19) })
        const sidebarVisible = await page.locator('.desktop-sidebar').isVisible()
        const beforeExpand = calls.length
        await expand.click()
        assert.equal(await page.locator('.content-root').evaluate(el => el.classList.contains('is-composer-expanded')), true)
        assert.equal(calls.length, beforeExpand, 'expansion adds no API calls')
        assert.equal(await input.evaluate(el => el === window.fullscreenInput && el === document.activeElement), true)
        assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd]), [12, 19])
        for (const selector of ['.content-header', '.desktop-sidebar', '.desktop-resize-handle', '.content-thread', '.new-thread-empty', '.mobile-drawer-backdrop']) {
          for (const element of await page.locator(selector).all()) assert.equal(await element.isVisible(), false, selector)
        }
        const composerBox = await withinViewport(page.locator('.thread-composer'), viewport)
        assert.equal(composerBox.x, 0)
        assert.equal(composerBox.y, 0)
        assert.equal(composerBox.width, viewport.width)
        assert.equal(composerBox.height, viewport.height)
        assert((await input.boundingBox()).height > viewport.height * 0.6)
        await withinViewport(exit, viewport)
        await assertGoalRow(page, viewport, 'Goal: active')
        for (const [status, label] of [
          ['paused', 'paused'], ['blocked', 'blocked'], ['usageLimited', 'usage limited'],
          ['budgetLimited', 'budget limited'], ['active', 'active'], ['complete', 'completed'],
        ]) {
          savedGoal = { ...savedGoal, status }
          emit('thread/goal/updated', { threadId:thread.id, goal:savedGoal })
          await assertGoalRow(page, viewport, `Goal: ${label}`)
        }
        const completedGoal = page.getByRole('button', { name:'Goal: completed', exact:true })
        const fullscreenGoalScreenshot = resolve(`output/playwright/composer-goal-fullscreen-${viewport.width}-${theme}.png`)
        await page.waitForTimeout(2200)
        await page.screenshot({ path:fullscreenGoalScreenshot })
        const beforeFullscreenSettings = apiRequests.length
        await completedGoal.click()
        await goalSettings.waitFor()
        await withinViewport(objective, viewport)
        assert.equal(await objective.inputValue(), goalObjective)
        assert.equal(await objective.evaluate(el => el === document.activeElement), true)
        await objective.press('Control+Home')
        const start = await objective.evaluate(el => el.scrollTop)
        await objective.press('Control+End')
        assert(await objective.evaluate((el, start) => el.scrollTop > start && el.selectionEnd === el.value.length, start), 'the last line of the objective is reachable')
        const goalStatus = goalSettings.locator('.composer-dropdown-trigger')
        await openGoalStatusMenu(goalSettings)
        await goalStatus.press('Escape')
        await goalSettings.getByRole('listbox').waitFor({ state:'hidden' })
        await goalStatus.press('Escape')
        await goalSettings.waitFor({ state:'hidden' })
        assert.equal(await completedGoal.evaluate(el => el === document.activeElement), true)
        assert.equal(await page.locator('.content-root.is-composer-expanded').count(), 1)
        assert.equal(await input.inputValue(), longDraft)
        assert.equal(apiRequests.length, beforeFullscreenSettings, 'full-screen Goal settings adds no API calls')
        assert.equal(calls.length, beforeExpand, 'Goal notifications and opening or closing settings add no API calls')
        await completedGoal.click()
        await objective.press('Control+End')
        await page.keyboard.insertText('\nEdited from the chip.')
        const editedObjective = `${goalObjective}\nEdited from the chip.`
        assert.equal(await objective.inputValue(), editedObjective)
        await (await openGoalStatusMenu(goalSettings)).getByRole('button', { name:'active', exact:true }).click()
        await assertGoalSettingsLayout(goalSettings, theme, 'active')
        const fullscreenSettingsScreenshot = await captureGoalSettings(page, 'fullscreen', viewport, theme)
        await (await openGoalStatusMenu(goalSettings)).getByRole('button', { name:'usage limited', exact:true }).click()
        await assertGoalSettingsLayout(goalSettings, theme, 'usage limited')
        assert.equal(apiRequests.length, beforeFullscreenSettings, 'editing the objective and status makes no API requests before Save')
        const saveGoal = goalSettings.getByRole('button', { name:'Save goal', exact:true })
        await saveGoal.click()
        await goalSettings.waitFor({ state:'hidden' })
        assert.deepEqual(calls.slice(beforeExpand).filter(call => call.method === 'thread/goal/set').map(call => call.params), [
          { threadId:thread.id, objective:editedObjective, status:'usageLimited' },
        ])
        const limitedGoal = page.getByRole('button', { name:'Goal: usage limited', exact:true })
        assert.equal(await limitedGoal.evaluate(el => el === document.activeElement), true)
        const afterSave = apiRequests.length
        await limitedGoal.click()
        assert.equal(await objective.inputValue(), editedObjective)
        assert.equal(await goalStatus.innerText(), 'usage limited')
        await goalSettings.getByRole('button', { name:'Cancel', exact:true }).click()
        await goalSettings.waitFor({ state:'hidden' })
        assert.equal(apiRequests.length, afterSave, 'reopening the saved Goal adds no API calls')

        let keyboardSettingsScreenshot
        if (viewport.width === 375) {
          await limitedGoal.click()
          await page.setViewportSize({ width:375, height:250 })
          const body = goalSettings.locator('.management-dialog-body')
          assert(await body.evaluate(el => el.scrollHeight > el.clientHeight), 'the body scrolls on a short screen')
          assert.equal(await objective.evaluate(el => el.offsetHeight), 96, 'the objective retains its minimum height')
          const shortMenu = await openGoalStatusMenu(goalSettings)
          assert(await shortMenu.evaluate(el => el.scrollHeight > el.clientHeight), 'the upward status menu scrolls when space is limited')
          await shortMenu.getByRole('button', { name:'active', exact:true }).click()
          rejectGoalSave = true
          await saveGoal.click()
          const error = goalSettings.getByRole('alert')
          await error.waitFor()
          assert.match(await error.innerText(), /Fixture rejected the Goal save/)
          await error.scrollIntoViewIfNeeded()
          await withinViewport(error, { width:375, height:250 })
          await withinViewport(goalSettings.locator('small'), { width:375, height:250 })
          assert(await body.evaluate(el => el.scrollTop > 0), 'scrolling exposes usage, error and actions')
          const cancel = goalSettings.getByRole('button', { name:'Cancel', exact:true })
          await scrollToGoalActions(body)
          for (const button of [goalSettings.getByRole('button', { name:'Clear goal', exact:true }), cancel, saveGoal]) {
            await withinViewport(button, { width:375, height:250 })
          }
          await cancel.click()
          await goalSettings.waitFor({ state:'hidden' })
          assert.equal(await limitedGoal.evaluate(el => el === document.activeElement), true)
          await page.setViewportSize(viewport)

          const beforeKeyboard = apiRequests.length
          await limitedGoal.click()
          const keyboardViewport = { width:375, height:250, offsetTop:40 }
          await setVisualViewport(page, keyboardViewport)
          await page.locator('.content-root.is-virtual-keyboard-open').waitFor()
          const dialogBox = await goalSettings.boundingBox()
          const visibleBottom = keyboardViewport.offsetTop + keyboardViewport.height
          assert(dialogBox.y >= keyboardViewport.offsetTop && dialogBox.y + dialogBox.height <= visibleBottom)
          assert(await body.evaluate(el => el.scrollHeight > el.clientHeight), 'the Goal body scrolls above the keyboard')
          const keyboardMenu = await openGoalStatusMenu(goalSettings, keyboardViewport.offsetTop)
          await setVisualViewport(page, { height:235, offsetTop:55 })
          await page.waitForFunction(() => {
            const dialog = document.querySelector('.thread-goal-dialog')
            const popup = dialog.querySelector('.composer-dropdown-menu').getBoundingClientRect()
            const trigger = dialog.querySelector('.composer-dropdown-trigger').getBoundingClientRect()
            return popup.top >= window.visualViewport.offsetTop && popup.bottom <= trigger.top - 7
          })
          await keyboardMenu.getByRole('button', { name:'budget limited', exact:true }).click()
          await scrollToGoalActions(body)
          for (const button of [goalSettings.getByRole('button', { name:'Clear goal', exact:true }), cancel, saveGoal]) {
            await withinViewport(button, { width:375, height:visibleBottom })
          }
          assert.equal(await objective.inputValue(), editedObjective)
          keyboardSettingsScreenshot = await captureGoalSettings(page, 'keyboard', viewport, theme)
          await cancel.click()
          await goalSettings.waitFor({ state:'hidden' })
          assert.equal(await limitedGoal.evaluate(el => el === document.activeElement), true)
          assert.equal(apiRequests.length, beforeKeyboard, 'the keyboard viewport and Goal settings add no API calls')
          await setVisualViewport(page, null)
        }
        await page.getByRole('button', { name:'Plan ×', exact:true }).click()
        await page.getByRole('button', { name:'Queue ×', exact:true }).click()
        await withinViewport(page.getByRole('button', { name:'Send message', exact:true }), viewport)
        await page.locator('.thread-composer-hidden-input').setInputFiles([
          { name:'fullscreen.png', mimeType:'image/png', buffer:png },
          { name:'fullscreen.txt', mimeType:'text/plain', buffer:Buffer.from('preserved attachment') },
        ])
        await page.getByRole('button', { name:'Remove fullscreen.txt', exact:true }).waitFor()
        await page.getByRole('button', { name:'Remove fullscreen.png', exact:true }).waitFor()
        // Exercise actual model/reasoning dropdowns in the expanded composer.
        await page.locator('.composer-dropdown-trigger').filter({ hasText:'fixture-model' }).click()
        await withinViewport(page.locator('.composer-dropdown-menu'), viewport)
        await page.getByRole('button', { name:'fixture-alternative', exact:true }).click()
        await page.locator('.composer-dropdown-trigger').filter({ hasText:'Low' }).click()
        await page.getByRole('button', { name:'High', exact:true }).click()
        await page.getByRole('button', { name:'Add attachments and settings', exact:true }).click()
        await withinViewport(page.locator('.thread-composer-attach-menu'), viewport)
        await page.getByRole('switch', { name:'Skills', exact:true }).click()
        await page.locator('.search-dropdown-trigger').click()
        await withinViewport(page.locator('.search-dropdown-menu-wrap'), viewport)
        await page.locator('.search-dropdown-option-main').filter({ hasText:'fullscreen-skill' }).click()
        await input.click()
        await page.getByRole('button', { name:'Open fullscreen-skill SKILL.md', exact:true }).waitFor()
        await openComposerEntry(page, 'Apps / Connectors')
        await withinViewport(page.locator('.composer-apps-popover'), viewport)
        await page.getByRole('button', { name:'Close Apps', exact:true }).click()
        await input.fill(longDraft + '/fullscreen')
        await withinViewport(page.locator('.thread-composer-skill-mentions'), viewport)
        await page.keyboard.press('Escape')
        await input.fill(longDraft)
        // Drag/drop handlers remain attached to the same writing surface.
        uploadPath = '/remote/uploads/dropped.txt'
        await page.locator('.thread-composer-input-wrap').dispatchEvent('drop', {
          dataTransfer:await page.evaluateHandle(() => {
            const data = new DataTransfer()
            data.items.add(new File(['drop'], 'dropped.txt', { type:'text/plain' }))
            return data
          }),
        })
        await page.getByRole('button', { name:'Remove dropped.txt', exact:true }).waitFor()
        await input.evaluate(el => el.setSelectionRange(12, 19))
        const snapshot = await input.inputValue()
        const screenshot = resolve(`output/playwright/composer-fullscreen-${viewport.width}-${theme}.png`)
        await page.waitForTimeout(2200)
        await page.screenshot({ path:screenshot })
        const background = await page.locator('.thread-composer').evaluate(el => getComputedStyle(el).backgroundColor)
        assert.equal(background, theme === 'dark' ? 'oklch(0.141 0.005 285.823)' : 'rgb(255, 255, 255)')
        if (viewport.width === 375) {
          // Simulate the VisualViewport contract used by mobile keyboard handling.
          await setVisualViewport(page, { height:450, offsetTop:40 })
          await page.locator('.content-root.is-virtual-keyboard-open').waitFor()
          const keyboardBox = await withinViewport(page.locator('.thread-composer'), { width:375, height:490 })
          assert.equal(keyboardBox.y, 40)
          assert.equal(keyboardBox.height, 450)
          await withinViewport(exit, { width:375, height:490 })
          await withinViewport(page.getByRole('button', { name:'Send message', exact:true }), { width:375, height:490 })
          await setVisualViewport(page, null)
          await page.waitForFunction(() => !document.querySelector('.content-root.is-virtual-keyboard-open'))
        }
        const beforeExit = calls.length
        await exit.click()
        await withinViewport(limitedGoal, viewport)
        assert.equal(await input.inputValue(), snapshot)
        assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd]), [12, 19])
        assert.equal(await input.evaluate(el => el === window.fullscreenInput), true)
        assert.equal(await page.locator('.content-thread').isVisible(), true)
        assert.equal(await page.locator('.desktop-sidebar').isVisible(), sidebarVisible)
        assert.equal(await page.locator('.composer-dropdown-trigger').filter({ hasText:'fixture-alternative' }).count(), 1)
        assert.equal(await page.locator('.composer-dropdown-trigger').filter({ hasText:'High' }).count(), 1)
        assert.equal(await page.getByRole('button', { name:'Remove fullscreen.png', exact:true }).isVisible(), true)
        assert.equal(await page.getByRole('button', { name:'Remove fullscreen.txt', exact:true }).isVisible(), true)
        assert.equal(await page.getByRole('button', { name:'Open fullscreen-skill SKILL.md', exact:true }).isVisible(), true)
        assert.equal(calls.length, beforeExit, 'exit adds no API calls')
        const beforeCycles = calls.length
        const cycles = []
        for (let i = 0; i < 3; i++) {
          const start = Date.now()
          await expand.focus()
          await page.keyboard.press('Enter')
          await exit.focus()
          await page.keyboard.press('Space')
          cycles.push(Date.now() - start)
        }
        assert.equal(calls.length, beforeCycles, 'layout cycles add no API requests')
        // A pending request exits expanded mode to make the approval reachable.
        await expand.click()
        emit('server/request', { id:99, method:'item/commandExecution/requestApproval', params:{ threadId:'approved-fixture', turnId:'live', command:'echo fullscreen' } })
        const pending = page.locator('.thread-pending-request')
        await pending.waitFor()
        assert.equal(await exit.count(), 0)
        assert.equal(await page.locator('.content-root.is-composer-expanded').count(), 0)
        await pending.getByRole('button', { name:'Send', exact:true }).click()
        await input.waitFor()
        assert.equal(await input.inputValue(), snapshot)
        // Both cleaned dialog headers retain focus/close behavior and content.
        await openToolsDialog(page)
        for (const title of ['Conversation tools', 'Context']) {
          if (title === 'Context') {
            await page.locator('.conversation-header-menu > summary').click()
            await page.getByRole('button', { name:'Context', exact:true }).click()
          }
          const dialog = page.getByRole('dialog', { name:title, exact:true })
          await dialog.waitFor()
          const dialogHeader = dialog.locator('.management-dialog-header')
          assert.equal(await dialogHeader.locator('h2').innerText(), title)
          assert.equal(await dialogHeader.locator('p').count(), 0)
          assert(!/Approved fixture|approved-fixture/.test(await dialogHeader.innerText()))
          assert(await dialog.evaluate(el => el.contains(document.activeElement)))
          const path = resolve(`output/playwright/composer-fullscreen-dialog-${title === 'Context' ? 'context' : 'tools'}-${viewport.width}-${theme}.png`)
          await page.waitForTimeout(2200)
          await page.screenshot({ path })
          if (title === 'Context') await dialog.getByRole('button', { name:'Close dialog', exact:true }).click()
          else await page.keyboard.press('Escape')
          await dialog.waitFor({ state:'hidden' })
          await page.locator('.conversation-header-menu > summary:focus').waitFor()
        }
        assert.equal(await input.inputValue(), snapshot)
        // Stop stays reachable in full-screen mode when the active turn has no draft.
        await expand.click()
        for (const name of ['Remove fullscreen.png', 'Remove fullscreen.txt', 'Remove dropped.txt']) {
          await page.getByRole('button', { name, exact:true }).click()
        }
        await input.fill('')
        emit('turn/started', { threadId:'approved-fixture', turn:{ id:'live', status:'inProgress', items:[] } })
        const stop = page.getByRole('button', { name:'Stop', exact:true })
        await stop.waitFor()
        await withinViewport(stop, viewport)
        assert.equal(await stop.isEnabled(), true)
        assert.equal(calls.filter(c => c.method === 'turn/interrupt').length, 0)
        await stop.click()
        assert.equal(calls.filter(c => c.method === 'turn/interrupt').length, 1)
        await input.fill(longDraft)
        await exit.click()

        // A rejected send keeps the original text and both attachment types, even after reload.
        await page.locator('.thread-composer-hidden-input').setInputFiles([
          { name:'rejected.png', mimeType:'image/png', buffer:png },
          { name:'rejected.txt', mimeType:'text/plain', buffer:Buffer.from('retained file') },
        ])
        await page.getByRole('button', { name:'Remove rejected.png', exact:true }).waitFor()
        await page.getByRole('button', { name:'Remove dropped.txt', exact:true }).waitFor()
        const failed = await beginExpandedSubmission(page, calls, holdSubmission, {
          text:'Fullscreen conversation draft', label:'Send message',
        })
        await page.locator('.content-thread').waitFor()
        const submitScreenshot = resolve(`output/playwright/composer-fullscreen-send-pending-${viewport.width}-${theme}.png`)
        await page.waitForTimeout(2200)
        await page.screenshot({ path:submitScreenshot })
        failed.release(rejection)
        await waitForSubmitEnabled(page)
        failed.assertSingleSubmission()
        assert.equal(await input.inputValue(), 'Fullscreen conversation draft')
        assert.equal(await page.getByRole('button', { name:'Remove rejected.png', exact:true }).isVisible(), true)
        await page.reload()
        await page.getByText('Fixture answer', { exact:true }).waitFor()
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
        assert.equal(await input.inputValue(), 'Fullscreen conversation draft')
        for (const name of ['Remove Image 1', 'Remove dropped.txt']) {
          await page.getByRole('button', { name, exact:true }).click()
        }

        emit('turn/started', { threadId:'approved-fixture', turn:{ id:'steering', status:'inProgress', items:[] } })
        await page.getByRole('button', { name:'Steer', exact:true }).waitFor()
        const steer = await beginExpandedSubmission(page, calls, holdSubmission, {
          text:'Fullscreen steering draft', label:'Steer', shortcut:'Control+Enter',
        })
        steer.release(rejection)
        await waitForSubmitEnabled(page)
        steer.assertSingleSubmission()
        assert.equal(await input.inputValue(), 'Fullscreen steering draft')

        await enableQueueMode(page)
        const queued = await beginExpandedSubmission(page, calls, holdSubmission, {
          text:'Fullscreen queue draft', label:'Queue prompt', method:'thread/queue/add', shortcut:'Meta+Enter',
        })
        await expand.click()
        await input.press('Meta+Enter')
        queued.release({ json:{ result:{ queuedSubmission:{ id:'queued', ...queued.params } } } })
        await page.waitForFunction(() => document.querySelector('.thread-composer-input')?.value === '')
        queued.assertSingleSubmission()
        assert.equal(await exit.isVisible(), true)
        await exit.click()

        // Route replacement/unmount must release the layout; Home also expands.
        await expand.click()
        await page.evaluate(() => { window.location.hash = '#/' })
        await page.locator('.new-thread-empty').waitFor()
        assert.equal(await page.locator('.content-root.is-composer-expanded').count(), 0)
        await page.locator('.new-thread-folder-dropdown .composer-dropdown-trigger').click()
        await page.locator('.composer-dropdown-option').filter({ hasText:'Fixture project' }).click()
        assert.equal(await input.inputValue(), '')
        await assertEditorClearance(input, [minimize, expand], viewport)
        await expand.click()
        assert.equal(await page.locator('.new-thread-empty').isVisible(), false)
        await assertEditorClearance(input, [exit], viewport)
        assert.equal((await page.locator('.thread-composer').boundingBox()).height, viewport.height)
        await assertNativeLineBreak(input, calls)
        await exit.click()
        assert.equal(await page.locator('.new-thread-empty').isVisible(), true)
        assert.equal(await input.inputValue(), 'first\nsecond')

        const failedHome = await beginExpandedSubmission(page, calls, holdSubmission, {
          text:'Fullscreen first message', label:'Send message', shortcut:'Control+Enter', createsThread:true,
        })
        await page.locator('.new-thread-empty').waitFor()
        failedHome.release(rejection)
        await waitForSubmitEnabled(page)
        failedHome.assertSingleSubmission()
        assert.equal(await input.inputValue(), 'Fullscreen first message')
        assert.equal(await page.locator('.new-thread-empty').isVisible(), true)
        const acceptedHome = await beginExpandedSubmission(page, calls, holdSubmission, {
          text:'Fullscreen first message', label:'Send message', createsThread:true,
        })
        acceptedHome.release(acceptedTurn)
        await page.waitForURL('**/#/thread/fullscreen-new-2')
        await expand.waitFor()
        acceptedHome.assertSingleSubmission()
        const acceptedHistoryCalls = calls.filter(call => call.method === 'thread/read' && call.params.threadId === 'fullscreen-new-2' && call.params.includeTurns)
        assert.equal(acceptedHistoryCalls.length, 1, 'navigation reuses the held history request')
        releaseAcceptedHistory()
        await page.evaluate(() => { window.location.hash = '#/' })
        await page.locator('.new-thread-empty').waitFor()
        assert.equal(await input.inputValue(), '')

        await page.locator('.new-thread-folder-dropdown .composer-dropdown-trigger').click()
        await page.locator('.composer-dropdown-option').filter({ hasText:'Fixture project' }).click()
        const homeHash = await page.evaluate(() => window.location.hash)
        const detachedHome = await beginExpandedSubmission(page, calls, holdSubmission, {
          text:'Fullscreen draft before navigation', label:'Send message', createsThread:true,
        })
        await page.evaluate(() => { window.location.hash = '#/thread/approved-fixture' })
        await page.getByText('Fixture answer', { exact:true }).waitFor()
        await page.evaluate(hash => { window.location.hash = hash }, homeHash)
        await page.locator('.new-thread-empty').waitFor()
        assert.equal(await input.inputValue(), 'Fullscreen draft before navigation')
        await expand.click()
        await input.fill('Edited after returning to Home')
        assert.equal(await page.getByRole('button', { name:'Send message', exact:true }).isDisabled(), true)
        await input.press('Control+Enter')
        assert.equal(await exit.isVisible(), true)
        detachedHome.assertSingleSubmission()
        detachedHome.release(acceptedTurn)
        await waitForSubmitEnabled(page)
        assert.equal(await page.evaluate(() => window.location.hash), homeHash)
        assert.equal(await input.inputValue(), 'Edited after returning to Home')
        assert.equal(await exit.isVisible(), true)
        detachedHome.assertSingleSubmission()

        assert.deepEqual(errors, [])
        results.push({ url:`${base}/#/thread/approved-fixture`, viewport, theme, screenshot, inlineGoalScreenshot, fullscreenGoalScreenshot, inlineSettingsScreenshot, fullscreenSettingsScreenshot, keyboardSettingsScreenshot, submitScreenshot, composerBox, background, zeroApiToggleCycles:3, apiRequestsFromGoalViewsAndUpdates:0, toggleRoundTripMs:cycles, submissions:6, heldHomeHistoryRequests:acceptedHistoryCalls.length })
        console.log('PASS', viewport.width, theme, 'Goal labels, row, objective and focus; full screen, native Enter, attachments, held sends, draft recovery, steering, queue, Home, zero-request cycles')
        await page.close()
      }
    }
    writeFileSync('output/playwright/composer-fullscreen-results.json', JSON.stringify(results, null, 2))
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path:'output/playwright/composer-fullscreen-failure.png' })
      writeFileSync('output/playwright/composer-fullscreen-failure.txt', await activePage.locator('body').innerText())
    }
    throw error
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
