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

  // 5b. cropping keeps the original: opening the crop again shows the box
  //     where it was on the whole picture, and widening it to the edges
  //     brings the whole picture back
  const kept=await page.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {full:im.full,crop:im.crop};},id);
  assert.equal(kept.full,b0.src,'the original is kept beside the crop');
  assert.ok(Math.abs(kept.crop.l-.25)<.02&&Math.abs(kept.crop.r-.5)<.02&&kept.crop.t===0&&Math.abs(kept.crop.b-.5)<.02,'the box is kept as fractions of the original');
  const b1mid=await screen(b1.x+b1.w/2,b1.y+b1.h/2);
  await page.evaluate(()=>{N.ink.clearSelection();N.ink.setTool('select');});
  await page.mouse.dblclick(b1mid.x,b1mid.y);
  const again=await page.evaluate(()=>N.ink.cropping());
  assert.ok(Math.abs(again.l-.25)<.01&&Math.abs(again.r-.5)<.01&&again.t===0&&Math.abs(again.b-.5)<.01,'a second crop opens on the box it left');
  assert.ok(Math.abs(again.F.x-b0.x)<2&&Math.abs(again.F.y-b0.y)<2&&Math.abs(again.F.w-b0.w)<2,'with the whole original where it was: '+JSON.stringify(again.F));
  await drag(await screen(b0.x+b0.w/2,b0.y+b0.h/2),await screen(b0.x+b0.w,b0.y+b0.h));   // se corner out to the corner
  await drag(await screen(b0.x+b0.w/4,b0.y+b0.h/2),await screen(b0.x,b0.y+b0.h/2));       // west edge (now mid-height) back to the side
  await page.keyboard.press('Enter');
  await page.waitForFunction(([id,src])=>N.core.S.images.find(i=>i.id===id).src===src,[id,b0.src]);
  const whole=await page.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {x:im.x,y:im.y,w:im.w,h:im.h,full:im.full??null,crop:im.crop??null};},id);
  assert.ok(Math.abs(whole.x-b0.x)<2&&Math.abs(whole.y-b0.y)<2&&Math.abs(whole.w-b0.w)<2&&Math.abs(whole.h-b0.h)<2&&!whole.full&&!whole.crop,'widening the box to the edges restores the whole picture: '+JSON.stringify(whole));
  await page.evaluate(()=>N.core.undo());
  assert.equal((await box()).src,b1.src,'and one undo goes back to the crop');

  // 6. a turned picture crops in its own frame, and the kept part stays put:
  //    turned a quarter, its right edge ('e') is at the bottom of what is seen
  await page.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);im.rot=Math.PI/2;N.ink.clearSelection();N.ink.setTool('select');N.ink.render();},id);
  const t0=await box(),cx=t0.x+t0.w/2,cy=t0.y+t0.h/2;
  const tmid=await screen(cx,cy);
  await page.mouse.dblclick(tmid.x,tmid.y);
  assert.ok(await page.evaluate(()=>!!N.ink.cropping()),'a turned picture opens its crop');
  await drag(await screen(cx,cy+t0.w/2),await screen(cx,cy));
  const tf=await page.evaluate(()=>N.ink.cropping());
  // the crop from step 4 is kept (the box is on the whole original now), and
  // the right side moved half way across it
  assert.ok(Math.abs(tf.l-.25)<.01&&Math.abs(tf.r-.375)<.02&&tf.t===0&&Math.abs(tf.b-.5)<.01,'the handle moves the side in the picture frame: '+JSON.stringify({l:tf.l,t:tf.t,r:tf.r,b:tf.b}));
  await page.keyboard.press('Enter');
  await page.waitForFunction(([id,src])=>N.core.S.images.find(i=>i.id===id).src!==src,[id,t0.src]);
  const t1=await page.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {cx:im.x+im.w/2,cy:im.y+im.h/2,w:im.w,h:im.h,rot:im.rot};},id);
  assert.ok(Math.abs(t1.w-t0.w/2)<2&&Math.abs(t1.h-t0.h)<2&&t1.rot===Math.PI/2,'the turned crop keeps half its width and its turn');
  assert.ok(Math.abs(t1.cx-cx)<2&&Math.abs(t1.cy-(cy-t0.w/4))<2,'the kept half stays where it was seen: '+JSON.stringify([t1.cx,t1.cy,cx,cy-t0.w/4]));
  assert.deepEqual(errors,[]);

  // 7. on a touch screen a hand wobbles: a double tap whose second tap
  //    drifts still opens the crop and does not move the picture, a small
  //    wobble on its own is not a drag, and a real drag still moves it
  const tctx=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true,isMobile:true});
  const tp=await tctx.newPage();
  await tp.goto(base+'/notas.html');
  await tp.waitForFunction(()=>window.N&&N.ui&&N.ink&&N.ink.startCrop);
  const tid=await tp.evaluate(async()=>{
    const skip=[...document.querySelectorAll('.tut button')].find(b=>b.textContent.trim()==='skip');if(skip)skip.click();
    const cv=document.createElement('canvas');cv.width=400;cv.height=300;const x=cv.getContext('2d');x.fillStyle='#48c';x.fillRect(0,0,400,300);
    const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
    await N.ui.insertImages([new File([blob],'p.png',{type:'image/png'})]);
    N.ink.clearSelection();N.ink.setTool('select');return N.core.S.images.at(-1).id;
  });
  const cdp=await tctx.newCDPSession(tp);
  // finger-sized contacts: a touch with no radius is taken for a stylus
  const touch=async(from,path,hold=40)=>{
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x,y:from.y,radiusX:12,radiusY:12,force:.5}]});
    for(const [dx,dy] of path)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+dx,y:from.y+dy,radiusX:12,radiusY:12,force:.5}]});
    await tp.waitForTimeout(hold);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  const tbox=()=>tp.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {x:im.x,y:im.y};},tid);
  const tscreen=(wx,wy)=>tp.evaluate(([wx,wy])=>{const sc=document.querySelector('#scroller'),r=sc.getBoundingClientRect(),M=N.core.M;return {x:wx*M.zoom+r.left+M.colLeft-sc.scrollLeft,y:wy*M.zoom+r.top-sc.scrollTop};},[wx,wy]);
  const at0=await tbox(),tc=await tp.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {x:im.x+im.w/2,y:im.y+im.h/2};},tid);
  const tm=await tscreen(tc.x,tc.y);
  await touch(tm,[[2,1]]);await tp.waitForTimeout(80);
  await touch({x:tm.x+6,y:tm.y+4},[[6,4],[12,9],[18,6]]);   // the second tap drifts 18px
  await tp.waitForTimeout(100);
  assert.ok(await tp.evaluate(()=>!!N.ink.cropping()),'a wobbly double tap opens the crop');
  assert.deepEqual(await tbox(),at0,'a wobbly double tap does not move the picture');
  await tp.keyboard.press('Escape');
  await tp.waitForTimeout(500);   // past the double-tap window
  await touch(tm,[[4,3],[8,6]]);   // a lone 10px wobble
  assert.deepEqual(await tbox(),at0,'a small wobble on its own is not a drag');
  await tp.waitForTimeout(500);
  await touch(tm,[[10,0],[30,0],[60,0],[80,0]],60);   // a real drag
  const moved=await tbox();
  assert.ok(Math.abs(moved.x-at0.x-80/await tp.evaluate(()=>N.core.M.zoom))<3&&moved.y===at0.y,'a real drag still moves the picture: '+JSON.stringify([at0,moved]));
  // 8. two fingers on a selected picture: spread to twice the size and turn a
  //    quarter, about the point between them; one undo puts it back
  const multi=async(a,b,steps)=>{
    const pt=(p,id)=>({x:p.x,y:p.y,radiusX:12,radiusY:12,force:.5,id});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pt(a,1)]});
    await tp.waitForTimeout(30);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pt(a,1),pt(b,2)]});
    for(const [A,B] of steps){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[pt(A,1),pt(B,2)]}); }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await tp.waitForTimeout(60);
  };
  // spread from 40px apart to 80px apart while turning a quarter, about the picture's centre
  const around=(c,r,a)=>[{x:c.x-r*Math.cos(a),y:c.y-r*Math.sin(a)},{x:c.x+r*Math.cos(a),y:c.y+r*Math.sin(a)}];
  const path=n=>[...Array(n)].map((_,i)=>{const f=(i+1)/n;return around(pc,20+20*f,Math.PI/2*f);});
  // lower on the page, so doubling it does not reach the paper's top edge
  await tp.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);im.y=320;N.ink.clearSelection();N.ink.setTool('select');N.ink.selectImage(id);},tid);
  const g0=await tp.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {x:im.x,y:im.y,w:im.w,h:im.h,rot:im.rot||0};},tid);
  const pc=await tscreen(g0.x+g0.w/2,g0.y+g0.h/2);
  const [a0,b0t]=around(pc,20,0);
  await multi(a0,b0t,path(12));
  const g1=await tp.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {x:im.x,y:im.y,w:im.w,h:im.h,rot:im.rot||0};},tid);
  assert.ok(Math.abs(g1.w-g0.w*2)<3&&Math.abs(g1.rot-Math.PI/2)<.02,'two fingers scale and turn a picture: '+JSON.stringify([g0,g1]));
  assert.ok(Math.abs(g1.x+g1.w/2-(g0.x+g0.w/2))<3&&Math.abs(g1.y+g1.h/2-(g0.y+g0.h/2))<3,'about the point between the fingers');
  await tp.evaluate(()=>N.core.undo());
  const g2=await tp.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {x:im.x,y:im.y,w:im.w,h:im.h,rot:im.rot||0};},tid);
  assert.deepEqual(g2,g0,'one undo puts the picture back');

  // 9. two fingers zoom the image beneath a stationary crop, ignoring twist
  await tp.evaluate(id=>N.ink.startCrop(id),tid);
  await multi(a0,b0t,[...Array(8)].map((_,i)=>{const f=(i+1)/8;return around(pc,20+20*f,Math.PI/2*f);}));
  const cz=await tp.evaluate(()=>N.ink.cropping());
  assert.ok(Math.abs((cz.r-cz.l)-.5)<.03&&Math.abs((cz.b-cz.t)-.5)<.03&&Math.abs(cz.F.rot||0)<.02,'spreading zooms into the crop without twisting the guide: '+JSON.stringify({l:cz.l,r:cz.r,t:cz.t,b:cz.b,rot:cz.F.rot}));
  const fixed=c=>({x:c.F.x+c.l*c.F.w,y:c.F.y+c.t*c.F.h,w:(c.r-c.l)*c.F.w,h:(c.b-c.t)*c.F.h});
  const fixed0=fixed(cz);
  assert.ok(Math.abs(fixed0.w-g0.w)<3,'zoom leaves the guide width unchanged');
  await touch(pc,[[12,6],[30,15]]);
  const movedCrop=await tp.evaluate(()=>N.ink.cropping());
  await tp.screenshot({path:'test-results/crop-fixed-guide.png'});
  for(const key of ['x','y','w','h'])assert.ok(Math.abs(fixed(movedCrop)[key]-fixed0[key])<.1,'drag keeps crop '+key+' fixed');
  assert.ok(Math.abs(movedCrop.F.x-cz.F.x)>20,'drag moves the source image');
  await touch(pc,[[2000,2000]]);
  const bounded=await tp.evaluate(()=>N.ink.cropping());
  assert.ok(bounded.l>=0&&bounded.t>=0&&bounded.r<=1&&bounded.b<=1,'panning cannot expose empty edges');
  await tp.keyboard.press('Enter');
  await tp.waitForFunction(id=>!!N.core.S.images.find(i=>i.id===id).crop,tid);
  const cr=await tp.evaluate(id=>{const im=N.core.S.images.find(i=>i.id===id);return {w:im.w,rot:im.rot||0};},tid);
  assert.ok(Math.abs(cr.w-g0.w)<3&&Math.abs(cr.rot)<.02,'the crop keeps its on-page size and orientation: '+JSON.stringify(cr));

  // 10. two fingers on lassoed ink scale and turn it too
  await tp.evaluate(()=>{
    const S=N.core.S;N.ink.clearSelection();
    S.strokes.push({id:'ink1',author:'user',pts:[500,200,0,560,200,10,560,240,20],bbox:[500,200,560,240],w:2,color:''});
    N.ink.setTool('select');N.ink.render();
  });
  await tp.evaluate(()=>N.ink.selectAll());
  const ic=await tscreen(530,220);
  const [ia,ib]=around(ic,20,0);
  await multi(ia,ib,[...Array(8)].map((_,i)=>around(ic,20+20*(i+1)/8,0)));
  const inked=await tp.evaluate(()=>N.core.S.strokes.find(s=>s.id==='ink1').bbox);
  assert.ok(Math.abs((inked[2]-inked[0])-120)<3&&Math.abs((inked[3]-inked[1])-80)<3,'two fingers scale lassoed ink: '+JSON.stringify(inked));
  await tp.evaluate(()=>N.core.undo());
  assert.deepEqual(await tp.evaluate(()=>N.core.S.strokes.find(s=>s.id==='ink1').bbox),[500,200,560,240],'one undo puts the ink back');
  await tctx.close();
  console.log('crop: ok');
}finally{await browser.close();server.close();}
