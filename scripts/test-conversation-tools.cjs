// Credential-free browser acceptance. All API/event traffic is isolated by interception.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
;(async () => {
 const out = resolve(process.env.TOOLS_OUTPUT_DIR || 'output/playwright'); mkdirSync(out, {recursive:true})
 const browser = await chromium.launch({headless:true})
 const evidence = []
 for (const viewport of [{width:1280,height:900},{width:375,height:812},{width:768,height:1024}].filter(v=>!process.env.TOOLS_WIDTH||v.width===Number(process.env.TOOLS_WIDTH))) {
  const context = await browser.newContext({viewport, permissions:['clipboard-read','clipboard-write']})
  const page = await context.newPage(); const calls=[]; const errors=[]; const bytes=[]; const externalRequests=[]
  page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4173/')&&!request.url().startsWith('data:'))externalRequests.push(request.url())})
  let restored=false, usageKind='valid'; const sockets=new Set()
  const thread = {id:'tools-fixture',name:'Tools fixture',cwd:'/fixture',projectId:'p',preview:'fixture',createdAt:1,updatedAt:1,status:{type:'idle'}}
  const archived = {...thread,id:'archived-a',name:'Archived original'}
  const rejected = {...thread,id:'archived-b',name:'Rejected restore'}
  const turn = (id, text) => ({id,status:'completed',error:null,submittedAt:'2026-11-01T00:00:00Z',completedAt:'2026-11-01T00:01:00Z',generationMetadata:{model:'historical-fixture',modelSource:'execution',effort:'none',effortSource:'execution'},items:[{type:'userMessage',id:id+'u',content:[{type:'text',text:'Prompt '+id}]},{type:'agentMessage',id:id+'a',text}]})
  const prefix=[{role:'user',text:'Portable prefix unique',source:'fixture'},{role:'assistant',text:'Imported answer',source:'fixture'}]
  await page.route('**/codex-api/**', async route => {
   const url=new URL(route.request().url()); let body={}; try{body=route.request().postDataJSON()||{}}catch{}
   calls.push({path:url.pathname,method:body.method,params:body.params})
   let result={}, payload, status=200
   if(body.method==='thread/list') result=body.params.archived ? {data: body.params.cursor ? [rejected] : restored ? [] : [archived],nextCursor:body.params.cursor||restored ? null : 'archive-cursor'} : {data:restored?[thread,archived]:[thread],nextCursor:null}
   if(body.method==='thread/unarchive') { if(body.params.threadId==='archived-b'){status=502;payload={error:'Restore rejected by fixture'}} else {restored=true;result={thread:archived}} }
   if(body.method==='thread/resume'||body.method==='thread/read') result={thread:{...thread,turns:[turn('latest','Latest **Markdown**\n```ts\nconst answer = 42\n```')]},olderCursor:'earlier',model:'current-model',modelProvider:'fixture',importedTranscript:prefix,importStage:'ready'}
   if(body.method==='modelProvider/list')result={data:[{id:'fixture',isDefault:true}]}
   if(body.method==='model/list')result={data:[{id:'current-model',model:'current-model',isDefault:true}],nextCursor:null}
   if(body.method==='config/read')result={config:{model:'current-model',model_provider:'fixture'}}
   if(body.method==='skills/list')result={data:[]}
   if(body.method==='account/usage/read') {
    if(usageKind==='unsupported'){status=502;payload={error:'Method not found',rpcCode:-32601}}
    else result={summary:usageKind==='empty'?{}:{lifetimeTokens:12345,longestRunningTurnSec:60},dailyUsageBuckets:usageKind==='empty'?[]:[{startDate:'2026-11-01',tokens:123}]}
   }
   if (body.method === 'project/list') result = { data: [{id:'p',name:'Fixture project',roots:[{path:'/fixture'}],position:0,metadata:{}}], nextCursor: null }
   payload=payload||{result}
   if(url.pathname.endsWith('/thread-pins'))payload={data:{threadIds:[]}}
   if(url.pathname.endsWith('/pending'))payload={data:[]}
   if(url.pathname.endsWith('/methods'))payload={data:[]}
   await route.fulfill({status,json:payload})
  })
  await page.routeWebSocket('**/codex-api/ws', ws=>{sockets.add(ws);ws.onClose(()=>sockets.delete(ws))})
  if(process.env.TOOLS_DIST_ROOT)await page.route('**/*',route=>{
   const url=new URL(route.request().url())
   if(url.pathname==='/'||url.pathname.startsWith('/assets/'))return route.fulfill({path:resolve(process.env.TOOLS_DIST_ROOT,'dist',url.pathname==='/'?'index.html':url.pathname.slice(1)),contentType:url.pathname==='/'?'text/html':url.pathname.endsWith('.css')?'text/css':'application/javascript'})
   return route.fallback()
  })
  page.on('pageerror',error=>errors.push(error.message))
  const openSidebar=async()=>{const expand=page.getByRole('button',{name:'Expand sidebar',exact:true});if(await expand.count())await expand.click()}
  const openMenu=async()=>{await openSidebar();const row=page.locator('.thread-row').filter({hasText:'Tools fixture'});await row.hover();await row.locator('.thread-menu-trigger').click()}
  const shot=async(name)=>{await page.waitForTimeout(2200);const path=resolve(out,`tools-${viewport.width}-${name}.png`);await page.screenshot({path});return path}
  try {
   await page.goto('http://127.0.0.1:4173/#/thread/tools-fixture')
   await page.getByText('Latest Markdown',{exact:false}).first().waitFor()
   await openSidebar()
   if(process.env.TOOLS_STARTUP_ONLY){await page.waitForTimeout(1500);const metrics=await page.locator('.conversation-list').evaluate(el=>({top:el.scrollTop,height:el.clientHeight,scrollHeight:el.scrollHeight}));evidence.push({viewport,olderPages:calls.filter(c=>c.method==='thread/turns/list').length,metrics});console.log(JSON.stringify(evidence.at(-1)));continue}
   assert.equal(calls.filter(c=>c.params?.archived===true).length,0)
   assert.equal(calls.filter(c=>c.method==='account/usage/read').length,0)
   assert.equal(calls.filter(c=>c.method==='thread/turns/list').length,0)
   await page.locator('.archive-browser summary').click()
   await page.getByRole('button',{name:'Restore Archived original',exact:true}).waitFor()
   await page.getByRole('button',{name:'Load more archived conversations'}).click()
   await page.getByRole('button',{name:'Restore Rejected restore',exact:true}).click()
   await page.getByRole('alert').filter({hasText:'Restore rejected'}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Restore Rejected restore',exact:true}).count(),1)
   await page.getByRole('button',{name:'Restore Archived original',exact:true}).click()
   await page.locator('.thread-row').filter({hasText:'Archived original'}).waitFor()
   await page.getByRole('button',{name:'Restore Archived original',exact:true}).waitFor({state:'hidden'})
   for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');evidence.push(await shot(`archive-${theme}`))}
   await page.reload();await page.getByText('Latest Markdown',{exact:false}).first().waitFor();await openSidebar()
   await page.locator('.thread-row').filter({hasText:'Archived original'}).waitFor()
   await page.locator('.archive-browser summary').click();await page.getByText('No archived conversations.',{exact:true}).waitFor()
   await openMenu()
   await page.getByRole('button',{name:'Copy chat',exact:true}).click()
   const chat = await page.evaluate(()=>navigator.clipboard.readText())
   assert.ok(chat.includes('Latest **Markdown**'))
   assert.equal(calls.filter(c=>c.method==='thread/turns/list').length,0)
   await page.getByRole('button',{name:'Settings',exact:true}).click()
   await page.locator('.account-usage summary').click()
   assert.equal(calls.filter(c=>c.method==='account/usage/read').length,0)
   await page.getByRole('button',{name:'Refresh account usage',exact:true}).click()
   await page.getByText('12,345 tokens',{exact:true}).waitFor()
   assert.equal(await page.getByText('Unavailable',{exact:true}).count()>=1,true)
   for(const theme of ['light','dark']){
    await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark')
    await page.locator('.account-usage').scrollIntoViewIfNeeded();evidence.push(await shot(`usage-${theme}`))
   }
   usageKind='empty';await page.getByRole('button',{name:'Refresh account usage',exact:true}).click();await page.getByText('No daily usage records returned.',{exact:true}).waitFor()
   usageKind='unsupported';await page.getByRole('button',{name:'Refresh account usage',exact:true}).click();await page.getByText('Account usage is unsupported by this App Server.',{exact:true}).waitFor()
   const usageBefore=calls.filter(c=>c.method==='account/usage/read').length
   await page.waitForTimeout(1500);assert.equal(calls.filter(c=>c.method==='account/usage/read').length,usageBefore)
   assert.equal(calls.some(c=>/feedback|billing|consume|purchase/.test(c.path+' '+c.method)),false)
   assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[])
   evidence.push({viewport,calls,totalApiKB:bytes.reduce((a,b)=>a+b,0)/1024,apiResponseCount:bytes.length,assertions:'archive pagination/rejection/restore/reload, usage absent/empty/unsupported/no polling, no external upload, themes'})
  } catch(error) {await shot('failure');console.error((await page.locator('body').innerText()).slice(-4000));throw error}
  finally {await context.close()}
 }
 writeFileSync(resolve(out,'conversation-tools-results.json'),JSON.stringify(evidence,null,2))
 await browser.close()
 console.log(process.env.TOOLS_STARTUP_ONLY ? 'PASS startup-only comparison' : 'PASS conversation tools; desktop/375x812/768x1024; light/dark; isolated fixture. Evidence: output/playwright/conversation-tools-results.json')
})().catch(error=>{console.error(error);process.exit(1)})
