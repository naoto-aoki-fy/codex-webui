// Build first. APPROVED_DIST_ROOT=. intercepts assets from this checkout as well as protocol calls.
const { chromium } = require('playwright')
const { setup, thread, assert, openToolsDialog, openComposerEntry, enableQueueMode } = require('./approved-fixture.cjs')
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

;(async () => {
  mkdirSync('output/playwright', { recursive:true })
  const browser = await chromium.launch({ headless:true })
  const results = []
  let activePage
  try {
    for (const viewport of [{ width:1280, height:900 }, { width:375, height:812 }, { width:768, height:1024 }]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport })
        activePage = page
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
        const { calls, errors, emit } = await setup(page, async (body, _page, url) => {
          if (url.pathname.endsWith('/upload-file')) return { json:{ path:uploadPath } }
          if (url.pathname.endsWith('/server-requests/respond')) return { json:{ ok:true } }
          if (body.method === 'model/list') return { json:{ result:{ data:['fixture-model', 'fixture-alternative'].map(model => ({ id:model, model, supportedReasoningEfforts:['low','high'], defaultReasoningEffort:'low' })), nextCursor:null } } }
          if (body.method === 'skills/list') return { json:{ result:{ data:[{ cwd:'/remote/project', skills:[{ name:'fullscreen-skill', description:'Full-screen skill', path:'/remote/skills/fullscreen-skill/SKILL.md', enabled:true }], errors:[] }] } } }
          if (body.method === 'thread/goal/get' && body.params.threadId === thread.id) {
            return { json:{ result:{ goal:{ threadId:thread.id, objective:'Keep Goal available while writing', status:'active' } } } }
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
        await withinViewport(page.getByRole('button', { name:'Send message', exact:true }), viewport)
        const goal = page.locator('.thread-composer-active-mode .thread-goal-summary')
        await withinViewport(goal, viewport)
        await goal.click()
        const goalSettings = page.getByRole('dialog', { name:'Goal settings', exact:true })
        await goalSettings.waitFor()
        assert.equal(await goalSettings.getByRole('textbox', { name:'Goal objective' }).inputValue(), 'Keep Goal available while writing')
        const goalStatus = goalSettings.locator('.composer-dropdown-trigger')
        await goalStatus.click()
        await goalSettings.getByRole('listbox').waitFor()
        await goalStatus.press('Escape')
        await goalSettings.getByRole('listbox').waitFor({ state:'hidden' })
        await goalStatus.press('Escape')
        await goalSettings.waitFor({ state:'hidden' })
        assert.equal(await goal.evaluate(el => el === document.activeElement), true)
        assert.equal(await page.locator('.content-root.is-composer-expanded').count(), 1)
        assert.equal(await input.inputValue(), longDraft)
        assert.equal(calls.length, beforeExpand, 'opening and closing Goal adds no API calls')
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
          await page.evaluate(() => {
            Object.defineProperty(window.visualViewport, 'height', { configurable:true, value:450 })
            Object.defineProperty(window.visualViewport, 'offsetTop', { configurable:true, value:40 })
            window.visualViewport.dispatchEvent(new Event('resize'))
          })
          await page.locator('.content-root.is-virtual-keyboard-open').waitFor()
          const keyboardBox = await withinViewport(page.locator('.thread-composer'), { width:375, height:490 })
          assert.equal(keyboardBox.y, 40)
          assert.equal(keyboardBox.height, 450)
          await withinViewport(exit, { width:375, height:490 })
          await withinViewport(page.getByRole('button', { name:'Send message', exact:true }), { width:375, height:490 })
          await page.evaluate(() => {
            delete window.visualViewport.height
            delete window.visualViewport.offsetTop
            window.visualViewport.dispatchEvent(new Event('resize'))
          })
          await page.waitForFunction(() => !document.querySelector('.content-root.is-virtual-keyboard-open'))
        }
        const beforeExit = calls.length
        await exit.click()
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
        results.push({ url:`${base}/#/thread/approved-fixture`, viewport, theme, screenshot, submitScreenshot, composerBox, background, zeroApiToggleCycles:3, toggleRoundTripMs:cycles, submissions:6, heldHomeHistoryRequests:acceptedHistoryCalls.length })
        console.log('PASS', viewport.width, theme, 'full screen, native Enter, attachments, held sends, draft recovery, steering, queue, Home, zero-request cycles')
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
