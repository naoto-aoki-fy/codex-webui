// Runs against the current Vite server on 4173 with a context-wide API fixture for new tabs.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')

const baseUrl = 'http://127.0.0.1:4173'
const outputDir = resolve('output/playwright')
const projectRoot = '/spaces/日本語 folder/#main&docs'
const alternateRoot = '/spaces/alternate'
const worktree = '/worktrees/日本語 branch/#work&tree'
const looseCwd = '/unassigned/日本語 folder/#draft&notes'
const projects = [
  { id: 'registered', name: 'Registered project', roots: [{ path: projectRoot }], position: 0, metadata: {} },
  { id: 'alternate', name: 'Alternate project', roots: [{ path: alternateRoot }], position: 1, metadata: {} },
]
const threads = [
  { id: 'worktree', name: 'Worktree chat', cwd: worktree, projectId: 'registered', isWorktree: true },
  { id: 'missing-root', name: 'Missing root chat', cwd: worktree, projectId: 'missing' },
  { id: 'unassigned', name: 'Unassigned chat', cwd: looseCwd, projectId: null },
  { id: 'empty', name: 'Empty cwd chat', cwd: '', projectId: null },
  { id: 'created', name: 'Created chat', cwd: projectRoot, projectId: 'registered' },
].map(thread => ({ ...thread, preview: thread.name, createdAt: 1, updatedAt: 1, status: { type: 'idle' } }))

async function installFixture(context) {
  context.setDefaultTimeout(10_000)
  const requests = new Map()
  const errors = []
  let created = false
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  await context.routeWebSocket('**/codex-api/ws', () => {})
  await context.route('**/codex-api/**', async route => {
    const request = route.request()
    const page = request.frame().page()
    const path = new URL(request.url()).pathname
    const body = request.postDataJSON() || {}
    if (!requests.has(page)) requests.set(page, [])
    requests.get(page).push({ path, ...body })

    if (path.endsWith('/connection-profile')) return route.fulfill({ json: { connectionProfile: 'toolbar-fixture' } })
    if (path.endsWith('/thread-pins')) return route.fulfill({ json: { data: { threadIds: [] } } })
    if (path.endsWith('/pending') || path.endsWith('/methods')) return route.fulfill({ json: { data: [] } })

    let result = {}
    const model = 'fixture-model'
    if (body.method === 'project/list') result = { data: projects, nextCursor: null }
    if (body.method === 'thread/list') result = { data: created ? threads : threads.slice(0, -1), nextCursor: null }
    if (['thread/read', 'thread/resume'].includes(body.method)) {
      const thread = threads.find(row => row.id === body.params.threadId)
      result = { thread: { ...thread, turns: [] }, model, modelProvider: 'fixture' }
    }
    if (body.method === 'thread/start') {
      created = true
      result = { thread: { ...threads.at(-1), turns: [] }, model, modelProvider: 'fixture' }
    }
    if (body.method === 'turn/start') result = { turn: { id: 'first-turn', status: 'inProgress' } }
    if (body.method === 'model/list') result = { data: [{ id: model, model, isDefault: true }], nextCursor: null }
    if (body.method === 'config/read') result = { config: { model, model_provider: 'fixture' } }
    if (body.method === 'skills/list') result = { data: [] }
    await route.fulfill({ json: { result } })
  })
  return { requests, errors }
}

const pencil = toolbar => toolbar.getByRole('link', { name: 'Start new thread', exact: true })
const arrow = toolbar => toolbar.getByRole('button', { name: 'Start new thread options', exact: true })
const menuItem = page => page.getByRole('menuitem', { name: 'Open in new tab' })
const composer = page => page.locator('.thread-composer-input')
const sidebar = page => page.locator('.sidebar-thread-controls-host')
const header = page => page.locator('.sidebar-thread-controls-header-host')
const requestNames = calls => calls.map(call => call.method || call.path).sort()

function checkHomeUrl(url, cwd, projectId) {
  const [path, query] = new URL(url).hash.slice(1).split('?')
  assert.equal(path, '/')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(query)), cwd ? { cwd, ...(projectId ? { projectId } : {}) } : {})
}

async function checkFolder(page, cwd, projectId, label) {
  const selection = page.locator('.new-thread-folder-selected')
  const picker = page.locator('.new-thread-folder-dropdown .composer-dropdown-trigger')
  await picker.waitFor()
  if (cwd) {
    await selection.waitFor()
    await picker.getByText(label, { exact: true }).waitFor()
    assert.equal(await selection.getAttribute('title'), cwd)
    assert.equal(await picker.getAttribute('title'), cwd)
    assert.equal(await composer(page).isEnabled(), true)
  } else {
    await picker.getByText('Choose folder', { exact: true }).waitFor()
    assert.equal(await selection.count(), 0)
    assert.equal(await composer(page).isDisabled(), true)
  }
  checkHomeUrl(page.url(), cwd, projectId)
}

