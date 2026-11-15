const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let mode='ok',release
  const {calls,errors,emit}=await setup(page,async body=>{
   if(body.method==='account/read'){
    if(mode==='delayed')await new Promise(resolve=>release=resolve)
    if(mode==='error')return {status:502,json:{error:'Account unavailable'}}
    return {json:{result:{account:mode==='empty'?null:{type:'chatgpt',email:'fixture@example.invalid',planType:'plus',workspaceName:'Fixture workspace',accessToken:'SECRET_AUTH'},requiresOpenaiAuth:true}}}
   }
   if(body.method==='configRequirements/read')return {json:{result:{requirements:{allowed_login_methods:mode==='empty'?[]:['chatgpt','api']}}}}
  },false)
  await page.waitForTimeout(700);const expand=page.getByRole('button',{name:'Expand sidebar',exact:true});if(await expand.count())await expand.click()
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByText('Native authentication details',{exact:true}).click()
  const before=calls.filter(c=>c.method==='account/read').length
  await page.getByRole('button',{name:'Read authentication details'}).click();await page.getByText('fixture@example.invalid',{exact:true}).waitFor();await page.getByText('Allowed native login methods: chatgpt, api',{exact:true}).waitFor()
  assert.equal(calls.filter(c=>c.method==='account/read').length,before+1);assert.equal((await page.locator('.auth-inspection').textContent()).includes('SECRET_AUTH'),false)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.locator('.auth-inspection').scrollIntoViewIfNeeded();await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-29-${width}-${theme}.png`})}
  mode='empty';await page.getByRole('button',{name:'Read authentication details'}).click();await page.getByText('No login method allowed by current server policy.',{exact:true}).waitFor()
  mode='error';await page.getByRole('button',{name:'Read authentication details'}).click();await page.getByRole('alert').filter({hasText:'Account unavailable'}).waitFor()
  mode='delayed';await page.getByRole('button',{name:'Read authentication details'}).click();await page.waitForTimeout(150);emit('app-server/disconnected',{});await page.waitForTimeout(100);release();await page.waitForTimeout(150);assert.equal(await page.getByText('fixture@example.invalid',{exact:true}).count(),0)
  assert.equal(calls.some(c=>c.method==='account/login/start'),false);assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 29 actual account and login policy, secret omission, empty/error/disconnect, no login; six views')
})().catch(e=>{console.error(e);process.exit(1)})
