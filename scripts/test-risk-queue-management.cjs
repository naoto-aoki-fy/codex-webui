const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let pending=[{id:'first',clientUserMessageId:'c1',input:[{type:'text',text:'Editable queue text'},{type:'skill',name:'s',path:'/remote/SKILL.md'},{type:'mention',name:'App',path:'app://exact'}]},{id:'second',clientUserMessageId:'c2',input:[{type:'text',text:'Second queue text'}]}],reject=false
  const {calls,errors,emit}=await setup(page,body=>{
   if(body.method==='thread/queue/list')return {json:{result:{data:pending,nextCursor:null}}}
   if(!body.method?.startsWith('thread/queue/'))return
   if(reject)return {status:502,json:{error:'Native entry changed',rpcCode:-32602}}
   if(body.method==='thread/queue/update'){const q=pending.find(p=>p.id===body.params.queuedSubmissionId);q.input=body.params.input;return {json:{result:{queuedSubmission:q}}}}
   if(body.method==='thread/queue/reorder'){pending=body.params.queuedSubmissionIds.map(id=>pending.find(p=>p.id===id));return {json:{result:{}}}}
   if(body.method==='thread/queue/delete'){pending=pending.filter(p=>p.id!==body.params.queuedSubmissionId);return {json:{result:{deleted:true}}}}
   if(body.method==='thread/queue/start'){pending=pending.filter(p=>p.id!==body.params.queuedSubmissionId);return {json:{result:{turn:{id:'native-queue-turn',status:'inProgress'}}}}}
  })
  await page.getByText('Native deferred prompt queue',{exact:true}).click();await page.getByRole('button',{name:'Read native queue',exact:true}).click();await page.getByRole('button',{name:'Edit queued first',exact:true}).click();await page.getByRole('textbox',{name:'Queued prompt text',exact:true}).fill('Edited queue text');await page.getByRole('button',{name:'Save queued prompt',exact:true}).click();await page.waitForTimeout(200)
  assert.deepEqual(pending[0].input.slice(1),[{type:'skill',name:'s',path:'/remote/SKILL.md'},{type:'mention',name:'App',path:'app://exact'}])
  await page.getByRole('button',{name:'Move up second',exact:true}).click();await page.waitForTimeout(200);assert.equal(pending[0].id,'second')
  await page.getByRole('button',{name:'Remove queued first',exact:true}).click();assert.equal(calls.some(c=>c.method==='thread/queue/delete'),false)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-07-management-${width}-${theme}.png`})}
  await page.getByRole('button',{name:'Confirm remove queued first',exact:true}).click();await page.waitForTimeout(200);assert.equal(pending.length,1)
  await page.getByRole('button',{name:'Start queued second',exact:true}).click();await page.getByRole('button',{name:'Confirm start queued second',exact:true}).click();await page.getByText('Native turn accepted: native-queue-turn.',{exact:false}).waitFor()
  pending=[{id:'stale',clientUserMessageId:'c3',input:[{type:'text',text:'stale'}]}];await page.getByRole('button',{name:'Read native queue',exact:true}).click();await page.getByRole('button',{name:'Remove queued stale',exact:true}).waitFor();emit('thread/queue/changed',{threadId:'approved-fixture'});await page.getByText('Queue changed. Refresh before acting.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Remove queued stale',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'Read native queue',exact:true}).click();reject=true;await page.getByRole('button',{name:'Remove queued stale',exact:true}).click();await page.getByRole('button',{name:'Confirm remove queued stale',exact:true}).click();await page.getByText('Native queue delete rejected.',{exact:false}).waitFor()
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 07 native edit/structured preservation/full reorder/confirmed delete/start/native stale/rejection; six views')
})().catch(e=>{console.error(e);process.exit(1)})
