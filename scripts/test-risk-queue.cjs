const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  await page.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}))
  let pending=[],mode='ok',release
  const {calls,errors,emit}=await setup(page,async body=>{
   if(body.method==='thread/queue/list')return mode==='unsupported'?{status:502,json:{error:'Native queue unavailable'}}:{json:{result:{data:pending,nextCursor:null}}}
   if(body.method==='thread/queue/add'){
    if(mode==='delayed')await new Promise(resolve=>release=resolve)
    if(mode==='lost')return {status:502,json:{error:'Connection lost after queue submission'}}
    const queuedSubmission={id:'queued-fixture',input:body.params.input,clientUserMessageId:body.params.clientUserMessageId};pending.push(queuedSubmission);return {json:{result:{queuedSubmission}}}
   }
   if(body.method==='turn/steer')return {json:{result:{turnId:'active'}}}
  })
  assert.equal(calls.some(c=>c.method?.startsWith('thread/queue/')),false)
  const draft=page.locator('.thread-composer-input');await draft.fill('Queue fixture prompt')
  await page.getByRole('button',{name:'Immediate mode',exact:true}).click();await page.getByText('No pending prompts returned.',{exact:true}).waitFor();await page.getByRole('button',{name:'Queue prompt',exact:true}).click()
  await page.getByText('queued-fixture · Client message:',{exact:false}).waitFor();assert.equal(await draft.inputValue(),'');assert.equal(calls.some(c=>c.method==='turn/start'||c.method==='turn/steer'),false)
  await page.getByText('Pending prompt preview (first 8,000 characters)',{exact:true}).click();await page.getByText('Queue fixture prompt',{exact:true}).waitFor()
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-07-${width}-${theme}.png`})}
  await page.reload();await page.getByText('Fixture answer',{exact:true}).waitFor();await page.getByRole('button',{name:'Immediate mode',exact:true}).click();await page.getByText('queued-fixture · Client message:',{exact:false}).waitFor()
  mode='delayed';await draft.fill('Delayed queue fixture');await page.getByRole('button',{name:'Queue prompt',exact:true}).click();await page.waitForTimeout(150);await page.getByRole('button',{name:'Queue prompt',exact:true}).evaluate(el=>el.click());assert.equal(calls.filter(c=>c.method==='thread/queue/add').length,2);release();await page.waitForTimeout(200)
  mode='lost';await draft.fill('Uncertain queue fixture');await page.getByRole('button',{name:'Queue prompt',exact:true}).click();await page.getByRole('alert').filter({hasText:'Queue outcome unknown'}).waitFor();assert.equal(await draft.inputValue(),'Uncertain queue fixture');assert.equal(await page.getByRole('button',{name:'Queue prompt',exact:true}).isDisabled(),true)
  const count=calls.filter(c=>c.method==='thread/queue/add').length;emit('app-server/disconnected',{});await page.waitForTimeout(200);assert.equal(calls.filter(c=>c.method==='thread/queue/add').length,count)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 07 explicit queue vs steering, native persistence after refresh, acknowledgment, duplicate and uncertain writes; six views')
})().catch(e=>{console.error(e);process.exit(1)})
