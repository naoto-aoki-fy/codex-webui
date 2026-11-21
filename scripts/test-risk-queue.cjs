const {chromium}=require('playwright')
const {setup,assert,openToolsDialog,enableQueueMode}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  await page.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}))
  let pending=[],mode='unsupported',release
  const {calls,errors,emit}=await setup(page,async body=>{
   if(body.method==='thread/queue/list')return mode==='unsupported'?{status:502,json:{error:'Native queue unavailable'}}:{json:{result:{data:pending,nextCursor:null}}}
   if(body.method==='thread/queue/add'){
    if(mode==='delayed')await new Promise(resolve=>release=resolve)
    if(mode==='lost'){pending.push({id:'lost-reply-fixture',input:body.params.input,clientUserMessageId:body.params.clientUserMessageId});return {status:502,json:{error:'Connection lost after queue submission'}}}
    const queuedSubmission={id:'queued-fixture',input:body.params.input,clientUserMessageId:body.params.clientUserMessageId};pending.push(queuedSubmission);return {json:{result:{queuedSubmission}}}
   }
   if(body.method==='turn/steer')return {json:{result:{turnId:'active'}}}
  },false)
  assert.equal(calls.some(c=>c.method?.startsWith('thread/queue/')),false)
  const draft=page.locator('.thread-composer-input');await draft.fill('Queue fixture prompt')
  const composerMenu=page.locator('.thread-composer-attach-menu')
  const composerMenuTrigger=page.getByRole('button',{name:'Add attachments and settings',exact:true})
  await composerMenuTrigger.click()
  const queueSwitch=page.getByRole('switch',{name:'Queue mode',exact:true})
  await queueSwitch.click()
  const queuePanel=page.locator('#native-prompt-queue')
  const inspectQueue=page.getByRole('button',{name:'Inspect native prompt queue',exact:true})
  const queueNotice=page.getByRole('alert').filter({has:inspectQueue})
  await queueNotice.getByText('Native queue unavailable',{exact:false}).waitFor()
  for(const expanded of [false,true]){
   if(expanded){
    await composerMenuTrigger.click()
    await page.getByRole('button',{name:'Expand composer',exact:true}).click()
    await composerMenuTrigger.click()
   }
   for(const theme of ['light','dark']){
    await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark')
    assert.equal(await queueSwitch.getAttribute('aria-checked'),'true')
    assert.equal(await page.getByRole('button',{name:'Queue prompt',exact:true}).isDisabled(),true)
    const menuBox=await composerMenu.boundingBox(),noticeBox=await queueNotice.boundingBox()
    assert(menuBox&&noticeBox&&menuBox.y+menuBox.height<=noticeBox.y,'Queue notice must stay visible and clear of the open composer menu')
    assert.equal(await inspectQueue.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),true)
    assert.equal(await draft.inputValue(),'Queue fixture prompt')
    await page.waitForTimeout(2200)
    const view=expanded?'queue-readiness-fullscreen':'queue-readiness'
    await page.screenshot({path:`output/playwright/${view}-${width}-${theme}.png`})
   }
  }
  assert.equal(calls.filter(c=>c.method==='thread/queue/list').length,1)
  assert(!calls.some(c=>/^(turn\/(start|steer)|thread\/queue\/add)$/.test(c.method)))
  for(const toolsAlreadyLoaded of [false,true]){
   if(toolsAlreadyLoaded)mode='ok'
   const reads=calls.filter(c=>c.method==='thread/queue/list').length
   await inspectQueue.click()
   const result=toolsAlreadyLoaded?/^No pending prompts returned\.$/:/Native queue unavailable$/
   await queuePanel.getByText(result).waitFor()
   assert.equal(await queuePanel.evaluate(el=>el.open),true)
   assert.equal(calls.filter(c=>c.method==='thread/queue/list').length,reads+1)
   await page.keyboard.press('Escape')
  }
  await page.getByRole('button',{name:'Exit full screen composer',exact:true}).click()
  await page.getByRole('button',{name:'Queue prompt',exact:true}).click();await openToolsDialog(page)
  await page.getByText('queued-fixture · Client message:',{exact:false}).waitFor();assert.equal(await draft.inputValue(),'');assert.equal(calls.some(c=>c.method==='turn/start'||c.method==='turn/steer'),false)
  await page.getByText('Pending prompt preview (first 8,000 characters)',{exact:true}).click();await page.getByText('Queue fixture prompt',{exact:true}).waitFor()
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-07-${width}-${theme}.png`})}
  await page.reload();await page.getByText('Fixture answer',{exact:true}).waitFor();await enableQueueMode(page);await openToolsDialog(page);await page.getByText('Native deferred prompt queue',{exact:true}).click();await page.getByText('queued-fixture · Client message:',{exact:false}).waitFor()
  await page.keyboard.press('Escape');mode='delayed';await draft.fill('Delayed queue fixture');await page.getByRole('button',{name:'Queue prompt',exact:true}).click();await page.waitForTimeout(150);await page.getByRole('button',{name:'Queue prompt',exact:true}).evaluate(el=>el.click());assert.equal(calls.filter(c=>c.method==='thread/queue/add').length,2);release();await page.waitForTimeout(200)
  mode='lost';await draft.fill('Uncertain queue fixture');await page.getByRole('button',{name:'Queue prompt',exact:true}).click();await page.getByRole('alert').filter({hasText:'Queue outcome unknown'}).waitFor();assert.equal(await draft.inputValue(),'Uncertain queue fixture');assert.equal(await page.getByRole('button',{name:'Queue prompt',exact:true}).isDisabled(),true)
  const count=calls.filter(c=>c.method==='thread/queue/add').length;emit('app-server/disconnected',{});await page.waitForTimeout(200);assert.equal(calls.filter(c=>c.method==='thread/queue/add').length,count)
  await page.reload();await page.getByText('Fixture answer',{exact:true}).waitFor();await enableQueueMode(page);await openToolsDialog(page);await page.getByText('Native deferred prompt queue',{exact:true}).click();await page.getByText('lost-reply-fixture · Client message:',{exact:false}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Queue prompt',exact:true}).isDisabled(),true);assert.equal(await draft.inputValue(),'Uncertain queue fixture');assert.equal(calls.filter(c=>c.method==='thread/queue/add').length,count)
  const recovery=await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('codex-web-local.persistence.v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('records','readonly'),read=tx.objectStore('records').get('codex-profile.approved-fixture.codex-web-local.queue-submissions.v1');read.onsuccess=()=>resolve(JSON.stringify(read.result));tx.oncomplete=()=>db.close()}}));assert(recovery);assert.equal(recovery.includes('Uncertain queue fixture'),false)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 07 readiness in normal and full-screen composers, native persistence after refresh, acknowledgment, duplicate and uncertain writes')
})().catch(e=>{console.error(e);process.exit(1)})
