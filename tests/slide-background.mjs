import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startServer} from '../scripts/serve.mjs';
const source=readFileSync(new URL('../../finetunedimages/IMG_2719.png',import.meta.url));
const blank=readFileSync(new URL('../../finetunedimages/IMG_2880.png',import.meta.url));
const server=await startServer(0),browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block'}),errors=[],chunks=new Map();page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(/\/assets\/slide\/[^/]+\.bin$/.test(r.url()))chunks.set(r.url(),r.status());});
 await page.goto((process.env.NOTAS_BASE_URL||`http://127.0.0.1:${server.address().port}`)+'/notas.html');
 await page.waitForFunction(()=>window.N?.ink?.removeBackground&&N.ui?.insertImages);
 await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'));
 await page.evaluate(()=>N.tutorial?.finish(false));
 for(const [bytes,positive] of [[source,true],[blank,false]]){
 const result=await page.evaluate(async({src,positive})=>{
   const blob=await (await fetch(src)).blob();await N.ui.insertImages([new File([blob],'slide.png',{type:'image/png'})]);
   const im=N.core.S.images.at(-1),before=im.src;
   N.ink.selectImage(im.id);
   const offered=[...document.querySelectorAll('#selbar button')].some(b=>b.textContent==='remove background')&&!document.querySelector('#selbar').textContent.includes('keep slide');
   const ok=await N.ink.removeBackground(im.id);
   if(!positive)return {ok,offered,unchanged:im.src===before};
   const image=new Image();await new Promise(r=>{image.onload=r;image.src=im.full;});
   const c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').drawImage(image,0,0);
   const a=c.getContext('2d').getImageData(0,0,512,512).data;
   let foreground=0;for(let i=3;i<a.length;i+=4)if(a[i]>127)foreground++;
   return {ok,offered,foreground:foreground/(512*512),crop:im.crop,w:im.w,h:im.h,src:im.src};
 },{src:'data:image/png;base64,'+bytes.toString('base64'),positive});
 assert.ok(result.offered,'one background action handles slides automatically');
 if(positive){assert.ok(result.ok);assert.ok(result.foreground>.4&&result.foreground<.75);assert.ok(result.crop.t>.2&&result.crop.l<.15);console.log({...result,src:'PNG cutout'});}
 else assert.deepEqual(result,{ok:false,offered:true,unchanged:true},'a wall-only crop is preserved');
 }
 assert.equal(chunks.size,5,'all five specialized model chunks were served');
 assert.ok([...chunks.values()].every(status=>status===200),'all model chunks are available');
 assert.deepEqual(errors,[]);console.log('real browser slide model, chunk verification, autocrop and wall rejection: ok');
}finally{await browser.close();server.close();}
