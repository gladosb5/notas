// Fixes from the September checklist: the answer's handwriting uses the free
// paper beside a picture and the width of the question; boxes and rules
// drawn round notes are kept out of the readers and split side-by-side rows;
// the caret follows its line when nota's reply pushes it down; two fingers on
// Android scroll instead of drawing; a regroup after a stroke on a long note
// is local and quick.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const sse=(text)=>text.split(/(?<= )/).map(piece=>`data: ${JSON.stringify({choices:[{delta:{content:piece}}]})}\n\n`).join('')+'data: [DONE]\n\n';
const REPLY='A bag holds 3 red, 2 blue and 5 green marbles, 10 in all. The chance of red is 3/10, of blue 2/10 and of green 5/10.';
async function open(ua){
  const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true,serviceWorkers:'block',...(ua?{userAgent:ua}:{})});
  const page=await context.newPage();
  page.on('pageerror',e=>{throw e;});
  await context.route(/\/nota\/chat$|api\.cerebras\.ai/,async route=>{
    await new Promise(r=>setTimeout(r,400));
    route.fulfill({status:200,contentType:'text/event-stream',body:sse(REPLY)});
  });
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.ui?.importNoteFile);
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'),null,{timeout:30000});
  await page.evaluate(()=>{N.tutorial?.finish(false);localStorage.setItem('notas.nota.key','csk-test-0123456789');});
  return {context,page};
}
try{
  {
    const {context,page}=await open();
    // ---- the answer flows beside a picture instead of under it ----
    const placed=await page.evaluate(async()=>{
      const C=N.core,S=C.S;S.lines=[];S.strokes=[];N.text.render();
      /* a picture to the right of the question, reaching well below it */
      const cv=document.createElement('canvas');cv.width=40;cv.height=30;const x=cv.getContext('2d');x.fillStyle='#8c8';x.fillRect(0,0,40,30);
      S.images=[{id:'pic',src:cv.toDataURL(),x:520,y:60,w:420,h:260}];
      const w=N.nota.Writer({x:20,y:110,right:500,rowH:30,skip:new Set(),instant:true});
      w.feed(document.title+' '+'word '.repeat(60));w.finish();
      const mine=new Set(w.ids),ai=S.strokes.filter(s=>mine.has(s.id));
      const box=[Math.min(...ai.map(s=>s.bbox[0])),Math.min(...ai.map(s=>s.bbox[1])),Math.max(...ai.map(s=>s.bbox[2])),Math.max(...ai.map(s=>s.bbox[3]))];
      const overlapsPicture=ai.some(s=>s.bbox[2]>520&&s.bbox[0]<940&&s.bbox[3]>60&&s.bbox[1]<320);
      const firstTop=Math.min(...ai.map(s=>s.bbox[1]));
      const reachesPast=ai.some(s=>s.bbox[1]>330&&s.bbox[2]>560);
      S.images=[];S.strokes=[];
      return {box,overlapsPicture,firstTop,reachesPast};
    });
    assert.equal(placed.overlapsPicture,false,'the answer never writes over the picture');
    assert.ok(placed.firstTop<140,'the answer starts right under the question, beside the picture: '+JSON.stringify(placed));
    assert.ok(placed.reachesPast,'below the picture the rows widen again: '+JSON.stringify(placed));

    // ---- a question written wider than the column gets an answer as wide ----
    const wide=await page.evaluate(()=>{
      const C=N.core,S=C.S;S.strokes=[];
      const w=N.nota.Writer({x:10,y:100,right:1400,rowH:30,skip:new Set(),instant:true});
      w.feed('word '.repeat(80));w.finish();
      const ai=S.strokes;const r=Math.max(...ai.map(s=>s.bbox[2]));S.strokes=[];
      return {right:r,contentW:C.M.contentW};
    });
    assert.ok(wide.right>wide.contentW+100,'the answer uses the width the question was written across: '+JSON.stringify(wide));

    // ---- boxes: frames are not ink to read, and side-by-side boxes are separate rows ----
    const framed=await page.evaluate(()=>{
      const C=N.core,S=C.S;
      let t=1;const st=(pts)=>{const s={id:C.uid(),author:'user',tool:'pen',w:2.4,pts:pts.flatMap(p=>[p[0],p[1],.5]),t0:t,t1:t+100};t+=400;s.bbox=N.ink.bboxOf(s.pts);return s;};
      const line=(a,b,n=12)=>st(Array.from({length:n},(_,i)=>[a[0]+(b[0]-a[0])*i/(n-1),a[1]+(b[1]-a[1])*i/(n-1)]));
      const letter=(x,y)=>st(Array.from({length:12},(_,i)=>[x+6+6*Math.cos(i/11*6.28),y+9*Math.sin(i/11*6.28)]));
      const strokes=[],frames=[];
      /* two boxes side by side, each with a header rule, and words inside */
      for(const [bx,by] of [[40,100],[420,100]]){
        const box=st([[bx,by],[bx+300,by],[bx+300,by+220],[bx,by+220],[bx,by+2]].flatMap((p,i,a)=>i?Array.from({length:10},(_,k)=>[a[i-1][0]+(p[0]-a[i-1][0])*(k+1)/10,a[i-1][1]+(p[1]-a[i-1][1])*(k+1)/10]):[p]));
        const rule=line([bx+4,by+50],[bx+296,by+50]);
        frames.push(box.id,rule.id);strokes.push(box,rule);
        for(let r=0;r<3;r++)for(let k=0;k<8;k++)strokes.push(letter(bx+20+k*16,by+25+r*60));
      }
      S.strokes=strokes;N.recog.rebuild();
      const inClusters=new Set(S.clusters.flatMap(c=>c.strokeIds));
      const rows=N.recog.textGroups();
      const spansBoth=rows.some(g=>g.bbox[0]<340&&g.bbox[2]>420);
      const out={framesOut:frames.every(id=>!inClusters.has(id)),detected:frames.filter(id=>N.recog.frames().ids.has(id)).length,boxes:N.recog.frames().boxes.length,spansBoth};
      S.strokes=[];N.recog.rebuild();
      return out;
    });
    assert.equal(framed.detected,4,'both boxes and both header rules are frames: '+JSON.stringify(framed));
    assert.equal(framed.framesOut,true,'frames are kept out of the maths groups');
    assert.equal(framed.boxes,2,'two boxes are found');
    assert.equal(framed.spansBoth,false,'no text row runs across both boxes');

    // a fraction bar has writing under it: it is not a frame
    const fraction=await page.evaluate(()=>{
      const C=N.core,S=C.S;let t=1;
      const st=(pts)=>{const s={id:C.uid(),author:'user',tool:'pen',w:2.4,pts:pts.flatMap(p=>[p[0],p[1],.5]),t0:t,t1:t+100};t+=300;s.bbox=N.ink.bboxOf(s.pts);return s;};
      const letter=(x,y)=>st(Array.from({length:12},(_,i)=>[x+6+6*Math.cos(i/11*6.28),y+9*Math.sin(i/11*6.28)]));
      const bar=st(Array.from({length:12},(_,i)=>[100+i*12,200]));
      S.strokes=[letter(120,180),letter(150,180),bar,letter(130,222),letter(160,222)];N.recog.rebuild();
      const r=N.recog.frames().ids.has(bar.id);S.strokes=[];N.recog.rebuild();return r;
    });
    assert.equal(fraction,false,'a fraction bar stays maths');

    // a radical sign has a box corner's outline; only the corner is a frame
    const radical=await page.evaluate(()=>{
      const C=N.core,S=C.S;let t=1;
      const st=(pts)=>{const s={id:C.uid(),author:'user',tool:'pen',w:2.4,pts:pts.flatMap(p=>[p[0],p[1],.5]),t0:t,t1:t+100};t+=300;s.bbox=N.ink.bboxOf(s.pts);return s;};
      const path=corners=>st(corners.flatMap((p,i,a)=>i?Array.from({length:10},(_,k)=>[a[i-1][0]+(p[0]-a[i-1][0])*(k+1)/10,a[i-1][1]+(p[1]-a[i-1][1])*(k+1)/10]):[p]));
      const letter=(x,y)=>st(Array.from({length:12},(_,i)=>[x+6+6*Math.cos(i/11*6.28),y+9*Math.sin(i/11*6.28)]));
      const read=corners=>{
        const sign=path(corners),under=[letter(130,205),letter(160,205),letter(190,205)];
        S.strokes=[sign,...under];N.recog.rebuild();
        const r={frame:N.recog.frames().ids.has(sign.id),grouped:S.clusters.some(c=>c.strokeIds.includes(sign.id)&&under.every(u=>c.strokeIds.includes(u.id)))};
        S.strokes=[];N.recog.rebuild();return r;
      };
      return {sqrt:read([[100,215],[108,240],[114,190],[260,188]]),corner:read([[100,240],[100,188],[260,188]])};
    });
    assert.deepEqual(radical.sqrt,{frame:false,grouped:true},'a square root sign stays with the writing under it');
    assert.equal(radical.corner.frame,true,'a box corner of the same size is still a frame');

    // ---- the caret moves with its line when the reply lands above it ----
    await page.evaluate(()=>{N.core.S.lines=[];N.text.render();N.ink.setTool('text');N.text.add(120,true);});
    await page.keyboard.type('hey nota, give me a probability example?');
    await page.keyboard.press('Enter');
    await page.keyboard.type('next');
    const before=await page.evaluate(()=>document.getElementById('caret').style.transform);
    await page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&/marbles/.test(l.text)),null,{timeout:8000});
    await page.waitForTimeout(100);
    const after=await page.evaluate(()=>{
      const cur=N.text.currentText(),line=cur.parentElement;
      const m=/translate\(([-\d.]+)px, ?([-\d.]+)px\)/.exec(document.getElementById('caret').style.transform);
      return {y:+m[2],lineTop:line.offsetTop,value:cur.value,start:cur.selectionStart};
    });
    assert.equal(after.value,'next','the caret stays in the line being typed');
    assert.equal(after.start,4,'and at the same place in it');
    assert.ok(Math.abs(after.y-after.lineTop)<8,'the caret bar is drawn on that line, not where it was: '+JSON.stringify({before,after}));
    await context.close();
  }
  {
    // ---- Android: a finger reports pressure; two fingers still scroll ----
    const {context,page}=await open('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36');
    const res=await page.evaluate(async()=>{
      const S=N.core.S;S.strokes=[];S.lines=[];N.text.render();N.ink.setTool('pen');
      const sc=document.getElementById('scroller');N.core.growDoc(4000);N.core.layout();sc.scrollTop=400;
      const ink=document.getElementById('c-ink');
      const fire=(type,id,x,y)=>ink.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',isPrimary:id===1,clientX:x,clientY:y,pressure:.37,width:30,height:30,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1}));
      const top=sc.scrollTop;
      fire('pointerdown',1,400,500);fire('pointerdown',2,500,500);
      for(let i=1;i<=10;i++){fire('pointermove',1,400,500-i*20);fire('pointermove',2,500,500-i*20);}
      fire('pointerup',1,400,300);fire('pointerup',2,500,300);
      await new Promise(r=>setTimeout(r,50));
      return {strokes:S.strokes.length,scrolled:sc.scrollTop-top};
    });
    assert.equal(res.strokes,0,'two fingers draw nothing: '+JSON.stringify(res));
    assert.ok(res.scrolled>100,'two fingers scroll the page: '+JSON.stringify(res));
    await context.close();
  }
  {
    // ---- a long note: a stroke's regroup is local and quick ----
    const {context,page}=await open();
    const timing=await page.evaluate(()=>{
      const C=N.core,S=C.S;S.lines=[];N.text.render();
      let seed=7;const r=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
      const strokes=[];let t=1;
      for(let row=0;row<60;row++){let x=20;const y=80+row*56;
        while(x<680){const n=3+Math.floor(r()*5);for(let k=0;k<n;k++){const pts=[];const m=16;
          for(let i=0;i<m;i++){const a=i/(m-1)*6.28;pts.push(x+6+6*Math.cos(a),y+10*Math.sin(a*1.3),.5);}
          const st={id:C.uid(),author:'user',tool:'pen',w:2.4,pts,t0:t,t1:t+120};t+=300;st.bbox=N.ink.bboxOf(pts);strokes.push(st);x+=14;}
          x+=22;}
        t+=10000;}
      S.strokes=strokes;N.recog.rebuild();
      const st={id:C.uid(),author:'user',tool:'pen',w:2.4,pts:[300,1200,.5,310,1205,.5,320,1200,.5],t0:t,t1:t+50};st.bbox=N.ink.bboxOf(st.pts);S.strokes.push(st);
      const a=performance.now();N.recog.rebuild();const local=performance.now()-a;
      const key=gs=>gs.map(g=>[...g].sort().join(',')).sort().join('|');
      const same=key(S.clusters.map(c=>c.strokeIds))===key(N.recog.mathStrokeGroups(S.strokes).map(g=>g.map(s=>s.id)));
      S.strokes=[];N.recog.rebuild();
      return {local,same,count:strokes.length};
    });
    assert.equal(timing.same,true,'the local regroup matches a whole-page one');
    assert.ok(timing.local<120,'a stroke on a '+timing.count+'-stroke note regroups in '+timing.local.toFixed(1)+' ms');
    await context.close();
  }
  console.log('checklist fixes: ok');
}finally{await browser.close();server.close();}
