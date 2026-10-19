import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  // Hold the stylesheets and the storage library: the loading card must keep
  // naming what it is still waiting for, above a moving progress line.
  const context=await browser.newContext({serviceWorkers:'block'});
  let release;const held=new Promise(r=>release=r);
  await context.route(/\/assets\/(?:fonts\.css|katex\.css|icons\.css|idb\.js)$/,async route=>{await held;await route.continue();});
  await context.route(/\/assets\/(?:ink|text|smart)\//,route=>route.abort());
  await context.addInitScript(()=>{
    localStorage.setItem('notas.tut','done');
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/notas.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#preparing').hasAttribute('data-await'));
  const pending=await page.textContent('#prep-status');
  assert.match(pending,/loading (storage|[a-z ]+)( · [a-z ]+)*…?/,'the card names what is still arriving: '+pending);
  assert.match(pending,/storage|styles|fonts/,'the named arrivals come from what is held: '+pending);
  const width=await page.locator('#prep-bar').evaluate(el=>parseFloat(el.style.width));
  assert.ok(width>0&&width<100,'the progress line is part way along: '+width);
  release();
  // When everything named has arrived, the line clears and the notebook opens.
  await page.waitForFunction(()=>!document.getElementById('preparing').hasAttribute('data-await'),null,{timeout:20000});
  assert.equal(await page.textContent('#prep-status'),'');
  await page.waitForFunction(()=>document.querySelector('#preparing').classList.contains('done'),null,{timeout:20000});
  await page.evaluate(()=>{N.core.S.settings.aiOn=false;N.ai.toggle();});
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'test-results/launch-progress-done.png'});
  await context.close();
  console.log('Loading progress: the card names what is still arriving, moves, clears when it is in.');
}finally{
  await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
