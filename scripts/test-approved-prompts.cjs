const {chromium}=require('playwright')
const {setup,assert,openComposerEntry}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  const {calls,errors,emit}=await setup(page,body=>body.method==='turn/start'?{json:{result:{turn:{id:'submitted',status:'inProgress'}}}}:undefined,false)
  emit('native-authentication/state',{phase:'ready',blocking:false,revision:1});
  await page.waitForTimeout(700);const draft=page.locator('.thread-composer-input')
  await draft.fill('Draft must remain editable')
  await openComposerEntry(page,'Prompts & commands')
  await page.getByRole('textbox',{name:'Preset name',exact:true}).fill('Fixture preset')
  await page.getByRole('textbox',{name:'Preset name',exact:true}).press('Enter')
  assert.equal(calls.some(c=>c.method==='turn/start'),false)
  assert.equal(await draft.inputValue(),'Draft must remain editable')
  await page.getByRole('textbox',{name:'Preset text',exact:true}).fill('Editable preset text')
  await page.getByRole('button',{name:'Save text preset',exact:true}).click()
  await page.getByRole('button',{name:'Use preset Fixture preset',exact:true}).click();assert.equal(await draft.inputValue(),'Editable preset text')
  assert.equal(calls.some(c=>c.method==='turn/start'),false)
  await openComposerEntry(page,'Prompts & commands')
  await page.getByRole('button',{name:'Edit preset Fixture preset',exact:true}).click();await page.getByRole('textbox',{name:'Preset text',exact:true}).fill('Edited preset text');await page.getByRole('button',{name:'Save preset changes',exact:true}).click()
  for(const theme of ['light','dark']){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/approved-25-${width}-${theme}.png`})}
  await page.reload();await page.getByText('Fixture answer',{exact:true}).waitFor();await page.waitForTimeout(200);emit('native-authentication/state',{phase:'ready',blocking:false,revision:2});await openComposerEntry(page,'Prompts & commands');await page.getByRole('button',{name:'Use preset Fixture preset',exact:true}).click();assert.equal(await draft.inputValue(),'Edited preset text')
  await openComposerEntry(page,'Prompts & commands');await page.getByRole('button',{name:'Enable recent prompt history',exact:true}).click();await page.getByRole('button',{name:'Close prompts',exact:true}).click()
  await draft.fill('/unknown-command fixture');await page.locator('.thread-composer-submit').click()
  await page.waitForTimeout(300);assert.ok(calls.some(c=>c.method==='turn/start'&&c.params.input.some(i=>i.type==='text'&&i.text.includes('/unknown-command fixture'))))
  await openComposerEntry(page,'Prompts & commands');await page.getByRole('button',{name:'/unknown-command fixture',exact:true}).click();assert.equal(await draft.inputValue(),'/unknown-command fixture')
  const count=calls.filter(c=>c.method==='turn/start').length
  await draft.fill('/diff');await page.locator('.thread-composer-submit').click();await page.waitForFunction(()=>document.querySelector('.working-tree-panel')?.open);assert.equal(await page.locator('.working-tree-panel').getAttribute('open'),'');assert.equal(calls.filter(c=>c.method==='turn/start').length,count)
  await page.keyboard.press('Escape');await openComposerEntry(page,'Prompts & commands');await page.getByRole('button',{name:'Clear all stored prompts and presets',exact:true}).click();await page.getByRole('button',{name:'Use preset Fixture preset',exact:true}).waitFor({state:'detached'});assert.equal(await page.getByRole('button',{name:'Use preset Fixture preset',exact:true}).count(),0)
  assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 25: preset create/edit/reload/selection, accepted history, unknown slash, action aliases, explicit clear; matrix')
})().catch(e=>{console.error(e);process.exit(1)})
