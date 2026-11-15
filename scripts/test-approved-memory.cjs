const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let kind='valid'
  const {calls,errors}=await setup(page,body=>body.method==='memory/status'?kind==='error'?{status:502,json:{error:'Memory API unavailable'}}:{json:{result:{v2Ready:false,v2ConsolidatedThreads:0}}}:body.method==='thread/memory/read'?{json:{result:{summary:kind==='valid'?'Fixture memory <script>safe text</script>':null}}}:undefined)
  assert.equal(calls.some(c=>c.method?.startsWith('memory/')||c.method==='thread/memory/read'),false)
  await page.getByText('Memory status',{exact:true}).click();await page.getByRole('button',{name:'Read memory status',exact:true}).click();await page.getByText('V2 readiness: Not ready',{exact:false}).waitFor()
  await page.getByText('Selected thread memory summary (first 8,000 characters)',{exact:true}).click();await page.getByText('Fixture memory <script>safe text</script>',{exact:true}).waitFor()
  for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/approved-20-${width}-${theme}.png`})}
  kind='null';await page.getByRole('button',{name:'Read memory status',exact:true}).click();await page.getByText('Selected summary unavailable:',{exact:false}).waitFor()
  kind='error';await page.getByRole('button',{name:'Read memory status',exact:true}).click();await page.getByRole('alert').filter({hasText:'Memory API unavailable'}).waitFor()
  assert.equal(calls.some(c=>c.method==='thread/memoryMode/set'||c.method==='memory/reset'||c.method==='config/value/write'),false)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 20: lazy native readiness/summary, actual zero, unavailable/error, no writes; matrix')
})().catch(e=>{console.error(e);process.exit(1)})
