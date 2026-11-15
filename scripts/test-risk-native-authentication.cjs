const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let signedIn=false,id=0,cancelStatus='canceled'
  const {calls,errors,emit}=await setup(page,async body=>{
   if(body.method==='account/read')return {json:{result:{account:signedIn?{type:'chatgpt',email:'native@example.invalid',planType:'plus'}:null,requiresOpenaiAuth:true}}}
   if(body.method==='configRequirements/read')return {json:{result:{requirements:{allowed_login_methods:['chatgpt']}}}}
   if(body.method==='thread/loaded/list')return {json:{result:{data:['approved-fixture'],nextCursor:null}}}
   if(body.method==='account/login/start')return {json:{result:body.params.type==='chatgptDeviceCode'?{type:'chatgptDeviceCode',loginId:`fixture-${++id}`,verificationUrl:'https://auth.openai.com/fixture-only',userCode:'FIXTURE-DEVICE-CODE'}:{type:'chatgpt',loginId:`fixture-${++id}`,authUrl:'https://auth.openai.com/fixture-only?state=FIXTURE-ONLY'}}}
   if(body.method==='account/login/cancel')return {json:{result:{status:cancelStatus}}}
  },false)
  await page.waitForTimeout(500);const expand=page.getByRole('button',{name:'Expand sidebar',exact:true});if(await expand.count())await expand.click()
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByText('Native Codex sign-in',{exact:true}).click()
  assert.equal(calls.some(c=>c.method==='thread/loaded/list'),false)
  async function prepare(){await page.getByRole('button',{name:'Prepare native sign-in',exact:true}).click();await page.getByText(/Loaded idle threads: 1/).waitFor()}
  async function start(){await page.getByLabel('I confirm native sign-in on this App Server and replacement of any pending login attempt.').check();await page.getByRole('button',{name:'Start confirmed native sign-in'}).click();await page.getByRole('link',{name:'Open native sign-in page'}).waitFor()}
  await prepare();await start();assert.equal(calls.filter(c=>c.method==='account/login/start').length,1)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.locator('.native-authentication').scrollIntoViewIfNeeded();await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-29-workflow-${width}-${theme}.png`})}
  assert.equal(await page.getByRole('button',{name:'Start confirmed native sign-in'}).count(),0)
  await page.getByRole('button',{name:'Cancel identified native sign-in'}).click();await page.getByText(/Native login cancellation acknowledged/).waitFor()
  assert.deepEqual(calls.find(c=>c.method==='account/login/cancel').params,{loginId:'fixture-1'})
  await prepare();await page.locator('.native-authentication').getByRole('button',{name:'ChatGPT browser sign-in'}).click();await page.getByRole('button',{name:'ChatGPT device-code sign-in',exact:true}).click();await start();await page.getByText('FIXTURE-DEVICE-CODE',{exact:true}).waitFor()
  const storage=await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]));assert.equal(storage.includes('FIXTURE-DEVICE-CODE'),false)
  emit('account/login/completed',{loginId:'other',success:true});await page.waitForTimeout(100);assert.equal(await page.getByText('FIXTURE-DEVICE-CODE',{exact:true}).count(),1)
  signedIn=true;emit('account/login/completed',{loginId:'fixture-2',success:true});await page.getByText(/Native sign-in completed and ChatGPT account state verified/).waitFor();assert.equal(await page.getByText('FIXTURE-DEVICE-CODE',{exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'Reconnect and reload account data'}).isEnabled(),true)
  assert.equal(await page.locator('.native-auth-barrier').count(),1)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS native authentication: lazy reads, explicit browser/device login, exact cancellation/completion, memory-only code, cache barrier; six views')
})().catch(e=>{console.error(e);process.exit(1)})
