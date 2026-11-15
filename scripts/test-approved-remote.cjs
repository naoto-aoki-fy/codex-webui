const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let failure=false
  const {calls,errors}=await setup(page,body=>body.method==='remoteControl/status/read'?failure?{status:502,json:{error:'Remote management unavailable'}}:{json:{result:{status:'connected',serverName:'Fixture server',environmentId:'env'}}}:body.method==='remoteControl/client/list'?{json:{result:{data:[{clientId:'device',displayName:'Fixture client',platform:'mobile',lastSeenAt:123}],nextCursor:null}}}:undefined)
  await page.waitForTimeout(700);const expand=page.getByRole('button',{name:'Expand sidebar',exact:true});if(await expand.count())await expand.click()
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByText('Codex Remote Control status',{exact:true}).click()
  assert.equal(calls.some(c=>c.method?.startsWith('remoteControl/')),false)
  await page.getByRole('button',{name:'Read Remote Control status',exact:true}).click();await page.getByText('Native service: connected',{exact:false}).waitFor()
  await page.getByRole('button',{name:'Read registered clients',exact:true}).click();await page.getByText('Fixture client · device',{exact:false}).waitFor()
  assert.deepEqual(calls.find(c=>c.method==='remoteControl/client/list').params,{environmentId:'env',cursor:null,limit:50,order:'desc'})
  for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');await page.locator('.remote-control-status').scrollIntoViewIfNeeded();await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/approved-31-${width}-${theme}.png`})}
  failure=true;await page.getByRole('button',{name:'Read Remote Control status',exact:true}).click();await page.getByRole('alert').filter({hasText:'Remote management unavailable'}).waitFor()
  assert.equal(calls.some(c=>/remoteControl\/(enable|disable|pairing|client\/revoke)/.test(c.method)),false)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 31: lazy status/environment-scoped client list/error/no access mutations; matrix')
})().catch(e=>{console.error(e);process.exit(1)})
