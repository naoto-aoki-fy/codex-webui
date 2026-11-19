// Live-server browser acceptance. Run only through the gated maintenance live test.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
;(async () => {
  const fixturePath = process.argv[2]
  const f = JSON.parse(readFileSync(fixturePath, 'utf8'))
  const base = process.env.MAINTENANCE_BROWSER_BASE_URL || 'http://127.0.0.1:4173'
  const out = resolve('output/playwright'); mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
  const page = await context.newPage()
  const createdThreadIds = [], errors = [], calls = [], checks = {}
  const allowed = new Set(f.threadIds)
  page.on('pageerror', error => errors.push(error.message))
  // Responses remain native/live. Filter only list visibility so screenshots do
  // not contain unrelated user projects/conversations; mutations are never stubbed.
  await page.route('**/codex-api/rpc', async route => {
    const request = route.request().postDataJSON()
    calls.push({ method: request.method, threadId: request.params?.threadId })
    if (!['project/list', 'thread/list', 'thread/fork'].includes(request.method)) return route.continue()
    const response = await route.fetch(), payload = await response.json()
    if (request.method === 'project/list' && Array.isArray(payload.result?.data)) payload.result.data = payload.result.data.filter(project => f.projectIds.includes(project.id))
    if (request.method === 'thread/list' && Array.isArray(payload.result?.data)) payload.result.data = payload.result.data.filter(t => allowed.has(t.id))
    if (request.method === 'thread/fork' && payload.result?.thread?.id) {
      createdThreadIds.push(payload.result.thread.id); allowed.add(payload.result.thread.id)
    }
    await route.fulfill({ response, json: payload })
  })
  const go = id => page.goto(base + '/#/thread/' + id)
  const capture = async name => { await page.waitForTimeout(2200); const path = resolve(out, name); await page.screenshot({ path, fullPage: true }); return path }
  try {
    await go(f.sourceId)
    await page.locator('.message-generation-metadata').filter({ hasText: f.expectedModel }).first().waitFor({ timeout: 30000 })
    assert.equal(await page.locator(`[data-project-name="${f.emptyProjectId}"]`).count(), 1)
    assert.match(await page.locator(`[data-project-name="${f.emptyProjectId}"]`).innerText(), /Empty maintenance-/)
    assert.match(await page.locator(`[data-project-name="${f.sourceProjectId}"]`).innerText(), /Source maintenance-/)
    assert.deepEqual(await page.locator('.project-group').evaluateAll(rows => rows.map(r => r.dataset.projectName)), [f.emptyProjectId, f.sourceProjectId])
    checks.sourceModelFromRolloutCache = true; checks.nativeSidebarAndEmptyProject = true
    checks.lightScreenshot = await capture('maintenance-native-projects-light.png')
    await page.reload()
    await page.locator('.message-generation-metadata').filter({ hasText: f.expectedModel }).first().waitFor({ timeout: 30000 })
    checks.modelHistoryAfterRefresh = true
    await go(f.forkId)
    await page.locator('.message-generation-metadata').filter({ hasText: 'Model unknown' }).first().waitFor({ timeout: 30000 })
    assert.ok((await page.locator('.message-row[data-role="assistant"]').count()) > 0)
    checks.nativeForkUnknownMetadataContentVisible = true
    await go(f.portableId)
    await page.getByText(f.tag + '_1', { exact: true }).first().waitFor({ timeout: 30000 })
    await page.reload()
    await page.getByText(f.tag + '_1', { exact: true }).first().waitFor({ timeout: 30000 })
    checks.previouslyImportedContentAfterReload = true
    await go(f.sourceId)
    await page.getByRole('button', { name: 'Fork and Revert', exact: true }).nth(1).waitFor({ timeout: 30000 })
    checks.beforeClickCallCount = calls.length
    await page.getByRole('button', { name: 'Fork and Revert', exact: true }).nth(1).click()
    await page.waitForTimeout(1000)
    checks.uiAfterClick = await page.evaluate(() => { let c = document.querySelector('.message-row')?.__vueParentComponent; const rows = []; while(c) { rows.push({ name: c.type?.__name, selectedThreadId: c.setupState?.selectedThreadId, activeThreadId: c.props?.activeThreadId, error: c.setupState?.desktopError, isRollingBack: c.setupState?.isRollingBack }); c = c.parent } return rows })
    await page.waitForFunction(prompt => document.querySelector('.thread-composer-input')?.value === prompt, f.prompt, { timeout: 30000 })
    checks.forkAndRevertRestoredPrompt = true
    checks.draftScreenshot = await capture('maintenance-fork-revert-draft.png')
    await page.reload()
    await page.waitForFunction(prompt => document.querySelector('.thread-composer-input')?.value === prompt, f.prompt, { timeout: 30000 })
    checks.restoredPromptAfterRefresh = true
    const newId = page.url().split('/thread/')[1]?.split('?')[0]
    if (newId && newId !== f.sourceId && !createdThreadIds.includes(newId)) createdThreadIds.push(newId)
    // Select the actual empty native project by ID, then refresh its home route.
    await page.goto(base + '/#/?cwd=' + encodeURIComponent(f.emptyRoot || '/tmp') + '&projectId=' + encodeURIComponent(f.emptyProjectId))
    await page.locator('.new-thread-folder-dropdown').waitFor({ timeout: 30000 })
    await page.locator('.new-thread-folder-dropdown').filter({ hasText: 'Empty maintenance-' }).waitFor({ timeout: 30000 })
    await page.reload()
    await page.locator('.new-thread-folder-dropdown').filter({ hasText: 'Empty maintenance-' }).waitFor({ timeout: 30000 })
    assert.equal(new URLSearchParams(page.url().split('?')[1]).get('projectId'), f.emptyProjectId)
    checks.projectSelectionAfterRefresh = true
    await page.emulateMedia({ colorScheme: 'dark' })
    await go(f.sourceId)
    await page.locator('.message-generation-metadata').filter({ hasText: f.expectedModel }).first().waitFor({ timeout: 30000 })
    await page.evaluate(() => { document.documentElement.classList.add('dark') })
    checks.darkScreenshot = await capture('maintenance-native-projects-dark.png')
    assert.deepEqual(errors, [])
    console.log('PASS live browser: native sidebar, rollout metadata, imported content, fork/revert draft, persisted project ID; 1440x1000 light/dark')
  } catch (error) {
    checks.failureScreenshot = await capture('maintenance-failure.png')
    checks.bodyAtFailure = (await page.locator('body').innerText()).slice(-2500)
    checks.textareasAtFailure = await page.locator('textarea').evaluateAll(rows => rows.map(r => ({ value: r.value, visible: r.offsetParent !== null })))
    throw error
  } finally {
    writeFileSync(fixturePath + '.result.json', JSON.stringify({ ...checks, createdThreadIds, errors, calls, testedUrl: base, viewport: '1440x1000' }, null, 2))
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
