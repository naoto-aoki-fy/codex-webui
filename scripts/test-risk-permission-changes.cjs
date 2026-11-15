const {chromium}=require('playwright')
const {setup,assert,thread}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let mode='ok',effective={cwd:'/remote/project',approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:{type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true},activePermissionProfile:{id:':workspace'}}
  const {calls,errors,emit}=await setup(page,body=>{
   if(body.method==='thread/resume')return {json:{result:{thread:{...thread,turns:[{id:'t',status:'completed',items:[{type:'userMessage',id:'u',content:[{type:'text',text:'Fixture request'}]},{type:'agentMessage',id:'a',text:'Fixture answer'}]}]},model:'fixture-model',modelProvider:'fixture',...effective}}}
   if(body.method==='configRequirements/read')return {json:{result:{requirements:{allowed_approval_policies:mode==='managed'?[]:['on-request','never'],allowed_sandbox_modes:mode==='managed'?['read-only']:null,allowed_permission_profiles:null}}}}
   if(body.method==='thread/settings/update'){
    if(mode==='reject')return {status:502,json:{error:'Managed permission restriction',rpcCode:-32600}}
    if(mode==='lost')return {status:502,json:{error:'Permission reply lost'}}
    effective={...effective,...(body.params.approvalPolicy?{approvalPolicy:body.params.approvalPolicy}:{}),...(body.params.sandboxPolicy?{sandbox:body.params.sandboxPolicy}:{})};return {json:{result:{}}}
   }
  })
  await page.getByText('Permissions inspection',{exact:true}).click();await page.getByRole('button',{name:'Read permission restrictions'}).click();await page.getByRole('button',{name:'Keep approval policy',exact:true}).click();await page.getByRole('button',{name:'Never request approval',exact:true}).click();await page.getByRole('button',{name:'Keep sandbox policy',exact:true}).click();await page.getByRole('button',{name:'Full access · unrestricted filesystem and network',exact:true}).click()
  const apply=page.getByRole('button',{name:'Apply confirmed thread permissions',exact:true});assert.equal(await apply.isDisabled(),true)
  await page.getByRole('checkbox',{name:"I confirm this thread's permission changes, including any broader access or reduced approval oversight."}).check();await apply.click();await page.getByText('Accepted; waiting for matching effective native settings.',{exact:true}).waitFor();await apply.evaluate(el=>el.click());assert.equal(calls.filter(c=>c.method==='thread/settings/update').length,1)
  emit('thread/settings/updated',{threadId:'other',threadSettings:{...effective,sandboxPolicy:effective.sandbox}});await page.waitForTimeout(100);await page.getByText('Accepted; waiting for matching effective native settings.',{exact:true}).waitFor()
  emit('thread/settings/updated',{threadId:'approved-fixture',threadSettings:{...effective,sandboxPolicy:effective.sandbox}});await page.getByText('Completed: matching effective native thread settings observed.',{exact:false}).waitFor()
  assert.deepEqual(calls.find(c=>c.method==='thread/settings/update').params,{threadId:'approved-fixture',approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}})
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.locator('.permissions-inspection').scrollIntoViewIfNeeded();await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-03-changes-${width}-${theme}.png`})}
  await page.reload();await page.getByText('Fixture answer',{exact:true}).waitFor();await page.getByText('Conversation tools',{exact:true}).click();await page.getByText('Permissions inspection',{exact:true}).click();await page.getByText('Approval policy: never · Reviewer: user',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Read permission restrictions'}).click();await page.getByRole('button',{name:'Keep approval policy',exact:true}).click();await page.getByRole('button',{name:'On request',exact:true}).click();await page.getByRole('checkbox',{name:/I confirm this thread's permission changes/}).check();mode='reject';await apply.click();await page.getByText('Permission update rejected.',{exact:false}).waitFor()
  mode='lost';await page.getByRole('checkbox',{name:/I confirm this thread's permission changes/}).check();await apply.click();await page.getByText('Permission update unknown.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).isDisabled(),true)
  emit('thread/settings/updated',{threadId:'approved-fixture',threadSettings:{...effective,approvalPolicy:'on-request',sandboxPolicy:effective.sandbox}});await page.getByRole('button',{name:'Reconcile fresh observed permissions',exact:true}).click();await page.getByText('Reconciled: requested effective native settings are now observed.',{exact:true}).waitFor()
  mode='managed';await page.getByRole('button',{name:'Read permission restrictions'}).click();await page.getByRole('button',{name:'Keep sandbox policy',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Full access · unrestricted filesystem and network',exact:true}).count(),0)
  assert.equal(calls.some(c=>c.method==='config/value/write'),false);assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 03 confirmed native permission changes, ack/event ordering, managed restrictions, refresh persistence, rejection/unknown/reconciliation, send lock; six views')
})().catch(e=>{console.error(e);process.exit(1)})
