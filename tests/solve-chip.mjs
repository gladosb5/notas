import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true,serviceWorkers:'block'});
const page=await context.newPage();

// The stroke encoder answers with 3 MB of zeros and a content-length, so the
// worker reports a real "downloading N of M MB" line and then fails to parse.
await context.route(/encoder\.onnx/,route=>route.fulfill({status:200,contentType:'application/octet-stream',body:Buffer.alloc(3*1048576)}));
try{
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.ui?.importNoteFile);

  // Setup screen: says "setting up", counts the model in, and offers a way through.
  // (a model already in the browser's store skips the download, and the screen with it)
  const prep=await page.evaluate(()=>document.getElementById('prep-skip')?{
    word:document.getElementById('prep-word').textContent,
    skip:!document.getElementById('prep-skip').hidden}:null);
  if(prep){
    assert.equal(prep.word,'setting up','Opening screen says setting up while the model downloads');
    assert.equal(prep.skip,true,'Start writing now is offered while the download runs');
  }
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'),null,{timeout:30000});
  if(prep){
    const bytes=await page.evaluate(()=>document.getElementById('prep-bytes').textContent);
    assert.match(bytes,/^\d+ of \d+ MB$/,'Download size was shown in MB: '+bytes);
    assert.equal(await page.evaluate(()=>document.getElementById('prep-bar').hidden),false,'Progress bar was shown');
  }

  await page.evaluate(()=>{N.tutorial?.finish(false);N.core.S.settings.aiOn=false;N.ai.toggle();});

  // Seed one handwritten cluster and give it a reading, as the recogniser would.
  const seed=(id,ascii,latex,extra={})=>page.evaluate(([id,ascii,latex,extra])=>{
    const S=N.core.S;
    const pts=[100,300,.5,160,300,.5,160,340,.5,220,340,.5];
    S.strokes=[{id,author:'user',w:2.8,t0:1,pts,bbox:[100,300,220,340]}];
    N.recog.rebuild();
    const cl=S.clusters[0];
    // stamped with the production result version so a rebuild (undo does one) keeps the reading
    Object.assign(cl,{ascii,latex,modelVersion:N.recog.resultVersion,confidence:.9,review:false,pending:false,confirmed:false},extra);
    N.recog.cache.set(cl.hash,{ascii,latex,modelVersion:N.recog.resultVersion,confidence:.9,confirmed:false,asked:!!extra.asked});
    N.mathcore.run();
    return {id:cl.id,hash:cl.hash};
  },[id,ascii,latex,extra]);

  // 6+2 without '=': shows the reading and Solve, no answer yet.
  await seed('s1','6+2','6+2');
  const offer=page.locator('.chip.offer');
  assert.equal(await offer.count(),1,'A reading without = gets a Solve chip');
  assert.ok((await offer.locator('.reading').textContent()).replace(/\s/g,'').includes('6+2'),'Chip shows the reading');
  assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result)),false,'No answer before Solve');
  // the offer has no close button: writing past it sends it away. Ink laid
  // down elsewhere once the box is up dismisses it; ink that joins the same
  // working does not (it makes a new reading instead). Solve on the ink
  // brings a dismissed box back.
  assert.equal(await offer.locator('.chip-dismiss').count(),0,'The offer carries no dismiss button');
  const writeElsewhere=(id)=>page.evaluate(id=>{
    const S=N.core.S;
    S.strokes.push({id,author:'user',w:2.8,t0:N.ink.now(),t1:N.ink.now(),pts:[100,700,.5,160,700,.5,160,740,.5,220,740,.5],bbox:[100,700,220,740]});
    N.mathcore.inkLanded(id); N.recog.rebuild(); N.mathcore.run();
  },id);
  await writeElsewhere('far1');
  assert.equal(await page.evaluate(()=>N.core.S.clusters.find(c=>c.id==='cl_s1').dismissed&&N.recog.cache.get(N.core.S.clusters.find(c=>c.id==='cl_s1').hash).dismissed),true,'Writing elsewhere dismisses the offer, recorded with the reading');
  assert.equal(await page.locator('.chip.offer').filter({hasText:'6+2'}).count(),0,'The offer is gone from the page');
  await page.evaluate(()=>{const S=N.core.S;S.strokes=S.strokes.filter(s=>s.id!=='far1');N.recog.rebuild();N.mathcore.run();});
  await page.evaluate(()=>N.mathcore.requestSolve(N.core.S.clusters[0].id));
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='8')&&!N.core.S.clusters[0].dismissed),'Solve on the ink answers it and lifts the dismissal');
  await page.evaluate(()=>{const c=N.core.S.clusters[0];c.asked=false;const st=N.recog.cache.get(c.hash);if(st)st.asked=false;N.mathcore.run();});
  assert.equal(await page.locator('.chip.offer').count(),1);
  await offer.getByRole('button',{name:/^solve/}).click();
  assert.equal(await page.locator('.chip.offer').count(),0,'Solve removes the offer');
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='8')),'Solve calculates 6+2 = 8');

  await seed('uncertain-equals','6+2=','6+2=',{needsConfirmation:true});
  assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result)),false,'Uncertain equals does not calculate automatically');
  assert.equal(await page.locator('.chip.offer').count(),1,'Uncertain equals shows its reading and Solve');
  await page.locator('.chip.offer').getByRole('button',{name:/^solve/}).click();
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='8')),'Explicit Solve accepts an uncertain reading');
  assert.equal(await page.evaluate(()=>N.core.S.clusters[0].asked),true,'Solve is recorded on the cluster');
  assert.equal(await page.evaluate(()=>N.recog.cache.get(N.core.S.clusters[0].hash).asked),true,'Solve is recorded in the saved transcript');

  // Explicit Solve survives a regrouping that changes the cluster hash (31).
  const kept=await page.evaluate(()=>{
    const S=N.core.S;
    S.strokes.push({id:'s1b',author:'user',w:2.8,t0:2,pts:[230,300,.5,260,300,.5,260,340,.5],bbox:[230,300,260,340]});
    N.recog.rebuild();
    return {one:S.clusters.length===1,asked:S.clusters[0].asked,newHash:S.clusters[0].hash};
  });
  assert.equal(kept.one,true,'Adjacent stroke joins the same cluster');
  assert.equal(kept.asked,true,'Solve intent survives the hash change');

  // With the pen up, a resting chip lets the pen through to the paper; the
  // ink canvas presses it on a tap. Zoom creates a stacking context, so the
  // canvas must still see the tap and blank paper must still take ink.
  const centre=async loc=>{const b=await loc.boundingBox();return [b.x+b.width/2,b.y+b.height/2];};
  for(const zoom of [1,.8,1.25]){
    await page.evaluate(()=>N.ink.setTool('pen'));
    await page.evaluate(z=>N.core.setZoom(z,400,350),zoom);
    await seed('zoom-'+zoom,'6+2','6+2');
    const [sx,sy]=await centre(page.locator('.chip.offer .solve'));
    assert.equal(await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.id,[sx,sy]),'c-ink','In pen mode the chip lets the pen through at zoom '+zoom);
    await page.mouse.click(sx,sy);
    assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='8')),'A pen tap on Solve still presses it at zoom '+zoom);
    assert.equal(await page.evaluate(()=>document.elementFromPoint(600,500)?.id),'c-ink','Blank paper still receives ink at zoom '+zoom);
    await seed('touch-zoom-'+zoom,'6+2','6+2');
    const [tx,ty]=await centre(page.locator('.chip.offer .solve'));
    await page.touchscreen.tap(tx,ty);
    assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='8')),'Touch Solve works at zoom '+zoom);
    await seed('card-zoom-'+zoom,'6+2','6+2');
    const [rx,ry]=await centre(page.locator('.chip.offer .reading'));
    await page.mouse.click(rx,ry);
    assert.equal(await page.locator('.chip.open').count(),1,'A pen tap on the reading opens the card at zoom '+zoom);
    // the open card takes its own input, so Playwright can press it directly
    await page.locator('.chip.open .solve').click({timeout:3000});
    assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='8')),'Expanded card Solve works at zoom '+zoom);
  }
  await page.evaluate(()=>{N.core.setZoom(1,400,350);N.ink.setTool('text');});

  // Prose stays quiet; '=' still answers by itself.
  await seed('s2','hello','hello');
  assert.equal(await page.locator('.chip').count(),0,'A word gets no chip');
  await seed('s3','6+2=','6+2=');
  assert.equal(await page.locator('.chip.offer').count(),0,'An equals sign asks for the answer itself');
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='8')),'= still auto-answers');

  // The offer chip still opens the correction card.
  await seed('s4','6+2','6+2');
  await page.locator('.chip.offer .reading').click();
  assert.equal(await page.locator('.chip.open').count(),1,'Tapping the reading opens the correction card');
  assert.ok(await page.locator('.chip.open .fix input').isVisible(),'Correction field is available before any answer');
  assert.equal(await page.locator('.chip.open .solve').count(),1,'Solve is also offered in the card');

  // A toast answers the latest action: a newer message replaces an older one
  // at once and the swap is visible (67).
  await page.waitForFunction(()=>!document.getElementById('toast').classList.contains('in'),null,{timeout:10000});
  const toasts=await page.evaluate(()=>{
    N.core.toast('first',400);N.core.toast('second',400);
    const t=document.getElementById('toast');
    return {text:t.textContent,bump:t.classList.contains('bump')};
  });
  assert.deepEqual(toasts,{text:'second',bump:true},'A newer toast replaces the older one visibly');

  // Session-scoped active note (15).
  const active=await page.evaluate(()=>({s:sessionStorage.getItem('notas.active'),l:localStorage.getItem('notas.active'),id:N.core.S.id}));
  assert.equal(active.s,active.id);assert.equal(active.l,active.id);

  // CJK fuzzy search slides over characters even when the transcript has spaces (35).
  const fuzzy=await page.evaluate(()=>[N.ui.fuzzyHandwriting('数学','今天 学数字 课')?.score, N.ui.fuzzyHandwriting('数学笔记','数学 笔记本')?.score, N.ui.fuzzyHandwriting('数','数学')?.score]);
  assert.equal(fuzzy[1],0,'Exact CJK phrase across a space is found');
  assert.equal(fuzzy[2],0,'Single-character CJK query matches');

  // A stroke that starts on a resting chip is ink, not a press: the chip sits
  // right where the next symbol goes, and it used to swallow the pen.
  {
    await page.evaluate(()=>{N.core.setZoom(1,400,350);N.ink.setTool('pen');});
    await seed('through','6+2','6+2');
    await page.waitForTimeout(400);           /* the chip's entrance has played out */
    const [sx,sy]=await centre(page.locator('.chip.offer .solve'));
    const strokesBefore=await page.evaluate(()=>N.core.S.strokes.length);
    await page.mouse.move(sx,sy);await page.mouse.down();
    for(let i=1;i<=16;i++)await page.mouse.move(sx+i*3,sy+i*2);
    await page.waitForTimeout(150);
    const hidden=await page.evaluate(()=>{const el=document.querySelector('.chip.offer');return {yield:el.classList.contains('yield'),opacity:getComputedStyle(el).opacity};});
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.deepEqual(hidden,{yield:true,opacity:'0'},'A chip the pen is writing across steps aside');
    assert.equal(await page.evaluate(()=>N.core.S.strokes.length),strokesBefore+1,'A stroke begun on the chip is kept as ink');
    assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='8')),false,'A stroke begun on Solve does not press it');
  }

  // Ink still warm from the pen gets no chip until a quiet moment after it.
  {
    await page.evaluate(()=>N.ink.setTool('pen'));
    const warm=await page.evaluate(()=>{
      const S=N.core.S,t=N.ink.now();
      S.strokes=[{id:'warm',author:'user',w:2.8,t0:t-100,t1:t,pts:[100,300,.5,160,300,.5,160,340,.5,220,340,.5],bbox:[100,300,220,340]}];
      N.recog.rebuild();
      const cl=S.clusters[0];
      Object.assign(cl,{ascii:'6+2',latex:'6+2',confidence:.9,review:false,pending:false,confirmed:false});
      N.recog.cache.set(cl.hash,{ascii:'6+2',latex:'6+2',modelVersion:cl.modelVersion,confidence:.9,confirmed:false});
      N.mathcore.run();
      return document.querySelectorAll('.chip').length;
    });
    assert.equal(warm,0,'Fresh ink shows no chip yet');
    await page.locator('.chip.offer').waitFor({state:'attached',timeout:4000});
    assert.equal(await page.locator('.chip.offer').count(),1,'The chip arrives once the ink has settled');
  }

  // Time spent away from the pen is not a pause between strokes: half an
  // expression written before a detour to type is still one expression with
  // the half written after it.
  {
    const strokeAt=async(x)=>{
      const box=await page.locator('#c-ink').boundingBox();
      const colLeft=await page.evaluate(()=>N.core.M.colLeft);
      const ox=box.x+colLeft+x,oy=box.y+400;
      await page.mouse.move(ox,oy);await page.mouse.down();
      for(let i=1;i<=12;i++)await page.mouse.move(ox,oy+i*3);
      await page.mouse.up();await page.waitForTimeout(150);
    };
    const detour=async(tool)=>{
      // the wall clock jumps twenty seconds while the pen is away
      await page.evaluate(t=>{N.ink.setTool(t);const real=Date.now;window.__skew=(window.__skew||0)+20000;const skew=window.__skew;Date.now=()=>real.call(Date)+skew;},tool);
      await page.waitForTimeout(50);
      await page.evaluate(()=>N.ink.setTool('pen'));
    };
    await page.evaluate(()=>{N.core.S.strokes=[];N.ink.setTool('pen');N.ink.render();N.recog.rebuild();});
    await strokeAt(60);await detour('text');await strokeAt(80);
    assert.equal(await page.evaluate(()=>N.core.S.strokes.length),2,'Both halves are ink');
    assert.equal(await page.evaluate(()=>N.core.S.clusters.length),1,'A detour into the text tool does not split the expression');
    await page.evaluate(()=>{N.core.S.strokes=[];N.ink.render();N.recog.rebuild();});
    await strokeAt(60);await detour('pen');await strokeAt(80);
    assert.equal(await page.evaluate(()=>N.core.S.clusters.length),2,'The same pause with the pen still up is a pause');
    await page.evaluate(()=>N.ink.setTool('text'));
  }

  // The dots beside a sum say what they are waiting for while the reader is
  // still being fetched, and count the download up in place.
  {
    const waiting=async()=>page.evaluate(()=>[...document.querySelectorAll('.chip')].map(el=>({dots:!!el.querySelector('.dots'),wait:el.querySelector('.wait')?.textContent||''})));
    await page.evaluate(()=>{
      const S=N.core.S;
      window.__setupState=N.ai.setupState;
      N.ai.setupState=()=>({phase:'download',detail:'12 of 80 MB'});
      S.strokes=[
        {id:'w1',author:'user',w:2.8,t0:1,t1:2,pts:[100,300,.5,160,300,.5,160,340,.5,220,340,.5],bbox:[100,300,220,340]},
        {id:'w2',author:'user',w:2.8,t0:3,t1:4,pts:[100,500,.5,160,500,.5,160,540,.5,220,540,.5],bbox:[100,500,220,540]}];
      N.recog.rebuild();
      for(const cl of S.clusters)cl.pending=true;
      N.mathcore.run();
    });
    const first=await waiting();
    assert.equal(first.length,2,'Both waiting sums show a chip');
    assert.deepEqual(first.map(c=>c.dots),[true,true],'Waiting chips show the dots');
    assert.deepEqual(first.map(c=>c.wait),['','getting the handwriting reader, 12 of 80 MB. first time only.'],'The ink written last says what the dots wait for');
    await page.evaluate(()=>{N.ai.setupState=()=>({phase:'download',detail:'40 of 80 MB'});N.mathcore.refreshWaiting();});
    assert.equal((await waiting())[1].wait,'getting the handwriting reader, 40 of 80 MB. first time only.','The download counts up in place');
    await page.evaluate(()=>{N.ai.setupState=()=>({phase:'starting',detail:''});N.mathcore.refreshWaiting();});
    assert.equal((await waiting())[1].wait,'starting the handwriting reader. a moment.','Starting the model is said too');
    await page.evaluate(()=>{N.ai.setupState=()=>({phase:'ready',detail:''});N.mathcore.refreshWaiting();});
    assert.deepEqual((await waiting()).map(c=>c.wait),['',''],'A ready reader leaves only the dots');
    await page.evaluate(()=>{N.ai.setupState=window.__setupState;N.core.S.strokes=[];N.recog.rebuild();N.mathcore.run();});
  }

  console.log('Solve chip, setup progress, solve intent, writing through chips, ink clock, waiting line, toast swap, active note and CJK search passed');
}finally{
  await browser.close();server.close();
}
