const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let accessible=true,failure=false
  const {calls,errors,emit}=await setup(page,body=>body.method==='app/list'?failure?{status:502,json:{error:'Apps unavailable'}}:{json:{result:{data:[{id:'connector_demo',name:'Demo App',isAccessible:accessible,isEnabled:true}],nextCursor:null}}}:body.method==='turn/start'?{json:{result:{turn:{id:'apps-turn',status:'inProgress'}}}}:undefined)
  await page.waitForTimeout(700);assert.equal(calls.some(c=>c.method==='app/list'),false)
  await page.getByText('Apps / Connectors',{exact:true}).click();await page.getByRole('button',{name:'Refresh available Apps',exact:true}).click()
  await page.getByRole('button',{name:'Reference Demo App',exact:true}).click();await page.getByText('Selected: Demo App',{exact:false}).waitFor()
  const draft=page.locator('.thread-composer-input');await draft.fill('Use App fixture')
  assert.equal(calls.some(c=>c.method==='turn/start'),false)
  for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/approved-18-${width}-${theme}.png`})}
  await page.reload();await page.getByText('Fixture answer',{exact:true}).waitFor();await page.getByText('Apps / Connectors',{exact:true}).click();await page.getByText('Selected: Demo App',{exact:false}).waitFor()
  accessible=false;await page.getByRole('button',{name:'Refresh available Apps',exact:true}).click();await page.getByText('No longer available; remove this reference.',{exact:false}).waitFor();assert.equal(await page.locator('.thread-composer-submit').isDisabled(),true)
  accessible=true;await page.getByRole('button',{name:'Refresh available Apps',exact:true}).click();await page.waitForTimeout(200);await page.locator('.thread-composer-submit').click()
  await page.waitForTimeout(300);const sent=calls.find(c=>c.method==='turn/start');assert.ok(sent);assert.ok(sent.params.input.some(i=>i.type==='mention'&&i.path==='app://connector_demo'&&i.name==='Demo App'))
  await page.getByRole('button',{name:'Reference Demo App',exact:true}).click();emit('app-server/disconnected',{})
  await page.getByText('Selected: Demo App',{exact:false}).waitFor({state:'hidden'})
  failure=true;await page.getByRole('button',{name:'Refresh available Apps',exact:true}).click();await page.getByRole('alert').filter({hasText:'Apps unavailable'}).waitFor()
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 18: lazy native picker, exact structured input, draft persistence, removed selection guard, connection invalidation/error; matrix')
})().catch(e=>{console.error(e);process.exit(1)})
