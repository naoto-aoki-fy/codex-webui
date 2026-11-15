const {chromium}=require('playwright')
const {setup,assert,thread,openToolsDialog}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let mode='ok',deleted=false
  const {calls,errors,emit}=await setup(page,body=>{
   if(body.method==='thread/read'&&body.params.includeTurns===false)return {json:{result:{thread:{...thread,...(mode==='active'?{status:{type:'active'}}:{})},...(mode==='imported'?{importStage:'ready',importedTranscript:[]}:{})}}}
   if(body.method==='thread/list')return {json:{result:{data:body.params.parentThreadId?mode==='children'?[{id:'child',parentThreadId:thread.id}]:[]:deleted?[]:[thread],nextCursor:null}}}
   if(body.method==='thread/delete'){
    if(mode==='reject')return {status:502,json:{error:'forked history still references it',rpcCode:-32600}}
    if(mode==='unknown')return {status:502,json:{error:'fixture internal failure',rpcCode:-32603}}
    return {json:{result:{}}}
   }
  })
  await page.getByText('Permanent native conversation deletion',{exact:true}).click()
  const inspect=page.getByRole('button',{name:'Inspect permanent deletion scope',exact:true})
  if(width===1280&&process.env.APPROVED_DIST_ROOT){
   let releaseModule,seenModule;const requested=new Promise(resolve=>seenModule=resolve)
   await page.route('**/assets/threadDeletion-*.js',async route=>{seenModule();await new Promise(resolve=>releaseModule=resolve);await route.fallback()})
   const before=calls.filter(c=>c.method==='thread/read'&&c.params.includeTurns===false).length
   await inspect.click();await requested;await page.evaluate(()=>location.hash='#/');await page.waitForURL(/#\/$/);releaseModule();await page.waitForTimeout(400);await page.unroute('**/assets/threadDeletion-*.js')
   assert.equal(calls.filter(c=>c.method==='thread/read'&&c.params.includeTurns===false).length,before)
   assert.equal(calls.some(c=>c.method==='thread/delete'),false)
   await page.evaluate(()=>location.hash='#/thread/approved-fixture');await page.getByText('Fixture answer',{exact:true}).waitFor();await openToolsDialog(page);if(!await page.locator('.permanent-deletion').evaluate(el=>el.open))await page.getByText('Permanent native conversation deletion',{exact:true}).click()
  }
  mode='imported';await inspect.click();await page.getByText(/Permanent deletion of Portable imported history is withheld/).waitFor()
  mode='children';await inspect.click();await page.getByText(/has native child agents/).waitFor()
  mode='active';await inspect.click();await page.getByText(/Exact native identity, working directory and idle state are required/).waitFor()
  mode='ok';await inspect.click();await page.getByText(/Conversation: Approved fixture/).waitFor()
  assert.equal(await page.getByRole('button',{name:'Permanently delete confirmed conversation',exact:true}).count(),0)
  assert.equal(await page.getByLabel('Type exact conversation ID',{exact:true}).count(),0)
  await page.getByText(/This panel provides read-only inspection/).waitFor()
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.locator('.permanent-deletion').scrollIntoViewIfNeeded();await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-10-${width}-${theme}.png`})}
  emit('app-server/disconnected',{});emit('app-server/reconnected',{});await page.waitForTimeout(200)
  assert.equal(calls.some(c=>c.method==='thread/delete'),false)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS deletion inspection only: mutation withheld, no native delete RPC, lazy ownership, reconnect; six views')
})().catch(e=>{console.error(e);process.exit(1)})
