const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true}),key='/remote/project/hooks.json:SessionStart:0:0'
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let state={enabled:true},version='v1',mode='ok'
  const native={key,eventName:'SessionStart',handlerType:'command',command:'echo fixture token=SECRET_HOOK',source:'project',sourcePath:'/remote/project/hooks.json',enabled:true,isManaged:false,trustStatus:'untrusted',currentHash:'sha256:fixture'}
  const {calls,errors}=await setup(page,body=>{
   if(body.method==='hooks/list'){assert.deepEqual(body.params,{threadId:'approved-fixture'});return {json:{result:{data:[{cwd:'/remote/project',hooks:[native],warnings:[],errors:[]}]}}}}
   if(body.method==='config/read'&&body.params.includeLayers)return {json:{result:{config:{},layers:[{name:{type:'user',file:'/remote/config.toml',profile:null},version,config:{hooks:{state:{[key]:state,'unrelated:SessionStart:0:0':{enabled:true,trusted_hash:'keep'}}},secret:'DO_NOT_ECHO'}}]}}}
   if(body.method==='config/value/write'){
    if(mode==='reject')return {status:502,json:{error:'Configuration version changed',rpcCode:-32600}}
    assert.equal(body.params.expectedVersion,version);assert.equal(body.params.keyPath,'hooks.state');assert.deepEqual(Object.keys(body.params.value),[key]);state={...state,...body.params.value[key]};version='v'+(Number(version.slice(1))+1)
    if(mode==='lost')return {status:502,json:{error:'Policy reply lost',rpcCode:-32603}}
    return {json:{result:{status:'ok',version,filePath:'/remote/config.toml'}}}
   }
  })
  await page.getByText('Hooks inspection',{exact:true}).click();await page.getByRole('button',{name:'Read Hooks',exact:true}).click();await page.getByRole('button',{name:'Read saved Hook policies',exact:true}).click();await page.getByRole('button',{name:'Prepare disabled Hook policy',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'Save confirmed Hook policy'}).isDisabled(),true)
  await page.getByRole('checkbox',{name:'I reviewed this Hook definition, origin, exact hash and affected configuration scope.'}).check();await page.getByRole('button',{name:'Save confirmed Hook policy'}).click();await page.getByText('Saved Hook policy verified.',{exact:false}).waitFor();assert.equal(state.enabled,false)
  await page.getByText('Enabled: Yes · Managed: No · Trust: untrusted',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Read saved Hook policies',exact:true}).click();await page.getByRole('button',{name:'Review Hook definition trust',exact:true}).click();assert.doesNotMatch(await page.locator('.hooks-inspection').textContent(),/SECRET_HOOK|DO_NOT_ECHO/)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.locator('.hooks-inspection').scrollIntoViewIfNeeded();await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-21-policies-${width}-${theme}.png`})}
  await page.getByRole('checkbox',{name:/I reviewed this Hook definition/}).check();await page.getByRole('button',{name:'Save confirmed Hook policy'}).click();await page.getByText('Saved Hook policy verified.',{exact:false}).waitFor();assert.equal(state.trusted_hash,'sha256:fixture');assert.equal(state.enabled,false)
  await page.getByRole('button',{name:'Read saved Hook policies',exact:true}).click();mode='lost';await page.getByRole('button',{name:'Prepare enabled Hook policy',exact:true}).click();await page.getByRole('checkbox',{name:/I reviewed this Hook definition/}).check();await page.getByRole('button',{name:'Save confirmed Hook policy'}).click();await page.getByText('Hook policy outcome unknown.',{exact:false}).waitFor()
  const count=calls.filter(c=>c.method==='config/value/write').length;await page.getByRole('button',{name:'Read saved Hook policies',exact:true}).click();await page.getByRole('button',{name:'Acknowledge inspected Hook policy outcome',exact:true}).click();assert.equal(calls.filter(c=>c.method==='config/value/write').length,count)
  assert.equal(calls.some(c=>c.method==='config/batchWrite'||c.method==='thread/resume'&&c.params.cwd),false);assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 21 future-load Hook enable/disable/trust policies, exact key/hash/version, preserved fields, saved vs loaded and unknown outcome; six views')
})().catch(e=>{console.error(e);process.exit(1)})
