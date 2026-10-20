import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {chromium} from 'playwright';
import {startServer} from '../scripts/serve.mjs';

const html=readFileSync(new URL('../notas.html',import.meta.url),'utf8');
const ctx=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function tidyShape('),html.indexOf('let shapeTimer=')),ctx);
vm.runInContext(html.slice(html.indexOf('function pointInPoly('),html.indexOf('/* ---- pointer diagnostics ----')),ctx);
const ink=p=>p.flatMap(([x,y])=>[x,y,.5]);
const polygon=c=>c.flatMap((p,i)=>Array.from({length:16},(_,j)=>{
  const q=c[(i+1)%c.length];return [p[0]+(q[0]-p[0])*j/16,p[1]+(q[1]-p[1])*j/16];
})).concat([c[0]]);
const rotated=(w,h,degrees)=>{
  const a=degrees*Math.PI/180;
  return [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[300+x*Math.cos(a)-y*Math.sin(a),400+x*Math.sin(a)+y*Math.cos(a)]);
};
const upright=pts=>{
  for(let i=3;i<pts.length;i+=3)if(Math.abs(pts[i]-pts[i-3])>1e-7&&Math.abs(pts[i+1]-pts[i-2])>1e-7)return false;
  return true;
};
for(const [w,h] of [[160,100],[120,120],[80,200]]){
  for(const angle of [0,5,-5,15,-15,22,-22,70,85,95,110,175,185,265]){
    for(const reverse of [false,true]){
      const c=rotated(w,h,angle);if(reverse)c.reverse();
      const out=ctx.tidyShape(ink(polygon(c)));
      assert.equal(out?.length,15,`recognizes ${w}x${h} at ${angle}`);
      assert.ok(upright(out),`levels ${w}x${h} at ${angle}`);
      const xs=out.filter((_,i)=>i%3===0),ys=out.filter((_,i)=>i%3===1);
      const sides=[Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)].sort((a,b)=>a-b);
      assert.ok(Math.abs(sides[0]-Math.min(w,h))<1e-6&&Math.abs(sides[1]-Math.max(w,h))<1e-6,'keeps fitted side lengths');
      assert.ok(Math.abs((Math.max(...xs)+Math.min(...xs))/2-300)<1e-6&&Math.abs((Math.max(...ys)+Math.min(...ys))/2-400)<1e-6,'keeps centre');
    }
  }
  for(const angle of [30,-30,45,60,135]){
    const out=ctx.tidyShape(ink(polygon(rotated(w,h,angle))));
    assert.equal(out?.length,15);assert.equal(upright(out),false,'keeps deliberate diagonals');
  }
}
const trapezium=[[100,100],[300,100],[250,220],[150,220]];
const trapeziumOut=ctx.tidyShape(ink(polygon(trapezium)));
assert.equal(trapeziumOut?.length,15);assert.equal(upright(trapeziumOut),false,'keeps trapezium sides');
const loop=[150,330,450,330,450,470,150,470];
const frame=[[100,280],[500,280],[500,520],[100,520],[100,280]];
assert.equal(ctx.strokeInPoly(ink(frame),loop),false,'sparse surrounding rectangle stays out');
assert.equal(ctx.strokeInPoly(ink(polygon(frame.slice(0,4))),loop),false,'dense surrounding rectangle stays out');
assert.equal(ctx.strokeInPoly(ink([[220,380],[240,420],[260,380]]),loop),true,'writing inside is selected');
assert.equal(ctx.strokeInPoly(ink([[220,400]]),loop),true,'single-point dots are selected');
assert.equal(ctx.strokeInPoly(ink([[220,400],[220,400]]),loop),true,'stationary dots are selected');
assert.equal(ctx.strokeInPoly(ink([[100,400],[500,400]]),loop),true,'sparse strokes crossing the loop use enclosed length');
assert.equal(ctx.strokeInPoly(ink([[0,400],[600,400]]),[250,350,350,350,350,450,250,450]),false,'small loop cannot select a long line by its centre');
assert.equal(ctx.strokeInPoly(ink(frame),[50,250,550,250,550,550,50,550]),true,'enclosing the whole frame still selects it');

const server=await startServer(0);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.core?.S.id&&N.ui);
  await page.evaluate(()=>{
    N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');
    N.core.S.settings.aiOn=false;N.ai.toggle();N.core.S.lines=[];N.core.S.strokes=[];N.text.render();N.ink.setTool('pen');
  });
  const pen=async(type,p)=>{
    const [x,y]=await page.evaluate(([x,y])=>{
      const sc=document.getElementById('scroller'),r=sc.getBoundingClientRect(),M=N.core.M;
      return [r.left+M.colLeft-sc.scrollLeft+x*M.zoom,r.top-sc.scrollTop+y*M.zoom];
    },p);
    await page.locator('#c-ink').dispatchEvent(type,{pointerId:73,pointerType:'pen',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,pressure:.5,clientX:x,clientY:y,bubbles:true});
  };
  const points=polygon(rotated(200,130,10));
  await pen('pointerdown',points[0]);
  for(const p of points.slice(1))await pen('pointermove',p);
  await page.waitForTimeout(750);await pen('pointerup',points.at(-1));
  const snapped=await page.evaluate(()=>N.core.S.strokes[0]);
  assert.equal(snapped.pts.length,15,'held rectangle tidies through pointer input');
  assert.ok(upright(snapped.pts),'held rectangle has horizontal and vertical edges');
  assert.equal(snapped.times.length,5);
  await page.evaluate(()=>N.core.undo());assert.equal(await page.evaluate(()=>N.core.S.strokes.length),0);
  await page.evaluate(()=>N.core.redo());assert.ok(upright(await page.evaluate(()=>N.core.S.strokes[0].pts)));

  const strokes=[['frame',ink(frame)],['letter-a',ink([[220,380],[240,420],[260,380]])],['letter-b',ink([[320,380],[320,420],[350,420]])]];
  await page.evaluate(strokes=>{
    const S=N.core.S;S.selection=[];S.imageSelection=null;S.images=[];
    S.strokes=strokes.map(([id,pts])=>({id,pts,author:'user',tool:'pen',w:2.4,t0:1,t1:2,bbox:N.ink.bboxOf(pts)}));
    N.ink.setTool('select');N.ink.render();
  },strokes);
  const lasso=async corners=>{
    const p=polygon(corners);await pen('pointerdown',p[0]);
    for(const q of p.slice(1))await pen('pointermove',q);
    await pen('pointerup',p.at(-1));
    return page.evaluate(()=>N.core.S.selection);
  };
  assert.deepEqual(await lasso([[150,330],[450,330],[450,470],[150,470]]),['letter-a','letter-b'],'lasso inside a frame selects only the writing');
  await page.keyboard.press('Delete');
  assert.deepEqual(await page.evaluate(()=>N.core.S.strokes.map(s=>s.id)),['frame'],'deleting the contents leaves the frame');
  await page.evaluate(()=>{N.core.undo();N.core.S.selection=[];N.ink.render();});
  assert.deepEqual((await lasso([[50,250],[550,250],[550,550],[50,550]])).sort(),['frame','letter-a','letter-b'],'lasso around everything still selects the frame');
  assert.deepEqual(errors,[]);
  console.log('Upright shape snapping and ink-based lasso selection passed, including pointer input, delete, undo and redo.');
}finally{
  await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
