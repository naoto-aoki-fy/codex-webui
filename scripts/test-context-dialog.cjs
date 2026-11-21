const {chromium}=require('playwright')
const {setup,thread,assert,enableQueueMode}=require('./approved-fixture.cjs')
const {mkdirSync,writeFileSync}=require('node:fs')
const path=require('node:path')
const results=[]
const otherThread={...thread,id:'other-fixture',name:'Other fixture'}
async function openContext(page){
 await page.locator('.conversation-header-menu > summary').click()
 await page.getByRole('button',{name:'Context',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Context',exact:true})
 await dialog.waitFor();return dialog
}
function usage(emit,last,window,threadId=thread.id){
 const breakdown=n=>({totalTokens:n,inputTokens:n,cachedInputTokens:0,outputTokens:0,reasoningOutputTokens:0})
 emit('thread/tokenUsage/updated',{threadId,tokenUsage:{total:breakdown(456789),last:breakdown(last),...(window?{modelContextWindow:window}:{})}})
}
;(async()=>{
 mkdirSync('output/playwright',{recursive:true})
 const browser=await chromium.launch()
 for(const [width,height] of [[1280,900],[320,900],[375,812],[768,1024]]){
  const page=await browser.newPage({viewport:{width,height}})
  const {calls,emit,errors}=await setup(page,body=>{
   if(body.method==='thread/queue/list')return {json:{result:{data:[],nextCursor:null}}}
   if(body.method==='thread/list')return {json:{result:{data:[thread,otherThread],nextCursor:null}}}
   if(['thread/read','thread/resume'].includes(body.method)&&body.params?.threadId===otherThread.id){
    return {json:{result:{thread:{...otherThread,turns:[]},model:'fixture-model',modelProvider:'fixture'}}}
   }
  },false)
  await page.locator('.thread-composer-input').fill('Context must retain this draft')
  await enableQueueMode(page)
  await page.waitForTimeout(700)
  const before=calls.length
  let dialog=await openContext(page)
  await dialog.getByText('Awaiting data',{exact:false}).waitFor()
  await dialog.getByText('Waiting for Codex thread/tokenUsage/updated events for this thread.',{exact:true}).waitFor()
  assert.equal(await dialog.locator('header h2').innerText(),'Context')
  assert.equal(await dialog.locator('header p').count(),0)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.conversation-header-menu > summary').evaluate(el=>el===document.activeElement),true)
  assert.equal(calls.length,before,'Opening Context must not issue requests')
  emit('item/agentMessage/delta',{threadId:'approved-fixture',turnId:'live',itemId:'context-stream',delta:'Retained streaming conversation text.\n'.repeat(100)})
  await page.locator('[data-message-id="context-stream"]').waitFor()
  const list=page.locator('.conversation-list')
  await list.evaluate(el=>el.scrollTop=120)
  await page.waitForTimeout(100)
  const scroll=await list.evaluate(el=>el.scrollTop);assert(scroll>0)
  for(const theme of ['light','dark']){
   await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark')
   dialog=await openContext(page)
   assert(await dialog.evaluate(el=>el.contains(document.activeElement)))
   usage(emit,12345,null)
   await dialog.getByText('Window size unavailable',{exact:true}).waitFor()
   await dialog.getByText('Model context window is unavailable in the latest usage event.',{exact:false}).waitFor()
   usage(emit,152000,200000)
   await dialog.getByText('Current context usage: 152,000 tokens',{exact:false}).waitFor()
   await dialog.getByText('Cumulative thread usage: 456,789 tokens',{exact:false}).waitFor()
   assert.equal(await dialog.locator('.thread-context-value').getAttribute('data-state'),'warning')
   usage(emit,182000,200000)
   await dialog.getByText('Remaining context: 18,000 tokens',{exact:false}).waitFor()
   assert.equal(await dialog.locator('.thread-context-value').getAttribute('data-state'),'danger')
   for(const key of ['Tab','Shift+Tab']){await page.keyboard.press(key);assert(await dialog.evaluate(el=>el.contains(document.activeElement)))}
   emit('item/agentMessage/delta',{threadId:'approved-fixture',turnId:'live',itemId:'context-stream',delta:'Stream continues while Context is open. '})
   await page.waitForTimeout(2200)
   const sizes=await dialog.locator('.management-dialog-body').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}))
   assert(sizes.scroll<=sizes.width+1,JSON.stringify(sizes))
   const screenshot=path.resolve(`output/playwright/context-${width}-${theme}.png`)
   await page.screenshot({path:screenshot})
   await page.keyboard.press('Escape')
   assert.equal(await list.evaluate(el=>el.scrollTop),scroll)
   assert.equal(await page.locator('.thread-composer-input').inputValue(),'Context must retain this draft')
   assert.equal(await page.getByRole('button',{name:'Queue ×',exact:true}).count(),1)
   assert.equal(await page.locator('[data-message-id="context-stream"]').count(),1)
   results.push({url:page.url(),width,height,theme,screenshot,scroll,requestsAddedByContext:calls.length-before})
  }
  assert.equal(calls.length,before,'Usage events, streaming and Context reopening must add no requests')
  const expand=page.getByRole('button',{name:'Expand sidebar',exact:true});if(await expand.count())await expand.click()
  await page.getByRole('button',{name:'Settings',exact:true}).click()
  const settings=page.getByRole('dialog',{name:'Settings',exact:true})
  await settings.getByRole('button',{name:'General',exact:true}).click()
  assert.equal(await settings.getByText('Context',{exact:true}).count(),0)
  assert.equal(await settings.getByRole('button',{name:'Appearance',exact:false}).count(),1)
  await page.keyboard.press('Escape')
  const collapse=page.locator('.mobile-drawer').getByRole('button',{name:'Collapse sidebar',exact:true});if(await collapse.count())await collapse.click()
  await openContext(page)
  await page.evaluate(id=>location.hash=`#/thread/${id}`,otherThread.id)
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'))
  await page.waitForURL(`**/#/thread/${otherThread.id}`)
  dialog=await openContext(page)
  await dialog.getByText('Awaiting data',{exact:false}).waitFor()
  usage(emit,34000,200000,otherThread.id)
  const destinationUsage=dialog.getByText('Current context usage: 34,000 tokens',{exact:false})
  await destinationUsage.waitFor()
  usage(emit,98000,200000)
  // The next event on the same socket confirms that the old thread update has arrived.
  emit('item/agentMessage/delta',{threadId:otherThread.id,turnId:'other-live',itemId:'other-context-stream',delta:'Destination thread streaming'})
  await page.locator('[data-message-id="other-context-stream"]').waitFor()
  assert.equal(await destinationUsage.isVisible(),true)
  await page.keyboard.press('Escape')
  await page.evaluate(()=>location.hash='#/')
  await page.waitForTimeout(200)
  assert.equal(await page.locator('.conversation-header-menu').count(),0)
  assert.deepEqual(errors,[])
  await page.close()
  console.log(`PASS Context ${width}: themes, focus, usage events, state continuity, Settings boundary and thread target`)
 }
 await browser.close()
 writeFileSync('output/playwright/context-results.json',JSON.stringify(results,null,2))
})().catch(e=>{console.error(e);process.exit(1)})
