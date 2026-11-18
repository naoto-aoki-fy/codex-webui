// Run with the current checkout serving on 127.0.0.1:4173.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const base = 'http://127.0.0.1:4173'
const html = `<!doctype html><html><body><div id="fixture"></div><script type="module">
import { createApp, h } from '/node_modules/.vite/deps/vue.js'
import ThreadComposer from '/src/components/content/ThreadComposer.vue'
import '/src/style.css'
window.submissions = []
createApp({ render: () => h(ThreadComposer, {
 activeThreadId: 'skills-visibility-fixture', models: ['gpt-5'], selectedModel: 'gpt-5',
 selectedReasoningEffort: 'high', reasoningEffortOptions: [{ value: 'high', label: 'High' }],
 selectedCollaborationMode: 'default', selectedSpeedMode: 'standard',
 skills: [{ name: 'review', description: 'Review code changes', path: '/skills/review' }, { name: 'test', description: 'Test changes', path: '/skills/test' }],
 onSubmit: (payload, settle) => { window.submissions.push(payload); settle(true) }
}) }).mount('#fixture')
</script><style>html,body { height:100%; margin:0 } #fixture { position:fixed; bottom:24px; left:16px; right:16px; max-width:760px; margin:auto } html.dark { background:#18181b; color:#eee }</style></body></html>`
;(async () => {
 mkdirSync('output/playwright', { recursive: true })
 const browser = await chromium.launch({ headless: true })
 try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // Serve a harness that mounts the real composer and dropdown; no app-server needed.
  await page.route('**/__composer-skills', route => route.fulfill({ contentType: 'text/html', body: html }))
  const selector = page.locator('.search-dropdown-trigger')
  const chip = page.getByRole('button', { name: 'Remove skill review', exact: true })
  async function toggle(expected) {
   await page.getByRole('button', { name: 'Add attachments and settings' }).click()
   const setting = page.getByRole('switch', { name: 'Skills', exact: true })
   assert.equal(await setting.getAttribute('aria-checked'), String(!expected))
   await setting.click()
   assert.equal(await selector.count(), Number(expected))
   assert.equal(await page.locator('.thread-composer-attach-menu').count(), 0)
  }
  for (const viewport of [{ width:1280,height:900 }, { width:375,height:812 }, { width:768,height:1024 }]) {
   await page.setViewportSize(viewport)
   for (const theme of ['light', 'dark']) {
    await page.goto(base + '/__composer-skills')
    await page.waitForSelector('.thread-composer-input')
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
    assert.equal(await selector.count(), 0)
    assert.equal(await page.locator('.composer-dropdown-trigger').count(), 2)
    await toggle(true)
    await selector.click()
    await page.getByPlaceholder('Search skills...').fill('Review code')
    assert.equal(await page.locator('.search-dropdown-option-main').count(), 1)
    await page.locator('.search-dropdown-option-main').click()
    assert.equal(await page.locator('.search-dropdown-menu-wrap').count(), 0)
    await toggle(false)
    assert.equal(await chip.count(), 1)
    await page.locator('textarea').fill('Review these changes')
    await page.getByRole('button', { name: 'Send message', exact:true }).click()
    assert.deepEqual(await page.evaluate(() => window.submissions[0].skills), [{ name:'review', path:'/skills/review' }])
    await page.locator('textarea').fill('/review')
    await page.locator('.thread-composer-skill-mentions button').click()
    assert.equal(await chip.count(), 1)
    assert.equal(await selector.count(), 0)
    await chip.click()
    assert.equal(await chip.count(), 0)
    await toggle(true)
    await selector.click()
    await page.locator('.search-dropdown-option-main').filter({ hasText:'review' }).click()
    await selector.click()
    assert.equal(await page.locator('.search-dropdown-option.is-selected').count(), 1)
    await page.locator('.search-dropdown-option-main').filter({ hasText:'review' }).click()
    assert.equal(await chip.count(), 0)
    // Capture the open + menu and visible selector to check both new states.
    await page.getByRole('button', { name:'Add attachments and settings' }).click()
    const state = await page.getByRole('switch', { name:'Skills', exact:true }).evaluate(el => {
     const menu = el.parentElement
     const rect = menu.getBoundingClientRect()
     return { background:getComputedStyle(menu).backgroundColor, left:rect.left, right:rect.right }
    })
    assert.ok((theme === 'dark' ? ['rgb(39, 39, 42)', 'oklch(0.274 0.006 286.033)'] : ['rgb(255, 255, 255)']).includes(state.background), state.background)
    assert.ok(state.left >= 0 && state.right <= viewport.width)
    assert.ok(await page.locator('.thread-composer-controls').evaluate(el => el.scrollWidth <= el.clientWidth))
    await page.waitForTimeout(2200)
    await page.screenshot({ path:`output/playwright/composer-skills-${viewport.width}-${theme}.png`, fullPage:true })
    console.log('PASS', viewport.width, theme, 'default, toggle, search, select/deselect, hidden chips, slash selection, submission, layout/theme')
    await page.getByRole('switch', { name:'Skills', exact:true }).click()
    await page.waitForTimeout(2200)
    await page.screenshot({ path:`output/playwright/composer-skills-hidden-${viewport.width}-${theme}.png`, fullPage:true })
   }
  }
  assert.deepEqual(errors, [])
 } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
