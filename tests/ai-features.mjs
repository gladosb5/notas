import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
await mkdir('test-results',{recursive:true});
const keys=['notaOn','textRecognitionOn','backgroundRemovalOn','handwritingRecognitionOn'];
try{
 for(const [width,height,theme] of [[1280,900,'light'],[390,844,'dark'],[320,640,'light'],[844,390,'dark']]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<900,serviceWorkers:'block',colorScheme:theme});
  const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  // Control model replies without downloading weights; exercise the actual worker lifecycle.
  await page.addInitScript(()=>{
   const NativeWorker=window.Worker;window.workerLog=[];
   window.Worker=class{
    constructor(url,opts){
     const name=String(url);if(!/\/(?:ink|text|bg)-worker\.js$/.test(new URL(name,location.href).pathname))return new NativeWorker(url,opts);
     this.url=name;this.log={url:name,stopped:false,messages:[]};window.workerLog.push(this.log);
    }
    postMessage(msg){this.log.messages.push(msg.type||'prefetch');if(this.url.includes('bg-worker'))return;
     queueMicrotask(()=>{if(!this.log.stopped)this.onmessage?.({data:{id:msg.id,ready:true,text:'test writing',latex:'2+2',confidence:1,terminated:true}});});
    }
    terminate(){this.log.stopped=true;}
   };
  });
  let requests=0,releaseReply=null;
  await context.route(/\/nota\/chat$|api\.cerebras\.ai/,async route=>{
   requests++;
   if(releaseReply)await new Promise(resolve=>{releaseReply=resolve;});
   await route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'A test answer.'}}]})+'\n\ndata: [DONE]\n\n'}).catch(()=>{});
  });
  const ready=async()=>{
   await page.waitForFunction(()=>window.N?.ui?.menuSheet&&N.nota?.toggle&&document.querySelector('#preparing').classList.contains('done'));
   await page.evaluate(()=>{N.tutorial?.finish(false);N.ink.setTool('text');});
  };
  await page.goto(base+'/notas.html');await ready();
  await page.locator('#btn-menu').click();await page.locator('#disable-ai').scrollIntoViewIfNeeded();
  const panel=page.locator('.sheet[role="dialog"]');
  const title=await panel.getAttribute('aria-labelledby');
  // Freeze the CSS transition at an intermediate frame to verify movement without a fade.
  const middle=await page.evaluate(async()=>{
   document.querySelector('#disable-ai').click();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const pages=[...document.querySelectorAll('.menu-page')];
   const animations=pages.flatMap(p=>p.getAnimations());
   for(const animation of animations){animation.pause();animation.currentTime=160;}
   const result=pages.map(p=>({x:new DOMMatrixReadOnly(getComputedStyle(p).transform).m41,opacity:getComputedStyle(p).opacity,width:p.offsetWidth}));
   for(const animation of animations)animation.finish();
   return result;
  });
  assert.ok(middle[0].x<0&&middle[0].x>-middle[0].width-24,'main page moves to the left');
  assert.ok(middle[1].x>0&&middle[1].x<middle[1].width+24,'AI page enters from the right');
  assert.deepEqual(middle.map(p=>p.opacity),['1','1'],'neither page fades');
  await page.waitForTimeout(100);
  const bounds=await page.evaluate(()=>{
   const v=document.querySelector('.menu-viewport').getBoundingClientRect(),m=document.querySelector('[data-page="main"].menu-page').getBoundingClientRect(),a=document.querySelector('[data-page="ai"].menu-page').getBoundingClientRect(),b=document.querySelector('.sheet .box').getBoundingClientRect();
   return {v:{left:v.left,right:v.right},m:{right:m.right},a:{left:a.left,right:a.right},b:{x:b.x,y:b.y,right:b.right,bottom:b.bottom},scroll:document.querySelector('[data-page="ai"] .body').scrollHeight};
  });
  assert.ok(bounds.m.right<=bounds.v.left,'outgoing menu travels completely outside the viewport');
  assert.ok(Math.abs(bounds.a.left-bounds.v.left)<1,'AI page finishes in place');
  assert.ok(bounds.b.x>=0&&bounds.b.y>=0&&bounds.b.right<=width+1&&bounds.b.bottom<=height+1,'sheet fits the screen');
  assert.notEqual(await panel.getAttribute('aria-labelledby'),title,'dialog is labelled by submenu title');
  assert.equal(await page.locator('.menu-back').evaluate(el=>el===document.activeElement),true);
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.menu-page[data-page="main"]')),false,'tab never enters outgoing page');}
  await page.screenshot({path:`test-results/ai-menu-${width}-${theme}.png`});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.menu-viewport').getAttribute('data-page'),'main','escape goes back');
  await page.waitForTimeout(450);await page.locator('#disable-ai').click();await page.waitForTimeout(450);
  const toggle=key=>page.locator(`[data-ai-feature="${key}"]`);
  for(const key of keys){assert.equal(await toggle(key).isChecked(),true);await toggle(key).uncheck();}
  assert.deepEqual(await page.evaluate(keys=>keys.map(k=>JSON.parse(localStorage.getItem('notas.prefs'))[k]),keys),[false,false,false,false]);
  assert.deepEqual(await page.evaluate(()=>[N.ai.enabled(),N.ai.textEnabled(),N.nota.enabled(),N.ai.setupState().phase,N.ai.textSetupState().phase]),[false,false,false,'off','off']);
  await page.evaluate(()=>N.ui.closeSheet(true));
  await page.evaluate(()=>N.ui.newNote());
  assert.deepEqual(await page.evaluate(keys=>keys.map(k=>N.core.S.settings[k]),keys),[false,false,false,false],'choices survive changing notes');
  await page.reload();await ready();
  assert.equal(await page.evaluate(()=>workerLog.length),0,'disabled models never start after reload');
  await page.evaluate(()=>{const ln=N.core.S.lines[0];ln.text='hey nota, why is the sky blue?';N.nota.onTyped(ln);});
  await page.waitForTimeout(1700);assert.equal(requests,0,'disabled Nota never sends a question');
  assert.equal(await page.evaluate(()=>N.ink.removeBackground('missing')),false);
  assert.equal(await page.evaluate(()=>N.ink.prefetchCutout()),false);
  assert.equal(await page.evaluate(()=>workerLog.length),0,'disabled background remover does not start');
  await page.locator('#btn-menu').click();await page.locator('#disable-ai').click();await page.waitForTimeout(450);
  for(const key of keys)assert.equal(await toggle(key).isChecked(),false,'switches remember their state');
  await toggle('textRecognitionOn').check();await page.evaluate(()=>N.ai.setupText());
  assert.equal(await page.evaluate(()=>N.recog.textReady),true,'text works with maths reading off');
  assert.equal(await page.evaluate(()=>N.ai.enabled()),false);
  await toggle('handwritingRecognitionOn').check();await page.waitForFunction(()=>N.ai.ready);
  await toggle('textRecognitionOn').uncheck();
  assert.equal(await page.evaluate(()=>N.ai.ready),true,'turning off text preserves the maths reader');
  assert.equal(await page.evaluate(()=>workerLog.find(w=>w.url.includes('text-worker')).stopped),true,'text worker is terminated');
  assert.equal(await page.evaluate(()=>N.ai.setupState().phase),'ready');
  await toggle('backgroundRemovalOn').check();await page.evaluate(()=>{void N.ink.prefetchCutout();});
  assert.ok(await page.evaluate(()=>workerLog.some(w=>w.url.includes('bg-worker')&&!w.stopped)));
  await toggle('backgroundRemovalOn').uncheck();
  assert.ok(await page.evaluate(()=>workerLog.filter(w=>w.url.includes('bg-worker')).every(w=>w.stopped)),'background download stops immediately');
  if(width===1280){
   await toggle('notaOn').check();
   releaseReply=()=>{};
   await page.evaluate(()=>{const ln=N.core.S.lines[0];ln.text='hey nota, what is the largest planet?';N.nota.onTyped(ln);});
   await page.waitForFunction(()=>N.nota.busy);await page.waitForFunction(()=>document.querySelector('.line.tutor.wait'));
   // Wait until the request has left the browser before withdrawing it.
   for(let i=0;i<50&&requests===0;i++)await page.waitForTimeout(50);
   assert.ok(requests>0,'enabled Nota sends a question');
   await toggle('notaOn').uncheck();
   await page.waitForFunction(()=>!N.nota.busy&&!N.core.S.lines.some(l=>l.wait));
   releaseReply();releaseReply=null;
   await page.waitForTimeout(250);
   assert.ok(!await page.evaluate(()=>N.core.S.lines.some(l=>l.tutor&&l.text.includes('test answer'))),'withdrawn answer never lands');
   await toggle('notaOn').check();
   await page.evaluate(()=>{const ln=N.core.S.lines[0];ln.text='hey nota, what is the smallest planet?';N.nota.onTyped(ln);});
   await page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&l.text.includes('test answer')),null,{timeout:10000});
   assert.ok(requests>=2,'Nota works again when re-enabled');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.menu-back').click();await page.locator('#disable-ai').click();
  assert.ok(await page.locator('.menu-page').first().evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration)<.001),'reduced motion is respected');
  assert.deepEqual(errors,[],`no errors on ${width}x${height}`);
  console.log(`AI menu, full slide, switches, persistence and worker lifecycle: ${width}x${height} ${theme} ok`);
  await context.close();
 }
}finally{await browser.close();server.close();}
