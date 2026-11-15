const {chromium}=require('playwright')
const {setup,assert,openToolsDialog}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true}),head='a'.repeat(40)
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let created=false,registered=false,rootRequests=0,mode='ok',release
  const {calls,errors,emit}=await setup(page,async(body,_page,url)=>{
   if(url.pathname.endsWith('/project-root')){registered=true;rootRequests++;return {json:{data:{path:'/remote/fixture-tree',projectId:'wp'}}}}
   if(url.pathname.endsWith('/workspace-roots-state')&&registered)return {json:{data:{projectMode:'native',nativeProjects:[{id:'p',name:'Fixture project',roots:[{path:'/remote/project'}],position:0,metadata:{}},{id:'wp',name:'Fixture worktree',roots:[{path:'/remote/fixture-tree'}],position:1,metadata:{}}],order:['/remote/project','/remote/fixture-tree'],active:[],labels:{},projectOrder:['p','wp']}}}
   if(body.method!=='command/exec')return
   const a=body.params.command
   let stdout=''
   if(a.includes('rev-parse'))stdout=a.includes('--show-toplevel')?body.params.cwd+'\n':head+'\n'
   if(a.includes('worktree')&&a.includes('list'))stdout=`worktree /remote/project\0HEAD ${head}\0branch refs/heads/main\0\0`+(created?`worktree /remote/fixture-tree\0HEAD ${head}\0branch refs/heads/fixture-branch\0\0`:'')
   if(a.includes('worktree')&&a.includes('add')){created=true;if(mode==='lost')return {status:502,json:{error:'Reply lost after worktree creation'}}}
   if(mode==='delayed'&&a.includes('rev-parse'))await new Promise(r=>release=r)
   return {json:{result:{exitCode:0,stdout,stderr:''}}}
  })
  assert.equal(calls.some(c=>c.method==='command/exec'),false)
  await page.keyboard.press('Escape');await page.locator('.thread-composer-input').fill('Parent draft must survive');await openToolsDialog(page);await page.getByText('Create remote Git worktree',{exact:true}).click();await page.getByRole('textbox',{name:'Worktree destination'}).fill('/remote/fixture-tree');await page.getByRole('textbox',{name:'Worktree new branch'}).fill('fixture-branch');await page.getByRole('button',{name:'Preview worktree creation'}).click();await page.getByText('Repository: /remote/project',{exact:false}).waitFor()
  assert.equal(calls.some(c=>c.params?.command?.includes('add')),false);assert.equal(await page.getByRole('button',{name:'Create confirmed worktree'}).isDisabled(),true)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-13-${width}-${theme}.png`})}
  await page.getByRole('checkbox',{name:'I confirm this remote repository, new branch and destination.'}).check();mode='lost';await page.getByRole('button',{name:'Create confirmed worktree'}).click();await page.getByText('Failed or partial/unknown creation.',{exact:false}).waitFor();assert.equal(calls.filter(c=>c.params?.command?.includes('add')).length,1)
  mode='ok';await page.getByRole('button',{name:'Reconcile exact worktree'}).click();await page.getByRole('button',{name:'Set up a new conversation in /remote/fixture-tree'}).waitFor();assert.equal(calls.filter(c=>c.params?.command?.includes('add')).length,1)
  // Existing conversation identity and visible history remain intact after creation.
  assert.match(page.url(),/thread\/approved-fixture/);await page.getByText('Fixture answer',{exact:true}).waitFor();assert.equal(calls.some(c=>c.method==='thread/start'||c.method==='thread/fork'),false)
  const command=calls.find(c=>c.params?.command?.includes('add'));assert.equal(command.params.cwd,'/remote/project');assert.equal(command.params.command.includes('core.hooksPath=/dev/null'),true)
  await page.getByRole('button',{name:'Set up a new conversation in /remote/fixture-tree'}).click();await page.waitForURL(u=>new URLSearchParams(u.hash.split('?')[1]).get('cwd')==='/remote/fixture-tree');assert.match(page.url(),/projectId=wp/);assert.equal(rootRequests,1);assert.equal(calls.some(c=>c.method==='thread/start'),false);await page.goto('http://127.0.0.1:4173/#/thread/approved-fixture');await page.getByText('Fixture answer',{exact:true}).waitFor();assert.equal(await page.locator('.thread-composer-input').inputValue(),'Parent draft must survive');emit('app-server/disconnected',{});await page.waitForTimeout(150);assert.equal(await page.getByRole('button',{name:'Set up a new conversation in /remote/fixture-tree'}).count(),0)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 13 remote plan/confirmation/fixed argv/unknown write/exact reconciliation, parent intact, disconnect; six views')
})().catch(e=>{console.error(e);process.exit(1)})
