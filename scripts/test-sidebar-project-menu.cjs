// Run against the current worktree's Vite server on 4173. All writes target fixture data.
const { chromium } = require('playwright')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { setup, thread, assert } = require('./approved-fixture.cjs')

const baseUrl = 'http://127.0.0.1:4173'
const outputDir = resolve('output/playwright')
const folder = '/work/日本語 + # & % ?'
const emptyProject = { id: 'empty & test', name: 'Empty project', roots: [{ path: '/work/空 + #' }], position: 1, metadata: {} }
const pinned = { ...thread, id: 'pinned-fixture', name: 'Pinned fixture' }
const unassigned = { ...thread, id: 'folder-fixture', name: 'Folder fixture', cwd: folder, projectId: null }
const blank = { ...thread, id: 'blank-fixture', name: 'No folder fixture', cwd: '', projectId: null }
const stale = { ...thread, id: 'stale-fixture', name: 'Stale project fixture', projectId: 'stale-project' }
const disposable = { ...thread, id: 'disposable-fixture', name: 'Disposable thread' }

const rpc = result => ({ json: { result } })
const queryOf = url => {
  const hash = new URL(url, baseUrl).hash
  const index = hash.indexOf('?')
  return index === -1 ? {} : Object.fromEntries(new URLSearchParams(hash.slice(index + 1)))
}
const threadRow = (page, title, scope = page) => scope.locator('.thread-row').filter({ has: page.getByText(title, { exact: true }) })
const groupRow = group => group.locator('.project-header-row > a')
const pencil = group => group.locator('.thread-start-button')
const isMobile = viewport => viewport.width < 768

async function openSidebar(page, viewport) {
  if (isMobile(viewport) && !await page.locator('.mobile-drawer').isVisible()) {
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  }
}

async function organize(page, mode) {
  await page.getByRole('button', { name: 'Organize threads', exact: true }).click()
  await page.getByRole('button', { name: mode, exact: false }).click()
}

async function assertNativeContextMenu(link) {
  // Headless Chromium does not render browser chrome. Check that a real right click
  // reaches the browser with the link as its target and the default action intact.
  await link.evaluate(el => window.addEventListener('contextmenu', event => {
    el.dataset.contextResult = String(event.target.closest('a') === el && !event.defaultPrevented)
  }, { once: true }))
  await link.click({ button: 'right' })
  assert.equal(await link.getAttribute('data-context-result'), 'true')
}

async function assertCreation(page, query, projectName) {
  await page.locator('.new-thread-hero').waitFor()
  assert.deepEqual(queryOf(page.url()), query)
  const selection = page.locator('.new-thread-folder-selected')
  if (query.cwd) {
    await selection.waitFor()
    assert.equal(await selection.getAttribute('title'), query.cwd)
  } else {
    assert.equal(await selection.count(), 0)
  }
  if (projectName) await page.locator('.new-thread-folder-dropdown').getByText(projectName, { exact: true }).waitFor()
}

async function assertThread(page, data) {
  await page.waitForURL('**/#/thread/' + data.id)
  await page.locator('.content-title').getByText(data.name, { exact: true }).waitFor()
  await page.getByText('Fixture answer', { exact: true }).waitFor()
}

async function openTab(page, action, check) {
  const url = page.url()
  const historyLength = await page.evaluate(() => history.length)
  const [tab] = await Promise.all([page.context().waitForEvent('page', { timeout: 12000 }), action()])
  try {
    await check(tab)
    await tab.reload()
    await check(tab)
  } finally {
    await tab.close()
  }
  assert.equal(page.url(), url)
  assert.equal(await page.evaluate(() => history.length), historyLength)
}

async function checkClickedOnce(page, action, check) {
  const before = await page.evaluate(() => window.sidebarPushes)
  await action()
  await check()
  assert.equal(await page.evaluate(() => window.sidebarPushes), before + 1)
}

async function checkRowMargins(group) {
  const geometry = await group.evaluate(row => {
    const link = row.querySelector('.sidebar-menu-row-body')
    const title = link.querySelector('.thread-row-title, .project-title')
    const right = link.querySelector('.thread-row-time') || title
    const actions = row.querySelector('.sidebar-menu-row-actions')
    return {
      rowLeft: row.getBoundingClientRect().left,
      linkLeft: link.getBoundingClientRect().left,
      rowRight: row.getBoundingClientRect().right,
      linkRight: link.getBoundingClientRect().right,
      titleLeft: title.getBoundingClientRect().left,
      textRight: right.getBoundingClientRect().right,
      actionsLeft: actions.getBoundingClientRect().left,
      actionsRight: actions.getBoundingClientRect().right,
    }
  })
  assert.equal(geometry.rowLeft, geometry.linkLeft)
  assert.equal(geometry.rowRight, geometry.linkRight)
  assert.equal(geometry.titleLeft - geometry.linkLeft, 36)
  assert.equal(geometry.rowRight - geometry.actionsRight, 12)
  assert(geometry.textRight <= geometry.actionsLeft - 4, JSON.stringify(geometry))
}

