const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let mode='ok',release
  const {calls,errors,emit}=await setup(page,async body=>{
   if(body.method!=='hooks/list')return
   if(mode==='delayed')await new Promise(resolve=>release=resolve)
   if(mode==='error')return {status:502,json:{error:'Hooks unsupported'}}
   return {json:{result:{data:[{cwd:'/remote/project',hooks:mode==='empty'?[]:[{key:'fixture-hook',eventName:'SessionStart',handlerType:'command',command:'echo <script>safe</script> token=PRIVATE_HOOK_TOKEN',source:'project',sourcePath:'/remote/project/.codex/hooks.json',enabled:false,isManaged:true,trustStatus:'untrusted',currentHash:'hash-fixture'}],warnings:[],errors:[]}]}}}
  })
  assert.equal(calls.some(c=>c.method==='hooks/list'),false)
  await page.getByText('Hooks inspection',{exact:true}).click();await page.getByRole('button',{name:'Read Hooks',exact:true}).click();await page.getByText('SessionStart · fixture-hook',{exact:true}).waitFor();await page.getByText('Hook definition and origin',{exact:true}).click()
  await page.getByText('Enabled: No · Managed: Yes · Trust: untrusted',{exact:true}).waitFor();assert.equal((await page.locator('.hooks-inspection').textContent()).includes('PRIVATE_HOOK_TOKEN'),false)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-21-${width}-${theme}.png`})}
  mode='empty';await page.getByRole('button',{name:'Read Hooks',exact:true}).click();await page.getByText('No Hooks returned for this scope.',{exact:true}).waitFor()
  mode='error';await page.getByRole('button',{name:'Read Hooks',exact:true}).click();await page.getByRole('alert').filter({hasText:'Hooks unsupported'}).waitFor()
  mode='delayed';await page.getByRole('button',{name:'Read Hooks',exact:true}).click();await page.waitForTimeout(100);await page.getByRole('button',{name:'Read Hooks',exact:true}).evaluate(el=>el.click());assert.equal(calls.filter(c=>c.method==='hooks/list').length,4)
  emit('app-server/disconnected',{});await page.waitForTimeout(100);release();await page.waitForTimeout(100);assert.equal(await page.getByText('SessionStart · fixture-hook',{exact:true}).count(),0)
  assert.equal(calls.some(c=>/hooks\//.test(c.method)&&c.method!=='hooks/list'),false);assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 21 native scoped definitions/trust/disabled/secret omission/empty/error/duplicate/disconnect; 6 views, no Hook writes or execution')
})().catch(e=>{console.error(e);process.exit(1)})
