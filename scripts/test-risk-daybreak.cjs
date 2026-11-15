const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let mode='ok',release
  const {calls,errors,emit}=await setup(page,async body=>{
   if(body.method==='thread/read'&&body.params.includeTurns===false){if(mode==='delayed')await new Promise(r=>release=r);return mode==='error'?{status:502,json:{error:'Daybreak metadata unavailable'}}:{json:{result:{thread:{id:'approved-fixture',...(mode==='unset'?{daybreakEnabled:null}:mode==='unknown'?{}:{daybreakEnabled:false})}}}}}
   if(body.method==='model/list'&&body.params.limit===20)return {json:{result:{data:[{id:'fixture-model',availableAccessPrograms:{cyber:['daybreakBlue','daybreakRed']}},{id:'name-with-daybreak-only'},{id:'no-programs',availableAccessPrograms:{cyber:[]}}],nextCursor:null}}}
  })
  assert.equal(calls.some(c=>c.method==='model/list'&&c.params.limit===20),false)
  await page.getByText('Native Daybreak status',{exact:true}).click();await page.getByRole('button',{name:'Read native Daybreak status',exact:true}).click();await page.getByText('Saved Daybreak choice: disabled.',{exact:false}).waitFor();await page.getByText('fixture-model · Advertised explicit cyber programs: daybreakBlue, daybreakRed',{exact:true}).waitFor();await page.getByText('name-with-daybreak-only · Access-program metadata unavailable',{exact:true}).waitFor()
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-33-${width}-${theme}.png`})}
  for(const kind of ['unset','unknown','error']){mode=kind;await page.getByRole('button',{name:'Read native Daybreak status',exact:true}).click();if(kind==='error')await page.getByRole('alert').filter({hasText:'Daybreak metadata unavailable'}).waitFor();else await page.getByText('Saved Daybreak choice: '+(kind==='unknown'?'unavailable':kind)+'.',{exact:false}).waitFor()}
  mode='delayed';await page.getByRole('button',{name:'Read native Daybreak status',exact:true}).click();await page.waitForTimeout(100);emit('app-server/disconnected',{});await page.waitForTimeout(100);release();await page.getByText('Saved Daybreak choice: unknown.',{exact:false}).waitFor()
  assert.equal(calls.some(c=>c.method==='thread/metadata/update'||c.method==='turn/start'||c.method==='experimentalFeature/enablement/set'),false);assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 33 native saved choice and caller-advertised programs, missing vs empty/false/unset/error/disconnect, no turns/settings; six views')
})().catch(e=>{console.error(e);process.exit(1)})
