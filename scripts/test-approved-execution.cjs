const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
const {mkdirSync}=require('node:fs')
;(async()=>{
 mkdirSync('output/playwright',{recursive:true})
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]) {
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  const {calls,emit,errors}=await setup(page)
  const tool=page.locator('[data-message-id="m"] .execution-details');await tool.locator('summary').click()
  assert.ok((await tool.innerText()).includes('[redacted]'));assert.ok(!(await tool.innerText()).includes('HIDDEN_META'))
  assert.equal(await page.evaluate(()=>window.BAD),undefined)
  await page.locator('[data-message-id="w"] summary').click();await page.getByText('Results: Empty result',{exact:false}).waitFor()
  const reads=calls.filter(c=>c.method==='thread/read').length
  emit('item/started',{threadId:'approved-fixture',turnId:'live',item:{id:'live-m',type:'mcpToolCall',server:'fixture',tool:'live',status:'inProgress',arguments:{}}})
  await page.locator('[data-message-id="live-m"]').waitFor()
  emit('item/mcpToolCall/progress',{threadId:'approved-fixture',turnId:'live',itemId:'live-m',message:'Working fixture'})
  const live=page.locator('[data-message-id="live-m"]');await live.locator('summary').click();await live.getByText('Progress: Working fixture',{exact:false}).waitFor()
  emit('item/completed',{threadId:'approved-fixture',turnId:'live',item:{id:'live-m',type:'mcpToolCall',server:'fixture',tool:'live',status:'completed',result:{content:[]}}})
  await live.getByText('Status: completed',{exact:false}).waitFor();assert.equal(await page.locator('[data-message-id="live-m"]').count(),1)
  assert.equal(calls.filter(c=>c.method==='thread/read').length,reads)
  for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/approved-06-${width}-${theme}.png`})}
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 06: history/live/progress/redaction/dedup/no item reloads; 3 sizes × 2 themes')
})().catch(e=>{console.error(e);process.exit(1)})
