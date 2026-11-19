// Credential-free UI acceptance against current production assets and fixture RPCs.
const { chromium } = require('playwright')
const { setup, assert } = require('./approved-fixture.cjs')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const threadId = 'approved-fixture'
const profile = 'codex-profile.recovery-A.'
const legacyKey = `${profile}codex-web-local.thread-draft.v1.${threadId}`
const forkKey = `${profile}codex-web-local.thread-fork-recovery.v1.${threadId}`
const siblingKey = `${profile}codex-web-local.thread-draft.v2.${threadId}.other.writer`
const payload = text => ({ text, imageUrls: ['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'], fileAttachments: [{ label: 'fixture.txt', path: '/fixture.txt', fsPath: '/fixture.txt' }], skills: [{ name: 'fixture-skill', path: '/fixture/SKILL.md' }], apps: [{ id: 'fixture_app', name: 'Fixture App' }] })
const reports = []

async function setupRecovery(page) {
  const fixture = await setup(page, (body, _page, url) => {
    if (url.pathname.endsWith('/connection-profile')) return { json: { connectionProfile: 'recovery-A' } }
    if (body.method === 'account/read') return { json: { result: { account: { type: 'apiKey' }, requiresOpenaiAuth: false } } }
    if (body.method === 'native-authentication/read') return { json: { result: { phase: 'ready', blocking: false, revision: 1 } } }
  }, false)
  fixture.emit('native-authentication/state', { phase: 'ready', blocking: false, revision: 1 })
  return fixture
}
async function openSettings(page) {
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true })
  if (await expand.count()) await expand.click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('button', { name: /^General/ }).click()
  return dialog
}
async function noOverflow(dialog) {
  const sizes = await dialog.locator('.management-dialog-body').evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth }))
  assert(sizes.scroll <= sizes.width + 1, JSON.stringify(sizes))
}
async function screenshot(page, name) {
  await page.waitForTimeout(2200)
  const path = resolve(`output/playwright/draft-recovery-${name}.png`)
  await page.screenshot({ path })
  return path
}
async function main() {
  mkdirSync('output/playwright', { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const [width, height] of [[1280, 900], [375, 812], [768, 1024]]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height } })
        const page = await context.newPage()
        await page.addInitScript(({ legacyKey, forkKey, siblingKey, source }) => {
          localStorage.setItem(legacyKey, JSON.stringify(source))
          localStorage.setItem(forkKey, JSON.stringify('Legacy fork recovery'))
          localStorage.setItem(siblingKey, JSON.stringify({ ...source, text: 'Other tab source' }))
          localStorage.setItem('codex-profile.recovery-B.codex-web-local.thread-draft.v1.approved-fixture', JSON.stringify({ ...source, text: 'Must stay isolated' }))
        }, { legacyKey, forkKey, siblingKey, source: payload('Legacy recovery source') })
        const fixture = await setupRecovery(page)
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
        const input = page.locator('.thread-composer-input')
        assert.equal(await input.inputValue(), '')
        await input.fill('Current draft to preserve')
        const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
        assert.equal(await page.locator('.thread-composer').getByRole('button', { name: /Recover saved drafts/ }).count(), 0)
        let settings = await openSettings(page)
        const recovery = settings.getByRole('region', { name: 'Draft Recovery', exact: true })
        await recovery.getByRole('button', { name: 'Recover saved drafts (3)', exact: true }).waitFor()
        await settings.getByRole('button', { name: 'General 3 drafts', exact: true }).waitFor()
        assert.equal(await recovery.getByText('Must stay isolated', { exact: false }).count(), 0)
        const toggle = recovery.getByRole('button', { name: 'Recover saved drafts (3)', exact: true })
        await toggle.focus()
        await page.keyboard.press('Enter')
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
        await recovery.getByRole('button', { name: 'Recover copy: Legacy fork recovery', exact: true }).waitFor()
        const copy = recovery.getByRole('button', { name: 'Recover copy: Legacy recovery source', exact: true })
        await copy.focus()
        await page.keyboard.press('Enter')
        await recovery.getByRole('status').filter({ hasText: 'Draft copied to the composer.' }).waitFor()
        const after = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
        for (const key of [legacyKey, forkKey, siblingKey]) assert.equal(after[key], before[key])
        assert(Object.entries(after).some(([key, value]) => key.includes('.archive-') && JSON.parse(value).text === 'Current draft to preserve'))
        const own = Object.entries(after).find(([key]) => key.startsWith(`${profile}codex-web-local.thread-draft.v2.${threadId}.`) && !key.includes('.archive-') && key !== siblingKey)
        assert.deepEqual(JSON.parse(own[1]), payload('Legacy recovery source'))
        assert.equal(fixture.calls.filter(c => ['turn/start', 'turn/steer', 'thread/queue/add'].includes(c.method)).length, 0)
        await noOverflow(settings)
        const image = await screenshot(page, `${width}-${theme}`)
        // Native modal focus stays contained, including the new list controls.
        await settings.getByRole('button', { name: 'Close dialog', exact: true }).focus()
        await page.keyboard.press('Shift+Tab')
        assert(await settings.evaluate(el => el.contains(document.activeElement)))
        await page.keyboard.press('Escape')
        assert.equal(await input.inputValue(), 'Legacy recovery source')
        settings = await openSettings(page)
        await settings.getByRole('button', { name: 'Recover saved drafts (4)', exact: true }).click()
        await settings.getByRole('button', { name: 'Recover copy: Current draft to preserve', exact: true }).click()
        await page.keyboard.press('Escape')
        assert.equal(await input.inputValue(), 'Current draft to preserve')
        if (width === 1280 && theme === 'light') {
          // A real second tab writes its own draft and is discoverable via storage events.
          const sibling = await context.newPage()
          const siblingFixture = await setupRecovery(sibling)
          await sibling.locator('.thread-composer-input').fill('Live other tab draft')
          const siblingSaved = await sibling.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
          settings = await openSettings(page)
          await settings.getByRole('button', { name: /Recover saved drafts/ }).click()
          await settings.getByRole('button', { name: 'Recover copy: Live other tab draft', exact: true }).click()
          await settings.getByRole('status').filter({ hasText: 'Draft copied to the composer.' }).waitFor()
          await page.keyboard.press('Escape')
          assert.equal(await sibling.locator('.thread-composer-input').inputValue(), 'Live other tab draft')
          const siblingAfter = await sibling.evaluate(() => Object.fromEntries(Object.entries(localStorage)))
          const liveKey = Object.keys(siblingSaved).find(key => key.startsWith(`${profile}codex-web-local.thread-draft.v2.`) && !key.includes('.archive-') && JSON.parse(siblingSaved[key]).text === 'Live other tab draft')
          assert.equal(siblingAfter[liveKey], siblingSaved[liveKey])
          assert.equal(siblingFixture.calls.filter(c => ['turn/start', 'turn/steer', 'thread/queue/add'].includes(c.method)).length, 0)
          assert.deepEqual(siblingFixture.errors, [])
          await sibling.close()
        }
        assert.deepEqual(fixture.errors, [])
        reports.push({ url: page.url(), viewport: { width, height }, theme, screenshot: image, result: 'PASS placement, count, legacy/fork/attachments/Skills/Apps, archive-before-copy, retained sources, profile isolation, keyboard and no submission' })
        await context.close()
      }
    }
    const context = await browser.newContext()
    const page = await context.newPage()
    const fixture = await setupRecovery(page)
    await page.locator('.thread-composer-input').fill('Keep this draft when closing Settings')
    const settings = await openSettings(page)
    await settings.getByText('No other saved drafts for this conversation.', { exact: true }).waitFor()
    assert.equal(await settings.getByRole('button', { name: /Recover saved drafts/ }).count(), 0)
    assert.equal(await page.locator('.thread-composer').getByRole('status').count(), 0)
    await settings.getByRole('button', { name: 'Refresh saved drafts', exact: true }).click()
    const image = await screenshot(page, 'empty')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.thread-composer-input').inputValue(), 'Keep this draft when closing Settings')
    assert.equal(fixture.calls.filter(c => ['turn/start', 'turn/steer', 'thread/queue/add'].includes(c.method)).length, 0)
    reports.push({ url: page.url(), screenshot: image, result: 'PASS empty Settings, quiet composer, close without loss' })
    await context.close()
    writeFileSync('output/playwright/draft-recovery-results.json', JSON.stringify(reports, null, 2))
    console.log(JSON.stringify(reports, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
