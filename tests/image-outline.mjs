import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

/* The blue outline belongs to the picture, not to the selection: a tap on
   bare paper lets the options go but the picture keeps its border, and while
   a picture is under the hand — moved, sized or turned — its outline and
   options step aside until the hand lifts. A click (not a loop) with the
   select tool lets whatever was selected go, with a mouse as well as touch. */
const server=await startServer(0);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block',hasTouch:true});
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.core?.S.id&&N.ui);
  await page.evaluate(()=>{
    N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');
    N.core.S.settings.aiOn=false;N.ai.toggle();N.core.S.lines=[];N.text.render();N.ink.setTool('select');
  });
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9Qz8DAwMAAAAwCAgGT9rw4AAAAAElFTkSuQmCC';
  await page.evaluate(png=>{
    const S=N.core.S;
    S.images=[{id:'a',src:png,x:300,y:300,w:200,h:150},{id:'b',src:png,x:650,y:330,w:120,h:90}];
    N.ink.pickImage('a');
  },png);
  await page.waitForTimeout(150);

  const im=id=>page.evaluate(id=>N.core.S.images.find(i=>i.id===id),id);
  const screen=(x,y)=>page.evaluate(([x,y])=>{
    const sc=document.getElementById('scroller'),r=sc.getBoundingClientRect(),M=N.core.M;
    return {x:r.left+M.colLeft-sc.scrollLeft+x*M.zoom, y:r.top-sc.scrollTop+y*M.zoom};
  },[x,y]);
  /* a border pixel of a picture: the outline runs 2px outside its edges */
  const edge=(p,k,ox=0,oy=0)=>[p.x+ox+p.w/2+(k==='l'?-p.w/2-2:k==='r'?p.w/2+2:0),
                               p.y+oy+p.h/2+(k==='t'?-p.h/2-2:k==='b'?p.h/2+2:0)];
  const px=(x,y)=>page.evaluate(([x,y])=>{
    const M=N.core.M,sc=document.getElementById('scroller'),c=document.getElementById('c-commit');
    const d=c.getContext('2d').getImageData(Math.round((M.colLeft-sc.scrollLeft+x*M.zoom)*M.dpr),Math.round((-sc.scrollTop+y*M.zoom)*M.dpr),1,1).data;
    return [d[0],d[1],d[2],d[3]];
  },[x,y]);
  const blue=p=>p[3]>120&&p[2]>p[0]&&p[2]>110;
  const outline=async(id,ox=0,oy=0)=>{ for(const k of ['t','b','l','r']) if(!blue(await px(...edge(await im(id),k,ox,oy)))) return false; return true; };
  const barHidden=()=>page.evaluate(()=>document.getElementById('selbar').hidden);

  // ---- selected: the frame with its options ----
  const labels=await page.evaluate(()=>[...document.querySelectorAll('#selbar button')].map(b=>b.textContent));
  assert.deepEqual(labels,['remove background','delete'],'a selected picture offers remove background and delete');
  assert.equal(await barHidden(),false,'bar beside a selected picture');
  assert.ok(blue(await px(...edge(await im('b'),'l'))),'b wears its outline while a is selected');

  // ---- bare click with the mouse: the options go, the outline stays ----
  const bare=await screen(140,700);
  await page.mouse.click(bare.x,bare.y);
  await page.waitForTimeout(150);
  assert.equal(await barHidden(),true,'a bare click lets the options go');
  assert.equal(await page.evaluate(()=>!!N.core.S.imageSelection),false,'a bare click lets the picture go');
  assert.ok(await outline('a'),'outline stays after click-off');
  assert.ok(await outline('b'),'b outline stays after click-off');

  // ---- touch tap off: the outline still stays ----
  await page.touchscreen.tap(bare.x,bare.y);
  await page.waitForTimeout(150);
  assert.equal(await barHidden(),true,'options stay away after a tap on bare paper');
  assert.ok(await outline('a'),'outline stays after a tap off');

  // ---- while a is moved, its outline and options step aside, b keeps its own ----
  const body=await screen(400,375);
  await page.mouse.move(body.x,body.y); await page.mouse.down();
  for(let i=1;i<=8;i++){ await page.mouse.move(body.x+i*5, body.y+i*4); await page.waitForTimeout(30); }
  await page.waitForTimeout(120);
  assert.equal(await barHidden(),true,'the options wait while a picture is being moved');
  assert.equal(blue(await px(...edge(await im('a'),'t',40,32))),false,'a draws bare under the hand: no border riding along');
  assert.ok(await outline('b'),'b keeps its outline while a is moved');
  await page.mouse.up();
  await page.waitForTimeout(180);
  assert.equal(await barHidden(),false,'the options come back when the hand lifts');
  assert.ok(blue(await px(...edge(await im('a'),'t'))),'the frame sits on a where the hand left it');

  // ---- sizing: the options step aside and return ----
  const hs=await page.evaluate(()=>{const f=N.ink.frameOf(N.core.S.images[0]);
    return N.ink.frameHandles(f).map(h=>({k:h.k,x:h.x,y:h.y}));});
  const se=hs.find(h=>h.k==='se'),nw=hs.find(h=>h.k==='nw');
  const seS=await screen(se.x,se.y), seTo=await screen(se.x+(se.x-nw.x)*.4, se.y+(se.y-nw.y)*.4);
  const before=await im('a');
  await page.mouse.move(seS.x,seS.y); await page.mouse.down();
  for(let i=1;i<=8;i++){ await page.mouse.move(seS.x+(seTo.x-seS.x)*i/8, seS.y+(seTo.y-seS.y)*i/8); await page.waitForTimeout(30); }
  await page.waitForTimeout(120);
  assert.equal(await barHidden(),true,'the options wait while a picture is being sized');
  await page.mouse.up();
  await page.waitForTimeout(180);
  const after=await im('a');
  assert.ok(after.w>before.w*1.2,'the corner grew the picture');
  assert.equal(await barHidden(),false,'the options come back after a size');

  // ---- turning: options aside, back on the lift; outline follows the border ----
  const fk=await page.evaluate(()=>{const f=N.ink.frameOf(N.core.S.images[0]);
    const h=N.ink.frameHandles(f).find(h=>h.k==='rot');return {x:h.x,y:h.y,cx:f.cx,cy:f.cy};});
  const knob=await screen(fk.x,fk.y), knobTo=await screen(fk.x+80,fk.cy);
  await page.mouse.move(knob.x,knob.y); await page.mouse.down();
  for(let i=1;i<=10;i++){ await page.mouse.move(knob.x+(knobTo.x-knob.x)*i/10, knob.y+(knobTo.y-knob.y)*i/10); await page.waitForTimeout(30); }
  await page.waitForTimeout(120);
  assert.equal(await barHidden(),true,'the options stay away while a picture turns');
  assert.ok(blue(await px(...edge(await im('b'),'l'))),'b keeps its outline while a turns');
  await page.mouse.up();
  await page.waitForTimeout(180);
  const rot=await page.evaluate(()=>N.core.S.images[0].rot);
  assert.ok(Math.abs(rot-Math.PI/2)<1e-6,'the knob turned the picture to a right angle');
  assert.equal(await barHidden(),false,'the options come back after a turn');

  await page.evaluate(()=>N.core.undo());
  await page.waitForTimeout(180);
  assert.ok(await outline('a'),'a wears the outline again after undoing the turn');
  assert.ok(await outline('b'),'b outline throughout');
  console.log('Image outline: outline stays after click-off, goes bare under the hand, options return on the lift passed');
}finally{
  await browser.close();server.close();
}
