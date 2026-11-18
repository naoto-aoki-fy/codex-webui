const {chromium}=require('playwright')
const {setup,assert,openToolsDialog,openComposerEntry}=require('./approved-fixture.cjs')
const {mkdirSync,writeFileSync}=require('node:fs')
const {resolve}=require('node:path')
const reports=[]
async function noOverflow(page,dialog=false) {
 const sizes=await page.evaluate(dialog=>{
  const el=dialog?document.querySelector('dialog[open] .management-dialog-body'):document.documentElement
  return {scroll:el.scrollWidth,width:el.clientWidth}
 },dialog)
 assert(sizes.scroll<=sizes.width+1,JSON.stringify(sizes))
}
async function screenshot(page,name,width,theme) {
 await page.waitForTimeout(2200)
 const path=resolve(`output/playwright/ui-${name}-${width}-${theme}.png`)
 await page.screenshot({path});return path
}
;(async()=>{
 mkdirSync('output/playwright',{recursive:true})
 const browser=await chromium.launch({headless:true})
 for(const width of process.env.UI_LAYOUT_CREATION_ONLY ? [] : [1280,320,375,768]){
  const height=width===375?812:width===768?1024:900
  const page=await browser.newPage({viewport:{width,height}})
  let archiveMode='rows',pending=[]
  const {calls,emit,errors}=await setup(page,(body,_page,url)=>{
   if(url.pathname.endsWith('/methods'))return {json:{data:['mcpServerStatus/list']}}
   if(body.method==='thread/list'&&body.params?.archived)return archiveMode==='error'?{status:502,json:{error:'Archive fixture unavailable'}}:{json:{result:{data:archiveMode==='empty'?[]:[{id:'archived-long',name:'A very long archived conversation title '.repeat(10),cwd:'/remote/project',createdAt:1,updatedAt:1,status:{type:'idle'}}],nextCursor:null}}}
   if(body.method==='remoteControl/status/read')return {json:{result:{status:'connected',serverName:'Long remote server explanation '.repeat(12),environmentId:'env'}}}
   if(body.method==='remoteControl/client/list')return {json:{result:{data:[],nextCursor:null}}}
   if(body.method==='thread/queue/list')return {json:{result:{data:pending,nextCursor:null}}}
   if(body.method==='thread/queue/add'){const queuedSubmission={id:'pending-fixture',input:body.params.input,clientUserMessageId:body.params.clientUserMessageId};pending.push(queuedSubmission);return {json:{result:{queuedSubmission}}}}
   if(body.method==='mcpServerStatus/list')return {json:{result:{data:[],nextCursor:null}}}
  },false)
  const startup={requests:calls.length,methods:calls.map(c=>c.method).filter(Boolean)}
  assert(!startup.methods.some(m=>/thread\/queue\/|remoteControl\/|app\/list|plugin\/list|mcpServerStatus\/list/.test(m)))
  const optionalChunks=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name).filter(name=>/\/(ConversationTools|AppsPicker|RemoteControlStatus|SkillsMcpHub)-/.test(name)))
  assert.deepEqual(optionalChunks,[])
  const draft=page.locator('.thread-composer-input')
  await draft.fill('Retained draft fixture')
  const originalRoute=page.url()
  const mcp=page.locator('[data-message-id="m"] .execution-details')
  await mcp.locator('summary').click()
  const alignment=await page.evaluate(()=>{
   const a=document.querySelector('[data-message-id="a"] .message-row').getBoundingClientRect()
   const m=document.querySelector('[data-message-id="m"] .message-row').getBoundingClientRect()
   return {answer:{x:a.x,width:a.width},mcp:{x:m.x,width:m.width},align:getComputedStyle(document.querySelector('.execution-details pre')).textAlign}
  })
  assert.deepEqual(alignment.answer,alignment.mcp);assert.equal(alignment.align,'left')
  await openComposerEntry(page,'Queue mode')
  await page.getByRole('button',{name:'Send mode: Queue mode',exact:true}).waitFor()
  await page.waitForFunction(()=>!document.querySelector('.thread-composer-submit')?.disabled)
  assert.equal(calls.filter(c=>c.method==='thread/queue/list').length,1)
  await page.getByRole('button',{name:'Send mode: Queue mode',exact:true}).click()
  assert.equal(await page.getByRole('radio',{name:'Queue mode',exact:true}).getAttribute('aria-checked'),'true')
  await page.getByRole('radio',{name:'Queue mode',exact:true}).focus()
  await page.keyboard.press('ArrowUp')
  assert.equal(await page.getByRole('radio',{name:'Immediate mode',exact:true}).getAttribute('aria-checked'),'true')
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape')
  await draft.fill('Native queued snapshot')
  await page.getByRole('button',{name:'Queue prompt',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.thread-composer-input').value==='')
  await draft.fill('Retained draft fixture')
  const queuedCall=calls.find(c=>c.method==='thread/queue/add')
  await openComposerEntry(page,'Immediate mode')
  assert(!await page.getByRole('button',{name:'Send mode: Queue mode',exact:true}).count())
  assert.equal(calls.filter(c=>c.method==='thread/queue/add').length,1)
  assert(queuedCall.params.input.some(i=>i.text==='Native queued snapshot'))
  await openComposerEntry(page,'Queue mode')
  const apiBefore=calls.length
  for(const theme of ['light','dark']){
   await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark')
   const images=[]
   await noOverflow(page)
   const composerBounds=await page.evaluate(()=>{
    const mode=document.querySelector('.thread-composer-queue-mode').getBoundingClientRect()
    const send=document.querySelector('.thread-composer-actions').getBoundingClientRect()
    return {mode:{right:mode.right,top:mode.top,bottom:mode.bottom},send:{left:send.left,top:send.top,bottom:send.bottom}}
   })
   assert(composerBounds.mode.bottom<=composerBounds.send.top || composerBounds.send.bottom<=composerBounds.mode.top || composerBounds.mode.right<=composerBounds.send.left)
   images.push(await screenshot(page,'chat',width,theme))
   // Settings can open from the sidebar even at narrow widths.
   const expand=page.getByRole('button',{name:'Expand sidebar',exact:true});if(await expand.count())await expand.click()
   await page.getByRole('button',{name:'Settings',exact:true}).click()
   const settings=page.getByRole('dialog',{name:'Settings',exact:true})
   await settings.waitFor()
   assert(await settings.evaluate(d=>d.contains(document.activeElement)))
   await settings.getByRole('button',{name:'Close dialog',exact:true}).focus();await page.keyboard.press('Shift+Tab');assert(await settings.evaluate(d=>d.contains(document.activeElement)))
   await settings.getByRole('button',{name:'Codex account',exact:true}).click()
   if(!await page.locator('.remote-control-status').evaluate(el=>el.open))await page.getByText('Codex Remote Control status',{exact:true}).click()
   await page.getByRole('button',{name:'Read Remote Control status',exact:true}).click()
   await page.getByText('Native service: connected',{exact:false}).waitFor()
   await noOverflow(page,true)
   images.push(await screenshot(page,'settings',width,theme))
   for(let i=0;i<15;i++){await page.keyboard.press('Tab');assert(await settings.evaluate(d=>d.contains(document.activeElement)))}
   await page.getByRole('button',{name:'Apps / Connectors',exact:true}).click()
   await page.getByText('MCP configuration switches',{exact:true}).waitFor()
   await noOverflow(page,true)
   images.push(await screenshot(page,'connectors',width,theme))
   await page.keyboard.press('Escape');assert.equal(await settings.count(),0)
   assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),'Settings')
   await page.getByRole('button',{name:'Archived conversations',exact:true}).click()
   const archive=page.getByRole('dialog',{name:'Archived conversations',exact:true})
   await archive.getByRole('button',{name:/Restore A very long/}).waitFor()
   assert((await archive.locator('li span').getAttribute('title')).length>200)
   await noOverflow(page,true)
   images.push(await screenshot(page,'archive',width,theme))
   archiveMode='empty';await page.getByRole('button',{name:'Refresh archived conversations',exact:true}).click();await page.getByText('No archived conversations.',{exact:true}).waitFor()
   archiveMode='error';await page.getByRole('button',{name:'Refresh archived conversations',exact:true}).click();await page.getByRole('alert').filter({hasText:'Archive fixture unavailable'}).waitFor()
   archiveMode='rows';await page.getByRole('button',{name:'Refresh archived conversations',exact:true}).click()
   await page.keyboard.press('Escape')
   const collapse=page.locator('.mobile-drawer').getByRole('button',{name:'Collapse sidebar',exact:true});if(width<768&&await collapse.count())await collapse.click()
   const list=page.locator('.conversation-list');await list.evaluate(el=>el.scrollTop=0)
   const scroll=await list.evaluate(el=>el.scrollTop)
   const composerMenu = page.getByRole('button',{name:'Add attachments and settings',exact:true})
   await composerMenu.click()
   assert.equal(await page.getByRole('button',{name:'Prompts & commands',exact:true}).count(),0)
   await page.getByRole('switch',{name:'Enable plan mode',exact:true}).waitFor()
   await page.getByRole('button',{name:'Goal…',exact:true}).waitFor()
   images.push(await screenshot(page,'composer-menu',width,theme))
   await page.keyboard.press('Escape')
   const headerMenu = page.locator('.conversation-header-menu > summary')
   await headerMenu.click()
   await page.getByRole('button',{name:'Copy conversation',exact:true}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Export conversation as Markdown',exact:true}).count(),0)
   await headerMenu.click()
   await openToolsDialog(page)
   const tools=page.getByRole('dialog',{name:'Conversation tools',exact:true})
   assert.equal(await tools.locator('.management-dialog-header h2').innerText(),'Conversation tools')
   assert.equal(await tools.locator('.management-dialog-header p').count(),0)
   await tools.getByText('Background processes',{exact:true}).waitFor()
   assert.equal(await tools.getByText('Current Git working tree',{exact:true}).count(),0)
   assert.equal(await tools.getByText('Create remote Git worktree',{exact:true}).count(),0)
   await noOverflow(page,true)
   images.push(await screenshot(page,'tools',width,theme))
   // Streaming continues while modal is open and remains one row when closed.
   emit('item/agentMessage/delta',{threadId:'approved-fixture',turnId:'live',itemId:'modal-stream',delta:'Streaming through dialog. '})
   await page.keyboard.press('Escape')
   assert.equal(await list.evaluate(el=>el.scrollTop),scroll)
   assert.equal(await page.locator('[data-message-id="modal-stream"]').count(),1)
   assert.equal(await draft.inputValue(),'Retained draft fixture')
   assert.equal(page.url(),originalRoute)
   assert(await page.getByRole('button',{name:'Send mode: Queue mode',exact:true}).count())
   console.log(`PASS views ${width} ${theme}`)
   reports.push({url:originalRoute,width,height,theme,images,alignment})
  }
  assert.equal(calls.filter(c=>c.method==='thread/queue/add').length,1)
  assert(!calls.some(c=>/remoteControl\/(enable|disable|pairing)|account\/login|mcpServer\/oauth\/login|config\/mcpServer\/reload|config\/value\/write/.test(c.method||'')))
  assert.equal(calls.filter(c=>c.method==='mcpServerStatus/list').length,1)
  // Route change dismisses the dialog before controls can retarget.
  await openToolsDialog(page)
  await page.evaluate(()=>location.hash='#/thread/other-fixture')
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'))
  assert(!await page.getByRole('button',{name:'Send mode: Queue mode',exact:true}).count())
  assert.deepEqual(errors,[])
  reports.push({width,totalRequests:calls.length,managementRequests:calls.length-apiBefore,queueWrites:1,startup,optionalChunks,errors})
  await page.close()
 }
 const creationPage=await browser.newPage({viewport:{width:1280,height:900}})
 const creation=await setup(creationPage,body=>{
  if(body.method==='thread/start')return {json:{result:{thread:{id:'created-fixture',cwd:'/remote/project',projectId:'p',turns:[]},model:'fixture-model',modelProvider:'fixture'}}}
  if(body.method==='turn/start')return {json:{result:{turn:{id:'first-turn',status:'inProgress'}}}}
  if(body.method==='thread/queue/list')return {json:{result:{data:[],nextCursor:null}}}
 },false)
 await creationPage.getByRole('button',{name:'Start new thread',exact:true}).click()
 await creationPage.waitForURL(url=>!url.hash.includes('/thread/'))
 assert(!await creationPage.getByRole('button',{name:'Send mode: Queue mode',exact:true}).count())
 await openComposerEntry(creationPage,'Queue mode')
 await creationPage.getByRole('button',{name:'Add attachments and settings',exact:true}).click()
 assert.equal(await creationPage.getByRole('radio',{name:'Queue mode',exact:true}).getAttribute('aria-checked'),'true')
 await screenshot(creationPage,'new-send-menu',1280,'light')
 await creationPage.getByRole('radio',{name:'Queue mode',exact:true}).click()
 await creationPage.locator('.thread-composer-input').fill('First message preserves selected Queue mode')
 assert.equal(await creationPage.locator('.thread-composer-submit').getAttribute('aria-label'),'Send message')
 await creationPage.locator('.thread-composer-submit').click()
 await creationPage.waitForURL('**/#/thread/created-fixture')
 await creationPage.getByRole('button',{name:'Send mode: Queue mode',exact:true}).waitFor()
 assert.equal(creation.calls.filter(c=>c.method==='thread/start').length,1)
 assert.equal(creation.calls.filter(c=>c.method==='thread/queue/add').length,0)
 await creationPage.getByRole('button',{name:'Start new thread',exact:true}).click()
 await creationPage.waitForURL(url=>!url.hash.includes('/thread/'))
 assert(!await creationPage.getByRole('button',{name:'Send mode: Queue mode',exact:true}).count())
 reports.push({creation:'PASS Immediate default, preselection, persistent ID handoff, next new-conversation reset',calls:creation.calls.map(c=>c.method).filter(Boolean)})
 assert.deepEqual(creation.errors,[])
 await creationPage.close()
 await browser.close();writeFileSync(process.env.UI_LAYOUT_CREATION_ONLY?'output/playwright/ui-creation-results.json':'output/playwright/ui-layout-results.json',JSON.stringify(reports,null,2))
 console.log(process.env.UI_LAYOUT_CREATION_ONLY?'PASS new-thread menu, accessible send label, identity handoff and reset':'PASS management layout: four widths × two themes; MCP alignment; keyboard/focus; drafts, streaming, scroll and mode continuity; queue snapshots; safe thread switching; read-only opening')
})().catch(e=>{console.error(e);process.exit(1)})
