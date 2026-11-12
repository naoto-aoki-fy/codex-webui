const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({headless:true});
 const context = await browser.newContext({permissions:['clipboard-read','clipboard-write']});
 const page = await context.newPage();
 let uploads=0;
 page.on('request',r=>{if(r.url().includes('/codex-api/upload')) uploads++});
 await page.goto('http://127.0.0.1:4173/');
 await page.waitForTimeout(4000);
 const text = 'LONG-PASTE-CHECK\n' + 'ordinary editable text\n'.repeat(180);
 const textarea = page.locator('textarea').first();
 await page.evaluate(text=>navigator.clipboard.writeText(text),text);
 await textarea.focus();
 await page.keyboard.press('Control+V');
 assert.equal(await textarea.inputValue(), text);
 assert.equal(uploads,0);
 await page.keyboard.press('End');
 await page.keyboard.type('editable');
 assert((await textarea.inputValue()).endsWith('editable'));
 for(const width of [1280,375,768]) {
  await page.setViewportSize({width,height:width===375?812:1024});
  for(const dark of [false,true]) {
   await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);
   await page.waitForTimeout(2500);
   const path = process.cwd()+'/output/playwright/plain-paste-'+width+'-'+(dark?'dark':'light')+'.png';
   await page.screenshot({path,fullPage:false});
   console.log('PASS editable long paste, zero uploads',width,dark?'dark':'light',path);
  }
 }
 await textarea.fill('');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
