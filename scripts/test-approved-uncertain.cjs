const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const kind of ['process','config']){
  const page=await browser.newPage({viewport:{width:1280,height:900}});let release,began=false
  const method=kind==='process'?'thread/backgroundTerminals/terminate':'config/value/write'
  const {calls,emit,errors}=await setup(page,async body=>{
   if(body.method===method){began=true;await new Promise(resolve=>release=resolve);return {json:{result:kind==='process'?{terminated:true}:{status:'ok',version:'v2',filePath:'/remote/config.toml'}}}}
   if(body.method==='thread/backgroundTerminals/list')return {json:{result:{data:[{processId:'42',itemId:'cmd',command:'fixture process',cwd:'/remote'}],nextCursor:null}}}
   if(body.method==='config/read'&&body.params?.includeLayers)return {json:{result:{layers:[{name:{type:'user',file:'/remote/config.toml'},version:'v1',config:{mcp_servers:{demo:{enabled:true}}}}]}}}
  },kind==='process')
  await page.waitForTimeout(700)
  if(kind==='process'){
   await page.getByText('Background processes',{exact:true}).click();await page.getByRole('button',{name:'Refresh background processes',exact:true}).click();await page.getByRole('button',{name:'Terminate process 42',exact:true}).click();await page.getByRole('button',{name:'Confirm termination 42',exact:true}).click()
  }else{
   await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Apps / Connectors',exact:true}).click();await page.getByText('MCP configuration switches',{exact:true}).click();await page.getByRole('button',{name:'Read MCP configuration',exact:true}).click();await page.getByRole('button',{name:'Save disabled for demo',exact:true}).click();await page.getByRole('button',{name:'Confirm MCP setting',exact:true}).click()
  }
  for(let i=0;!began&&i<100;i++)await page.waitForTimeout(20);assert.ok(began)
  emit('app-server/disconnected',{});await page.waitForTimeout(200);release();await page.waitForTimeout(500)
  const panel=page.locator(kind==='process'?'.background-terminals':'.mcp-configuration')
  assert.ok((await panel.innerText()).includes('outcome unknown'))
  assert.ok(!(await panel.innerText()).includes(kind==='process'?'Process termination acknowledged.':'Saved configuration only.'))
  assert.equal(calls.filter(c=>c.method===method).length,1)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS uncertain process/config mutations: connection invalidation, no stale success, no automatic retry')
})().catch(e=>{console.error(e);process.exit(1)})
