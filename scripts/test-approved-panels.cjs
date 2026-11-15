const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
const {mkdirSync}=require('node:fs')
;(async()=>{
 mkdirSync('output/playwright',{recursive:true})
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]) {
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let gitFailure=false
  const {calls,errors}=await setup(page,body=>{
   if(body.method==='command/exec'){
    assert.equal(body.params.cwd,'/remote/project');const args=body.params.command
    assert.deepEqual(args.slice(0,6),['git','--literal-pathspecs','--no-pager','--no-optional-locks','-c','core.fsmonitor=false'])
    return {json:{result:gitFailure?{exitCode:128,stdout:'',stderr:'Not a repository fixture'}:{exitCode:args.includes('--no-index')?1:0,stdout:args.includes('status')?'MM both.txt\0R  renamed.txt\0old.txt\0 D deleted.txt\0?? new.txt\0':'diff --git a/both.txt b/both.txt\n-old\n+new\n',stderr:''}}}
   }
  })
  assert.equal(calls.filter(c=>c.method==='command/exec').length,0)
  await page.getByText('Current Git working tree',{exact:true}).click()
  assert.equal(calls.filter(c=>c.method==='command/exec').length,0)
  await page.getByRole('button',{name:'Refresh working tree',exact:true}).click()
  await page.getByRole('button',{name:'Staged M · both.txt',exact:true}).waitFor()
  assert.equal(calls.filter(c=>c.method==='command/exec').length,1)
  await page.getByRole('button',{name:'Staged M · both.txt',exact:true}).click();await page.locator('.working-tree-panel pre').getByText('+new',{exact:false}).waitFor()
  assert.ok(calls.at(-1).params.command.includes('--cached'))
  await page.getByRole('button',{name:'Preview untracked new.txt',exact:true}).click();await page.getByText('new.txt · untracked (bounded text patch)',{exact:true}).waitFor()
  assert.ok(calls.at(-1).params.command.includes('--no-index'))
  for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/approved-12-${width}-${theme}.png`})}
  gitFailure=true;await page.getByRole('button',{name:'Refresh working tree',exact:true}).click();await page.getByRole('alert').filter({hasText:'Not a repository fixture'}).waitFor()
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 12: remote path/argv, lazy reads, staged/untracked previews, nonrepo errors; 3 sizes × 2 themes')
})().catch(e=>{console.error(e);process.exit(1)})
