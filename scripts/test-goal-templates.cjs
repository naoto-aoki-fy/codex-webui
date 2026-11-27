const { chromium } = require('playwright')
const { mkdirSync } = require('node:fs')
const { resolve } = require('node:path')
const { assert, setup, thread } = require('./approved-fixture.cjs')
const { captureGoalSettings, openGoalStatusMenu } = require('./goal-settings-fixture.cjs')

const secondThread = { ...thread, id: 'template-target', name: 'Template target' }
const targetUrl = 'http://127.0.0.1:4173/#/thread/' + secondThread.id
const original = '\nReview the result.\n\n  Preserve indentation.\n'
const templateName = 'Review checklist'

async function verify(page, viewport, theme) {
  const goals = new Map([
    [thread.id, { threadId: thread.id, objective: 'Source goal', status: 'active' }],
    [secondThread.id, { threadId: secondThread.id, objective: 'Target goal', status: 'paused' }],
  ])
  const templates = new Map()
  let failMethod
  let holdList
  const ok = result => ({ json: { result } })
  const { calls, errors, emit } = await setup(page, async ({ method, params }) => {
    if (method === 'thread/list') return ok({ data: [thread, secondThread], nextCursor: null })
    if (['thread/read', 'thread/resume'].includes(method) && params.threadId === secondThread.id) {
      return ok({ thread: { ...secondThread, turns: [] }, model: 'fixture-model', modelProvider: 'fixture' })
    }
    if (method === 'thread/goal/get') return ok({ goal: goals.get(params.threadId) ?? null })
    if (method === 'thread/goal/set') {
      goals.set(params.threadId, params)
      return ok({ goal: params })
    }
    if (!method?.startsWith('goal-templates/')) return
    assert.equal(params.connectionProfile, 'approved-fixture')
    if (method === failMethod) return { status: 502, json: { error: 'Template storage unavailable' } }
    if (method === 'goal-templates/list') {
      if (holdList) await holdList
      return ok(Array.from(templates, ([name, body]) => ({ name, body })))
    }
    if (method === 'goal-templates/save') {
      if (templates.has(params.name) && !params.overwrite) return ok({ saved: false })
      templates.set(params.name, params.body)
      return ok({ saved: true })
    }
    assert.equal(method, 'goal-templates/delete')
    templates.delete(params.name)
    return ok(null)
  }, false)

  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
  const dialog = page.getByRole('dialog', { name: 'Goal settings', exact: true })
  const button = name => dialog.getByRole('button', { name, exact: true })
  const objective = dialog.getByRole('textbox', { name: 'Goal objective' })
  const nameInput = dialog.getByRole('textbox', { name: 'Template name' })
  const openGoal = async status => {
    await page.getByRole('button', { name: 'Goal: ' + status, exact: true }).click()
    await dialog.waitFor()
  }
  const listCount = () => calls.filter(call => call.method === 'goal-templates/list').length
  const goalSaves = () => calls.filter(call => call.method === 'thread/goal/set').map(call => call.params)
  const saveTemplate = async name => {
    await button('Save as template').click()
    await nameInput.fill(name)
    await button('Save template').click()
  }

  assert.equal(listCount(), 0, 'startup adds zero template fetches')
  await openGoal('active')
  assert.equal(listCount(), 0, 'opening Goal settings adds zero template fetches')
  await objective.fill(original)
  await button('Save as template').click()
  await nameInput.fill(templateName)
  await nameInput.press('Enter')
  await nameInput.waitFor({ state: 'hidden' })
  assert.equal(templates.get(templateName), original)
  assert.equal(listCount(), 0, 'saving a template adds zero list fetches')
  await button('Cancel').click()

  await page.evaluate(id => { location.hash = '#/thread/' + id }, secondThread.id)
  await page.waitForURL(targetUrl)
  await openGoal('paused')
  assert.equal(await objective.inputValue(), 'Target goal')
  assert.equal(listCount(), 0, 'switching threads and opening Goal settings add zero template fetches')
  await (await openGoalStatusMenu(dialog)).getByRole('button', { name: 'blocked', exact: true }).click()

  await button('Saved templates').click()
  await button(templateName).waitFor()
  assert.equal(listCount(), 1)
  const style = await dialog.evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    listFits: el.querySelector('ul').scrollWidth === el.querySelector('ul').clientWidth,
  }))
  assert.equal(style.background, theme === 'dark' ? 'rgb(24, 24, 27)' : 'rgb(255, 255, 255)')
  assert.equal(style.listFits, true)
  const screenshot = await captureGoalSettings(page, 'saved-templates', viewport, theme)
  await button(templateName).click()
  assert.equal(await objective.inputValue(), original)
  assert.equal(await dialog.locator('.composer-dropdown-trigger').innerText(), 'blocked')
  const edited = original + '\nCheck the logs before finishing.\n'
  await objective.fill(edited)
  await button('Save goal').click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(goalSaves(), [{ threadId: secondThread.id, objective: edited, status: 'blocked' }])

  await openGoal('blocked')
  await button('Saved templates').click()
  await button(templateName).click()
  assert.equal(await objective.inputValue(), original, 'editing the loaded draft preserves the template')
  await button('Cancel').click()
  await openGoal('blocked')
  assert.equal(await objective.inputValue(), edited)
  assert.equal(goalSaves().length, 1, 'Cancel leaves the applied Goal intact')

  failMethod = 'goal-templates/list'
  await button('Saved templates').click()
  await dialog.getByRole('alert').filter({ hasText: 'Template storage unavailable' }).waitFor()
  assert.equal(await objective.inputValue(), edited)
  failMethod = 'goal-templates/save'
  await saveTemplate(templateName)
  await dialog.getByRole('alert').filter({ hasText: 'Template storage unavailable' }).waitFor()
  assert.equal(await objective.inputValue(), edited)
  failMethod = undefined
  await button('Save template').click()
  await dialog.getByText(`Overwrite the saved template “${templateName}”?`, { exact: true }).waitFor()
  assert.equal(await button('Use a different name').evaluate(el => el === document.activeElement), true)
  assert.equal(templates.get(templateName), original)
  await button('Use a different name').click()
  await nameInput.fill('Second checklist')
  await button('Save template').click()
  await nameInput.waitFor({ state: 'hidden' })
  await saveTemplate(templateName)
  await button('Overwrite template').click()
  await button('Overwrite template').waitFor({ state: 'hidden' })
  assert.equal(templates.get(templateName), edited)

  await button('Saved templates').click()
  await button('Delete ' + templateName).click()
  await dialog.getByText(`Delete the saved template “${templateName}”?`, { exact: true }).waitFor()
  assert.equal(await button('Keep template').evaluate(el => el === document.activeElement), true)
  await button('Keep template').click()
  await button(templateName).waitFor()
  await button('Delete ' + templateName).click()
  await button('Delete template').click()
  await button('Second checklist').waitFor()
  assert.equal(await button(templateName).count(), 0)
  assert.equal(await objective.inputValue(), edited)
  assert.equal(goalSaves().length, 1)

  await button('Saved templates').click()
  let releaseList
  holdList = new Promise(resolve => { releaseList = resolve })
  await button('Saved templates').click()
  await dialog.getByRole('status').filter({ hasText: 'Loading templates' }).waitFor()
  emit('app-server/disconnected', {})
  await dialog.getByRole('status').filter({ hasText: 'Loading templates' }).waitFor({ state: 'hidden' })
  releaseList()
  await button('Saved templates').click()
  await button('Second checklist').waitFor()
  assert.equal(await objective.inputValue(), edited, 'connection invalidation preserves the draft')

  await button('Saved templates').click()
  holdList = new Promise(resolve => { releaseList = resolve })
  await button('Saved templates').click()
  await dialog.getByRole('status').filter({ hasText: 'Loading templates' }).waitFor()
  await page.evaluate(id => { location.hash = '#/thread/' + id }, thread.id)
  await dialog.waitFor({ state: 'hidden' })
  releaseList()
  await openGoal('active')
  assert.equal(await objective.inputValue(), 'Source goal')
  assert.equal(await button('Second checklist').count(), 0, 'late list stays out of the newly opened editor')
  assert.equal(listCount(), 7, 'each explicit open adds exactly one list request')
  assert.deepEqual(errors, [])
  console.log('PASS', targetUrl, viewport, theme, 'save, reuse, edit, cancel, conflict, delete, failures and stale reads', screenshot)
}

;(async () => {
  mkdirSync(resolve('output/playwright'), { recursive: true })
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL })
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport })
        try {
          await verify(page, viewport, theme)
        } catch (error) {
          await page.screenshot({ path: 'output/playwright/goal-templates-failure.png' }).catch(() => {})
          throw error
        } finally {
          await page.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
