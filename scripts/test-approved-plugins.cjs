const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  let kind='valid'
  const {calls,errors}=await setup(page,body=>{
   if(body.method==='plugin/list'){
    assert.deepEqual(body.params,{marketplaceKinds:['vertical'],forceRefetch:false})
    return kind==='error'?{status:502,json:{error:'Collection unsupported'}}:{json:{result:{marketplaces:kind==='empty'?[]:[{name:'native-vertical',plugins:[{id:'demo',name:'Demo plugin',version:'2',localVersion:'1',installed:true,enabled:false,source:{type:'remote',token:'SECRET'},interface:{developerName:'Fixture developer',shortDescription:'Fixture description'}}]}],marketplaceLoadErrors:[]}}}
   }
  },false)
  await page.waitForTimeout(700);const expand=page.getByRole('button',{name:'Expand sidebar',exact:true});if(await expand.count())await expand.click()
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Apps / Connectors',exact:true}).click();await page.getByText('Curated plugin collection',{exact:true}).click()
  assert.equal(calls.some(c=>c.method==='plugin/list'),false)
  await page.getByRole('button',{name:'Read curated plugins',exact:true}).click();await page.getByText('Demo plugin · native-vertical',{exact:true}).click();await page.getByText('Advertised version: 2 · Local version: 1',{exact:true}).waitFor()
  assert.ok(!(await page.locator('.curated-plugins').innerText()).includes('SECRET'))
  for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/approved-17-${width}-${theme}.png`})}
  await page.getByRole('textbox',{name:'Filter curated plugins',exact:true}).fill('absent');await page.getByText('0 matching returned plugins',{exact:true}).waitFor()
  kind='empty';await page.getByRole('button',{name:'Read curated plugins',exact:true}).click();await page.getByText('No curated plugins returned for this runtime/account configuration.',{exact:true}).waitFor()
  kind='error';await page.getByRole('button',{name:'Read curated plugins',exact:true}).click();await page.getByRole('alert').filter({hasText:'Collection unsupported'}).waitFor()
  assert.equal(calls.some(c=>/plugin\/(install|uninstall|reconcile)|marketplace\//.test(c.method)),false)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 17: vertical-only lazy browser, search/details/version/state, empty/error/no install/sync calls; matrix')
})().catch(e=>{console.error(e);process.exit(1)})
