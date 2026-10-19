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
    localStorage.setItem('notas.tut','done');window.launchFrames=[];window.launchFade=[];window.loadingWasShown=false;
    new MutationObserver(records=>{
      for(const r of records){
        if(r.target.id==='preparing'&&r.attributeName==='data-revealed')window.loadingWasShown=true;
        if(r.target.id==='preparing'&&r.attributeName==='class'&&r.target.classList.contains('done')){
          const sample=()=>{
            window.launchFade.push({opacity:+getComputedStyle(r.target).opacity,hidden:r.target.hidden});
            if(!r.target.hidden)requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }
        if(r.target.id==='prep-art'){
          const n=+r.target.dataset.frame;if(window.launchFrames.at(-1)!==n)window.launchFrames.push(n);
        }
      }
    }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-frame','data-revealed','class']});
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
async function typeInNotebook(page,text,animating=true){
  await page.evaluate(()=>{N.ink.setTool('text');N.text.add(120,true);});
  await page.locator('.line .txt').last().evaluate(el=>el.focus());
  await page.keyboard.insertText(text);
  assert.ok(await page.evaluate(text=>N.core.S.lines.some(l=>l.text===text),text),'typing works during the intro');
  if(animating)assert.ok(+await page.locator('#prep-art').getAttribute('data-frame')<111,'typing did not wait for the animation');
}
try{
  // Warm/local startup: fade the notebook in with a static header logo,
  // without showing the loader or playing any intermediate film frames.
  {
    const {context,page}=await setup();
    await page.goto(base+'/notas.html',{waitUntil:'domcontentloaded'});await ready(page);
    assert.equal(await page.evaluate(()=>window.loadingWasShown),false,'a quick start never reveals the loader');
    const frame=+await page.locator('#prep-art').getAttribute('data-frame');
    assert.equal(frame,111,'a quick start uses the final static logo');
    await page.waitForFunction(()=>document.querySelector('#preparing').dataset.handoff==='header');
    assert.equal(await page.locator('#brand #prep-art').count(),1);
    await typeInNotebook(page,'ready as the notebook fades in',false);
    await page.locator('#brand').click();
    assert.equal(await page.locator('#brand').getAttribute('aria-expanded'),'true','static logo opens the library');
    await page.evaluate(()=>N.library.close());
    await page.evaluate(()=>window.notasLaunch.finished);
    assert.ok(await page.evaluate(()=>window.launchFrames.every(n=>n===0||n===111)),'quick starts skip the film entirely');
    await page.waitForFunction(()=>document.querySelector('#preparing').hidden);
    assert.ok(await page.evaluate(()=>window.launchFade.some(s=>!s.hidden&&s.opacity>0&&s.opacity<1)),'the paper overlay fades out to reveal the ready notebook');
    const last=await page.locator('#prep-art').getAttribute('data-frame');
    await page.waitForTimeout(200);assert.equal(await page.locator('#prep-art').getAttribute('data-frame'),last,'completed logo stays static');
    await page.screenshot({path:'test-results/launch-handoff-fast.png'});
    await context.close();
    console.log('Fast startup: notebook fades in, no loading indicator or film, static logo button works.');
  }
  // Slower startup: release storage midway through the drawing. The drawing
  // finishes right on the loader at four frames a tick, and only the
  // completed mark travels through the 300 ms transfer.
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
    assert.equal(active.frame,111,'the mark travels finished, not still being drawn');
    assert.equal(active.duration,300);
    const cdp=await context.newCDPSession(page);
    await writeFile('test-results/launch-handoff-moving.png',Buffer.from((await cdp.send('Page.captureScreenshot')).data,'base64'));
    await typeInNotebook(page,'no waiting for the moving logo',false);
    await page.waitForFunction(()=>document.querySelector('#preparing').dataset.handoff==='header');
    const then=+await page.locator('#prep-art').getAttribute('data-frame');
    await page.waitForTimeout(500);
    const now=+await page.locator('#prep-art').getAttribute('data-frame');
    assert.equal(now,111,'the header keeps the completed drawing, not a running one');
    await page.setViewportSize({width:390,height:844});
    const box=await page.locator('#prep-art').boundingBox(),brand=await page.locator('#brand').boundingBox();
    assert.ok(box.x>=brand.x&&box.x+box.width<=brand.x+brand.width+1,'header drawing follows mobile layout');
    await page.evaluate(()=>window.notasLaunch.finished);
    assert.ok(await page.evaluate(()=>{const f=window.launchFrames;return f.at(-1)===111&&f.every((n,i)=>n>=0&&n<=111&&(i===0||n>f[i-1]));}),'every drawing shows once, in order, ending complete');
    await page.screenshot({path:'test-results/launch-handoff-mobile.png'});
    await context.close();
    console.log('Slow startup: drawing finishes on the loader, 300 ms transfer of the finished mark, early typing, responsive header.');
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
