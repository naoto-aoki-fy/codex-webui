const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let signedIn=false,id=0,cancelStatus='canceled'
  const {calls,errors,emit}=await setup(page,async(body,_,url)=>{
   if(url.pathname==='/codex-api/reconnect')return {json:{ok:true}}
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
  emit('account/updated',{authMode:'chatgpt'});await page.getByText(/Earlier account reads and sign-in preparation are invalid/).waitFor()
  await page.reload();await page.getByText('Fixture answer',{exact:true}).waitFor()
  assert.equal(await page.locator('.native-auth-barrier').count(),1)
  assert.equal(await page.locator('.thread-composer-input').isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).isDisabled(),true)
  const reopenedExpand=page.getByRole('button',{name:'Expand sidebar',exact:true});if(await reopenedExpand.count())await reopenedExpand.click()
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByText('Native Codex sign-in',{exact:true}).click()
  await page.getByRole('button',{name:'Open native authentication recovery controls',exact:true}).click();await page.getByText(/An earlier native authentication operation or account change needs reconciliation/).waitFor()
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.locator('.native-authentication').scrollIntoViewIfNeeded();await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/evidence-29-recovery-${width}-${theme}.png`})}
  assert.equal(calls.filter(c=>c.method==='account/login/start').length,2)
  const pendingMarker=await page.evaluate(()=>localStorage.getItem('codex-web-local.native-authentication-pending.v1'));assert.equal(pendingMarker,'1')
  await page.getByRole('button',{name:'Inspect current native account',exact:true}).click();await page.getByText(/Actual account: chatgpt/).waitFor()
  await page.getByRole('checkbox',{name:/I inspected the account and understand/}).check()
  await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Reconnect and reload account data',exact:true}).click()])
  await page.getByText('Fixture answer',{exact:true}).waitFor();assert.equal(await page.locator('.native-auth-barrier').count(),0)
  assert.equal(await page.evaluate(()=>localStorage.getItem('codex-web-local.native-authentication-pending.v1')),null)
  assert.equal(calls.filter(c=>c.method==='account/login/start').length,2);assert.equal(calls.some(c=>c.method==='turn/start'||c.method==='turn/steer'||c.method==='thread/queue/add'),false)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS native authentication: lazy reads, explicit browser/device login, exact cancellation/completion, memory-only code, cache barrier; six views')
})().catch(e=>{console.error(e);process.exit(1)})
