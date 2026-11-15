const {chromium}=require('playwright')
const {setup,assert}=require('./approved-fixture.cjs')
;(async()=>{
 const browser=await chromium.launch({headless:true})
 for(const width of [1280,375,768]){
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===768?1024:900}})
  const {calls,errors,emit}=await setup(page)
  await page.getByText('Denied-action inspection',{exact:true}).click();await page.getByText('No native denials observed for approved-fixture.',{exact:true}).waitFor()
  const params={threadId:'approved-fixture',turnId:'native-turn',reviewId:'native-review',targetItemId:'native-item',review:{status:'denied',riskLevel:'high'},action:{type:'command',command:'echo <script> token=DENIAL_SECRET',cwd:'/remote/project',internalInstructions:'HIDDEN'}}
  emit('item/autoApprovalReview/completed',{...params,threadId:'other'});await page.waitForTimeout(100);await page.getByText('No native denials observed for approved-fixture.',{exact:true}).waitFor()
  emit('item/autoApprovalReview/completed',params);emit('item/autoApprovalReview/completed',params)
  await page.getByText('Denied native action (bounded)',{exact:true}).click();await page.getByText('Review: native-review · Turn: native-turn · Item: native-item',{exact:true}).waitFor()
  assert.equal(await page.locator('.denied-actions li').count(),1);assert.doesNotMatch(await page.locator('.denied-actions').textContent(),/DENIAL_SECRET|HIDDEN/)
  for(const theme of ['light','dark']){await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),theme==='dark');await page.waitForTimeout(2200);await page.screenshot({path:`output/playwright/risk-04-${width}-${theme}.png`})}
  emit('app-server/disconnected',{});await page.getByText('No native denials observed for approved-fixture.',{exact:true}).waitFor()
  assert.equal(calls.some(c=>c.method==='thread/approveGuardianDeniedAction'),false);assert.deepEqual(errors,[]);await page.close()
 }
 await browser.close();console.log('PASS 04 exact native denial IDs, duplicate/other-thread/secret/disconnect isolation, no retry requests; six views')
})().catch(e=>{console.error(e);process.exit(1)})