async function openTab(page, trigger) {
  const [tab] = await Promise.all([page.context().waitForEvent('page'), trigger()])
  await tab.waitForLoadState('networkidle')
  return tab
}

async function verifyNavigation(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  try {
    const { requests, errors } = await installFixture(context)
    const page = await context.newPage()
    const originalUrl = `${baseUrl}/#/thread/worktree`
    await page.goto(originalUrl)
    await page.waitForLoadState('networkidle')
    await composer(page).fill('An unsent draft stays here')
    const active = page.locator('.thread-row[data-active="true"][title="Worktree chat"]')
    await active.waitFor()
    const link = pencil(sidebar(page))
    const href = await link.getAttribute('href')
    checkHomeUrl(new URL(href, originalUrl), projectRoot, 'registered')

    const regularHome = await context.newPage()
    await regularHome.goto(new URL(href, originalUrl).href)
    await regularHome.waitForLoadState('networkidle')
    const homeRequests = requestNames(requests.get(regularHome))
    for (const name of ['thread/list', 'project/list', '/codex-api/connection-profile']) {
      assert.equal(homeRequests.filter(request => request === name).length, 1, name)
    }
    assert(!homeRequests.some(name => /^thread\/(read|resume|start)$|^turn\/start$/.test(name)))
    await regularHome.close()

    const originalRequests = requests.get(page).length
    // Linux Chromium exercises Ctrl-click below. Verify that the app also leaves Meta-click to the browser.
    const metaClickHandled = await link.evaluate(element => {
      let handled
      element.addEventListener('click', event => {
        handled = event.defaultPrevented
        event.preventDefault()
      }, { once: true })
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }))
      return handled
    })
    assert.equal(metaClickHandled, false)

    await link.click({ button: 'right' })
    assert.equal(await menuItem(page).getAttribute('href'), href)
    const popup = await openTab(page, () => page.keyboard.press('Enter'))
    await checkFolder(popup, projectRoot, 'registered', 'Registered project')
    assert.deepEqual(requestNames(requests.get(popup)), homeRequests)
    assert.equal(await composer(popup).inputValue(), '')
    await popup.reload()
    await popup.waitForLoadState('networkidle')
    await checkFolder(popup, projectRoot, 'registered', 'Registered project')
    assert.deepEqual(requestNames(requests.get(popup).slice(homeRequests.length)), homeRequests)

    for (const options of [{ button: 'middle' }, { modifiers: ['ControlOrMeta'] }]) {
      const tab = await openTab(page, () => link.click(options))
      await checkFolder(tab, projectRoot, 'registered', 'Registered project')
      assert.deepEqual(requestNames(requests.get(tab)), homeRequests)
      await tab.close()
    }
    assert.equal(page.url(), originalUrl)
    assert.equal(await active.count(), 1)
    assert.equal(await composer(page).inputValue(), 'An unsent draft stays here')
    assert.equal(requests.get(page).length, originalRequests)

    await composer(popup).fill('First prompt in the new tab')
    await popup.locator('.thread-composer-submit').click()
    await popup.waitForURL('**/#/thread/created')
    const startup = requests.get(popup).filter(call => call.method === 'thread/start')
    assert.equal(startup.length, 1)
    assert.equal(startup[0].params.cwd, projectRoot)
    assert.equal(startup[0].params.projectId, 'registered')
    const turns = requests.get(popup).filter(call => call.method === 'turn/start')
    assert.equal(turns.length, 1)
    assert.equal(turns[0].params.input[0].text, 'First prompt in the new tab')
    await popup.close()
    assert.equal(page.url(), originalUrl)
    assert.equal(await active.count(), 1)
    assert.equal(await composer(page).inputValue(), 'An unsent draft stays here')

    await link.click()
    await checkFolder(page, projectRoot, 'registered', 'Registered project')
    assert.equal(context.pages().length, 1)
    await page.locator('.new-thread-folder-dropdown .composer-dropdown-trigger').click()
    await page.getByRole('listbox').getByRole('button', { name: 'Alternate project', exact: true }).click()
    await checkFolder(page, alternateRoot, 'alternate', 'Alternate project')
    await composer(page).fill('Original home draft')
    await arrow(sidebar(page)).click()
    const homeTab = await openTab(page, () => menuItem(page).click())
    await checkFolder(homeTab, alternateRoot, 'alternate', 'Alternate project')
    assert.equal(await composer(homeTab).inputValue(), '')
    await homeTab.close()
    await link.click()
    await checkFolder(page, alternateRoot, 'alternate', 'Alternate project')
    assert.equal(await composer(page).inputValue(), 'Original home draft')

    for (const [id, cwd, projectId, label] of [
      ['missing-root', worktree, 'missing', '#work&tree'],
      ['unassigned', looseCwd, undefined, '#draft&notes'],
      ['empty', '', undefined],
    ]) {
      await page.getByRole('button', { name: threads.find(thread => thread.id === id).name, exact: true }).click()
      await page.waitForURL(`**/#/thread/${id}`)
      const tab = await openTab(page, () => link.click({ button: 'middle' }))
      await checkFolder(tab, cwd, projectId, label)
      await tab.reload()
      await tab.waitForLoadState('networkidle')
      await checkFolder(tab, cwd, projectId, label)
      await tab.close()
      await link.click()
      await checkFolder(page, cwd, projectId, label)
    }
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ url: originalUrl, viewport: '1280x900', homeRequests, menuApiRequests: 0,
      result: 'same-tab and native new-tab navigation, project/folder fallbacks, reload, draft isolation, and first submission passed' }))
  } finally {
    await context.close()
  }
}

