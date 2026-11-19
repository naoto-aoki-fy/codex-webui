const {chromium}=require('playwright')
const {readFileSync}=require('node:fs')
const {transpileModule,ModuleKind}=require('typescript')
const {setup,assert}=require('./approved-fixture.cjs')
// Exercise the production backend state machine with a simulated upstream protocol.
// This is not OAuth or live App Server validation.
const backendModule={exports:{}}
new Function('exports','require','module',transpileModule(readFileSync(require('node:path').join(__dirname,'../src/server/nativeAuthenticationState.ts'),'utf8'),{compilerOptions:{module:ModuleKind.CommonJS,target:9}}).outputText)(backendModule.exports,require,backendModule)
const {NativeAuthenticationStateMachine}=backendModule.exports
const until=async(test)=>{for(let i=0;i<150;i++){if(test())return;await new Promise(r=>setTimeout(r,20))}throw new Error('Timed out waiting for backend state')}
;(async()=>{
 const browser=await chromium.launch({headless:true})
 try{for(const width of [1280,375,768]){
  let signedIn=false,id=0,workspace='workspace-1',hold=false
  const queued=[],upstreamCalls=[],clients=[]
  const account=()=>({account:signedIn?{type:'chatgpt',email:'fixture@example.invalid',workspaceName:'Same display name',planType:'plus'}:null,requiresOpenaiAuth:true})
  const upstream=async(method,params)=>{
   upstreamCalls.push(method)
   if(method==='account/read'){if(hold)return new Promise(resolve=>queued.push(()=>resolve(account())));return account()}
   if(method==='accountSession/list')return {activeSessionId:'session-1',sessions:[{sessionId:'session-1',isActive:true,userId:'user-1',selectedWorkspaceAccountId:workspace}]}
   if(method==='account/login/start')return params.type==='chatgptDeviceCode'?{type:params.type,loginId:`fixture-${++id}`,verificationUrl:'https://example.invalid/login',userCode:'FIXTURE-DEVICE-CODE'}:{type:params.type,loginId:`fixture-${++id}`,authUrl:'https://example.invalid/login'}
   if(method==='account/login/cancel')return {status:'canceled'}
   throw new Error('Unexpected simulated upstream method')
  }
  const auth=new NativeAuthenticationStateMachine(upstream,state=>clients.forEach(c=>c.emit('native-authentication/state',state)))
  const notify=(method,params)=>{auth.observe(method,params);clients.forEach(c=>c.emit(method,params))}
  const attach=async()=>{
   const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
   const client=await setup(page,async(body)=>{
    try{
     let result
     if(body.method==='native-authentication/read')result=await auth.read()
     else if(body.method==='native-authentication/reconcile')result=await auth.reconcile()
     else if(body.method==='account/login/start')result=await auth.start(body.params)
     else if(body.method==='account/login/cancel')result=await auth.cancel(body.params)
     else if(body.method==='account/read')result=account()
     else if(body.method==='configRequirements/read')result={requirements:{allowed_login_methods:['chatgpt']}}
     else if(body.method==='thread/loaded/list')result={data:['approved-fixture'],nextCursor:null}
     else return
     return {json:{result}}
    }catch(e){return {status:502,json:{error:e.message,rpcCode:e.code}}}
   },false)
   Object.assign(client,{page});clients.push(client);client.emit('ready',{ok:true});return client
  }
  const first=await attach(),page=first.page
  const ready=async()=>{await until(()=>auth.snapshot().phase==='ready');await page.waitForFunction(()=>document.querySelector('.thread-composer-input')?.disabled===false)}
  const settings=async()=>{
   const expand=page.getByRole('button',{name:'Expand sidebar',exact:true});if(await expand.count())await expand.click()
   await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByText('Native Codex sign-in',{exact:true}).click()
  }
  const prepare=async()=>{await page.getByRole('button',{name:'Prepare native sign-in',exact:true}).click();await page.getByText(/Loaded idle threads: 1/).waitFor()}
  const start=async()=>{await page.getByLabel('I confirm native sign-in on this App Server and replacement of any pending login attempt.').check();await page.getByRole('button',{name:'Start confirmed native sign-in'}).click();await page.getByRole('link',{name:'Open native sign-in page'}).waitFor()}
  const reload=async()=>{await page.reload();await page.getByText('Fixture answer',{exact:true}).waitFor();await page.waitForTimeout(250);first.emit('ready',{ok:true,reconnected:true})}
  await until(()=>auth.snapshot().phase==='signedOut');await settings();await prepare();await start()
  notify('account/updated',{authMode:'chatgpt'});await until(()=>auth.snapshot().reason==='authentication-operation-unresolved')
  assert.equal(auth.snapshot().loginId,'fixture-1')
  await reload();await settings();await page.getByRole('button',{name:'Open native authentication recovery controls',exact:true}).click()
  assert.equal(await page.getByRole('link',{name:'Open native sign-in page'}).count(),0)
  await page.getByRole('button',{name:'Cancel identified native sign-in'}).click();await until(()=>auth.snapshot().phase==='signedOut')
  await prepare();await page.locator('.native-authentication').getByRole('button',{name:'ChatGPT browser sign-in'}).click();await page.getByRole('button',{name:'ChatGPT device-code sign-in',exact:true}).click();await start()
  await page.getByText('FIXTURE-DEVICE-CODE',{exact:true}).waitFor()
  notify('account/login/completed',{loginId:'unrelated',success:true});assert.equal(auth.snapshot().phase,'pending')
  signedIn=true;notify('account/login/completed',{loginId:'fixture-2',success:true});await ready()
  await page.getByText('Native account verified by the backend. Sending is available.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Reconnect and reload account data'}).count(),0)
  assert.equal(await page.getByText('FIXTURE-DEVICE-CODE',{exact:true}).count(),0)
  await page.keyboard.press('Escape')
  const second=width===1280?await attach():null
  const before=upstreamCalls.filter(m=>m==='account/read').length
  for(let i=0;i<20;i++)notify('account/updated',{authMode:'chatgpt',planType:'plus'})
  assert.equal(auth.snapshot().phase,'checking');await ready()
  assert.equal(upstreamCalls.filter(m=>m==='account/read').length-before,1,'one upstream read for the notification burst')
  if(second)await second.page.waitForFunction(()=>document.querySelector('.thread-composer-input')?.disabled===false)
  // Reload while verification is in flight. No manual recovery action is used.
  await page.evaluate(()=>{localStorage.setItem('codex-web-local.native-authentication-pending.v1','1');localStorage.setItem('auth-test-unrelated','keep')})
  hold=true;notify('account/updated',{authMode:'chatgpt'});await until(()=>queued.length>0)
  await reload();assert.equal(await page.locator('.thread-composer-input').isDisabled(),true)
  hold=false;queued.splice(0).forEach(resolve=>resolve());await ready()
  assert.equal(await page.evaluate(()=>localStorage.getItem('codex-web-local.native-authentication-pending.v1')),'1')
  assert.equal(await page.evaluate(()=>localStorage.getItem('auth-test-unrelated')),'keep')
  // A late raw notification cannot recreate a frontend latch after verification.
  first.emit('account/updated',{authMode:'chatgpt'});await page.waitForTimeout(100)
  assert.equal(await page.locator('.native-auth-barrier').count(),0)
  for(const theme of ['light','dark']){
   await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200)
   await page.screenshot({path:`output/playwright/auth-auto-ready-${width}-${theme}.png`})
  }
  workspace='workspace-2';notify('account/updated',{authMode:'chatgpt'});await until(()=>auth.snapshot().phase==='reconciliation')
  assert.equal(auth.snapshot().reason,'account-context-changed')
  await page.waitForFunction(()=>document.querySelector('.thread-composer-input')?.disabled===true)
  await settings();await page.getByRole('button',{name:'Open native authentication recovery controls',exact:true}).click()
  await page.getByRole('button',{name:'Inspect current native account',exact:true}).waitFor();await page.getByRole('button',{name:'Retry account verification',exact:true}).waitFor()
  for(const theme of ['light','dark']){
   await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.locator('.native-authentication').scrollIntoViewIfNeeded();await page.waitForTimeout(2200)
   await page.screenshot({path:`output/playwright/auth-context-change-${width}-${theme}.png`})
  }
  for(const client of clients){assert.deepEqual(client.errors,[]);assert.equal(client.calls.some(c=>c.path==='/codex-api/reconnect'||c.method==='native-authentication/reconcile'||c.method==='turn/start'),false);await client.page.close()}
  auth.dispose();console.log(`PASS ${width}px: automatic login/update/reload recovery, coalesced burst, retained pending ID, explicit workspace-change block; no manual recovery or message replay`)
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)})
