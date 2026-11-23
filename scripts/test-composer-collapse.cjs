// Requires the current checkout on 127.0.0.1:4173; all protocol traffic is stubbed.
const { chromium } = require('playwright')
const { setup, assert } = require('./approved-fixture.cjs')
const { mkdirSync, writeFileSync } = require('node:fs')
const base = 'http://127.0.0.1:4173'
const longDraft = 'Unsent composer collapse check\n' + 'Keep this editable draft and its attachments.\n'.repeat(25)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOcQAAAAASUVORK5CYII=', 'base64')
;(async () => {
  mkdirSync('output/playwright', { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const results = []
  let activePage
  try {
    for (const viewport of [{ width:1280, height:900 }, { width:375, height:812 }, { width:768, height:1024 }]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport })
        activePage = page
        let turnActive = false
        const requests = []
        page.on('request', r => { if (r.url().includes('/codex-api/')) requests.push(r.url()) })
        await page.route('**/codex-local-image?*', route => route.fulfill({ contentType:'image/png', body:png }))
        const { calls, errors, emit } = await setup(page, (body, _page, url) => {
          if (url.pathname.endsWith('/upload-file')) return { json:{ path:'/remote/uploads/collapse.txt' } }
          if (url.pathname.endsWith('/server-requests/respond')) {
            if (body.id !== 100) return { json:{ ok:true } }
            return { json:{ ok:true, saved:true, response:{
              id:'collapse-question-answer', threadId:'approved-fixture', turnId:'live',
              submittedAt:'2026-11-20T01:05:00.000Z',
              questions:[{ id:'q', heading:'Which option?', answers:body.result.answers.q.answers }],
            } } }
          }
          if (body.method === 'thread/goal/get') return { json:{ result:{ goal:{ threadId:'approved-fixture', objective:'Keep goal actions accessible', status:'active' } } } }
          if (body.method === 'turn/interrupt') turnActive = false
          if (body.method === 'thread/resume' || body.method === 'thread/read') return { json:{ result:{
            thread:{ id:'approved-fixture', name:'Composer collapse fixture', cwd:'/remote/project', status:{ type:turnActive ? 'active' : 'idle' }, turns:[{ id:'t', status:'completed', items:[
              ...Array.from({ length:40 }, (_, i) => ({ type:i % 2 ? 'agentMessage' : 'userMessage', id:`history-${i}`, ...(i % 2 ? { text:`Reading position ${i}. ${'Conversation history with enough space to scroll. '.repeat(5)}` } : { content:[{ type:'text', text:`History question ${i}` }] }) })),
              { type:'agentMessage', id:'a', text:'Fixture answer' },
            ] }, ...(turnActive ? [{ id:'live', status:'inProgress', items:[] }] : [])] }, model:'fixture-model', modelProvider:'fixture',
          } } }
        }, false)
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
        const input = page.locator('.thread-composer-input')
        const collapse = page.getByRole('button', { name:'Minimize message input', exact:true })
        const restore = page.getByRole('button', { name:'Show message input', exact:true })
        const list = page.locator('.conversation-list')
        await collapse.waitFor()
        await page.locator('.thread-goal-summary').waitFor()
        assert.equal(await collapse.innerText(), '', 'minimize is an icon with no visible label')
        assert.equal(await collapse.getAttribute('title'), 'Minimize message input')
        assert.equal(await restore.count(), 0, 'inline is the default view')
        const restoreBox = async () => restore.evaluate(el => {
          const r = el.getBoundingClientRect()
          return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }
        })
        const assertFloating = async () => {
          assert.equal(await page.locator('.thread-composer-collapsed-bar').count(), 0)
          assert.equal(await page.locator('.thread-composer-floating-actions').evaluate(el => el.parentElement === document.body && getComputedStyle(el).position === 'fixed'), true)
          assert.equal(await restore.innerText(), '', 'restore is an icon with no visible label')
          assert.equal(await restore.getAttribute('title'), 'Show message input')
          const box = await restoreBox()
          assert.equal(box.width, 40)
          assert.equal(box.height, 40)
          assert.equal(viewport.width - box.right, 16)
          assert.equal(viewport.height - box.bottom, 16)
          assert.equal(await restore.evaluate(el => {
            const r = el.getBoundingClientRect()
            return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
          }), true, 'restore is not covered by other controls')
          const goalBox = await page.locator('.thread-goal-summary').boundingBox()
          const actionsBox = await page.locator('.thread-composer-floating-actions').boundingBox()
          assert.ok(goalBox.x + goalBox.width <= actionsBox.x - 8, 'goal controls clear the floating buttons')
          return box
        }
        const normalHeight = await list.evaluate(el => el.clientHeight)
        const readPosition = await list.evaluate(el => { el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2); return el.scrollTop })
        await page.waitForTimeout(200)
        const beforeToggle = requests.length
        await collapse.focus()
        await page.keyboard.press('Enter')
        await restore.waitFor()
        assert.equal(await restore.getAttribute('aria-expanded'), 'false')
        assert.equal(await restore.evaluate(el => el === document.activeElement), true)
        const floatingBox = await assertFloating()
        const goal = page.locator('.thread-goal-summary')
        await goal.press('Enter')
        const goalSettings = page.getByRole('dialog', { name:'Goal settings', exact:true })
        await goalSettings.waitFor()
        assert.equal(await goalSettings.getByRole('textbox', { name:'Goal objective' }).inputValue(), 'Keep goal actions accessible')
        await goalSettings.getByRole('button', { name:'Close dialog', exact:true }).click()
        await goalSettings.waitFor({ state:'hidden' })
        assert.equal(await goal.evaluate(el => el === document.activeElement), true)
        assert.equal(await page.locator('.thread-composer').evaluate(el => el.getBoundingClientRect().height), 0, 'no compact bar or reserved height')
        assert.equal(await input.isVisible(), false)
        assert.equal(await page.getByRole('button', { name:'Send message', exact:true }).isVisible(), false)
        const compactHeight = await list.evaluate(el => el.clientHeight)
        assert.ok(compactHeight - normalHeight >= 40, `${normalHeight} -> ${compactHeight}`)
        assert.ok(Math.abs(await list.evaluate(el => el.scrollTop) - readPosition) <= 2, 'reading position on collapse')
        await list.evaluate(el => { el.scrollTop += 100 })
        assert.deepEqual(await restoreBox(), floatingBox, 'restore stays at the viewport edge while history scrolls')
        await list.evaluate((el, position) => { el.scrollTop = position }, readPosition)
        // A transformed ancestor must not become the fixed-position containing block.
        await page.locator('.content-root').evaluate(el => { el.style.transform = 'translateY(25px)' })
        assert.deepEqual(await restoreBox(), floatingBox, 'restore is independent of transformed chat layout')
        await page.locator('.content-root').evaluate(el => { el.style.transform = '' })
        await restore.press('Space')
        await input.waitFor()
        assert.equal(await input.evaluate(el => el === document.activeElement), true)
        assert.equal(await input.inputValue(), '')
        assert.ok(Math.abs(await list.evaluate(el => el.scrollTop) - readPosition) <= 2, 'reading position on restore')
        assert.equal(requests.length, beforeToggle, 'empty collapse/restore must not issue API requests')
        await input.fill(longDraft)
        await page.locator('.thread-composer-hidden-input').setInputFiles([
          { name:'collapse.png', mimeType:'image/png', buffer:png },
          { name:'collapse.txt', mimeType:'text/plain', buffer:Buffer.from('preserved attachment') },
        ])
        await page.getByRole('button', { name:'Remove collapse.png', exact:true }).waitFor()
        await page.getByRole('button', { name:'Remove collapse.txt', exact:true }).waitFor()
        const stored = () => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.includes('thread-draft'))))
        await input.evaluate(el => el.setSelectionRange(12, 19))
        const draftSnapshot = await stored()
        const maximize = page.getByRole('button', { name:'Expand composer', exact:true })
        const minusRect = await collapse.boundingBox()
        const maxRect = await maximize.boundingBox()
        assert.equal(minusRect.y, maxRect.y, 'minimize and maximize align')
        assert.equal(minusRect.width, maxRect.width)
        assert.equal(minusRect.height, maxRect.height)
        assert.equal(maxRect.x - minusRect.x - minusRect.width, 4, 'minus is immediately left of maximize')
        assert.equal(await collapse.evaluate(el => getComputedStyle(el).backgroundColor), await maximize.evaluate(el => getComputedStyle(el).backgroundColor))
        await maximize.click()
        assert.equal(await collapse.count(), 0)
        const fullscreen = await page.locator('.thread-composer').boundingBox()
        assert.ok(fullscreen.height >= viewport.height - 2)
        await page.getByRole('button', { name:'Exit full screen composer', exact:true }).click()
        await collapse.click()
        assert.deepEqual(await stored(), draftSnapshot)
        await restore.click()
        assert.equal(await input.inputValue(), longDraft)
        assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd]), [12, 19])
        assert.equal(await page.getByRole('button', { name:'Remove collapse.png', exact:true }).isVisible(), true)
        assert.equal(await page.getByRole('button', { name:'Remove collapse.txt', exact:true }).isVisible(), true)
        const networkBeforeCycles = requests.length
        const toggleMs = []
        for (let i = 0; i < 5; i++) {
          const start = Date.now()
          await collapse.click()
          await restore.click()
          toggleMs.push(Date.now() - start)
        }
        assert.equal(requests.length, networkBeforeCycles, 'toggles must not issue API requests')
        turnActive = true
        emit('turn/started', { threadId:'approved-fixture', turn:{ id:'live', status:'inProgress', items:[] } })
        await page.getByRole('button', { name:'Steer', exact:true }).waitFor()
        await collapse.click()
        await page.getByRole('button', { name:'Stop', exact:true }).waitFor()
        assert.equal(await page.getByRole('button', { name:'Stop', exact:true }).isEnabled(), true)
        emit('item/agentMessage/delta', { threadId:'approved-fixture', turnId:'live', itemId:'stream', delta:'Streaming while the composer is collapsed.' })
        await page.getByText('Streaming while the composer is collapsed.', { exact:false }).first().waitFor()
        assert.equal(calls.filter(c => c.method === 'turn/interrupt' || c.method === 'turn/start').length, 0)
        assert.deepEqual(await stored(), draftSnapshot)
        await page.waitForTimeout(2200)
        const screenshot = `output/playwright/composer-collapsed-${viewport.width}-${theme}.png`
        await page.screenshot({ path:screenshot })
        await assertFloating()
        const stopBox = await page.getByRole('button', { name:'Stop', exact:true }).boundingBox()
        const showBox = await restoreBox()
        assert.ok(stopBox.x + stopBox.width + 8 <= showBox.x, 'Stop and restore have separate touch targets')
        const jump = page.getByRole('button', { name:'Jump to latest output', exact:true })
        if (await jump.isVisible()) {
          const jumpBox = await jump.boundingBox()
          assert.ok(jumpBox.x + jumpBox.width < stopBox.x || jumpBox.y + jumpBox.height < stopBox.y, 'floating controls do not cover jump to latest')
        }
        const colors = await restore.evaluate(el => {
          const r = el.getBoundingClientRect()
          return { background:getComputedStyle(el).backgroundColor, left:r.left, right:r.right, height:r.height }
        })
        assert.ok(colors.left >= 0 && colors.right <= viewport.width)
        assert.ok(colors.height <= 55)
        assert.ok((theme === 'dark' ? ['rgb(39, 39, 42)', 'oklch(0.274 0.006 286.033)'] : ['rgb(255, 255, 255)']).includes(colors.background), colors.background)
        // Pending requests must hide the teleported controls without destroying the draft owner.
        emit('server/request', { id:99, method:'item/commandExecution/requestApproval', params:{ threadId:'approved-fixture', turnId:'live', command:'echo approved' } })
        const panel = page.locator('.thread-pending-request')
        await panel.waitFor()
        assert.equal(await restore.isVisible(), false)
        await panel.getByRole('button', { name:'Send', exact:true }).click()
        await restore.waitFor()
        assert.equal(calls.filter(c => c.path.endsWith('/server-requests/respond')).length, 1)
        emit('server/request', { id:100, method:'item/tool/requestUserInput', params:{ threadId:'approved-fixture', turnId:'live', questions:[{ id:'q', header:'Choose', question:'Which option?', isOther:true, options:[{ label:'Continue', description:'Keep going' }] }] } })
        await panel.waitFor()
        await panel.getByPlaceholder('Other answer').fill('A usable free-text answer')
        await panel.getByRole('button', { name:'Send', exact:true }).click()
        await restore.waitFor()
        assert.equal(calls.filter(c => c.path.endsWith('/server-requests/respond')).length, 2)
        assert.deepEqual(await stored(), draftSnapshot)
        await restore.click()
        assert.equal(await input.inputValue(), longDraft)
        assert.equal(await page.locator('.thread-composer-controls').evaluate(el => el.scrollWidth <= el.clientWidth), true)
        await page.waitForTimeout(2200)
        await page.screenshot({ path:`output/playwright/composer-restored-${viewport.width}-${theme}.png` })
        // Only an explicit Stop click may interrupt the active response.
        await collapse.click()
        await page.getByRole('button', { name:'Stop', exact:true }).click()
        await page.waitForFunction(() => !document.querySelector('.thread-composer-floating-actions .thread-composer-stop'))
        await assertFloating()
        assert.equal(await page.locator('.thread-composer-floating-actions button').count(), 1, 'idle minimized view has only the restore icon')
        await page.waitForTimeout(2200)
        const idleScreenshot = `output/playwright/composer-minimized-${viewport.width}-${theme}.png`
        await page.screenshot({ path:idleScreenshot })
        assert.equal(calls.filter(c => c.method === 'turn/interrupt').length, 1)
        assert.deepEqual(errors, [])
        results.push({ url:`${base}/#/thread/approved-fixture`, viewport, theme, freedPixels:compactHeight-normalHeight, readingPosition:readPosition, zeroApiToggleCycles:5, toggleRoundTripMs:toggleMs, colors, screenshot, idleScreenshot, apiRequestsDuringEmptyToggle:0 })
        console.log('PASS', viewport.width, theme, 'empty/long draft, attachments, focus, reading position, fullscreen, streaming, Stop, approval and user input')
        await page.close()
      }
    }
    writeFileSync('output/playwright/composer-collapse-results.json', JSON.stringify(results, null, 2))
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path:'output/playwright/composer-collapse-failure.png' })
      writeFileSync('output/playwright/composer-collapse-failure.txt', await activePage.locator('body').innerText())
    }
    throw error
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
