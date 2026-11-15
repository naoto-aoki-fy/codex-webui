const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let mode='ok',release
  const {calls,errors,emit}=await setup(page,async body=>{
   if(body.method==='config/read'&&body.params.includeLayers){
    if(mode==='delayed')await new Promise(resolve=>release=resolve)
    return mode==='error'?{status:502,json:{error:'Configuration unavailable'}}:{json:{result:{config:mode==='empty'?{}:{model:'fixture-model',approval_policy:'on-request',sandbox_mode:'workspace-write',api_key:'CONFIG_SECRET'},origins:{model:{name:{type:'user',file:'/remote/.codex/config.toml'},version:'v1'}},layers:mode==='empty'?[]:[{name:{type:'user',file:'/remote/.codex/config.toml'},version:'v1',config:{profiles:{careful:{model:'fixture-model',api_key:'PROFILE_SECRET'}}}}]}}}
   }
   if(body.method==='configRequirements/read')return {json:{result:{requirements:mode==='empty'?null:{allowed_sandbox_modes:['read-only'],allowed_login_methods:[],additional_developer_instructions:'HIDDEN'}}}}
  })
  assert.equal(calls.some(c=>c.params?.includeLayers||c.method==='configRequirements/read'),false)
  await page.getByText('Configuration inspection',{exact:true}).click();await page.getByRole('button',{name:'Read configuration',exact:true}).click();await page.getByText('sandbox_mode: workspace-write',{exact:true}).waitFor()
  await page.getByText('Configuration layers',{exact:true}).click();await page.getByText('Named profiles (public settings)',{exact:true}).click();await page.getByText('careful',{exact:true}).waitFor();await page.getByText('Managed restrictions',{exact:true}).click()
  assert.doesNotMatch(await page.locator('.config-inspection').textContent(),/CONFIG_SECRET|PROFILE_SECRET|HIDDEN/)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-23-${width}-${theme}.png`})}
  mode='empty';await page.getByRole('button',{name:'Read configuration',exact:true}).click();await page.getByText('No managed requirements returned.',{exact:true}).waitFor()
  mode='error';await page.getByRole('button',{name:'Read configuration',exact:true}).click();await page.getByRole('alert').filter({hasText:'Configuration unavailable'}).waitFor()
  mode='delayed';await page.getByRole('button',{name:'Read configuration',exact:true}).click();await page.waitForTimeout(150);emit('app-server/disconnected',{});await page.waitForTimeout(100);release();await page.waitForTimeout(150)
  assert.equal(await page.getByText('sandbox_mode: workspace-write',{exact:true}).count(),0)
  assert.equal(calls.some(c=>/config\/(value|batch)\/write|experimentalFeature\/enablement\/set/.test(c.method)),false);assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 23 effective/layers/origins/profiles/managed restrictions, secret projection, lazy empty/error/disconnect; six views, no writes')
})().catch(e=>{console.error(e);process.exit(1)})
