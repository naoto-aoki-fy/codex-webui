const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let mode='ok',release
  const {calls,errors,emit}=await setup(page,async body=>{
   if(body.method!=='externalAgentConfig/detect')return
   if(mode==='delayed')await new Promise(resolve=>release=resolve)
   if(mode==='error')return {status:502,json:{error:'Migration API unavailable'}}
   return {json:{result:{items:mode==='empty'?[]:[{itemType:'AGENTS_MD',description:'Migrate CLAUDE.md into /remote/project/AGENTS.md',cwd:'/remote/project'},{itemType:'SKILLS',description:'Excluded skill lifecycle',cwd:'/remote/project',details:{skills:[{name:'fixture-skill',secret:'SECRET'}]}}]}}}
  })
  assert.equal(calls.some(c=>c.method==='externalAgentConfig/detect'),false)
  await page.getByText('External-agent import preview',{exact:true}).click();await page.getByRole('button',{name:'Discover import candidates'}).click();await page.getByText('Migrate CLAUDE.md into /remote/project/AGENTS.md',{exact:true}).waitFor()
  await page.getByText('Skipped: extension outside this approved import scope.',{exact:true}).waitFor()
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-28-${width}-${theme}.png`})}
  const request=calls.find(c=>c.method==='externalAgentConfig/detect');assert.deepEqual(request.params,{cwds:['/remote/project'],includeHome:false,maxSessions:0,migrationSource:'claude-code'})
  mode='empty';await page.getByRole('button',{name:'Discover import candidates'}).click();await page.getByText('No candidates returned for this project and source.',{exact:true}).waitFor()
  mode='error';await page.getByRole('button',{name:'Discover import candidates'}).click();await page.getByRole('alert').filter({hasText:'Migration API unavailable'}).waitFor()
  mode='delayed';await page.getByRole('button',{name:'Discover import candidates'}).click();await page.waitForTimeout(150);emit('app-server/disconnected',{});await page.waitForTimeout(150);release();await page.waitForTimeout(150);assert.equal(await page.getByText('Migrate CLAUDE.md into /remote/project/AGENTS.md',{exact:true}).count(),0)
  assert.equal(calls.some(c=>c.method==='externalAgentConfig/import'),false);assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 28 lazy remote project-only manifest, exclusion labels, empty/error/disconnect, no imports; six views')
})().catch(e=>{console.error(e);process.exit(1)})