async function run(browser, viewport, theme) {
  const mobile = isMobile(viewport)
  const context = await browser.newContext({ viewport, colorScheme: theme, hasTouch: mobile })
  context.setDefaultTimeout(8000)
  try {
    await context.addInitScript(() => {
      window.sidebarPushes = 0
      const pushState = history.pushState
      history.pushState = function (...args) {
        window.sidebarPushes += 1
        return pushState.apply(this, args)
      }
    })
    const errors = []
    context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)))
    const page = await context.newPage()
    const requests = []
    page.on('request', request => {
      if (request.url().includes('/codex-api/')) {
        requests.push({ url: new URL(request.url()).pathname, body: request.postDataJSON() })
      }
    })
    let threads = [thread, pinned, unassigned, blank, stale, disposable]
    let projects = [{ id: 'p', name: 'Fixture project', roots: [{ path: '/remote/project' }], position: 0, metadata: {} }, emptyProject]
    const { calls, items } = await setup(page, (body, _, url) => {
      if (url.pathname.endsWith('/thread-pins')) return { json: { data: { threadIds: [pinned.id] } } }
      if (body.method === 'thread/list') return rpc({ data: threads, nextCursor: null })
      if (body.method === 'project/list') return rpc({ data: projects, nextCursor: null })
      if (body.method === 'thread/archive') {
        threads = threads.filter(row => row.id !== body.params.threadId)
        return rpc({})
      }
      if (body.method === 'project/delete') {
        projects = projects.filter(project => project.id !== body.params.projectId)
        return rpc({})
      }
      if (['thread/read', 'thread/resume'].includes(body.method) && body.params.threadId !== thread.id) {
        const target = threads.find(row => row.id === body.params.threadId)
        if (target) return rpc({
          thread: { ...target, turns: [{ id: 't', status: 'completed', items }] },
          model: 'fixture-model', modelProvider: 'fixture',
        })
      }
    }, false, { network: context })

    await openSidebar(page, viewport)
    const empty = page.locator(`[data-project-name="${emptyProject.id}"]`)
    const pinnedLink = threadRow(page, pinned.name).locator('a')
    const mainLink = threadRow(page, thread.name).locator('a')
    const headerClass = mobile ? '.sidebar-thread-controls-header-host' : '.sidebar-thread-controls-host'
    const toolbar = page.locator(headerClass).getByRole('link', { name: 'Start new thread', exact: true })
    const emptyQuery = { projectId: emptyProject.id, cwd: emptyProject.roots[0].path }
    const threadQuery = { projectId: thread.projectId, cwd: thread.cwd }
    await groupRow(empty).waitFor()
    await pinnedLink.waitFor()
    await page.waitForLoadState('networkidle')
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), theme === 'dark')
    assert.equal(await pinnedLink.getAttribute('href'), '#/thread/' + pinned.id)
    assert.equal(await mainLink.getAttribute('href'), '#/thread/' + thread.id)
    assert.deepEqual(queryOf(await toolbar.getAttribute('href')), threadQuery)
    assert.deepEqual(queryOf(await groupRow(empty).getAttribute('href')), emptyQuery)
    assert.equal(await pencil(empty).getAttribute('href'), await groupRow(empty).getAttribute('href'))
    assert.deepEqual(queryOf(await groupRow(page.locator('[data-project-name="__codexapp_unassigned__"]')).getAttribute('href')), { cwd: folder })
    await checkRowMargins(empty.locator('.project-header-row'))
    await checkRowMargins(threadRow(page, pinned.name))

    const originalUrl = page.url()
    const renderStart = requests.length
    const originalExpansion = await groupRow(empty).getAttribute('aria-expanded')
    await groupRow(empty).click()
    assert.notEqual(await groupRow(empty).getAttribute('aria-expanded'), originalExpansion)
    await groupRow(empty).press('Space')
    assert.equal(await groupRow(empty).getAttribute('aria-expanded'), originalExpansion)
    assert.equal(await groupRow(empty).evaluate(el => getComputedStyle(el).outlineWidth), '2px')
    await groupRow(empty).press('Enter')
    assert.notEqual(await groupRow(empty).getAttribute('aria-expanded'), originalExpansion)
    assert.equal(page.url(), originalUrl)

    const emptyDots = empty.getByRole('button', { name: 'Project actions', exact: true })
    await emptyDots.press('Enter')
    await empty.getByRole('button', { name: 'Remove', exact: true }).waitFor()
    await emptyDots.press('Escape')
    assert.equal(await empty.locator('.project-menu-panel').count(), 0)
    const staleGroup = page.locator('[data-project-name="stale-project"]')
    await staleGroup.getByRole('button', { name: 'Project actions', exact: true }).click()
    assert.equal(await staleGroup.getByRole('button', { name: 'Remove', exact: true }).count(), 0)

    await organize(page, 'By Folder')
    const folderGroup = page.locator('[data-folder-path]').filter({ has: page.locator('.project-title').getByText(folder.split('/').at(-1), { exact: true }) })
    await groupRow(folderGroup).waitFor()
    assert.deepEqual(queryOf(await groupRow(folderGroup).getAttribute('href')), { cwd: folder })
    assert.equal(await pencil(folderGroup).getAttribute('href'), await groupRow(folderGroup).getAttribute('href'))
    const blankGroup = page.locator('[data-folder-path=""]')
    assert.equal(await groupRow(blankGroup).getAttribute('href'), '#/')
    const beforeFold = await groupRow(folderGroup).getAttribute('aria-expanded')
    await groupRow(folderGroup).click()
    assert.notEqual(await groupRow(folderGroup).getAttribute('aria-expanded'), beforeFold)
    await groupRow(folderGroup).press('Enter')
    assert.equal(await groupRow(folderGroup).getAttribute('aria-expanded'), beforeFold)
    assert.equal(page.url(), originalUrl)
    await checkRowMargins(folderGroup.locator('.project-header-row'))
    await page.waitForTimeout(150)
    const groupRequests = requests.length - renderStart
    assert.equal(groupRequests, 0, 'Redrawing and toggling loaded groups must not fetch data')

    if (!mobile && viewport.width > 768) {
      await assertNativeContextMenu(groupRow(folderGroup))
      await assertNativeContextMenu(pinnedLink)
      await assertNativeContextMenu(toolbar)
      assert.equal(await page.locator('.thread-menu-panel, .project-menu-panel').count(), 0)
      assert.equal(page.url(), originalUrl)
      await openTab(page, () => pinnedLink.click({ modifiers: ['ControlOrMeta'] }), tab => assertThread(tab, pinned))
      await openTab(page, () => threadRow(page, unassigned.name).locator('.thread-row-time').click({ button: 'middle' }), tab => assertThread(tab, unassigned))
      await openTab(page, () => groupRow(folderGroup).click({ button: 'middle' }), tab => assertCreation(tab, { cwd: folder }))
      await folderGroup.getByRole('button', { name: 'Folder actions', exact: true }).click()
      await openTab(page, () => folderGroup.getByRole('button', { name: 'Open in new tab', exact: true }).click(), tab => assertCreation(tab, { cwd: folder }))
      await openTab(page, () => toolbar.click({ modifiers: ['ControlOrMeta'] }), tab => assertCreation(tab, threadQuery, 'Fixture project'))
      await openTab(page, () => groupRow(blankGroup).click({ modifiers: ['ControlOrMeta'] }), tab => assertCreation(tab, {}))
    }

    const pinnedDots = threadRow(page, pinned.name).getByRole('button', { name: 'Thread actions' })
    await pinnedDots.press('Space')
    const threadMenu = page.locator('.thread-menu-panel')
    const openThreadInTab = threadMenu.getByRole('button', { name: 'Open in new tab', exact: true })
    await openThreadInTab.waitFor()
    assert.equal(await openThreadInTab.evaluate(el => el === document.activeElement), true)
    if (!mobile && viewport.width > 768) {
      await openTab(page, () => openThreadInTab.press('Enter'), tab => assertThread(tab, pinned))
      await pinnedDots.press('Enter')
      await openThreadInTab.waitFor()
    }
    await openThreadInTab.press('Escape')
    assert.equal(await pinnedDots.evaluate(el => el === document.activeElement), true)
    assert.equal(await threadMenu.count(), 0)

    await organize(page, 'Chronological list')
    const chronological = threadRow(page, unassigned.name, page.locator('.thread-list-global')).locator('a')
    await chronological.waitFor()
    assert.equal(await chronological.getAttribute('href'), '#/thread/' + unassigned.id)
    if (!mobile && viewport.width > 768) {
      await openTab(page, () => chronological.click({ button: 'middle' }), tab => assertThread(tab, unassigned))
    }
    await checkClickedOnce(page, () => chronological.press('Space'), () => assertThread(page, unassigned))
    if (mobile) await page.locator('.mobile-drawer').waitFor({ state: 'hidden' })
    assert.deepEqual(queryOf(await toolbar.getAttribute('href')), { cwd: folder })
    await checkClickedOnce(page, () => toolbar.press('Enter'), () => assertCreation(page, { cwd: folder }))
    if (mobile) await page.locator('.mobile-drawer').waitFor({ state: 'hidden' })
    await openSidebar(page, viewport)
    const sidebarToolbar = page.locator('.sidebar-thread-controls-host').getByRole('link', { name: 'Start new thread', exact: true })
    assert.deepEqual(queryOf(await sidebarToolbar.getAttribute('href')), { cwd: folder })
    const unchangedHistory = await page.evaluate(() => window.sidebarPushes)
    await sidebarToolbar.click()
    assert.equal(await page.evaluate(() => window.sidebarPushes), unchangedHistory)
    if (mobile) await page.locator('.mobile-drawer').waitFor({ state: 'hidden' })

    await openSidebar(page, viewport)
    await organize(page, 'By project')
    await groupRow(empty).waitFor()
    if (!mobile && viewport.width > 768) {
      await assertNativeContextMenu(groupRow(empty))
      await assertNativeContextMenu(pencil(empty))
      await openTab(page, () => groupRow(empty).click({ modifiers: ['ControlOrMeta'] }), tab => assertCreation(tab, emptyQuery, emptyProject.name))
      await openTab(page, () => pencil(empty).click({ button: 'middle' }), tab => assertCreation(tab, emptyQuery, emptyProject.name))
    }
    await checkClickedOnce(page, () => pencil(empty).click(), () => assertCreation(page, emptyQuery, emptyProject.name))
    if (mobile) await page.locator('.mobile-drawer').waitFor({ state: 'hidden' })
    await page.reload()
    await assertCreation(page, emptyQuery, emptyProject.name)
    await openSidebar(page, viewport)

    await organize(page, 'By Folder')
    await checkClickedOnce(page, () => pencil(folderGroup).press('Space'), () => assertCreation(page, { cwd: folder }))
    if (mobile) await page.locator('.mobile-drawer').waitFor({ state: 'hidden' })
    await openSidebar(page, viewport)
    await checkClickedOnce(page, () => pencil(blankGroup).click(), () => assertCreation(page, {}))
    if (mobile) await page.locator('.mobile-drawer').waitFor({ state: 'hidden' })
    await openSidebar(page, viewport)
    await organize(page, 'By project')
    await page.waitForLoadState('networkidle')

    // Exercise normal navigation through the timestamp and keyboard activation.
    const requestStart = requests.length
    await checkClickedOnce(page, () => pinnedLink.locator('.thread-row-time').click(), () => assertThread(page, pinned))
    if (mobile) await page.locator('.mobile-drawer').waitFor({ state: 'hidden' })
    await page.waitForLoadState('networkidle')
    const selectedCalls = requests.slice(requestStart).map(request => request.body)
      .filter(body => body?.params?.threadId === pinned.id && ['thread/read', 'thread/resume'].includes(body.method))
    assert.equal(new Set(selectedCalls.map(call => call.method)).size, selectedCalls.length, JSON.stringify(selectedCalls))
    await openSidebar(page, viewport)

    const deleteButton = threadRow(page, disposable.name).getByRole('button', { name: 'Delete thread', exact: true })
    if (mobile) await deleteButton.tap()
    else await deleteButton.press('Enter')
    const confirm = threadRow(page, disposable.name).getByRole('button', { name: 'Confirm delete' })
    await confirm.waitFor()
    assert.equal(new URL(page.url()).hash, '#/thread/' + pinned.id)
    assert.equal(calls.filter(call => call.method === 'thread/archive').length, 0)

    await emptyDots.click()
    const menu = empty.locator('.project-menu-panel')
    await menu.waitFor()
    const menuBackground = await menu.evaluate(el => getComputedStyle(el).backgroundColor)
    assert.match(menuBackground, theme === 'dark' ? /oklch\(0\.2|rgb\(39, 39, 42\)/ : /rgb\(255, 255, 255\)/)
    await page.waitForTimeout(2200)
    const screenshot = resolve(outputDir, `sidebar-links-${viewport.width}-${theme}.png`)
    await page.screenshot({ path: screenshot })
    const testedUrl = page.url()
    await menu.getByRole('button', { name: 'Remove', exact: true }).click()
    await empty.waitFor({ state: 'detached' })
    assert.deepEqual(calls.filter(call => call.method === 'project/delete').map(call => call.params.projectId), [emptyProject.id])
    await confirm.click()
    await threadRow(page, disposable.name).waitFor({ state: 'detached' })
    assert.deepEqual(calls.filter(call => call.method === 'thread/archive').map(call => call.params.threadId), [disposable.id])
    assert.deepEqual(errors, [])
    return { theme, url: testedUrl, viewport, screenshot, groupRequests, selectedThreadRequests: selectedCalls.map(call => call.method) }
  } finally {
    await context.close()
  }
}

async function main() {
  mkdirSync(outputDir, { recursive: true })
  const browser = await chromium.launch()
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      for (const theme of ['light', 'dark']) console.log(JSON.stringify(await run(browser, viewport, theme)))
    }
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
