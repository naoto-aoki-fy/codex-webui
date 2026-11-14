// Real composer/state fixture; run the current checkout on 127.0.0.1:4173.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const base = 'http://127.0.0.1:4173'
const html = `<!doctype html><html><body><div id="fixture"></div><script type="module">
import { createApp, h, ref } from '/node_modules/.vite/deps/vue.js'
import ThreadComposer from '/src/components/content/ThreadComposer.vue'
import { useDesktopState } from '/src/composables/useDesktopState.ts'
import { reasoningCatalog } from '/src/api/codexGateway.ts'
import { modelSelectionKey as key } from '/src/api/modelCapabilities.ts'
import '/src/style.css'
reasoningCatalog.value = [
 { id:'shared', modelProvider:'cloud', providerDisplayName:'Cloud fixture', supportedReasoningEfforts:['low','high'], defaultReasoningEffort:'low' },
 { id:'recent', modelProvider:'local', providerDisplayName:'Local fixture' },
 { id:'shared', modelProvider:'local', isDefault:true, supportedReasoningEfforts:['medium'], defaultReasoningEffort:'medium' }
]
const state = useDesktopState()
if (!state.readModelIdForThread('')) state.setSelectedModelIdForThread('', key('cloud','shared'))
const context = ref('__new-thread__')
window.navigate = id => context.value = id
createApp({ render: () => h(ThreadComposer, {
 activeThreadId:context.value, models:[key('cloud','shared'), key('local','recent'), key('local','shared')],
 selectedModel:state.readModelIdForThread(''), selectedReasoningEffort:state.readReasoningEffortForThread(''),
 reasoningEffortOptions:state.readReasoningOptionsForThread(''), selectedCollaborationMode:'default', selectedSpeedMode:'standard',
 'onUpdate:selected-model': value => state.setSelectedModelIdForThread('',value)
}) }).mount('#fixture')
</script><style>html,body { height:100%; margin:0 } #fixture { position:fixed; bottom:24px; left:16px; right:16px; max-width:760px; margin:auto } html.dark { background:#18181b; color:#eee }</style></body></html>`
;(async () => {
 mkdirSync('output/playwright', { recursive:true })
 const browser = await chromium.launch({ headless:true })
 try {
  for (const viewport of [{ width:1280,height:900 }, { width:375,height:812 }, { width:768,height:1024 }]) {
   for (const theme of ['light','dark']) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/__new-thread-provider', route => route.fulfill({ contentType:'text/html', body:html }))
    await page.goto(base + '/__new-thread-provider')
    await page.getByRole('button', { name:'Cloud fixture', exact:true }).click()
    await page.getByRole('button', { name:'Local fixture', exact:true }).click()
    await page.getByRole('button', { name:'shared', exact:true }).click()
    assert.deepEqual(await page.locator('.composer-dropdown-option').allTextContents(), ['recent','shared'])
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name:'Medium', exact:true }).count(), 1)
    await page.evaluate(() => window.navigate('existing'))
    assert.equal(await page.getByRole('button', { name:'Local fixture', exact:true }).count(), 0)
    await page.evaluate(() => window.navigate('__new-thread__'))
    await page.getByRole('button', { name:'Local fixture', exact:true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name:'Local fixture', exact:true }).waitFor()
    assert.equal(await page.getByRole('button', { name:'shared', exact:true }).count(), 1)
    assert.equal(await page.getByRole('button', { name:'Medium', exact:true }).count(), 1)
    await page.evaluate(theme => document.documentElement.classList.toggle('dark',theme === 'dark'), theme)
    await page.getByRole('button', { name:'Local fixture', exact:true }).click()
    const surface = await page.locator('.composer-dropdown-menu').evaluate(el => ({ bg:getComputedStyle(el).backgroundColor, left:el.getBoundingClientRect().left, right:el.getBoundingClientRect().right }))
    assert.ok(surface.left >= 0 && surface.right <= viewport.width)
    assert.ok(theme === 'dark' ? !['rgb(255, 255, 255)','rgb(244, 244, 245)'].includes(surface.bg) : surface.bg === 'rgb(255, 255, 255)', surface.bg)
    assert.ok(await page.locator('.thread-composer-controls').evaluate(el => el.scrollWidth <= el.clientWidth))
    await page.waitForTimeout(2200)
    await page.screenshot({ path:'output/playwright/new-thread-provider-' + viewport.width + '-' + theme + '.png', fullPage:true })
    assert.deepEqual(errors, [])
    console.log('PASS', viewport.width, theme, 'provider default, model filtering, reasoning, navigation, refresh, layout/theme')
    await page.close()
   }
  }
 } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode=1 })