async function verifyMenus(browser, viewport, colorScheme) {
  const hasTouch = viewport.width < 768
  const context = await browser.newContext({ viewport, colorScheme, hasTouch })
  try {
    const { requests, errors } = await installFixture(context)
    const page = await context.newPage()
    const url = `${baseUrl}/#/thread/worktree`
    await page.goto(url)
    await page.waitForLoadState('networkidle')
    const originalRequests = requests.get(page).length
    const visible = viewport.width < 768 ? header(page) : sidebar(page)
    const alternate = viewport.width < 768 ? sidebar(page) : header(page)
    const href = await pencil(visible).getAttribute('href')
    const menu = page.getByRole('menu', { name: 'Start new thread options' })
    const item = menuItem(page)

    await pencil(visible).click({ button: 'right' })
    await item.waitFor()
    assert.equal(await item.evaluate(element => element === document.activeElement), true)
    await page.keyboard.press('ArrowDown')
    assert.equal(await item.evaluate(element => element === document.activeElement), true)
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    assert.equal(await pencil(visible).evaluate(element => element === document.activeElement), true)

    for (const trigger of [pencil(visible), arrow(visible)]) {
      // Observe the actual click event without letting a native context menu obscure the test page.
      await trigger.evaluate(element => element.addEventListener('contextmenu', event => {
        element.dataset.contextHandled = String(event.defaultPrevented)
        event.preventDefault()
      }, { once: true }))
      await trigger.click({ button: 'right', modifiers: ['Shift'] })
      assert.equal(await trigger.getAttribute('data-context-handled'), 'false')
      assert.equal(await menu.count(), 0)
    }

    await arrow(visible).click({ button: 'right' })
    await item.waitFor()
    const bounds = await menu.boundingBox()
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height)
    assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), colorScheme === 'dark')
    const background = await menu.evaluate(element => getComputedStyle(element).backgroundColor)
    assert.notEqual(background === 'rgb(255, 255, 255)', colorScheme === 'dark')
    await page.waitForTimeout(2200)
    const screenshot = resolve(outputDir, `toolbar-new-thread-${viewport.width}-${colorScheme}.png`)
    await page.screenshot({ path: screenshot })
    await page.locator('.content-title').click()
    await menu.waitFor({ state: 'detached' })
    await arrow(visible).press('ArrowDown')
    await item.waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await arrow(visible).evaluate(element => element === document.activeElement), true)
    assert.deepEqual(requests.get(page).slice(originalRequests), [])

    const sidebarToggle = visible.getByRole('button', { name: /^(Expand|Collapse) sidebar$/ })
    if (viewport.width < 768) {
      // Opening the drawer mounts the existing thread tree, which loads its pins.
      await Promise.all([page.waitForResponse('**/codex-api/thread-pins'), sidebarToggle.click()])
    } else {
      await sidebarToggle.click()
    }
    const alternateRequests = requests.get(page).length
    assert.equal(await pencil(alternate).getAttribute('href'), href)
    await composer(page).fill('Draft in the original toolbar tab')
    if (hasTouch) await arrow(alternate).tap()
    else await arrow(alternate).click()
    await item.waitFor()
    assert.equal(await item.getAttribute('href'), await pencil(alternate).getAttribute('href'))
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    assert.equal(page.url(), url)
    assert.deepEqual(requests.get(page).slice(alternateRequests), [])

    await arrow(alternate).press('ArrowDown')
    await item.waitFor()
    const tab = await openTab(page, () => page.keyboard.press('Enter'))
    await checkFolder(tab, projectRoot, 'registered', 'Registered project')
    assert.equal(await tab.evaluate(() => window.opener), null)
    await tab.close()
    assert.equal(page.url(), url)
    assert.equal(await page.locator('.content-title').textContent(), 'Worktree chat')
    assert.equal(await composer(page).inputValue(), 'Draft in the original toolbar tab')
    assert.deepEqual(requests.get(page).slice(alternateRequests), [])
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ url, viewport, colorScheme, screenshot, result: 'shared menu, keyboard, Escape, outside click, Shift delegation, theme, bounds and alternate toolbar navigation passed', menuApiRequests: 0 }))
  } finally {
    await context.close()
  }
}

async function main() {
  mkdirSync(outputDir, { recursive: true })
  const browser = await chromium.launch()
  try {
    await verifyNavigation(browser)
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      for (const colorScheme of ['light', 'dark']) await verifyMenus(browser, viewport, colorScheme)
    }
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
