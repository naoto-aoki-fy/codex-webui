const {chromium}=require('playwright')
const {setup,assert,thread}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let mode='local',finish
  const {calls,errors,emit}=await setup(page,async body=>{
   if(body.method==='thread/read'&&body.params.includeTurns===false)return {json:{result:{thread:{...thread,environments:mode==='remote'?[{environmentId:'remote',cwd:thread.cwd}]:[{environmentId:'local',cwd:thread.cwd}]}}}}
   if(body.method==='environment/info')return {json:{result:{shell:{name:'sh',path:'/bin/sh'},cwd:'file:///server'}}}
   if(body.method==='command/exec'){
    if(mode==='reject')return {status:502,json:{error:'Managed sandbox restriction',rpcCode:-32600}}
    if(mode==='unknown')return {status:502,json:{error:'fixture internal failure token=SECRET',rpcCode:-32603}}
    return await new Promise(resolve=>finish=resolve)
   }
   if(body.method==='command/exec/terminate')return {json:{result:{}}}
  })
  await page.getByText('Standalone native command (read-only)',{exact:true}).click()
  const inspect=page.getByRole('button',{name:'Inspect native command context',exact:true}),run=page.getByRole('button',{name:'Execute confirmed read-only command',exact:true})
  mode='remote';await inspect.click();await page.getByText(/Exact local App Server environment\/cwd is unavailable/).waitFor();assert.equal(calls.some(c=>c.method==='command/exec'),false)
  mode='local';await inspect.click();await page.getByLabel('Standalone native shell command',{exact:true}).fill('printf fixture');assert.equal(await run.isDisabled(),true)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.locator('.native-shell').scrollIntoViewIfNeeded();await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-26-${width}-${theme}.png`})}
  async function confirm(){await page.getByRole('checkbox',{name:'I confirm this command, local App Server target, cwd and read-only permissions.'}).check();await run.click()}
  await confirm();await page.getByText(/Requested native read-only command/).waitFor();assert.equal(calls.filter(c=>c.method==='command/exec').length,1)
  const params=calls.find(c=>c.method==='command/exec').params;assert.deepEqual(params.sandboxPolicy,{type:'readOnly',networkAccess:false});assert.deepEqual(params.command,['/bin/sh','-c','printf fixture']);assert.equal(params.cwd,'/remote/project');assert.equal(params.timeoutMs,30000);assert.equal(params.outputBytesCap,65536)
  assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Inspect permanent deletion scope',exact:true,includeHidden:true}).isDisabled(),true)
  await page.getByRole('button',{name:'Terminate this standalone native process',exact:true}).click();await page.getByText(/Native termination requested for this exact/).waitFor();assert.deepEqual(calls.find(c=>c.method==='command/exec/terminate').params,{processId:params.processId})
  finish({json:{result:{exitCode:143,stdout:'<script>window.BAD=true</script> token=SECRET\n'+'x'.repeat(90000),stderr:''}}});await page.getByText(/Native process exited with code 143/).waitFor();await page.getByText('Native stdout preview',{exact:true}).click();assert.equal(await page.evaluate(()=>window.BAD),undefined);assert.equal((await page.locator('.native-shell').textContent()).includes('SECRET'),false)
  await inspect.click();await page.getByLabel('Standalone native shell command',{exact:true}).fill('pwd');mode='reject';await confirm();await page.getByText(/Native command rejected.*Managed sandbox/).waitFor()
  mode='unknown';await inspect.click();await page.getByLabel('Standalone native shell command',{exact:true}).fill('pwd');await confirm();await page.getByText(/Native command unknown/).waitFor();assert.equal(await inspect.isDisabled(),true);const before=calls.filter(c=>c.method==='command/exec').length
  emit('app-server/disconnected',{});await page.waitForTimeout(150);await page.getByText(/Original-connection command outcome unknown/).waitFor();assert.equal(calls.filter(c=>c.method==='command/exec').length,before);assert.equal(calls.some(c=>c.method==='thread/shellCommand'||c.method==='turn/start'||c.method==='turn/interrupt'),false);assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 26 verified local shell/cwd, explicit readonly native process/exit/termination, bounded safe output, remote rejection, unknown/disconnect/no replay and chat/deletion barriers; six views')
})().catch(e=>{console.error(e);process.exit(1)})
