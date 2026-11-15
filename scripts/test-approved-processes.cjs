const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let terminated=false,failure=false
  const {calls,errors}=await setup(page,body=>{
   if(body.method==='thread/backgroundTerminals/list')return failure?{status:502,json:{error:'Unavailable terminal API'}}:{json:{result:{data:terminated?[]:[{processId:'42',itemId:'cmd',command:'fixture command',cwd:'/remote/project'}],nextCursor:null}}}
   if(body.method==='thread/backgroundTerminals/terminate'){assert.deepEqual(body.params,{threadId:'approved-fixture',processId:'42'});terminated=true;return {json:{result:{terminated:true}}}}
  })
  await page.waitForTimeout(700);assert.equal(calls.some(c=>c.method?.startsWith('thread/backgroundTerminals/')),false)
  await page.getByText('Background processes',{exact:true}).click();await page.getByRole('button',{name:'Refresh background processes',exact:true}).click()
  await page.getByText('Recent captured output · 42',{exact:true}).click();await page.getByText('Recent output unavailable in loaded history.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Terminate process 42',exact:true}).click()
  assert.equal(calls.some(c=>c.method==='thread/backgroundTerminals/terminate'),false)
  for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/approved-08-${width}-${theme}.png`})}
  await page.getByRole('button',{name:'Confirm termination 42',exact:true}).click();await page.getByText('Process termination acknowledged.',{exact:false}).waitFor()
  assert.equal(calls.filter(c=>c.method==='turn/interrupt').length,0)
  await page.getByRole('button',{name:'Refresh background processes',exact:true}).click();await page.getByText('No background processes returned.',{exact:true}).waitFor()
  failure=true;await page.getByRole('button',{name:'Refresh background processes',exact:true}).click();await page.getByRole('status').filter({hasText:'Unavailable terminal API'}).waitFor()
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 08: lazy scoped process list/output/explicit termination/empty/error/no model interruption; matrix')
})().catch(e=>{console.error(e);process.exit(1)})
