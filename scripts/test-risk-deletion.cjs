const {chromium}=require('playwright')
const {setup,assert,thread}=require('./approved-fixture.cjs')
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
   await page.evaluate(()=>location.hash='#/thread/approved-fixture');await page.getByText('Fixture answer',{exact:true}).waitFor();await page.getByText('Conversation tools',{exact:true}).click();await page.getByText('Permanent native conversation deletion',{exact:true}).click()
  }
  mode='imported';await inspect.click();await page.getByText(/Permanent deletion of Portable imported history is withheld/).waitFor()
  mode='children';await inspect.click();await page.getByText(/has native child agents/).waitFor()
  mode='active';await inspect.click();await page.getByText(/Exact native identity, working directory and idle state are required/).waitFor()
  mode='ok';await inspect.click();await page.getByLabel('Type exact conversation ID',{exact:true}).waitFor()
  const remove=page.getByRole('button',{name:'Permanently delete confirmed conversation',exact:true})
  assert.equal(await remove.isDisabled(),true)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.locator('.permanent-deletion').scrollIntoViewIfNeeded();await page.waitForTimeout(2200);const fieldStyle=await page.getByLabel('Type exact conversation ID',{exact:true}).evaluate(el=>({border:getComputedStyle(el).borderTopStyle,width:getComputedStyle(el).borderTopWidth,background:getComputedStyle(el).backgroundColor}));assert.equal(fieldStyle.border,'solid');assert.equal(fieldStyle.width,'1px');assert.equal(fieldStyle.background,theme==='dark'?'rgb(39, 39, 42)':'rgb(255, 255, 255)');await page.screenshot({path:`output/playwright/risk-10-${width}-${theme}.png`})}
  async function confirm(){await page.getByLabel('Type exact conversation ID',{exact:true}).fill(thread.id);await page.getByRole('checkbox',{name:/I confirm permanent native history deletion/}).check();await remove.click()}
  mode='reject';await confirm();await page.getByText(/Permanent deletion rejected.*forked history/).waitFor()
  await inspect.click();mode='ok';await confirm();await page.getByText(/Native deletion accepted; waiting for the matching/).waitFor()
  assert.equal(calls.filter(c=>c.method==='thread/delete').length,2)
  assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).isDisabled(),true)
  emit('thread/deleted',{threadId:'other'});await page.waitForTimeout(100);await page.getByText(/Native deletion accepted; waiting/).waitFor()
  deleted=true;emit('thread/deleted',{threadId:thread.id});await page.getByText(/Permanent native deletion completed/).waitFor();await page.waitForURL(/#\/$/)
  await page.reload();await page.waitForTimeout(800);assert.equal(await page.getByRole('button',{name:'Approved fixture',exact:true}).count(),0)
  deleted=false;mode='unknown';await page.goto('http://127.0.0.1:4173/#/thread/approved-fixture');await page.getByText('Fixture answer',{exact:true}).waitFor();await page.getByText('Conversation tools',{exact:true}).click();await page.getByText('Permanent native conversation deletion',{exact:true}).click();await inspect.click();await confirm();await page.getByText(/Permanent deletion unknown.*fixture internal failure/).waitFor();assert.equal(await inspect.isDisabled(),true)
  const before=calls.filter(c=>c.method==='thread/delete').length;emit('app-server/disconnected',{});await page.waitForTimeout(100);emit('thread/deleted',{threadId:thread.id});await page.waitForTimeout(100);assert.equal(calls.filter(c=>c.method==='thread/delete').length,before);assert.equal(await page.getByText(/Permanent native deletion completed/).count(),0)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS native permanent deletion: imported/active/child protection, typed confirmation, native Fork rejection, ACK/event distinction, no duplicate, confirmed cleanup and refresh; six views')
})().catch(e=>{console.error(e);process.exit(1)})
