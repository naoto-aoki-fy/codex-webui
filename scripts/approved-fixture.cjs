const assert = require('node:assert/strict')
const {resolve}=require('node:path')
const thread = {id:'approved-fixture',name:'Approved fixture',cwd:'/remote/project',projectId:'p',preview:'fixture',createdAt:1,updatedAt:1,status:{type:'idle'}}
async function setup(page, handle = () => undefined, openTools = true, { network = page } = {}) {
 const calls=[], sockets=new Set(), errors=[]
 const items=[{type:'userMessage',id:'u',content:[{type:'text',text:'Fixture request'}]}, {type:'agentMessage',id:'a',text:'Fixture answer'},
 {type:'mcpToolCall',id:'m',server:'fixture',tool:'lookup',status:'completed',arguments:{q:'safe'},result:{content:[{type:'text',text:'<script>window.BAD=true</script> token=secret'}],structuredContent:{answer:'Structured fixture result',apiKey:'STRUCTURED_SECRET',debug:{hidden:'INTERNAL_DIAGNOSTIC'}},_meta:{hidden:'HIDDEN_META'}}},
 {type:'webSearch',id:'w',query:'fixture query',results:[]}]
 page.on('pageerror',e=>errors.push(e.message))
 await network.route('**/codex-api/**',async route=>{
  const url=new URL(route.request().url()); let body={};try{body=route.request().postDataJSON()||{}}catch{}
  if (url.pathname === '/codex-api/connection-profile') {
   const profile = await handle(body, page, url)
   return route.fulfill(profile ?? { json: { connectionProfile: 'approved-fixture' } })
  }
  calls.push({path:url.pathname,...body})
  const custom=await handle(body,page,url)
  if(custom) return route.fulfill(custom)
  let result={}
  if(body.method==='thread/list') result={data:[thread],nextCursor:null}
  if(body.method==='thread/resume'||body.method==='thread/read') result={thread:{...thread,turns:[{id:'t',status:'completed',items}]},model:'fixture-model',modelProvider:'fixture'}
  if(body.method==='modelProvider/list')result={data:[{id:'fixture',isDefault:true}]}
  if(body.method==='model/list')result={data:[{id:'fixture-model',model:'fixture-model',isDefault:true}],nextCursor:null}
  if(body.method==='config/read')result={config:{model:'fixture-model',model_provider:'fixture'}}
  if(body.method==='skills/list')result={data:[]}
  if (body.method === 'project/list') result = { data: [{id:'p',name:'Fixture project',roots:[{path:'/remote/project'}],position:0,metadata:{}}], nextCursor: null }
  let payload={result}
  if(url.pathname.endsWith('/thread-pins'))payload={data:{threadIds:[]}}
  if(url.pathname.endsWith('/pending')||url.pathname.endsWith('/methods'))payload={data:[]}
  await route.fulfill({json:payload})
 })
 await network.routeWebSocket('**/codex-api/ws',ws=>{sockets.add(ws);ws.onClose(()=>sockets.delete(ws))})
 if(process.env.APPROVED_DIST_ROOT)await network.route('**/*',route=>{
  const url=new URL(route.request().url())
  if(url.origin==='http://127.0.0.1:4173'&&(url.pathname==='/'||url.pathname.startsWith('/assets/')))return route.fulfill({path:resolve(process.env.APPROVED_DIST_ROOT,'dist',url.pathname==='/'?'index.html':url.pathname.slice(1)),contentType:url.pathname==='/'?'text/html':url.pathname.endsWith('.css')?'text/css':'application/javascript'})
  return route.fallback()
 })
 const emit=(method,params)=>{for(const ws of sockets)ws.send(JSON.stringify({method,params,atIso:new Date().toISOString()}))}
 await page.goto('http://127.0.0.1:4173/#/thread/approved-fixture')
 await page.getByText('Fixture answer',{exact:true}).waitFor()
 for(let attempt=0;attempt<100&&!sockets.size;attempt++)await page.waitForTimeout(50)
 assert(sockets.size,'Native fixture notification stream did not become ready')
 if(openTools)await openToolsDialog(page)
 return {calls,emit,errors,items,thread}
}
async function openToolsDialog(page) {
 await page.locator('.conversation-header-menu > summary').click()
 await page.getByRole('button',{name:'Conversation tools…',exact:true}).click()
 await page.getByText('Conversation actions',{exact:true}).waitFor()
}
async function openComposerEntry(page,name) {
 await page.getByRole('button',{name:'Add attachments and settings',exact:true}).click()
 await page.getByRole('button',{name:name==='Apps / Connectors'?/^Apps \/ Connectors/:name,exact:true}).click()
}
async function enableQueueMode(page) {
 const trigger=page.getByRole('button',{name:'Add attachments and settings',exact:true})
 const queueSwitch=page.getByRole('switch',{name:'Queue mode',exact:true,checked:false})
 await trigger.click()
 await queueSwitch.click()
 await trigger.click()
}
module.exports={setup,thread,assert,openToolsDialog,openComposerEntry,enableQueueMode}
