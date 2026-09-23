// Background removal: the selection bar offers it on a picture, the model
// comes from its pinned Hugging Face revision, the result is a transparent
// cut-out, and one undo brings the original back. The prefetch that runs
// in the background on a real start stores the model beforehand. The browser profile is
// kept in test-results/ so the model store holds the 94 MB model after the
// first run and later runs do not download it again.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {startServer} from '../scripts/serve.mjs';

const PROFILE=fileURLToPath(new URL('../test-results/background-profile',import.meta.url));
const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const context=await chromium.launchPersistentContext(PROFILE,{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:800,height:1100}});
try{
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N&&N.ui&&N.ink&&N.ink.removeBackground);
  // the background download (automatic on a real start, asked for here since
  // automated browsers skip it) leaves the model in the store, not running
  const warmed=await page.evaluate(()=>N.ink.prefetchCutout());
  assert.ok(warmed==='stored'||warmed==='downloaded','the prefetch stores the model: '+warmed);
  const before=await page.evaluate(async()=>{
    const S=N.core.S;
    // a dark disc on a light, slightly textured backdrop
    const cv=document.createElement('canvas');cv.width=600;cv.height=400;const x=cv.getContext('2d');
    x.fillStyle='#e8e4dc';x.fillRect(0,0,600,400);
    for(let i=0;i<400;i+=8){x.fillStyle=i%16?'#e2ddd4':'#ece8e1';x.fillRect(0,i,600,4);}
    x.fillStyle='#2a5caa';x.beginPath();x.arc(300,200,120,0,Math.PI*2);x.fill();
    const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',.92));
    await N.ui.insertImages([new File([blob],'disc.jpg',{type:'image/jpeg'})]);
    N.ink.clearSelection();N.ink.setTool('select');
    const im=S.images.at(-1);return {id:im.id,src:im.src};
  });
  // the lasso: a loop drawn round the whole page, starting off the picture
  const box=await page.locator('#c-ink').boundingBox();
  const l=box.x+12,t=box.y+12,r=box.x+box.width-12,b=box.y+box.height-12;
  await page.mouse.move(l,t);await page.mouse.down();
  for(const [px,py] of [[r,t],[r,b],[l,b],[l,t+4]])await page.mouse.move(px,py,{steps:12});
  await page.mouse.up();
  const buttons=await page.locator('#selbar button').allTextContents();
  const t0=Date.now();
  await page.locator('#selbar button',{hasText:'remove background'}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='background removed.',null,{timeout:300000});
  const ms=Date.now()-t0;
  const out=await page.evaluate(async({id,src:before})=>{
    const S=N.core.S,C=N.core;
    const after=S.images.find(i=>i.id===id).src;
    const img=new Image();await new Promise(r=>{img.onload=r;img.src=after;});
    const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
    const cx=c.getContext('2d');cx.drawImage(img,0,0);
    const a=(px,py)=>cx.getImageData(Math.round(px*c.width),Math.round(py*c.height),1,1).data[3];
    const result={png:after.startsWith('data:image/png'),size:[c.width,c.height],
      corner:a(.02,.02),edge:a(.95,.5),centre:a(.5,.5),selected:S.imageSelection===id};
    C.undo();
    result.undone=S.images.find(i=>i.id===id).src===before;
    C.redo();
    result.redone=S.images.find(i=>i.id===id).src===after;
    return result;
  },before);
  Object.assign(out,{buttons,ms,ok:true});
  console.log(out);
  assert.ok(out.buttons.includes('remove background'),'the picture selection offers remove background');
  assert.equal(out.ok,true,'background removal finished');
  assert.ok(out.png,'the cut-out is a PNG');
  assert.deepEqual(out.size,[600,400],'the cut-out keeps the picture size');
  assert.ok(out.corner<32&&out.edge<32,'the backdrop became transparent');
  assert.ok(out.centre>224,'the subject stayed opaque');
  assert.ok(out.selected,'the lasso selected the picture');
  assert.ok(out.undone&&out.redone,'one undo restores the original, redo the cut-out');
  assert.deepEqual(errors,[]);
  console.log('background removal: ok');
}finally{await context.close();server.close();}
