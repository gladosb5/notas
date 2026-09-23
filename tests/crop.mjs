// Cropping a picture: a double click (and two taps with the pen) opens the
// crop, handles move its sides, done keeps the part inside at full
// resolution without moving it on the page, cancel and Escape leave the
// picture alone, and one undo brings the whole picture back.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
  const context=await browser.newContext({viewport:{width:900,height:1000}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N&&N.ui&&N.ink&&N.ink.startCrop);
  // a 400x300 PNG in four coloured quarters
  const id=await page.evaluate(async()=>{
    const S=N.core.S;
    const skip=[...document.querySelectorAll('.tut button')].find(b=>b.textContent.trim()==='skip');if(skip)skip.click();
    const cv=document.createElement('canvas');cv.width=400;cv.height=300;const x=cv.getContext('2d');
    x.fillStyle='#d22';x.fillRect(0,0,200,150);x.fillStyle='#2a2';x.fillRect(200,0,200,150);
    x.fillStyle='#22d';x.fillRect(0,150,200,150);x.fillStyle='#dd2';x.fillRect(200,150,200,150);
    const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
    await N.ui.insertImages([new File([blob],'quarters.png',{type:'image/png'})]);
    N.ink.clearSelection();
    return S.images.at(-1).id;
  });
  // page point -> screen point, the inverse of toWorld
  const screen=(wx,wy)=>page.evaluate(([wx,wy])=>{
    const sc=document.querySelector('#scroller'),r=sc.getBoundingClientRect(),M=N.core.M;
    return {x:wx*M.zoom+r.left+M.colLeft-sc.scrollLeft,y:wy*M.zoom+r.top-sc.scrollTop};
  },[wx,wy]);
  const box=()=>page.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {x:im.x,y:im.y,w:im.w,h:im.h,src:im.src};},id);
  const bar=()=>page.locator('#selbar button').allTextContents();
  const b0=await box();
  const mid=await screen(b0.x+b0.w/2,b0.y+b0.h/2);

  // 1. a double click with the select tool opens the crop
  await page.evaluate(()=>N.ink.setTool('select'));
  await page.mouse.dblclick(mid.x,mid.y);
  assert.ok(await page.evaluate(()=>!!N.ink.cropping()),'a double click opens the crop');
  assert.deepEqual(await bar(),['done','cancel'],'the bar offers done and cancel while cropping');

  // 2. Escape leaves the picture as it was and keeps it selected
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>N.ink.cropping()),null,'Escape closes the crop');
  assert.equal((await box()).src,b0.src,'Escape leaves the picture alone');
  assert.ok((await bar()).includes('remove background'),'the picture is still selected after Escape');

  // 3. two quick taps with the pen open it too
  await page.evaluate(()=>{N.ink.clearSelection();N.ink.setTool('pen');});
  const strokesBefore=await page.evaluate(()=>N.core.S.strokes.length);
  await page.mouse.click(mid.x,mid.y);await page.mouse.click(mid.x,mid.y);
  assert.ok(await page.evaluate(()=>!!N.ink.cropping()),'two pen taps open the crop');
  assert.equal(await page.evaluate(()=>N.core.S.strokes.length),strokesBefore,'the taps leave no ink');

  // 4. drag the bottom-right corner to the centre and the left edge a quarter in: the red quarter's right half is left
  const drag=async(from,to)=>{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:10});await page.mouse.up();};
  await drag(await screen(b0.x+b0.w,b0.y+b0.h),await screen(b0.x+b0.w/2,b0.y+b0.h/2));
  await drag(await screen(b0.x,b0.y+b0.h/4),await screen(b0.x+b0.w/4,b0.y+b0.h/4));
  const frac=await page.evaluate(()=>N.ink.cropping());
  assert.ok(Math.abs(frac.r-.5)<.02&&Math.abs(frac.b-.5)<.02&&Math.abs(frac.l-.25)<.02&&frac.t===0,'the handles move the sides: '+JSON.stringify(frac));
  await page.locator('#selbar button',{hasText:'done'}).click();
  await page.waitForFunction(([id,src])=>N.core.S.images.find(i=>i.id===id).src!==src,[id,b0.src]);
  const b1=await box();
  const px=await page.evaluate(async src=>{
    const img=new Image();await new Promise(r=>{img.onload=r;img.src=src;});
    const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);
    const at=(u,v)=>[...x.getImageData(Math.floor(u*c.width),Math.floor(v*c.height),1,1).data].slice(0,3);
    return {w:c.width,h:c.height,tl:at(.1,.1),br:at(.9,.9)};
  },b1.src);
  assert.ok(Math.abs(px.w-100)<=4&&Math.abs(px.h-150)<=4,'the crop keeps full-resolution pixels: '+px.w+'x'+px.h);
  assert.deepEqual(px.tl,[221,34,34],'only the red quarter is left');
  assert.deepEqual(px.br,[221,34,34],'only the red quarter is left');
  assert.ok(Math.abs(b1.x-(b0.x+b0.w/4))<2&&Math.abs(b1.y-b0.y)<2,'the kept part stays where it was on the page');
  assert.ok(Math.abs(b1.w-b0.w/4)<2&&Math.abs(b1.h-b0.h/2)<2,'and keeps its size on the page');

  // 5. one undo brings the whole picture back, redo the crop
  await page.evaluate(()=>N.core.undo());
  assert.deepEqual(await box(),b0,'one undo restores the whole picture');
  await page.evaluate(()=>N.core.redo());
  assert.equal((await box()).src,b1.src,'redo crops again');

  // 6. a turned picture crops in its own frame, and the kept part stays put:
  //    turned a quarter, its right edge ('e') is at the bottom of what is seen
  await page.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);im.rot=Math.PI/2;N.ink.clearSelection();N.ink.setTool('select');N.ink.render();},id);
  const t0=await box(),cx=t0.x+t0.w/2,cy=t0.y+t0.h/2;
  const tmid=await screen(cx,cy);
  await page.mouse.dblclick(tmid.x,tmid.y);
  assert.ok(await page.evaluate(()=>!!N.ink.cropping()),'a turned picture opens its crop');
  await drag(await screen(cx,cy+t0.w/2),await screen(cx,cy));
  const tf=await page.evaluate(()=>N.ink.cropping());
  assert.ok(Math.abs(tf.r-.5)<.02&&tf.l===0&&tf.t===0&&tf.b===1,'the handle moves the side in the picture frame: '+JSON.stringify(tf));
  await page.keyboard.press('Enter');
  await page.waitForFunction(([id,src])=>N.core.S.images.find(i=>i.id===id).src!==src,[id,t0.src]);
  const t1=await page.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {cx:im.x+im.w/2,cy:im.y+im.h/2,w:im.w,h:im.h,rot:im.rot};},id);
  assert.ok(Math.abs(t1.w-t0.w/2)<2&&Math.abs(t1.h-t0.h)<2&&t1.rot===Math.PI/2,'the turned crop keeps half its width and its turn');
  assert.ok(Math.abs(t1.cx-cx)<2&&Math.abs(t1.cy-(cy-t0.w/4))<2,'the kept half stays where it was seen: '+JSON.stringify([t1.cx,t1.cy,cx,cy-t0.w/4]));
  assert.deepEqual(errors,[]);
  console.log('crop: ok');
}finally{await browser.close();server.close();}
