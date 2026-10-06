import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {startServer} from '../scripts/serve.mjs';

const html=readFileSync(new URL('../notas.html',import.meta.url),'utf8');
const ctx=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function tidyShape('),html.indexOf('let shapeTimer=')),ctx);
const tidy=p=>ctx.tidyShape(p.flatMap(([x,y])=>[x,y,.5]));
const polygon=c=>c.flatMap((p,i)=>Array.from({length:12},(_,j)=>{const q=c[(i+1)%c.length];return [p[0]+(q[0]-p[0])*j/12,p[1]+(q[1]-p[1])*j/12];})).concat([c[0]]);
assert.equal(tidy(polygon([[0,0],[100,0],[100,80],[0,80]])).length,15);
assert.equal(tidy(polygon([[0,80],[50,0],[100,80]])).length,12);
assert.equal(tidy(Array.from({length:65},(_,i)=>[80*Math.cos(i*Math.PI/32),50*Math.sin(i*Math.PI/32)])).length,195);
assert.equal(tidy([[0,0],[10,20],[20,-10],[30,30],[40,-20],[50,10]]),null);

// Real MessageChannel replies exercise installed and already-waiting updates.
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.core?.S.id&&N.ui);
 await page.evaluate(()=>{N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');N.core.S.settings.aiOn=false;N.ai.toggle();N.ink.setTool('pen');});
 const pen=(type,x,y)=>page.locator('#c-ink').dispatchEvent(type,{pointerId:73,pointerType:'pen',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,pressure:.5,clientX:x,clientY:y,bubbles:true});
 const draw=async(hold,resume=false)=>{
   await page.evaluate(()=>{N.core.S.strokes=[];N.ink.render();});
   await pen('pointerdown',400,400);
   for(let i=1;i<=20;i++)await pen('pointermove',400+i*6,400+Math.sin(i)*1.5);
   if(hold)await page.waitForTimeout(750);
   if(resume)await pen('pointermove',550,440);
   await pen('pointerup',resume?550:520,resume?440:400);
   return page.evaluate(()=>N.core.S.strokes[0]);
 };
 const snapped=await draw(true);assert.equal(snapped.pts.length,6,'held line becomes straight');
 assert.equal(snapped.times.length,2);assert.ok(snapped.bbox.every(Number.isFinite));
 await page.evaluate(()=>N.core.undo());assert.equal(await page.evaluate(()=>N.core.S.strokes.length),0);
 await page.evaluate(()=>N.core.redo());assert.equal(await page.evaluate(()=>N.core.S.strokes[0].pts.length),6);
 assert.ok((await draw(false)).pts.length>6,'quick writing stays freehand');
 assert.ok((await draw(true,true)).pts.length>6,'moving after correction restores freehand');
 const offline=html.slice(html.indexOf('async function prepareOffline(){'),html.indexOf('/* The notebook does not open without its storage.'));
 for(const waiting of [true,false]){
   const notices=await page.evaluate(async({source,waiting})=>{
     const messages=[],events={},workerEvents={};
     const worker={state:'installed',addEventListener:(name,fn)=>workerEvents[name]=fn,postMessage:(_,ports)=>ports[0].postMessage({version:'v109'})};
     const reg={active:{state:'activated',addEventListener(){}},waiting:waiting?worker:null,addEventListener:(name,fn)=>events[name]=fn,update:async()=>{}};
     const navigator={serviceWorker:{register:async()=>reg}},C={toast:m=>messages.push(m)};
     const setInterval=()=>0;
     await eval('('+source+')')();
     if(!waiting){reg.installing=worker;events.updatefound();workerEvents.statechange();workerEvents.statechange();}
     await new Promise(r=>setTimeout(r,100));return messages;
   },{source:offline,waiting});
   assert.equal(notices.length,1);assert.match(notices[0],/v109.*… → update/);
 }
 assert.deepEqual(errors,[]);
 console.log('Shape recognition, hold/release/resume, undo/redo, and versioned update notices passed.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
