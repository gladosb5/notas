import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({hasTouch:true,serviceWorkers:'block'});
 await page.route('**/bg-worker.js*',route=>route.fulfill({contentType:'text/javascript',body:`self.onmessage=e=>{const {id,prefetch}=e.data;if(prefetch)return self.postMessage({id,done:'stored'});const alpha=new Uint8ClampedArray(512*512);for(let y=128;y<384;y++)for(let x=128;x<384;x++)alpha[y*512+x]=255;self.postMessage({id,alpha});};`}));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.ink?.removeBackground&&N.ui?.insertImages);
 await page.evaluate(()=>N.tutorial?.finish(false));
 for(const rotation of [0,Math.PI/4]){
 const result=await page.evaluate(async rot=>{
   const C=N.core,S=C.S,cv=document.createElement('canvas');cv.width=cv.height=512;
   cv.getContext('2d').fillRect(0,0,512,512);
   const blob=await new Promise(r=>cv.toBlob(r));await N.ui.insertImages([new File([blob],'subject.png',{type:'image/png'})]);
   const im=S.images.at(-1);im.rot=rot;
   const snapshot=()=>JSON.parse(JSON.stringify(im));const before=snapshot();
   const ok=await N.ink.removeBackground(im.id),after=snapshot();
   C.undo();const undone=snapshot();C.redo();const redone=snapshot();
   await N.ink.undoBackground(im.id);const restored=snapshot();await N.ink.removeBackground(im.id);const toggled=snapshot();
   const el=new Image();await new Promise(r=>{el.onload=r;el.src=im.src;});
   return {ok,before,after,undone,redone,restored,toggled,size:[el.naturalWidth,el.naturalHeight]};
 },rotation);
 assert.ok(result.ok);assert.deepEqual(result.size,[256,256]);
 assert.equal(result.after.w,result.before.w/2);assert.equal(result.after.h,result.before.h/2);
 assert.ok(Math.abs(result.after.x+result.after.w/2-result.before.x-result.before.w/2)<1e-6);
 assert.deepEqual(result.undone,result.before);assert.deepEqual(result.redone,result.after);
 assert.deepEqual(result.toggled,result.after);assert.deepEqual(result.restored.crop,result.after.crop);
 }
 // Multi-finger taps must never navigate history. Use the real pointer path.
 const history=await page.evaluate(()=>{
   N.ink.setTool('pen');let undo=0,redo=0;const u=N.core.undo,r=N.core.redo;
   N.core.undo=()=>undo++;N.core.redo=()=>redo++;
   const canvas=document.querySelector('#c-ink');
   for(const count of [2,3]){
     for(let i=0;i<count;i++)canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:100+i,pointerType:'touch',clientX:400+i*30,clientY:500,bubbles:true}));
     for(let i=0;i<count;i++)canvas.dispatchEvent(new PointerEvent('pointerup',{pointerId:100+i,pointerType:'touch',clientX:400+i*30,clientY:500,bubbles:true}));
   }
   N.core.undo=u;N.core.redo=r;return {undo,redo};
 });
 assert.deepEqual(history,{undo:0,redo:0});assert.deepEqual(errors,[]);
 console.log('autocrop, rotation, background toggle, undo/redo and disabled finger taps: ok');
}finally{await browser.close();server.close();}
