// Credential-free comparison of production builds and a real browser export.
// Usage: node scripts/measure-conversation-tools.cjs <before-root> <after-root>
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { gzipSync } = require('node:zlib')
const [beforeRoot, afterRoot = process.cwd()] = process.argv.slice(2)
if (!beforeRoot) throw new Error('Supply an extracted, built pre-feature revision')
const base = 'http://127.0.0.1:4173'
const out = resolve('output/playwright/final-verification')
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
const TURN_COUNT=2000
const commandOutput='`x'.repeat(150_000)
function turn(index, large) {
 return {id:`turn-${index}`,status:'completed',error:null,items:[
  {type:'userMessage',id:`u-${index}`,content:[{type:'text',text:`TURN_${index}_USER`}]},
  {type:'agentMessage',id:`a-${index}`,text:large ? `TURN_${index}_ANSWER\n${'Representative conversation content. '.repeat(55)}\n\`\`\`ts\nconst turn = ${index}\n\`\`\``:'Latest **Markdown**'},
  ...(large && index===0 ? [{type:'commandExecution',id:'large-command',command:'cat transcript',cwd:'/fixture',status:'completed',exitCode:0,aggregatedOutput:commandOutput,commandActions:[]}] : []),
 ]}
}
async function setup(context, root, large = false) {
 const page=await context.newPage(), calls=[], payloads=[], errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 const total=large?TURN_COUNT:2
 await page.route('**/*',async route=>{
  const req=route.request(), url=new URL(req.url())
  assert.equal(url.origin,base,'Unexpected external request')
  if(url.pathname.startsWith('/codex-api/')){
   let body={};try{body=req.postDataJSON()||{}}catch{}
   calls.push({path:url.pathname,method:body.method,params:body.params})
   const detail=(start,end)=>({thread:{...thread,turns:Array.from({length:end-start},(_,i)=>turn(start+i,large))},threadTurnStartIndex:start,importedTranscript:imported,importStage:'ready',model:'current-model',modelProvider:'fixture'})
   let result={}, payload
   if(body.method==='thread/list')result={data:[thread],nextCursor:null}
   if(body.method==='thread/resume'||body.method==='thread/read')result=body.params?.includeTurns===false?{thread}:detail(Math.max(0,total-10),total)
   if(body.method==='modelProvider/list')result={data:[{id:'fixture',isDefault:true}]}
   if(body.method==='model/list')result={data:[{id:'current-model',model:'current-model',isDefault:true}],nextCursor:null}
   if(body.method==='config/read')result={config:{model:'current-model',model_provider:'fixture'}}
   if(body.method==='skills/list')result={data:[]}
   payload={result}
   if(url.pathname.endsWith('/workspace-roots-state'))payload={data:{projectMode:'native',nativeProjects:[{id:'p',name:'Fixture project',roots:[{path:'/fixture'}],position:0,metadata:{}}],order:['/fixture'],active:[],labels:{},projectOrder:['p']}}
   if(url.pathname.endsWith('/thread-pins'))payload={data:{threadIds:[]}}
   if(url.pathname.endsWith('/pending'))payload={data:[]}
   if(url.pathname.endsWith('/methods'))payload={data:[]}
   if(url.pathname.endsWith('/thread-turn-page')){
    const end=Number(url.searchParams.get('beforeTurnId').split('-').at(-1)), start=Math.max(0,end-10)
    payload={result:detail(start,end),startTurnIndex:start,hasMoreOlder:start>0}
   }
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
 await page.routeWebSocket('**/codex-api/ws',()=>{})
 await page.goto(base+'/#/thread/tools-fixture')
 await page.getByText(large?`TURN_${TURN_COUNT-1}_ANSWER`:'Latest Markdown',{exact:false}).first().waitFor()
 return {page,calls,payloads,errors}
}
;(async()=>{
 const browser=await chromium.launch({headless:true})
 const report={environment:{node:process.version,productionBuilds:true,gzipLevel:6,viewport:'1280x900',startupWaitMs:7000,fixture:'Same metadata/model/project/history/empty-pin responses; mocked WS opens without notifications; no eager archive/usage/history operation'},bundles:{before:bundles(beforeRoot),after:bundles(afterRoot)},startup:[],largeExport:null}
 try {
  for(let trial=1;trial<=3;trial++)for(const [revision,root] of [['before',beforeRoot],['after',afterRoot]]){
   const context=await browser.newContext({viewport:{width:1280,height:900}})
   try {
    const {page,calls,payloads,errors}=await setup(context,root)
    await page.waitForTimeout(7000)
    assert.deepEqual(errors,[])
    assert.equal(calls.some(call=>call.params?.archived===true||call.method==='account/usage/read'||call.path.endsWith('/thread-turn-page')),false)
    const counts={};for(const call of calls){const key=call.method||call.path;counts[key]=(counts[key]||0)+1}
    report.startup.push({revision,trial,count:calls.length,responseBytes:payloads.reduce((a,b)=>a+b,0),counts})
   } finally{await context.close()}
  }
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true})
  try {
   const {page,calls,payloads,errors}=await setup(context,afterRoot,true)
   await page.waitForTimeout(1000)
   await page.locator('.thread-row').filter({hasText:'Tools fixture'}).hover()
   await page.locator('.thread-row').filter({hasText:'Tools fixture'}).locator('.thread-menu-trigger').click()
   await page.evaluate(()=>{
    window.exportTiming={started:performance.now(),rafGaps:[],longTasks:[]}
    let last=performance.now()
    const tick=now=>{window.exportTiming.rafGaps.push(now-last);last=now;window.exportTiming.raf=requestAnimationFrame(tick)}
    window.exportTiming.raf=requestAnimationFrame(tick)
    window.exportObserver=new PerformanceObserver(list=>window.exportTiming.longTasks.push(...list.getEntries().map(e=>e.duration)))
    window.exportObserver.observe({type:'longtask'})
   })
   const callStart=calls.length, byteStart=payloads.length
   const downloaded=page.waitForEvent('download')
   await page.getByRole('button',{name:'Export conversation as Markdown',exact:true}).click()
   const file=await downloaded
   const text=readFileSync(await file.path(),'utf8')
   await page.waitForTimeout(100)
   const timing=await page.evaluate(()=>{cancelAnimationFrame(window.exportTiming.raf);window.exportObserver.disconnect();return {...window.exportTiming,elapsedMs:performance.now()-window.exportTiming.started-100}})
   assert.equal(text.match(/Portable prefix unique/g).length,1)
   assert.equal((text.match(/TURN_\d+_USER/g)||[]).length,TURN_COUNT)
   assert.equal((text.match(/TURN_\d+_ANSWER/g)||[]).length,TURN_COUNT)
   assert.ok(text.indexOf('TURN_0_USER')<text.indexOf(`TURN_${TURN_COUNT-1}_USER`))
   assert.ok(text.includes(commandOutput),'Large command must be exported without stack overflow')
   assert.deepEqual(errors,[])
   const screenshot=resolve(out,'large-export-complete.png');await page.waitForTimeout(2200);await page.screenshot({path:screenshot})
   report.largeExport={turns:TURN_COUNT,messages:(text.match(/^## /gm)||[]).length,importedMessages:2,markdownBytes:Buffer.byteLength(text),apiResponseBytes:payloads.slice(byteStart).reduce((a,b)=>a+b,0),initialDetailReads:calls.slice(callStart).filter(c=>c.method==='thread/read').length,olderPageReads:calls.slice(callStart).filter(c=>c.path.endsWith('/thread-turn-page')).length,elapsedMs:timing.elapsedMs,maxAnimationFrameGapMs:Math.max(...timing.rafGaps),longTasksMs:timing.longTasks,screenshot,assertions:'All 2000 prompts/answers ordered, portable prefix once, 300k-character command included, no page errors; no paid calls.'}
  } finally{await context.close()}
  writeFileSync(resolve(out,'performance-comparison.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
 } finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
