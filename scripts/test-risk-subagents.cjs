const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let mode='ok',release
  const {calls,errors}=await setup(page,async body=>{
   if(body.method==='thread/list'&&body.params.parentThreadId){
    if(mode==='delayed')await new Promise(resolve=>release=resolve)
    return mode==='error'?{status:502,json:{error:'Subagents unsupported'}}:{json:{result:{data:mode==='empty'?[]:[{id:'child-fixture',parentThreadId:'approved-fixture',agentNickname:'Worker',agentRole:'explorer',status:{type:'idle'}}],nextCursor:null}}}
   }
   if(body.method==='thread/read'&&body.params.threadId==='child-fixture')return {json:{result:{thread:{id:'child-fixture',parentThreadId:'approved-fixture',status:{type:'idle'},cwd:'/remote/project',preview:'<script>preview stays text</script>'}}}}
  })
  assert.equal(calls.some(c=>c.params?.parentThreadId),false)
  await page.getByText('Subagents',{exact:true}).click()
  await page.getByRole('button',{name:'Read subagents',exact:true}).click()
  const link=page.getByRole('link',{name:'Worker · child-fixture',exact:true});await link.waitFor();assert.equal(await link.getAttribute('href'),'#/thread/child-fixture')
  await page.getByRole('button',{name:'Inspect child-fixture'}).click();await page.getByText('Agent preview (bounded)',{exact:true}).click();await page.getByText('<script>preview stays text</script>',{exact:true}).waitFor()
  assert.equal(calls.filter(c=>c.method==='thread/read'&&c.params.threadId==='child-fixture').length,1)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-05-${width}-${theme}.png`})}
  mode='empty';await page.getByRole('button',{name:'Read subagents',exact:true}).click();await page.getByText('No active direct children returned.',{exact:true}).waitFor()
  mode='error';await page.getByRole('button',{name:'Read subagents',exact:true}).click();await page.getByRole('alert').filter({hasText:'Subagents unsupported'}).waitFor()
  mode='delayed';await page.getByRole('button',{name:'Read subagents',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.subagents-panel button').disabled)
  await page.getByRole('button',{name:'Read subagents',exact:true}).evaluate(el=>el.click());assert.equal(calls.filter(c=>c.params?.parentThreadId).length,4)
  // Navigation invalidates the component and its pending read without resuming any child.
  await page.evaluate(()=>location.hash='#/');release();await page.waitForTimeout(250)
  assert.deepEqual(errors,[]);assert.equal(calls.some(c=>/spawn|terminate/.test(c.method)),false);await page.close()
 }
 await browser.close();console.log('PASS 05 lazy native child reads/details/navigation, bounded/empty/unsupported/duplicate/delayed navigation; 3 viewports × 2 themes')
})().catch(e=>{console.error(e);process.exit(1)})
