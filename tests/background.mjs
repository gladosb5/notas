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
  const busy=page.locator('#selbar button[aria-busy="true"]');
  assert.equal(await busy.textContent(),'removing background\u2026','loading is visible while the worker runs');
  assert.ok(await busy.isDisabled(),'loading prevents duplicate removal');
  assert.ok(!(await page.locator('#selbar button').allTextContents()).includes('undo background'),'undo is not offered during removal');
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='background removed.',null,{timeout:300000});
  await page.waitForFunction(()=>!document.querySelector('#selbar [aria-busy="true"]'));
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
  assert.ok(out.size[0]<600&&out.size[1]<400,'transparent margins are automatically cropped');
  assert.ok(out.size[0]<300&&out.size[1]<300,'automatic routing preserves the disc rather than the textured backdrop');
  assert.ok(out.corner<32,'the backdrop became transparent');
  assert.ok(out.centre>224,'the subject stayed opaque');
  assert.ok(out.selected,'the lasso selected the picture');
  assert.ok(out.undone&&out.redone,'one undo restores the original, redo the cut-out');
  // the button turns into undo background, which brings the original back,
  // and remove background then puts the kept cut-out back without the model
  const label=async()=>{await page.waitForTimeout(50);return page.locator('#selbar button').allTextContents();};
  const cutLabels=await label();
  assert.ok(cutLabels.includes('undo background')&&!cutLabels.includes('remove background'),'a cut-out offers undo background: '+cutLabels);
  await page.locator('#selbar button',{hasText:'undo background'}).click();
  await page.waitForFunction(id=>{const im=N.core.S.images.find(i=>i.id===id);return im.cut&&!im.bg;},before.id,{timeout:5000});
  const backLabels=await label();
  assert.ok(backLabels.includes('remove background')&&!backLabels.includes('undo background'),'the original offers remove background again: '+backLabels);
  const t1=Date.now();
  await page.locator('#selbar button',{hasText:'remove background'}).click();
  await page.waitForFunction(id=>{const im=N.core.S.images.find(i=>i.id===id);return im.bg&&!im.cut&&im.src.startsWith('data:image/png');},before.id,{timeout:5000});
  assert.ok(Date.now()-t1<3000,'the cut-out comes back at once');
  const toggled=await page.evaluate(id=>{const C=N.core,S=N.core.S,im=()=>S.images.find(i=>i.id===id);
    const cut=im().src;C.undo();const undone=!!im().cut&&!im().bg;C.undo();const orig=!im().cut&&!!im().bg&&im().src===cut;C.redo();C.redo();
    return {undone,orig,again:im().src===cut&&!!im().bg};},before.id);
  assert.ok(toggled.undone&&toggled.orig&&toggled.again,'each toggle is one undo: '+JSON.stringify(toggled));
  // a cropped picture: the background goes from its whole original, so a
  // later, wider crop does not bring it back, and the crop stays as it was
  const cropped=await page.evaluate(async id=>{
    const S=N.core.S,C=N.core,im=S.images.find(i=>i.id===id);
    C.undo();   // back to the photo with its backdrop
    delete im.cut;   // and without the kept cut-out, so the model runs on the crop
    const full=im.full||im.src,el=new Image();await new Promise(r=>{el.onload=r;el.src=full;});
    const cv=document.createElement('canvas');cv.width=el.naturalWidth/2;cv.height=el.naturalHeight;
    cv.getContext('2d').drawImage(el,el.naturalWidth/4,0,cv.width,cv.height,0,0,cv.width,cv.height);
    Object.assign(im,{src:cv.toDataURL('image/jpeg',.92),full,crop:{l:.25,t:0,r:.75,b:1},w:im.w/2,x:im.x+im.w/4});
    const ok=await N.ink.removeBackground(id);
    const size=src=>new Promise(r=>{const i=new Image();i.onload=()=>r([i.naturalWidth,i.naturalHeight,src.slice(5,14)]);i.src=src;});
    const alphaAt=async(src,u,v)=>{const i=new Image();await new Promise(r=>{i.onload=r;i.src=src;});const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);return x.getImageData(Math.round(u*c.width),Math.round(v*c.height),1,1).data[3];};
    const result={ok,src:await size(im.src),full:await size(im.full),crop:im.crop,fullCorner:await alphaAt(im.full,.02,.02),fullChanged:im.full!==full};
    // the toggle keeps the crop: the original comes back cut to the same box
    await N.ink.undoBackground(id);
    result.back={src:await size(im.src),original:im.full===full,crop:im.crop};
    await N.ink.removeBackground(id);
    result.again={src:await size(im.src),crop:im.crop};
    return result;
  },before.id);
  assert.ok(cropped.ok&&cropped.fullChanged,'the original loses its background too');
  assert.equal(cropped.fullCorner,0,"the original backdrop is transparent");
  assert.ok(cropped.src[0]<=300&&cropped.src[1]<400&&cropped.src[2]==='image/png','the existing crop is trimmed to the subject');
  assert.ok(cropped.crop.l>=.25&&cropped.crop.r<=.75&&cropped.crop.t>0&&cropped.crop.b<1,'autocrop stays within the existing crop');
  assert.deepEqual(cropped.back.src,[...cropped.src.slice(0,2),'image/jpe'],'undo background keeps the new crop');
  assert.ok(cropped.back.original,'the original is the whole picture again');
  assert.deepEqual(cropped.again.src,cropped.src,'remove background restores the trimmed cut-out');
  assert.deepEqual(cropped.again.crop,cropped.crop,'the toggle preserves the trimmed crop');
  assert.deepEqual(errors,[]);
  console.log('background removal: ok');
}finally{await context.close();server.close();}
