const {chromium}=require('playwright')
const {setup,thread,assert}=require('./approved-fixture.cjs')
const {writeFileSync}=require('node:fs')
;(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}})
 thread.name='TestChat fixture'
 let submitted
 const {emit,errors}=await setup(page,body=>{if(body.method==='turn/start'){submitted=body.params;return {json:{result:{turn:{id:'testchat-turn',status:'inProgress'}}}}}})
 const marker='APPROVED_TESTCHAT_'+Date.now(),text=`${marker}\n**Markdown** [sample.ts](/remote/project/src/sample.ts) and [reference](https://example.test/docs)\n\`\`\`ts\nconst safe = true\n\`\`\``
 await page.waitForTimeout(700);await page.locator('.thread-composer-input').fill(text);await page.locator('.thread-composer-submit').click()
 for(let i=0;!submitted&&i<100;i++)await page.waitForTimeout(20)
 assert.ok(submitted.input.some(i=>i.type==='text'&&i.text.includes(marker)))
 emit('item/completed',{threadId:thread.id,turnId:'testchat-turn',item:{id:'testchat-answer',type:'agentMessage',text}})
 const row=page.locator('[data-message-id="testchat-answer"]');await row.waitFor()
 const rendered=await row.locator('a').filter({hasText:'sample.ts'}).first().evaluate(a=>({href:a.getAttribute('href'),title:a.getAttribute('title'),text:a.textContent}))
 const hrefOk=!!rendered.href?.includes('sample.ts'),titleOk=!!rendered.title?.includes('sample.ts'),textOk=rendered.text==='sample.ts'
 assert.ok(hrefOk&&titleOk&&textOk,JSON.stringify(rendered));assert.ok((await row.innerText()).includes(marker))
 await page.waitForTimeout(2200);const screenshot='output/playwright/testchat-approved-features-cjs.png';await page.screenshot({path:screenshot})
 writeFileSync('output/playwright/approved-testchat-results.json',JSON.stringify({url:page.url(),viewport:{width:1280,height:900},fixture:true,marker,hrefOk,titleOk,textOk,screenshot},null,2))
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS isolated TestChat: sent unique marker, rendered Markdown/code/file link; hrefOk/titleOk/textOk')
})().catch(e=>{console.error(e);process.exit(1)})
