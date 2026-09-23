import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/tools/ocr-labeler.html`);
 const stroke={id:'test-ink',author:'user',pts:[10,20,.5,40,20,.6],times:[0,18],w:2,t0:100,t1:118};
 await page.locator('#note').setInputFiles({name:'fixture.notas.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({strokes:[stroke,{...stroke,id:'ai',author:'ai'}]}))});
 await page.waitForFunction(()=>document.querySelector('#selection').textContent.startsWith('1 of 1'));
 await page.locator('#writer').fill('fixture-writer');await page.locator('#session').fill('fixture-session');await page.locator('#label').fill('x=2');await page.locator('#add').click();
 await page.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('1 labeled'));
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);
 const stream=await download.createReadStream();let text='';for await(const chunk of stream)text+=chunk;
 const row=JSON.parse(text);assert.deepEqual(row.strokes,[stroke]);assert.equal(row.expected,'x=2');assert.equal(row.usage,'evaluation_only');assert.equal(row.timing,'recorded');
 await page.locator('#all').click();await page.locator('#label').fill('different');await page.locator('#add').click();assert.match(await page.locator('#status').textContent(),/already labeled/);
 await page.locator('#resume').setInputFiles({name:'fixture.jsonl',mimeType:'application/json',buffer:Buffer.from(text)});await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Collection loaded'));assert.match(await page.locator('#count').textContent(),/^1 labeled/);
 console.log('Passed: import filters AI, preserves ink/timing, export marks evaluation-only, duplicate protection, resume. Synthetic test fixture only; no real dataset created.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
