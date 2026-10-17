import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[];
async function setup(options={}){
  const context=await browser.newContext({serviceWorkers:'block',...options});
  await context.addInitScript(()=>{
    localStorage.setItem('notas.tut','done');window.launchFrames=[];window.loadingWasShown=false;
    new MutationObserver(records=>{
      for(const r of records){
        if(r.target.id==='preparing'&&r.attributeName==='data-revealed')window.loadingWasShown=true;
        if(r.target.id==='prep-art'){
          const n=+r.target.dataset.frame;if(window.launchFrames.at(-1)!==n)window.launchFrames.push(n);
        }
      }
    }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-frame','data-revealed']});
  });
  await context.route(/\/assets\/(?:ink|text|smart)\//,r=>r.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  return {context,page};
}
async function ready(page){
  await page.waitForFunction(()=>document.querySelector('#preparing').classList.contains('done'));
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#preparing')).pointerEvents),'none');
  await page.evaluate(()=>{N.core.S.settings.aiOn=false;N.ai.toggle();});
}
async function typeWhileAnimating(page,text){
  await page.evaluate(()=>{N.ink.setTool('text');N.text.add(120,true);});
  await page.locator('.line .txt').last().evaluate(el=>el.focus());
  await page.keyboard.insertText(text);
  assert.ok(await page.evaluate(text=>N.core.S.lines.some(l=>l.text===text),text),'typing works during the intro');
  assert.ok(+await page.locator('#prep-art').getAttribute('data-frame')<111,'typing did not wait for the animation');
}
try{
  // Warm/local startup: the app releases early, with the same drawing
  // continuing as the header's logo and all ordinary controls available.
  {
    const {context,page}=await setup();
    await page.goto(base+'/notas.html',{waitUntil:'domcontentloaded'});await ready(page);
    assert.equal(await page.evaluate(()=>window.loadingWasShown),false,'a quick start never reveals the loader');
    const frame=+await page.locator('#prep-art').getAttribute('data-frame');
    assert.ok(frame<41,'app ready before the spirit finishes');
    await page.waitForFunction(()=>document.querySelector('#preparing').dataset.handoff==='header');
    assert.equal(await page.locator('#brand #prep-art').count(),1);
    await typeWhileAnimating(page,'ready while the logo draws');
    await page.locator('#brand').click();
    assert.equal(await page.locator('#brand').getAttribute('aria-expanded'),'true','logo opens the library while drawing');
    await page.evaluate(()=>N.library.close());
    await page.evaluate(()=>window.notasLaunch.finished);
    assert.deepEqual(await page.evaluate(()=>window.launchFrames.slice(0,41)),Array.from({length:41},(_,n)=>n));
    const last=await page.locator('#prep-art').getAttribute('data-frame');
    await page.waitForTimeout(200);assert.equal(await page.locator('#prep-art').getAttribute('data-frame'),last,'completed logo stays static');
    await page.screenshot({path:'test-results/launch-handoff-fast.png'});
    await context.close();
    console.log('Fast startup: early interactive notebook, uninterrupted animation in header, working logo button.');
  }
  // Slower startup: release storage midway through the drawing. Its frame
  // sequence and cadence must continue through the 300 ms transfer.
  {
    const {context,page}=await setup();let release;const held=new Promise(r=>release=r);
    await context.route('**/assets/idb.js',async r=>{await held;await r.continue();});
    await page.goto(base+'/notas.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>performance.now()>=650);
    assert.equal(await page.locator('.prep-card').isVisible(),false,'no loading indicator during the first second');
    assert.equal(await page.locator('#prep-art').getAttribute('data-frame'),'0','hidden animation has not consumed any drawings');
    await page.waitForFunction(()=>document.querySelector('#preparing').hasAttribute('data-revealed'));
    assert.ok(await page.evaluate(()=>performance.now())>=1000,'loading indicator appears only after one second');
    await page.waitForFunction(()=>+document.querySelector('#prep-art').dataset.frame>=20);
    assert.equal(await page.locator('#preparing').isVisible(),true);
    const before=+await page.locator('#prep-art').getAttribute('data-frame');release();await ready(page);
    assert.ok(+await page.locator('#prep-art').getAttribute('data-frame')>=before,'handoff never resets the drawing');
    await page.waitForFunction(()=>document.querySelector('#preparing').dataset.handoff==='moving');
    const active=await page.evaluate(()=>({frame:+document.querySelector('#prep-art').dataset.frame,duration:document.querySelector('#prep-art').getAnimations()[0]?.effect.getTiming().duration}));
    assert.equal(active.duration,300);
    const cdp=await context.newCDPSession(page);
    await writeFile('test-results/launch-handoff-moving.png',Buffer.from((await cdp.send('Page.captureScreenshot')).data,'base64'));
    await typeWhileAnimating(page,'no waiting for the moving logo');
    await page.waitForFunction(()=>document.querySelector('#preparing').dataset.handoff==='header');
    const then=+await page.locator('#prep-art').getAttribute('data-frame');
    await page.waitForTimeout(500);
    const now=+await page.locator('#prep-art').getAttribute('data-frame');
    assert.ok(now-then>=8&&now-then<=15,'header keeps the normal 24 fps pace');
    await page.setViewportSize({width:390,height:844});
    const box=await page.locator('#prep-art').boundingBox(),brand=await page.locator('#brand').boundingBox();
    assert.ok(box.x>=brand.x&&box.x+box.width<=brand.x+brand.width+1,'header drawing follows mobile layout');
    await page.evaluate(()=>window.notasLaunch.finished);
    assert.deepEqual(await page.evaluate(()=>window.launchFrames.slice(0,41)),Array.from({length:41},(_,n)=>n));
    await page.screenshot({path:'test-results/launch-handoff-mobile.png'});
    await context.close();
    console.log('Slow startup: 300 ms transfer, early typing, all frames retained, normal cadence, responsive header.');
  }
  // Changing accessibility preferences while the mark is travelling must
  // dock a static final logo, with no cancelled animation left on the page.
  {
    const {context,page}=await setup({colorScheme:'dark'});let release;const held=new Promise(r=>release=r);
    await context.route('**/assets/idb.js',async r=>{await held;await r.continue();});
    await page.goto(base+'/notas.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>+document.querySelector('#prep-art').dataset.frame>=20);
    release();await ready(page);
    await page.waitForFunction(()=>document.querySelector('#preparing').dataset.handoff==='moving');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>document.querySelector('#preparing').dataset.handoff==='header');
    assert.equal(await page.locator('#prep-art').getAttribute('data-frame'),'111');
    assert.equal(await page.evaluate(()=>document.querySelector('#prep-art').getAnimations().length),0);
    await page.screenshot({path:'test-results/launch-handoff-dark-reduced.png'});
    await context.close();
    console.log('Reduced motion during transfer: static header logo, no stuck overlay or cancelled transform.');
  }
  {
    const {context,page}=await setup();let release;const held=new Promise(r=>release=r);
    await context.route('**/assets/idb.js',async r=>{await held;await r.continue();});
    await page.goto(base+'/notas.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>+document.querySelector('#prep-art').dataset.frame>=20);
    release();await ready(page);
    await page.waitForFunction(()=>document.querySelector('#preparing').dataset.handoff==='moving');
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('#preparing').dataset.handoff==='header');
    assert.equal(await page.evaluate(()=>document.querySelector('#prep-art').getAnimations().length),0);
    await page.locator('#btn-menu').click();
    await page.locator('#seg-motion button[data-v="0"]').click();
    await page.waitForFunction(()=>document.querySelector('#prep-art').dataset.frame==='111');
    assert.equal(await page.evaluate(()=>N.core.S.settings.animations),false);
    await context.close();
    console.log('Resize during transfer and animations switched off: logo docks cleanly and becomes static.');
  }
  {
    const {context,page}=await setup();
    await context.addInitScript(()=>localStorage.setItem('notas.prefs',JSON.stringify({animations:false})));
    await page.goto(base+'/notas.html',{waitUntil:'domcontentloaded'});await ready(page);
    assert.equal(await page.locator('#preparing').isVisible(),false);
    assert.equal(await page.locator('#prep-art').getAttribute('data-frame'),'111');
    assert.equal(await page.locator('#brand #prep-art').count(),1);
    assert.equal(await page.evaluate(()=>document.querySelector('#prep-art').getAnimations().length),0);
    await context.close();
    console.log('Saved animations-off preference: immediate notebook and static header wordmark.');
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
