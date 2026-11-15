const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let mode='ok',release
  const {calls,errors,emit}=await setup(page,async body=>{
   if(body.method==='configRequirements/read'){
    if(mode==='delayed')await new Promise(resolve=>release=resolve)
    return mode==='error'?{status:502,json:{error:'Restrictions unavailable'}}:{json:{result:{requirements:mode==='empty'?null:{allowed_sandbox_modes:['read-only'],allowed_approval_policies:['on-request']}}}}
   }
  })
  const resumes=calls.filter(c=>c.method==='thread/resume').length
  await page.getByText('Permissions inspection',{exact:true}).click();await page.getByText('Effective thread permissions: Unknown.',{exact:false}).waitFor()
  emit('thread/settings/updated',{threadId:'approved-fixture',threadSettings:{cwd:'/remote/project',approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'workspaceWrite',writableRoots:['/remote/project'],networkAccess:false},activePermissionProfile:{id:'workspace-write',title:'Workspace write'}}})
  await page.getByText('Approval policy: on-request · Reviewer: user',{exact:true}).waitFor();await page.getByText('Sandbox restrictions and writable scope',{exact:true}).click();await page.getByText('Active permission profile',{exact:true}).click()
  await page.getByRole('button',{name:'Read permission restrictions'}).click();await page.locator('.permissions-inspection pre').filter({hasText:'allowed_sandbox_modes'}).waitFor()
  assert.equal(calls.filter(c=>c.method==='thread/resume').length,resumes)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-03-${width}-${theme}.png`})}
  emit('thread/settings/updated',{threadId:'other-thread',threadSettings:{approvalPolicy:'never'}});await page.waitForTimeout(100);await page.getByText('Approval policy: on-request · Reviewer: user',{exact:true}).waitFor()
  mode='empty';await page.getByRole('button',{name:'Read permission restrictions'}).click();await page.getByText('No managed requirements returned.',{exact:true}).waitFor()
  mode='error';await page.getByRole('button',{name:'Read permission restrictions'}).click();await page.getByRole('alert').filter({hasText:'Restrictions unavailable'}).waitFor()
  mode='delayed';await page.getByRole('button',{name:'Read permission restrictions'}).click();await page.waitForTimeout(150);emit('app-server/disconnected',{});await page.waitForTimeout(100);release();await page.getByText('Effective thread permissions: Unknown.',{exact:false}).waitFor()
  assert.equal(calls.some(c=>c.method==='thread/settings/update'),false);assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 03 observed native settings, unknown/managed/empty/error/stale isolation, no extra resume or writes; six views')
})().catch(e=>{console.error(e);process.exit(1)})
