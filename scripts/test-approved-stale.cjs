const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 const cases=[
  {id:'12',summary:'Current Git working tree',button:'Refresh working tree',method:'command/exec',result:{exitCode:0,stdout:'?? STALE_PATH\0',stderr:''},panel:'.working-tree-panel',absent:'STALE_PATH'},
  {id:'08',summary:'Background processes',button:'Refresh background processes',method:'thread/backgroundTerminals/list',result:{data:[{processId:'42',itemId:'stale',command:'STALE_PROCESS',cwd:'/remote'}],nextCursor:null},panel:'.background-terminals',absent:'STALE_PROCESS'},
  {id:'20',summary:'Memory status',button:'Read memory status',method:'thread/memory/read',result:{summary:'STALE_MEMORY'},panel:'.memory-status',absent:'STALE_MEMORY'},
  {id:'18',summary:'Apps / Connectors',button:'Refresh available Apps',method:'app/list',result:{data:[{id:'stale',name:'STALE_APP',isAccessible:true,isEnabled:true}],nextCursor:null},panel:'.apps-picker',absent:'STALE_APP'},
  {id:'31',summary:'Codex Remote Control status',button:'Read Remote Control status',method:'remoteControl/status/read',result:{status:'connected',serverName:'STALE_REMOTE',environmentId:'stale'},panel:'.remote-control-status',absent:'STALE_REMOTE',settings:true},
  {id:'16',summary:'MCP configuration switches',button:'Read MCP configuration',method:'config/read',filter:b=>b.params?.includeLayers,result:{layers:[{name:{type:'user',file:'/remote/config.toml'},version:'v1',config:{mcp_servers:{STALE_MCP:{enabled:true}}}}]},panel:'.mcp-configuration',absent:'STALE_MCP',skills:true},
  {id:'17',summary:'Curated plugin collection',button:'Read curated plugins',method:'plugin/list',result:{marketplaces:[{name:'stale',plugins:[{id:'stale',name:'STALE_PLUGIN'}]}]},panel:'.curated-plugins',absent:'STALE_PLUGIN',skills:true},
 ]
 for(const c of cases){
  const page=await browser.newPage({viewport:{width:1280,height:900}});let release,began=false
  const {emit,errors}=await setup(page,async body=>{
   if(body.method===c.method&&(!c.filter||c.filter(body))){began=true;await new Promise(resolve=>release=resolve);return {json:{result:c.result}}}
   if(body.method==='memory/status')return {json:{result:{v2Ready:true,v2ConsolidatedThreads:1}}}
  })
  await page.waitForTimeout(700)
  if(c.settings)await page.getByRole('button',{name:'Settings',exact:true}).click()
  if(c.skills)await page.getByRole('button',{name:'Skills',exact:true}).click()
  await page.getByText(c.summary,{exact:true}).click();await page.getByRole('button',{name:c.button,exact:true}).click()
  for(let i=0;!began&&i<100;i++)await page.waitForTimeout(20)
  assert.ok(began,c.id+' request began')
  emit('app-server/disconnected',{});await page.waitForTimeout(200);release();await page.waitForTimeout(500)
  assert.ok(!(await page.locator(c.panel).innerText()).includes(c.absent),c.id+' stale response must be discarded')
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS stale-connection result rejection: 12, 08, 20, 18, 31, 16, 17')
})().catch(e=>{console.error(e);process.exit(1)})
