import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

/* The frame round a selection: a picture and a lasso's ink alike are moved,
   scaled by a corner and turned by the knob above them, with no arrow or
   bigger/smaller buttons in the bar. */
const server=await startServer(0);
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.core?.S.id&&N.ui);
  await page.evaluate(()=>{
    N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');
    N.core.S.settings.aiOn=false;N.ai.toggle();N.core.S.lines=[];N.text.render();N.ink.setTool('select');
  });
  /* world -> screen, the inverse of toWorld */
  const screen=(x,y)=>page.evaluate(([x,y])=>{
    const sc=document.getElementById('scroller'),r=sc.getBoundingClientRect(),M=N.core.M;
    return {x:r.left+N.core.M.colLeft-sc.scrollLeft+x*M.zoom, y:r.top-sc.scrollTop+y*M.zoom};
  },[x,y]);
  const drag=async(from,to,steps=8)=>{
    await page.mouse.move(from.x,from.y);await page.mouse.down();
    for(let i=1;i<=steps;i++)await page.mouse.move(from.x+(to.x-from.x)*i/steps,from.y+(to.y-from.y)*i/steps);
    await page.mouse.up();await page.waitForTimeout(120);
  };

  // ---- ink: a square of four strokes, selected ----
  await page.evaluate(()=>{
    const S=N.core.S;
    const seg=(id,a,b)=>({id,author:'user',w:2.8,t0:1,t1:2,pts:[a[0],a[1],.5,(a[0]+b[0])/2,(a[1]+b[1])/2,.5,b[0],b[1],.5],bbox:[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]});
    S.strokes=[seg('a',[200,300],[300,300]),seg('b',[300,300],[300,400]),seg('c',[300,400],[200,400]),seg('d',[200,400],[200,300])];
    N.recog.rebuild();S.selection=['a','b','c','d'];S.imageSelection=null;N.ink.showSelBar();N.ink.render();
  });
  await page.waitForTimeout(100);
  const bar=page.locator('#selbar');
  assert.equal(await bar.isHidden(),false,'The bar is shown for selected ink');
  // frame: box [197,297,303,403] (+3 pad each side), centre (250,350), knob 30px above the top edge
  const knob=await screen(250,297-3-30), knobTo=await screen(250+53+30,350);   /* a quarter turn clockwise */
  await drag(knob,knobTo,12);
  const turned=await page.evaluate(()=>{const st=N.core.S.strokes.find(s=>s.id==='a');return [st.pts[0],st.pts[1],st.pts[6],st.pts[7]];});
  // stroke a ran (200,300)->(300,300); turned 90deg clockwise about (250,350) it runs (300,300)->(300,400)
  assert.ok(Math.abs(turned[0]-300)<2&&Math.abs(turned[1]-300)<2&&Math.abs(turned[2]-300)<2&&Math.abs(turned[3]-400)<2,'The knob turns the ink about its centre, settling on the square angle: '+turned.map(v=>v.toFixed(1)));
  await page.evaluate(()=>N.core.undo());
  const back=await page.evaluate(()=>{const st=N.core.S.strokes.find(s=>s.id==='a');return [st.pts[0],st.pts[1],st.pts[6],st.pts[7]];});
  assert.deepEqual(back,[200,300,300,300],'Undo puts the ink back exactly');
  await page.evaluate(()=>{N.core.S.selection=['a','b','c','d'];N.ink.showSelBar();N.ink.render();});
  await page.waitForTimeout(100);
  // corner se (303,403) dragged away from nw (197,297) doubles the size
  const se=await screen(303,403), seTo=await screen(197+2*106,297+2*106);
  await drag(se,seTo,10);
  const scaled=await page.evaluate(()=>{const S=N.core.S;const b=N.ink.bboxOf(S.strokes.flatMap(s=>s.pts));return {w:b[2]-b[0],h:b[3]-b[1],x:b[0],y:b[1],lw:S.strokes[0].w};});
  assert.ok(Math.abs(scaled.w-200)<3&&Math.abs(scaled.h-200)<3,'A corner scales the ink about the corner opposite: '+JSON.stringify(scaled));
  // the frame's corner (197,297) is the anchor; the ink's own corner, 3px in, lands 6px in
  assert.ok(Math.abs(scaled.x-203)<3&&Math.abs(scaled.y-303)<3,'The frame corner opposite stays put: '+JSON.stringify(scaled));
  assert.ok(Math.abs(scaled.lw-5.6)<.1,'The line width scales with the ink');
  await page.evaluate(()=>N.core.undo());
  assert.equal(await page.evaluate(()=>N.core.S.strokes[0].w),2.8,'Undo restores the width too');

  // ---- picture ----
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9Qz8DAwMAAAAwCAgGT9rw4AAAAAElFTkSuQmCC';
  await page.evaluate(png=>{
    const S=N.core.S;S.selection=[];
    S.images=[{id:'pic',src:png,x:400,y:300,w:200,h:100}];
    N.ink.selectImage('pic');
  },png);
  await page.waitForTimeout(150);
  const labels=await page.evaluate(()=>[...document.querySelectorAll('#selbar button')].map(b=>b.textContent));
  assert.deepEqual(labels,['remove background','delete'],'A selected picture offers no arrows or bigger/smaller buttons: '+labels.join(','));
  // knob at (500, 300-30) dragged to the right of the centre (500,350): a quarter turn
  const pk=await screen(500,270), pkTo=await screen(500+50+30,350);
  await drag(pk,pkTo,12);
  const rot=await page.evaluate(()=>N.core.S.images[0].rot);
  assert.ok(Math.abs(rot-Math.PI/2)<1e-6,'The knob turns the picture, settling on a right angle: '+rot);
  const labels2=await page.evaluate(()=>[...document.querySelectorAll('#selbar button')].map(b=>b.textContent));
  assert.deepEqual(labels2,['straighten','remove background','delete'],'A turned picture can be straightened from the bar');
  // a turned picture is hit where it is seen: its centre column now runs 400..600 tall, 450..550 wide
  assert.equal(await page.evaluate(()=>N.ink.imageAt(460,420)?.id),'pic','Inside the turned picture');
  assert.equal(await page.evaluate(()=>N.ink.imageAt(420,320)?.id),undefined,'The old upright corner is now empty paper');
  // a corner of the turned picture still resizes it, the opposite corner staying put
  const before=await page.evaluate(()=>{const im=N.core.S.images[0];return {x:im.x,y:im.y,w:im.w,h:im.h};});
  const hs=await page.evaluate(()=>N.ink.frameHandles(N.ink.frameOf(N.core.S.images[0])));
  const seH=hs.find(h=>h.k==='se'),nwH=hs.find(h=>h.k==='nw');
  const seS=await screen(seH.x,seH.y), seTo2=await screen(seH.x+(seH.x-nwH.x)*.5,seH.y+(seH.y-nwH.y)*.5);
  await drag(seS,seTo2,10);
  const after=await page.evaluate(()=>{const im=N.core.S.images[0];const hs=N.ink.frameHandles(N.ink.frameOf(im));return {w:im.w,h:im.h,nw:hs.find(h=>h.k==='nw')};});
  assert.ok(after.w>before.w*1.3&&Math.abs(after.w/after.h-2)<.01,'The corner grows the turned picture, keeping its shape: '+JSON.stringify(after));
  assert.ok(Math.hypot(after.nw.x-nwH.x,after.nw.y-nwH.y)<2,'The corner opposite the hand stays where it was on the page');
  await page.locator('#selbar button',{hasText:'straighten'}).click();
  assert.equal(await page.evaluate(()=>N.core.S.images[0].rot),undefined,'Straighten drops the turn');
  await page.evaluate(()=>N.core.undo());
  assert.ok(Math.abs(await page.evaluate(()=>N.core.S.images[0].rot)-Math.PI/2)<1e-6,'Undo brings the turn back');

  console.log('Frames: ink turn and scale, picture turn, resize while turned, straighten, bar without arrows passed');
}finally{
  await browser.close();server.close();
}
