import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
  const page=await browser.newPage({viewport:{width:820,height:1180},hasTouch:true,deviceScaleFactor:2});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html?debug=pointers`);
  /* the preparing screen no longer offers a skip button; it closes itself
     once the core libraries load. Click one only if a build still has it. */
  await page.waitForFunction(()=>window.N?.ui);
  if(await page.locator('#prep-skip:visible').count())await page.locator('#prep-skip').click();
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'));
  await page.evaluate(()=>{
    N.tutorial.finish(false);N.core.S.settings.aiOn=false;
    N.core.S.strokes=[];N.ink.setTool('pen');
  });
  await page.locator('.tut:not(.tut-lite)').waitFor({state:'detached'});
  const result=await page.evaluate(async()=>{
    const c=document.getElementById('c-ink'),r=c.getBoundingClientRect(),S=N.core.S;
    const x=r.left+220,y=r.top+320;
    const fire=(type,dx,dy,id=1,coalesced)=>{
      const ev=new PointerEvent(type,{bubbles:true,pointerType:'pen',pointerId:id,
        clientX:x+dx,clientY:y+dy,pressure:type==='pointerup'?0:.6,
        button:type==='pointermove'?-1:0,buttons:type==='pointerup'?0:1});
      if(coalesced)Object.defineProperty(ev,'getCoalescedEvents',{value:()=>coalesced});
      c.dispatchEvent(ev);
    };
    const alpha=id=>{
      const cv=document.getElementById(id),d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n;
    };
    // A complete short flick can arrive between rendered frames, with no move.
    fire('pointerdown',0,0);
    const downPixels=alpha('c-ink');
    fire('pointerup',80,0);
    const flick=S.strokes.at(-1);
    fire('pointerdown',0,50);
    fire('pointermove',20,50,1,[]);
    fire('pointerup',90,50);
    const tail=S.strokes.at(-1);
    for(let i=0;i<40;i++){
      fire('pointerdown',0,100+i*8);
      fire('pointerup',40,100+i*8);
    }
    // Cancellation has no reliable tip position; don't connect to its (0,0).
    fire('pointerdown',0,450);
    fire('pointermove',40,450);
    const cancelledAt=N.ink.toWorld({clientX:x+40,clientY:y+450});
    c.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,pointerType:'pen',clientX:0,clientY:0}));
    const cancelled=S.strokes.at(-1);
    await new Promise(requestAnimationFrame);
    return {downPixels,commitPixels:alpha('c-commit'),flick,tail,
      rapid:S.strokes.slice(2,42),cancelled,cancelledAt,count:S.strokes.length,
      end:N.ink.toWorld({clientX:x+90,clientY:y+50})};
  });
  assert.ok(result.flick.bbox[2]-result.flick.bbox[0]>=79,'fast down/up stroke must retain its path instead of collapsing to a dot');
  assert.ok(result.downPixels>0,'pen contact paints immediately');
  assert.equal(result.tail.pts.at(-3),Math.round(result.end.x*10)/10,'lift position completes the stroke without smoothing away its end');
  assert.equal(result.count,43,'rapid strokes are committed exactly once');
  assert.ok(result.rapid.every(s=>s.bbox[2]-s.bbox[0]>=39),'every rapid stroke keeps its length');
  assert.ok(result.rapid.every(s=>s.times.length===s.pts.length/3),'endpoint timing stays aligned');
  assert.ok(result.cancelled.bbox[0]>0&&result.cancelled.bbox[1]>0,'cancel cannot add a line to the origin');
  assert.ok(result.commitPixels>2000,'fast strokes remain visible on the committed canvas');
  const diagnostic=await page.evaluate(()=>{
    N.ink.setTool('text');
    const target=document.getElementById('textlayer');
    target.addEventListener('pointerdown',e=>e.stopPropagation(),{once:true});
    target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'pen',pointerId:90,clientX:100,clientY:300}));
    const touch=new Event('touchstart',{bubbles:true});
    Object.defineProperty(touch,'changedTouches',{value:[{touchType:'stylus',identifier:91,force:.6,clientX:100,clientY:300}]});
    target.dispatchEvent(touch);
    return {log:document.getElementById('pointer-trace').textContent,tool:N.core.S.tool,count:N.core.S.strokes.length};
  });
  assert.match(diagnostic.log,/PAGE pointerdown.*target=div#textlayer/,'page capture sees input intercepted outside the canvas');
  assert.match(diagnostic.log,/PAGE touchstart.*stylus/,'touch-only contacts are visible in diagnostics');
  assert.equal(diagnostic.tool,'text','automatic tool-switching fix remains reverted');
  assert.equal(diagnostic.count,43,'diagnostics never create strokes');
  assert.deepEqual(errors,[]);
  console.log('Fast Pencil flicks, immediate ink, lift endpoints, 40 rapid strokes and cancellation passed.');
}finally{
  await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
