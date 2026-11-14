const { chromium } = require('playwright')
const assert = require('node:assert/strict')
;(async () => {
 const browser = await chromium.launch({headless:true})
 const page = await browser.newPage({viewport:{width:1280,height:900}})
 const thread = {id:'cleanup-fixture',name:'Cleanup fixture',cwd:'/fixture',projectId:'p',preview:'fixture',createdAt:1,updatedAt:1,status:{type:'idle'},turns:[]}
 const models = [{id:'arbitrary',model:'arbitrary',isDefault:true,serviceTiers:[{id:'fast'}]}, {id:'unsupported',model:'unsupported',serviceTiers:[]}, {id:'unknown',model:'unknown'}]
 await page.route('**/codex-api/**', async route => {
  const url = new URL(route.request().url()); let body={}
  try {body=route.request().postDataJSON()||{}}catch{}
  let result = {}
  if(body.method==='thread/list') result={data:[thread],nextCursor:null}
  if(body.method==='thread/resume'||body.method==='thread/read') result={thread,model:'arbitrary',modelProvider:'fixture'}
  if(body.method==='modelProvider/list') result={data:[{id:'fixture',isDefault:true}]}
  if(body.method==='model/list') result={data:models,nextCursor:null}
  if(body.method==='config/read') result={config:{model:'arbitrary',model_provider:'fixture',service_tier:null}}
  if(body.method==='skills/list') result={data:[]}
  let payload={result}
  if(url.pathname.endsWith('/workspace-roots-state')) payload={data:{projectMode:'native',nativeProjects:[{id:'p',name:'Fixture',roots:[{path:'/fixture'}],position:0,metadata:{}}],order:['/fixture'],active:[],labels:{},projectOrder:['p']}}
  if(url.pathname.endsWith('/thread-pins')) { await route.fulfill({status:502,json:{error:'Legacy pin migration is incomplete. Complete pin migration using WebUI commit 3f659043adef2fb075919dec669e88e843fe4889 with the same connection profile and CODEX_HOME before upgrading.'}});return }
  if(url.pathname.endsWith('/pending')) payload={data:[]}
  if(url.pathname.endsWith('/methods')) payload={methods:[]}
  if(url.pathname.endsWith('/thread-turn-page')) payload={result:{thread},startTurnIndex:0,hasMoreOlder:false}
  await route.fulfill({json:payload})
 })
 await page.routeWebSocket('**/codex-api/ws', ws=>{})
 await page.goto('http://127.0.0.1:4173/#/thread/cleanup-fixture')
 await page.getByRole('alert').filter({hasText:'Legacy pin migration is incomplete'}).waitFor()
 assert.equal(await page.getByText('Cleanup fixture',{exact:true}).count()>0,true)
 await page.getByRole('button',{name:'Add attachments and settings',exact:true}).click()
 const fast = page.getByRole('switch',{name:'Fast mode disabled',exact:true})
 await fast.waitFor(); assert.equal(await fast.isDisabled(),false)
 for(const theme of ['light','dark']) {
  await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark')
  await page.waitForTimeout(2200)
  assert.equal(await page.getByRole('alert').evaluate(el=>el.scrollWidth<=el.clientWidth),true)
  await page.screenshot({path:`output/playwright/acceptance-upgrade-${theme}.png`})
 }
 console.log('PASS legacy-pin warning visible; native thread and supported Fast composer accessible; light/dark screenshots; URL='+page.url()+' viewport=1280x900; synthetic APIs only')
 await browser.close()
})().catch(e=>{console.error(e);process.exit(1)})
