const {chromium}=require('playwright')
const {setup,assert,openToolsDialog}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let version='v1',model='profile-model',mode='ok'
  const untouched={secret:'DO_NOT_ECHO',unknown:{preserve:true},profiles:{legacy:{model:'legacy-keep'}}}
  const {calls,errors}=await setup(page,body=>{
   if(body.method==='config/read'&&body.params.includeLayers)return {json:{result:{config:{model:'project-override',api_key:'DO_NOT_ECHO'},origins:{},layers:[{name:{type:'user',file:'/remote/work.config.toml',profile:'work'},version,config:{model,...untouched}},{name:{type:'user',file:'/remote/config.toml',profile:null},version:'base-v',config:{model:'base-keep',secret:'DO_NOT_ECHO'}}]}}}
   if(body.method==='configRequirements/read')return {json:{result:{requirements:null}}}
   if(body.method==='config/value/write'){
    assert.deepEqual(Object.keys(body.params).sort(),['expectedVersion','filePath','keyPath','mergeStrategy','value'].sort());assert.equal(body.params.keyPath,'model');assert.equal(body.params.filePath,'/remote/work.config.toml')
    if(mode==='conflict')return {status:502,json:{error:'Configuration version conflict',rpcCode:-32600}}
    assert.equal(body.params.expectedVersion,version);model=body.params.value;version='v'+(Number(version.slice(1))+1)
    if(mode==='lost')return {status:502,json:{error:'Configuration reply lost',rpcCode:-32603}}
    return {json:{result:{status:'okOverridden',version,filePath:'/remote/work.config.toml'}}}
   }
  })
  await page.getByText('Configuration inspection',{exact:true}).click();await page.getByRole('button',{name:'Read configuration',exact:true}).click();await page.getByText('Active user configuration model defaults',{exact:true}).click()
  await page.getByRole('textbox',{name:'User configuration model default',exact:true}).fill('new-profile-model');assert.equal(await page.getByRole('button',{name:'Save confirmed model default'}).isDisabled(),true)
  await page.getByRole('checkbox',{name:'I confirm the shown user configuration file and its effects on future defaults.'}).check();await page.getByRole('button',{name:'Save confirmed model default'}).click();await page.getByText('Completed: saved user-layer value verified.',{exact:false}).waitFor();await page.getByText('model: project-override',{exact:true}).waitFor()
  assert.equal(calls.filter(c=>c.method==='config/value/write').length,1);assert.doesNotMatch(await page.locator('.config-inspection').textContent(),/DO_NOT_ECHO/)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.locator('.config-inspection').scrollIntoViewIfNeeded();await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-23-changes-${width}-${theme}.png`})}
  await page.reload();await page.getByText('Fixture answer',{exact:true}).waitFor();await openToolsDialog(page);await page.getByText('Configuration inspection',{exact:true}).click();await page.getByRole('button',{name:'Read configuration',exact:true}).click();await page.getByText('Active user configuration model defaults',{exact:true}).click();await page.getByText('Saved model: new-profile-model',{exact:false}).waitFor()
  mode='conflict';await page.getByRole('textbox',{name:'User configuration model default',exact:true}).fill('conflict-model');await page.getByRole('checkbox',{name:/I confirm the shown user configuration file/}).check();await page.getByRole('button',{name:'Save confirmed model default'}).click();await page.getByText('Configuration write rejected.',{exact:false}).waitFor();assert.equal(model,'new-profile-model')
  await page.getByRole('button',{name:'Read configuration',exact:true}).click();await page.getByText('Active user configuration model defaults',{exact:true}).click();mode='lost';await page.getByRole('textbox',{name:'User configuration model default',exact:true}).fill('uncertain-model');await page.getByRole('checkbox',{name:/I confirm the shown user configuration file/}).check();await page.getByRole('button',{name:'Save confirmed model default'}).click();await page.getByText('Configuration write outcome unknown.',{exact:false}).waitFor()
  const count=calls.filter(c=>c.method==='config/value/write').length;await page.getByRole('button',{name:'Read configuration',exact:true}).click();await page.getByRole('button',{name:'Acknowledge inspected configuration outcome',exact:true}).click();assert.equal(calls.filter(c=>c.method==='config/value/write').length,count);assert.equal(untouched.secret,'DO_NOT_ECHO');assert.equal(untouched.profiles.legacy.model,'legacy-keep');assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 23 targeted active-profile model write, native version/conflict/unknown reconciliation, saved/effective distinction and reload; six views')
})().catch(e=>{console.error(e);process.exit(1)})
