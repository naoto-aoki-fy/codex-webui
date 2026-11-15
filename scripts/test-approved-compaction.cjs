const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let failure=false
  const {calls,emit,errors}=await setup(page,body=>body.method==='thread/compact/start'?failure?{status:502,json:{error:'Method not found',rpcCode:-32601}}:{json:{result:{}}}:undefined)
  await page.getByText('Conversation actions',{exact:true}).click()
  const button=page.getByRole('button',{name:'Compact conversation',exact:true})
  assert.equal(calls.some(c=>c.method==='thread/compact/start'),false)
  await page.waitForTimeout(1000)
  await button.click();await page.getByText('Compaction requested; waiting for the native completion event.',{exact:true}).waitFor().catch(async e=>{console.error(await page.locator('.native-thread-actions').innerText());console.error(calls.filter(c=>c.method==='thread/compact/start'));throw e})
  assert.equal(await button.isDisabled(),true)
  assert.equal(await page.locator('.thread-composer-input').isDisabled(),true)
  emit('item/started',{threadId:'approved-fixture',turnId:'c-turn',item:{id:'c',type:'contextCompaction'}})
  emit('item/completed',{threadId:'approved-fixture',turnId:'c-turn',item:{id:'c',type:'contextCompaction'}})
  await page.getByText('Native compaction completed.',{exact:false}).waitFor()
  assert.equal(calls.filter(c=>c.method==='thread/compact/start').length,1)
  for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/approved-02-${width}-${theme}.png`})}
  failure=true;await button.click();await page.getByText('Manual compaction is unsupported by this App Server.',{exact:true}).waitFor()
  emit('turn/started',{threadId:'approved-fixture',turn:{id:'active',status:'inProgress',items:[]}})
  await page.waitForTimeout(300);assert.equal(await button.isDisabled(),true)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 02: native acknowledgment versus completion, overlap/send guards, unsupported, active-turn guard; matrix')
})().catch(e=>{console.error(e);process.exit(1)})
