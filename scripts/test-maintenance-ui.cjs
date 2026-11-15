// Credential-free rendering check; all API data and notifications are fixtures.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const base = process.env.MAINTENANCE_BROWSER_BASE_URL || 'http://127.0.0.1:4173'
const marker = 'maintenance-testchat-20261115'
const thread = { id: 'maintenance-fixture', name: marker, preview: marker, projectId: 'project-id', cwd: '/fixture', createdAt: 100, updatedAt: 200, modelProvider: 'openai', source: 'cli', turns: [{ id: 'turn-1', status: 'completed', items: [
  { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: marker }] },
  { id: 'assistant-1', type: 'agentMessage', text: '**Fixture response** [sample.ts](/fixture/sample.ts)' },
] }] }
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const out = resolve('output/playwright'); mkdirSync(out, { recursive: true })
  const checks = []
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport, colorScheme: theme })
        await context.addInitScript(({ theme }) => { localStorage.setItem('codex-web-local.dark-mode.v1', theme) }, { theme })
        const page = await context.newPage()
        const errors = []
        const skillWrites = []
        page.on('pageerror', e => errors.push(e.message))
        await page.routeWebSocket('**/codex-api/ws', ws => { ws.send(JSON.stringify({ method: 'ready', params: { ok: true } })) })
        await page.route('**/codex-api/**', async route => {
          const path = new URL(route.request().url()).pathname
          let payload = {}
          if (path.endsWith('/workspace-roots-state')) payload = { data: { projectMode: 'native', nativeProjects: [{ id: 'project-id', name: 'Native fixture', roots: [{ path: '/fixture' }], metadata: {}, position: 0 }], order: ['/fixture'] } }
          else if (path.endsWith('/thread-pins')) payload = { data: { threadIds: [] } }
          else if (path.endsWith('/home-directory')) payload = { path: '/fixture' }
          else if (path.endsWith('/meta/methods')) payload = { data: require('../src/server/appServerMethods.json').methods }
          else if (path.endsWith('/skills-hub')) payload = { installed: [{ name: 'fixture-skill', path: '/fixture/skills/fixture-skill/SKILL.md', description: 'Installed fixture skill', enabled: true }] }
          else if (path.endsWith('/skills-hub/readme')) payload = { content: '# Fixture skill instructions', description: 'Installed fixture skill' }
          else if (path.endsWith('/rpc')) {
            const { method, params } = route.request().postDataJSON()
            if (method === 'skills/config/write') skillWrites.push(params)
            const result = method === 'thread/list' ? { data: [thread], nextCursor: null }
              : method === 'thread/read' || method === 'thread/resume' ? { thread, model: 'fixture-model' }
              : method === 'modelProvider/list' ? { data: [{ id: 'openai', displayName: 'OpenAI', isDefault: true }] }
              : method === 'model/list' ? { data: [{ id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture', isDefault: true, supportedReasoningEfforts: [] }], nextCursor: null }
              : method === 'config/read' ? { config: { model: 'fixture-model', model_provider: 'openai' } }
              : method === 'skills/list' ? { data: [] }
              : method === 'account/read' ? { account: { type: 'apiKey' } }
              : { data: [], nextCursor: null }
            payload = { result }
          }
          await route.fulfill({ json: payload })
        })
        await page.goto(base + '/#/thread/' + thread.id)
        await page.locator('.thread-composer-input').waitFor()
        await page.getByText('Fixture response', { exact: true }).waitFor()
        const link = page.locator('a', { hasText: 'sample.ts' }).first()
        const rendered = await link.evaluate(a => ({ href: a.getAttribute('href'), title: a.getAttribute('title'), text: a.textContent }))
        const hrefOk = Boolean(rendered.href?.includes('sample.ts'))
        const titleOk = Boolean(rendered.title?.includes('sample.ts'))
        const textOk = rendered.text === 'sample.ts'
        assert(hrefOk && titleOk && textOk, JSON.stringify(rendered))
        await page.locator('.thread-composer-input').fill('Disposable draft ' + marker)
        await page.waitForTimeout(500)
        await page.reload()
        await page.locator('.thread-composer-input').waitFor()
        await page.waitForFunction(marker => document.querySelector('.thread-composer-input')?.value === 'Disposable draft ' + marker, marker)
        assert.equal(await page.locator('html').getAttribute('lang'), 'en')
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), theme === 'dark')
        await page.waitForTimeout(2200)
        const screenshot = resolve(out, `testchat-maintenance-${viewport.width}-${theme}-cjs.png`)
        await page.screenshot({ path: screenshot, fullPage: true })
        assert.equal(await page.getByText('Malformed native pin state', { exact: true }).count(), 0)
        assert.deepEqual(errors, [])
        checks.push({ url: page.url(), viewport, theme, hrefOk, titleOk, textOk, draftAfterRefresh: true, screenshot })
        if (viewport.width === 1440) {
          await page.goto(base + '/#/skills')
          await page.getByText('fixture-skill', { exact: true }).click()
          await page.getByText('Fixture skill instructions', { exact: true }).waitFor()
          await page.getByRole('button', { name: 'Disable', exact: true }).click()
          await page.getByRole('button', { name: 'Enable', exact: true }).click()
          assert.deepEqual(skillWrites.map(write => write.enabled), [false, true])
          assert(skillWrites.every(write => write.path === '/fixture/skills/fixture-skill/SKILL.md'))
          await page.waitForTimeout(2200)
          await page.screenshot({ path: resolve(out, 'maintenance-skills-' + theme + '.png'), fullPage: true })
        }
        await context.close()
      }
    }
    writeFileSync(resolve(out, 'maintenance-ui.json'), JSON.stringify({ fixture: true, checks }, null, 2))
    console.log('PASS six fixture layouts: conversation, file link, English labels, theme, draft persistence')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
