// Credential-free comparison of production build startup.
// Usage: node scripts/measure-conversation-tools.cjs <before-root> <after-root>
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { gzipSync } = require('node:zlib')
const [beforeRoot, afterRoot = process.cwd()] = process.argv.slice(2)
if (!beforeRoot) throw new Error('Supply an extracted, built pre-feature revision')
const base = 'http://127.0.0.1:4173'
const out = resolve(process.env.CONVERSATION_MEASURE_OUTPUT || 'output/playwright/final-verification')
mkdirSync(out, { recursive: true })
function bundles(root) {
 const manifest = JSON.parse(readFileSync(join(root, 'dist/.vite/manifest.json')))
 return Object.entries(manifest).filter(([,entry]) => entry.file.endsWith('.js')).map(([key,entry]) => {
  const bytes = readFileSync(join(root,'dist',entry.file))
  return {key, file:entry.file, bytes:bytes.length, gzipBytes:gzipSync(bytes).length, dynamic:!!entry.isDynamicEntry}
 })
}
const thread = {id:'tools-fixture',name:'Tools fixture',cwd:'/fixture',projectId:'p',preview:'fixture',createdAt:1,updatedAt:1,status:{type:'idle'}}
const imported = [{role:'user',text:'Portable prefix unique',source:'fixture'},{role:'assistant',text:'Imported answer',source:'fixture'}]
async function setup(context, root) {
 const page=await context.newPage(), calls=[], payloads=[], errors=[], assetRequests=[]
 let socketConnections=0,peakOpenSockets=0
 const openSockets=new Set()
 page.on('pageerror',e=>errors.push(e.message))
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/assets/'))assetRequests.push(path)})
 await page.route('**/*',async route=>{
  const req=route.request(), url=new URL(req.url())
  assert.equal(url.origin,base,'Unexpected external request')
  if(url.pathname.startsWith('/codex-api/')){
   let body={};try{body=req.postDataJSON()||{}}catch{}
   calls.push({path:url.pathname,method:body.method,params:body.params})
   const detail=()=>({thread:{...thread,turns:[0,1].map(index=>({id:`turn-${index}`,status:'completed',error:null,items:[
    {type:'userMessage',id:`u-${index}`,content:[{type:'text',text:`TURN_${index}_USER`}]},
    {type:'agentMessage',id:`a-${index}`,text:'Latest **Markdown**'},
   ]}))},threadTurnStartIndex:0,importedTranscript:imported,importStage:'ready',model:'current-model',modelProvider:'fixture'})
   let result={}, payload
   if(body.method==='thread/list')result={data:[thread],nextCursor:null}
   if(body.method==='thread/resume'||body.method==='thread/read')result=body.params?.includeTurns===false?{thread}:detail()
   if(body.method==='modelProvider/list')result={data:[{id:'fixture',isDefault:true}]}
   if(body.method==='model/list')result={data:[{id:'current-model',model:'current-model',isDefault:true}],nextCursor:null}
   if(body.method==='config/read')result={config:{model:'current-model',model_provider:'fixture'}}
   if(body.method==='skills/list')result={data:[]}
   payload={result}
   if(url.pathname.endsWith('/workspace-roots-state'))payload={data:{nativeProjects:[{id:'p',name:'Fixture project',roots:[{path:'/fixture'}],position:0,metadata:{}}],order:['/fixture'],active:[],labels:{},projectOrder:['p']}}
   if(url.pathname.endsWith('/thread-pins'))payload={data:{threadIds:[]}}
   if(url.pathname.endsWith('/pending'))payload={data:[]}
   if(url.pathname.endsWith('/methods'))payload={data:[]}
   payloads.push(Buffer.byteLength(JSON.stringify(payload)))
   return route.fulfill({json:payload})
  }
  if(url.pathname==='/'||url.pathname.startsWith('/assets/')){
   const name=url.pathname==='/'?'index.html':url.pathname.slice(1)
   const type=name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'application/javascript'
   return route.fulfill({path:join(root,'dist',name),contentType:type})
  }
  return route.fulfill({status:404,body:''})
 })
 await page.routeWebSocket('**/codex-api/ws',socket=>{socketConnections++;openSockets.add(socket);peakOpenSockets=Math.max(peakOpenSockets,openSockets.size);socket.onClose(()=>openSockets.delete(socket))})
 await page.goto(base+'/#/thread/tools-fixture')
 await page.getByText('Latest Markdown',{exact:false}).first().waitFor()
 return {page,calls,payloads,errors,assetRequests,sockets:()=>({attempts:socketConnections,peakOpen:peakOpenSockets,openAtSample:openSockets.size})}
}
;(async()=>{
 const browser=await chromium.launch({headless:true})
 const report={environment:{node:process.version,productionBuilds:true,gzipLevel:6,viewport:'1280x900',startupWaitMs:7000,fixture:'Same metadata/model/project/history/empty-pin responses; mocked WS opens without notifications; no eager archive/usage/history operation'},bundles:{before:bundles(beforeRoot),after:bundles(afterRoot)},startup:[]}
 try {
  for(let trial=1;trial<=3;trial++)for(const [revision,root] of [['before',beforeRoot],['after',afterRoot]]){
   console.log('Measuring startup',revision,trial)
   const context=await browser.newContext({viewport:{width:1280,height:900}})
   try {
    const {page,calls,payloads,errors,assetRequests,sockets}=await setup(context,root)
    await page.waitForTimeout(7000)
    assert.deepEqual(errors,[])
    assert.equal(calls.some(call=>call.params?.archived===true||call.method==='account/usage/read'||call.path.endsWith('/thread-turn-page')),false)
    const counts={};for(const call of calls){const key=call.method||call.path;counts[key]=(counts[key]||0)+1}
    assert.equal(assetRequests.some(path=>/\/(ConversationTools|AppsPicker|RemoteControlStatus|AuthInspection|NativeAuthentication|nativeAuthentication|threadDeletion|NativeShell|nativeShell)-/.test(path)),false,'Optional feature module fetched before opening it')
    const javascriptBytes=[...new Set(assetRequests)].filter(path=>path.endsWith('.js')).reduce((sum,path)=>sum+readFileSync(join(root,'dist',path.slice(1))).length,0)
    report.startup.push({revision,trial,assetRequests,javascriptBytes,nativeConnections:sockets(),count:calls.length,responseBytes:payloads.reduce((a,b)=>a+b,0),counts})
    console.log('Startup measured',revision,trial,calls.length,sockets())
   } finally{await context.close()}
  }
  writeFileSync(resolve(out,'performance-comparison.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
 } finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
