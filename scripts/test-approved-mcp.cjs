const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let failure=false,enabled=true,version='v1'
  const {calls,errors}=await setup(page,body=>{
   if(body.method==='config/read'&&body.params.includeLayers)return {json:{result:{layers:[{name:{type:'user',file:'/remote/config.toml',profile:null},version,config:{mcp_servers:{demo:{enabled,env:{TOKEN:'FIXTURE_SECRET'}},unrelated:{command:'KEEP_SECRET'}}}}]}}}
   if(body.method==='config/value/write'){
    assert.deepEqual(body.params,{keyPath:'mcp_servers.demo.enabled',value:false,mergeStrategy:'upsert',filePath:'/remote/config.toml',expectedVersion:version})
    if(failure)return {status:502,json:{error:'Configuration version conflict'}}
    enabled=false;version='v2';return {json:{result:{status:'ok',version,filePath:'/remote/config.toml'}}}
   }
  },false)
  await page.waitForTimeout(700);const expand=page.getByRole('button',{name:'Expand sidebar',exact:true});if(await expand.count())await expand.click()
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Apps / Connectors',exact:true}).click();await page.getByText('MCP configuration switches',{exact:true}).click()
  assert.equal(calls.filter(c=>c.method==='config/read'&&c.params?.includeLayers).length,0)
  await page.getByRole('button',{name:'Read MCP configuration',exact:true}).click();await page.getByRole('button',{name:'Save disabled for demo',exact:true}).click()
  assert.equal(calls.some(c=>c.method==='config/value/write'),false)
  for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/approved-16-${width}-${theme}.png`})}
  await page.getByRole('button',{name:'Confirm MCP setting',exact:true}).click();await page.getByText('Saved configuration only.',{exact:false}).waitFor()
  assert.equal(calls.some(c=>c.method==='config/mcpServer/reload'),false)
  assert.ok(!(await page.locator('.mcp-configuration').innerText()).includes('FIXTURE_SECRET'))
  failure=true;await page.getByRole('button',{name:'Save disabled for demo',exact:true}).click();await page.getByRole('button',{name:'Confirm MCP setting',exact:true}).click();await page.getByRole('status').filter({hasText:'Configuration version conflict'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Save disabled for demo',exact:true}).count(),0)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 16: lazy config/version scope, exact scalar save, no secrets/reload, confirmation, conflict; matrix')
})().catch(e=>{console.error(e);process.exit(1)})
