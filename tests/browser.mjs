import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';
// Real handwritten sums: the stroke reader needs human pen shapes and timing,
// which authored polylines do not have (see tests/fixtures/stroke-sums.json).
const INK=JSON.parse(await readFile(new URL('./fixtures/stroke-sums.json',import.meta.url),'utf8'));
// a composed sum or word placed on the page: every point and box shifted, ids
// and times made distinct so two pieces never share a stroke id or a moment
const placeInk=(strokes,prefix,dx,dy,dt)=>strokes.map((st,i)=>({...st,id:prefix+i,t0:st.t0+dt,t1:st.t1+dt,
  pts:st.pts.map((v,k)=>k%3===0?v+dx:k%3===1?v+dy:v),bbox:[st.bbox[0]+dx,st.bbox[1]+dy,st.bbox[2]+dx,st.bbox[3]+dy]}));
const placeSum=(expr,prefix,dx,dy,dt)=>placeInk(INK.sums[expr].strokes,prefix,dx,dy,dt);
const placeWord=(word,prefix,dx,dy,dt)=>placeInk(INK.words[word].strokes,prefix,dx,dy,dt);
const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:800,height:1100}});
const page=await context.newPage(),errors=[],remote=[];
page.on('pageerror',e=>errors.push(e.message));
// blob: URLs are same-origin object URLs (pasted images decode through one)
context.on('request',r=>{if(!r.url().startsWith(base+'/')&&!r.url().startsWith('blob:'+base+'/')&&!r.url().startsWith('data:'))remote.push(r.url());});
try{
  await page.goto(base+'/notas.html');
  await page.locator('#local-status').filter({hasText:'handwriting ready.'}).waitFor({state:'attached'});
  await page.locator('#offline-status').filter({hasText:'available offline.'}).waitFor({state:'attached'});
  assert.equal(await page.locator('#apikey').count(),0);
  assert.equal(await page.locator('#ask-dot:visible').count(),0,'AI hint launcher is hidden');

  // "2+2" on one line and, low enough to form its own cluster, "3+3" on the
  // next: real ink through the bundled network, calculation and correction.
  const sums=[...placeSum('2+2','test-',10,30,0),...placeSum('3+3','test-',10,160,20000)].map((st,i)=>({...st,id:'test-'+i}));
  const recognition=await page.evaluate(async sums=>{
    N.tutorial.finish(false);
    N.recog.switchEngine('ink');
    N.core.S.strokes=sums;
    N.recog.rebuild();
    const start=performance.now();
    for(const cl of N.core.S.clusters) await N.recog.recognize(cl);
    // A background schedule() may have grabbed a cluster first; the explicit
    // call then early-returns on pending. Give it time to finish, then sweep
    // anything it left unsettled.
    for(let sweep=0;sweep<40;sweep++){
      if(N.core.S.clusters.every(c=>c.source!=='ink'||c.confirmed||c.latex||c.ascii||c.error||c.review||!c.pending))break;
      await new Promise(r=>setTimeout(r,500));
    }
    for(const cl of N.core.S.clusters) await N.recog.recognize(cl);
    N.ink.render();
    const resultOf=cl=>{const n=N.core.S.nodes.find(o=>o.ref===cl);return n?{result:n.result,error:n.error}:null;};
    return {ms:performance.now()-start,clusters:N.core.S.clusters.map(c=>({latex:c.latex,ascii:c.ascii,alternatives:c.alternatives,review:c.review,needsConfirmation:c.needsConfirmation,confirmed:c.confirmed,error:c.error,modelVersion:c.modelVersion,confidence:c.confidence,...resultOf(c)}))};
  },sums);
  console.log('Actual local recognition:',JSON.stringify(recognition));
  const first=recognition.clusters.find(c=>c.ascii.replace(/\s/g,'')==='2+2'),second=recognition.clusters.find(c=>c.ascii.replace(/\s/g,'')==='3+3');
  assert.ok(first,'First line was read as 2+2, got '+JSON.stringify(recognition.clusters.map(c=>c.ascii)));
  assert.ok(second,'Second line was read as 3+3, got '+JSON.stringify(recognition.clusters.map(c=>c.ascii)));
  for(const c of [first,second]){
    assert.equal(c.review,false,'A reading is not an inference error');
    assert.equal(c.confirmed,false,'Recognition does not mark a reading confirmed');
    assert.match(c.modelVersion||'',/:ink$/,'Only the stroke reader stamps math readings');
  }
  // a sum without a trailing equals waits for Solve whatever its confidence
  assert.ok(!first.result&&!second.result,'Readings without an equals wait for Solve');
  const solved=await page.evaluate(()=>{
    // each Solve repaints the margin, so the next button is looked up fresh
    for(let guard=0;guard<8;guard++){const button=document.querySelector('.chip.offer .solve');if(!button)break;button.click();}
    return N.core.S.nodes.map(n=>n.result).filter(Boolean);
  });
  assert.ok(solved.includes('4')&&solved.includes('6'),'Explicit Solve calculates both visible readings, got '+JSON.stringify(solved));
  const quiet=await page.evaluate(async wordInk=>{
    // A word is not a sum. It is read, but must produce no chip and no answer.
    N.core.S.strokes=N.core.S.strokes.concat(wordInk);
    N.recog.rebuild();
    for(const cl of N.core.S.clusters) await N.recog.recognize(cl);
    for(let sweep=0;sweep<40;sweep++){
      if(N.core.S.clusters.every(c=>c.source!=='ink'||c.confirmed||c.latex||c.ascii||c.error||c.review||!c.pending))break;
      await new Promise(r=>setTimeout(r,500));
    }
    for(const cl of N.core.S.clusters) await N.recog.recognize(cl);
    N.mathcore.run();
    const word=N.core.S.clusters.find(c=>c.strokeIds.some(id=>id.startsWith('w')));
    const node=N.core.S.nodes.find(o=>o.ref===word);
    return {read:word?.latex,hasEquals:/=/.test(word?.ascii||''),result:node?.result,
            chips:document.querySelectorAll('#margin .chip').length,
            clusters:N.core.S.clusters.length};
  },placeWord('hello','w',380,-100,60000));
  console.log('Prose handling:',JSON.stringify(quiet));
  assert.ok(quiet.read,'The word was still read');
  assert.ok(!quiet.hasEquals,'Test word did not accidentally read as an equation');
  assert.ok(!quiet.result,'A word is never calculated');
  assert.ok(quiet.chips<quiet.clusters,'A word with no equals sign gets no chip');
  const textOcr=await page.evaluate(async()=>{
    const group=N.recog.textGroups().find(g=>g.strokeIds.some(id=>id.startsWith('w')));
    if(!group)return null;
    await N.recog.recognizeText(group);
    return N.core.S.textTranscripts.find(t=>t.hash===group.hash)||null;
  });
  console.log('Search handwriting OCR:',JSON.stringify(textOcr));
  assert.ok(textOcr?.text,'PP-OCRv6 creates a separate searchable transcript from real Notas strokes');
  assert.match(textOcr.modelVersion,/^ppocrv6-small-v3:[a-f0-9]{16}$/);
  await page.evaluate(()=>N.ui.notesSheet());
  await page.locator('#search').fill('hello');
  const liveOcrRow=page.locator('.note-row').filter({has:page.locator('.match',{hasText:textOcr.text})});
  await liveOcrRow.waitFor();
  assert.equal((await liveOcrRow.locator('.match').textContent()).trim(),textOcr.text,
    'A likely OCR error remains searchable and the result shows the actual recognized handwriting');
  await page.evaluate(()=>N.ui.closeSheet());
  assert.equal(await page.evaluate(()=>N.mathcore.latexToMath('a + 1 0 =')),'a + 10 =',
    'Adjacent digit tokens remain one number');
  // Prove the shipped stroke model loads, reads a whole expression and calculates it.
  const smart=await page.evaluate(async()=>{
    N.recog.switchEngine('ink');
    // the second line, written as 3+3 by strokes test-4..7; found by its ink,
    // since switchEngine has just cleared the readings and the word added
    // above it changes the order clusters come out of regrouping
    const cl=N.core.S.clusters.find(c=>c.strokeIds.includes('test-4'));
    const t=performance.now();
    await N.recog.recognize(cl);
    N.mathcore.run();
    const node=N.core.S.nodes.find(o=>o.ref===cl);
    return {engine:N.recog.engine(),status:document.querySelector('#local-status').textContent,
            latex:cl.latex,ascii:cl.ascii,result:node?.result,ms:Math.round(performance.now()-t)};
  });
  console.log('Stroke engine:',JSON.stringify(smart));
  assert.equal(smart.engine,'ink','The stroke reader is the one engine');
  assert.match(smart.status,/handwriting ready./,'The stroke reader loaded');
  assert.ok(smart.latex,'The stroke reader returned a reading');
  assert.equal(smart.result,'6','The stroke reader read and calculated the written 3+3');
  await page.evaluate(async()=>{N.recog.switchEngine('ink');await new Promise(r=>setTimeout(r,50));});
  await page.locator('#local-status').filter({hasText:'handwriting ready.'}).waitFor({state:'attached'});
  await page.evaluate(async()=>{
    for(const cl of N.core.S.clusters)if(!cl.confirmed)await N.recog.recognize(cl);
    N.mathcore.run();
  });
  const answerChip=page.locator('.chip').filter({hasText:'6'}).first();
  const answerNode=await answerChip.getAttribute('data-node');
  const generatedSize=await answerChip.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  const sourceHeight=await page.evaluate(()=>{
    const cl=N.core.S.clusters.find(c=>c.ascii==='3+3');
    return cl.bbox[3]-cl.bbox[1];
  });
  assert.equal(generatedSize,sourceHeight,'Generated answer font size follows the handwriting height');
  // the answer is only read, on the page: it opens nothing and a tap on it
  // lands on the paper
  const autoChip=page.locator(`.chip[data-node="${answerNode}"]`);
  const [ax,ay]=await autoChip.evaluate(el=>{const r=el.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];});
  assert.notEqual(await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest('.chip')?'chip':'paper',[ax,ay]),'chip','A tap on an answer goes to the paper');
  await autoChip.dispatchEvent('click');
  assert.equal(await autoChip.evaluate(el=>el.children.length===0&&el.textContent.trim()),'6','The answer stays a plain answer on the page');
  await page.evaluate(()=>N.recog.confirm(N.core.S.clusters.find(c=>c.ascii==='2+2'),'2+2'));
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='4')));
  const migration=await page.evaluate(()=>{
    const hash=N.core.S.clusters[0].hash;
    N.recog.cache.set(hash,{ascii:'9',confirmed:false});N.recog.rebuild();
    const refreshed=N.core.S.clusters[0].ascii==='';
    N.recog.cache.set(hash,{ascii:'2+2',confirmed:true});N.recog.rebuild();
    return refreshed&&N.core.S.clusters[0].ascii==='2+2'&&N.core.S.clusters[0].confirmed;
  });
  assert.ok(migration,'Model upgrade refreshes unconfirmed readings and preserves confirmed corrections');
  const cacheRefresh=await page.evaluate(async()=>{
    const S=N.core.S,confirmed=S.clusters.find(c=>c.confirmed),unconfirmed=S.clusters.find(c=>!c.confirmed&&c.source==='ink');
    if(unconfirmed){
      Object.assign(unconfirmed,{ascii:'stale=99',latex:'stale=99',modelVersion:'recognition-v1'});
      N.recog.cache.set(unconfirmed.hash,{ascii:'stale=99',latex:'stale=99',modelVersion:'recognition-v1',confirmed:false});
    }
    S.textTranscripts.push({hash:'text:stale',text:'stale',confidence:1,modelVersion:'ppocr-old'});
    const refreshed=await N.recog.refreshModels();
    const staleCache=[...N.recog.cache.values()].some(v=>!v.confirmed&&v.modelVersion==='recognition-v1');
    const staleText=S.textTranscripts.some(t=>t.modelVersion==='ppocr-old');
    const group=N.recog.textGroups().find(g=>g.strokeIds.some(id=>id.startsWith('w')));
    if(group)await N.recog.recognizeText(group);
    return {ok:refreshed?.ok,removed:refreshed?.removed||0,staleCache,staleText,
      confirmed:!!confirmed&&confirmed.ascii==='2+2'&&confirmed.confirmed,
      currentText:S.textTranscripts.find(t=>t.hash===group?.hash)?.modelVersion||''};
  });
  assert.equal(cacheRefresh.ok,true,'Explicit model refresh invalidates the service-worker recognition cache');
  assert.equal(cacheRefresh.staleCache,false,'Explicit model refresh drops stale unconfirmed math readings');
  assert.equal(cacheRefresh.staleText,false,'Explicit model refresh drops stale handwriting-search transcripts');
  assert.equal(cacheRefresh.confirmed,true,'Explicit model refresh preserves a confirmed user correction');
  assert.equal(cacheRefresh.currentText,await page.evaluate(()=>N.recog.textVersion),'Text OCR is regenerated with the current transcript version');
  await page.evaluate(async()=>{N.recog.rebuild();await N.core.save();});
  assert.ok(await page.evaluate(()=>N.core.S.clusters[0].confirmed&&N.core.S.clusters[0].ascii==='2+2'));
  await page.locator('#ask-dot').evaluate(el=>el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})));
  await page.locator('#ask-in').fill('2x+3=11');
  await page.locator('#ask-go').click();
  await page.getByRole('button',{name:'hint',exact:true}).click();
  await page.getByRole('button',{name:'next step',exact:true}).click();
  await page.getByRole('button',{name:'full solution',exact:true}).click();
  assert.match(await page.locator('#reply').innerText(),/x = 4/);
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/tablet.png'});
  await context.setOffline(true);
  await page.reload();
  await page.locator('#local-status').filter({hasText:'handwriting ready.'}).waitFor({state:'attached'});
  assert.ok(await page.evaluate(()=>N.core.S.clusters.some(c=>c.confirmed&&c.ascii==='2+2')),'Corrections survive offline reload');
  assert.ok(await page.evaluate(()=>N.core.S.textTranscripts.some(t=>t.modelVersion===N.recog.textVersion&&t.text)),
    'PP-OCRv6 handwriting search transcripts survive offline reload');
  const offlineText=await page.evaluate(async()=>{
    const group=N.recog.textGroups().find(g=>g.strokeIds.some(id=>id.startsWith('w')));
    if(!group)return null;
    N.core.S.textTranscripts=N.core.S.textTranscripts.filter(t=>t.hash!==group.hash);
    await N.recog.recognizeText(group);
    return N.core.S.textTranscripts.find(t=>t.hash===group.hash)?.text||null;
  });
  assert.ok(offlineText,'PP-OCRv6 model itself runs after an offline reload');
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='4')),'Offline calculator works');
  await page.setViewportSize({width:1100,height:700});
  await page.screenshot({path:'test-results/landscape.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Landscape does not overflow');
  console.log('Offline reopen and saved correction: passed');
  // Scribbling something out no longer deletes it: no heuristic separated a
  // deliberate cross-out from a carefully drawn x or a shaky bar reliably enough,
  // and guessing wrong destroyed the student's ink. These strokes go through the
  // real pointer pipeline; the jitter is seeded so a failure is reproducible.
  await page.setViewportSize({width:1180,height:900});
  await page.evaluate(()=>{N.core.S.settings.aiOn=false;N.core.S.strokes=[];N.ink.setTool('pen');N.core.layout();N.ink.render();});
  const inkBox=await page.locator('#c-ink').boundingBox();
  // the column is centred, so page coordinates come from the live layout rather
  // than a constant that silently drifts when the viewport changes
  const colLeft=await page.evaluate(()=>N.core.M.colLeft);
  // mulberry32: the naive LCG loses precision past 2^53 and degenerates into a
  // near-constant offset, which is not the hand tremor this is meant to model
  let seed=20260910;
  const rand=()=>{
    seed=(seed+0x6D2B79F5)|0;
    let t=Math.imul(seed^(seed>>>15),1|seed);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return (((t^(t>>>14))>>>0)/4294967296)-0.5;
  };
  async function drawStrokePath(points,jitter,steps){
    const ox=inkBox.x+colLeft,oy=inkBox.y,path=[];
    for(let s=0;s<points.length-1;s++){
      const [x1,y1]=points[s],[x2,y2]=points[s+1];
      for(let i=0;i<=steps;i++){
        const t=i/steps;
        path.push([x1+(x2-x1)*t+rand()*jitter,y1+(y2-y1)*t+rand()*jitter]);
      }
    }
    await page.mouse.move(ox+path[0][0],oy+path[0][1]);
    await page.mouse.down();
    for(const [x,y] of path.slice(1))await page.mouse.move(ox+x,oy+y);
    await page.mouse.up();
    await page.waitForTimeout(90);
  }
  const strokeCount=()=>page.evaluate(()=>N.core.S.strokes.length);
  const resetInk=()=>page.evaluate(()=>{N.core.S.strokes=[];N.ink.render();});
  for(const [name,segments,jitter,steps] of [
    ['a plus drawn slowly with a shaky hand',[[[40,300],[92,300]],[[66,274],[66,326]]],3.0,130],
    ['a times drawn slowly with a shaky hand',[[[40,400],[86,446]],[[86,400],[40,446]]],3.0,130],
    ['an equals drawn slowly with a shaky hand',[[[40,500],[92,500]],[[40,516],[92,516]]],3.0,130],
    ['a times retraced in one stroke',[[[40,560],[86,606],[40,560],[40,606],[86,560]]],1.6,30]
  ]){
    await resetInk();
    for(const segment of segments)await drawStrokePath(segment,jitter,steps);
    assert.equal(await strokeCount(),segments.length,`Scribble-erase leaves ${name} alone`);
  }
  for(const [name,scribble,jitter,steps] of [
    ['three sweeps',[[30,500],[140,506],[30,512],[140,518],[30,524]],1.2,30],
    ['five sweeps',[[30,500],[140,504],[30,508],[140,512],[30,516],[140,520],[30,524]],1.2,30],
    ['fast and loose',[[30,500],[140,510],[30,500],[140,515],[30,505],[140,520]],2.0,14]
  ]){
    await resetInk();
    await drawStrokePath([[40,500],[70,500]],1.2,24);
    await drawStrokePath([[80,490],[80,530]],1.2,24);
    const before=await strokeCount();
    await drawStrokePath(scribble,jitter,steps);
    assert.equal(await strokeCount(),before+1,`A scribble of ${name} is kept as ink and deletes nothing`);
  }
  console.log('Scribble is ink: nothing is deleted by drawing');

  // A hand resting on the glass puts the palm down before the nib arrives, so
  // the palm was already tracked when the pen landed: two pointers, read as a
  // two-finger scroll, and the first stroke of every line was swallowed.
  {
    const cdp=await context.newCDPSession(page);
    const ox=inkBox.x+colLeft, oy=inkBox.y;
    await resetInk();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',
      touchPoints:[{x:ox+420,y:oy+320,radiusX:40,radiusY:40,id:9}]});
    await page.waitForTimeout(120);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:ox+60,y:oy+260,
      button:'left',clickCount:1,pointerType:'pen',force:0.5});
    for(let i=1;i<=20;i++)await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',
      x:ox+60+i*6,y:oy+260,button:'left',buttons:1,pointerType:'pen',force:0.5});
    const midStroke=await strokeCount();
    // the palm lifting must not end the line the pen is still drawing
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    for(let i=21;i<=30;i++)await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',
      x:ox+60+i*6,y:oy+260,button:'left',buttons:1,pointerType:'pen',force:0.5});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:ox+240,y:oy+260,
      button:'left',pointerType:'pen',force:0.5});
    await page.waitForTimeout(200);
    assert.equal(midStroke,0,'A palm lifting mid-stroke does not commit the pen line early');
    assert.equal(await strokeCount(),1,'A pen stroke drawn with the palm already down is kept the first time');
    const drawn=await page.evaluate(()=>Math.round(N.core.S.strokes[0].bbox[2]-N.core.S.strokes[0].bbox[0]));
    assert.ok(drawn>140,`The whole pen stroke survives the palm lifting, got ${drawn}px`);
  }
  console.log('Palm rejection: pen wins over a resting hand');

  // A pointer whose up never arrives stays tracked forever. One leftover used to
  // make every following pen stroke look like a second finger, so strokes went
  // missing with nothing touching the screen and nothing on screen to explain it.
  {
    const cdp=await context.newCDPSession(page);
    const ox=inkBox.x+colLeft, oy=inkBox.y;
    await resetInk();
    await page.evaluate(({x,y})=>{
      document.getElementById('c-ink').dispatchEvent(new PointerEvent('pointerdown',
        {pointerId:4242,pointerType:'pen',isPrimary:true,clientX:x,clientY:y,button:0,buttons:1,bubbles:true}));
    },{x:ox+500,y:oy+500});
    for(let n=0;n<3;n++){
      const y=oy+200+n*50;
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:ox+60,y,button:'left',clickCount:1,pointerType:'pen',force:0.5});
      for(let i=1;i<=18;i++)await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:ox+60+i*6,y,button:'left',buttons:1,pointerType:'pen',force:0.5});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:ox+168,y,button:'left',pointerType:'pen',force:0.5});
      await page.waitForTimeout(140);
      assert.equal(await strokeCount(),n+1,`Pen stroke ${n+1} survives a stale pointer left in the map`);
    }
  }
  console.log('Phantom pointers: a stale pointer cannot eat pen strokes');

  // The same Apple Pencil is not reported consistently: a device diagnostic showed
  // it arriving as 'pen' for some strokes and 'touch' for others. Rejecting every
  // touch for 1500ms after a pen event therefore ate real strokes, about one line
  // in two. Rejecting large contacts instead was worse: iOS reports a fingertip
  // far above the size a palm was assumed to need, so finger drawing and
  // two-finger scrolling both died. Touch now draws unless the pen is writing or
  // pen-only is chosen, and these run at a fingertip size that broke both rules.
  {
    const ox=inkBox.x+colLeft, oy=inkBox.y;
    const synth=(type,y,w,h,id)=>page.evaluate(({type,y,w,h,id,ox,oy})=>{
      const c=document.getElementById('c-ink');
      const fire=(name,x,yy,buttons)=>c.dispatchEvent(new PointerEvent(name,{pointerId:id,pointerType:type,
        isPrimary:true,clientX:x,clientY:yy,button:name==='pointermove'?-1:0,buttons,width:w,height:h,pressure:.5,bubbles:true}));
      fire('pointerdown',ox+60,oy+y,1);
      for(let i=1;i<=18;i++)fire('pointermove',ox+60+i*6,oy+y,1);
      fire('pointerup',ox+168,oy+y,0);
    },{type,y,w,h,id,ox,oy});

    await resetInk();
    // pen and touch alternating with no delay, all with a stylus-sized contact
    const seen=[];
    for(const [i,type] of ['pen','touch','pen','touch'].entries()){
      await synth(type,200+i*50,3,3,300+i);
      await page.waitForTimeout(90);
      seen.push(await strokeCount());
    }
    assert.deepEqual(seen,[1,2,3,4],'A pencil reported as touch straight after a pen stroke still draws');

    // a fingertip as iOS actually reports it: far larger than a palm was assumed
    await resetInk();
    await synth('touch',200,50,50,401);
    await page.waitForTimeout(90);
    assert.equal(await strokeCount(),1,'A finger draws however large the device says the contact is');
    const scroller=()=>page.evaluate(()=>document.getElementById('scroller').scrollTop);
    await page.evaluate(()=>{document.getElementById('scroller').scrollTop=0;});
    await page.evaluate(({ox,oy})=>{
      const c=document.getElementById('c-ink');
      const f=(n,id,x,y,b)=>c.dispatchEvent(new PointerEvent(n,{pointerId:id,pointerType:'touch',isPrimary:id===11,
        clientX:x,clientY:y,button:n==='pointermove'?-1:0,buttons:b,width:50,height:50,pressure:.5,bubbles:true}));
      f('pointerdown',11,ox+300,oy+500,1);f('pointerdown',12,ox+360,oy+500,1);
      for(let i=1;i<=10;i++){f('pointermove',11,ox+300,oy+500-i*12,1);f('pointermove',12,ox+360,oy+500-i*12,1);}
      f('pointerup',11,ox+300,oy+380,0);f('pointerup',12,ox+360,oy+380,0);
    },{ox,oy});
    await page.waitForTimeout(200);
    assert.ok(await scroller()>0,'Two fingers scroll at the same contact size');

    // pen-only: touch stops drawing and scrolls instead, once a pen has been seen
    await page.evaluate(()=>{document.getElementById('scroller').scrollTop=0;});
    await resetInk();
    await synth('pen',200,2,2,402);
    await page.waitForTimeout(90);
    await page.evaluate(()=>{N.core.S.settings.touchDraw=false;});
    const penOnlyBase=await strokeCount();
    // dragging upward: scrollTop rises, so the pan is unambiguous
    await page.evaluate(({ox,oy})=>{
      const c=document.getElementById('c-ink');
      const f=(n,x,y,b)=>c.dispatchEvent(new PointerEvent(n,{pointerId:403,pointerType:'touch',isPrimary:true,
        clientX:x,clientY:y,button:n==='pointermove'?-1:0,buttons:b,width:50,height:50,pressure:.5,bubbles:true}));
      f('pointerdown',ox+120,oy+500,1);
      for(let i=1;i<=12;i++)f('pointermove',ox+120,oy+500-i*10,1);
      f('pointerup',ox+120,oy+380,0);
    },{ox,oy});
    await page.waitForTimeout(200);
    assert.equal(await strokeCount(),penOnlyBase,'Pen only: a finger does not draw');
    assert.ok(await scroller()>0,'Pen only: a single finger scrolls instead');
    // a two-finger pan, whose first finger began a one-finger scroll, must
    // leave the next pen stroke drawing rather than scrolling
    await page.evaluate(({ox,oy})=>{
      const c=document.getElementById('c-ink');
      const f=(n,id,x,y,b)=>c.dispatchEvent(new PointerEvent(n,{pointerId:id,pointerType:'touch',isPrimary:id===404,
        clientX:x,clientY:y,button:n==='pointermove'?-1:0,buttons:b,width:50,height:50,pressure:.5,bubbles:true}));
      f('pointerdown',404,ox+100,oy+400,1); f('pointerdown',405,ox+200,oy+400,1);
      for(let i=1;i<=8;i++){ f('pointermove',404,ox+100,oy+400-i*8,1); f('pointermove',405,ox+200,oy+400-i*8,1); }
      f('pointerup',404,ox+100,oy+336,0); f('pointerup',405,ox+200,oy+336,0);
    },{ox,oy});
    await page.waitForTimeout(400);
    const afterPinch=await strokeCount();
    await synth('pen',260,2,2,406);
    await page.waitForTimeout(120);
    assert.equal(await strokeCount(),afterPinch+1,'Pen only: the pen draws right after a two-finger pan');
    await page.evaluate(()=>{N.core.S.settings.touchDraw=true;document.getElementById('scroller').scrollTop=0;});
  }
  console.log('Touch input: finger draws, two fingers scroll, pen-only is a setting');

  // The lasso selects, and dragging inside the selection moves it. A reading
  // is keyed on stroke points, so it has to travel with the ink it belongs to.
  {
    await resetInk();
    await page.evaluate(async sum=>{
      // the scribble block above turned reading off to keep itself deterministic
      N.core.S.settings.aiOn=true;
      N.recog.switchEngine('ink');
      N.core.S.strokes=sum;
      N.recog.rebuild();
      for(const cluster of N.core.S.clusters){cluster.asked=true;await N.recog.recognize(cluster);}
      N.mathcore.run();
    },placeSum('3+3','m',10,60,0));
    await page.waitForTimeout(400);
    const readBefore=await page.evaluate(()=>N.core.S.clusters.map(c=>c.ascii).join('|'));
    const leftBefore=await page.evaluate(()=>Math.min(...N.core.S.strokes.map(s=>s.bbox[0])));
    const ox=inkBox.x+colLeft, oy=inkBox.y;
    await page.click('.tool[data-tool="select"]');
    await page.mouse.move(ox+30,oy+180);await page.mouse.down();
    for(const [x,y] of [[250,180],[250,260],[30,260],[30,180]])await page.mouse.move(ox+x,oy+y);
    await page.mouse.up();await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>N.core.S.selection.length),4,'The lasso selects the whole sum');
    await page.mouse.move(ox+140,oy+220);await page.mouse.down();
    for(let i=1;i<=12;i++)await page.mouse.move(ox+140+i*10,oy+220+i*8);
    const midDrag=await page.evaluate(()=>Math.min(...N.core.S.strokes.map(s=>s.bbox[0])));
    assert.equal(midDrag,leftBefore,'A drag in progress is not committed until the finger lifts');
    await page.mouse.up();await page.waitForTimeout(600);
    const moved=await page.evaluate(()=>({left:Math.min(...N.core.S.strokes.map(s=>s.bbox[0])),
      read:N.core.S.clusters.map(c=>c.ascii).join('|'),result:N.core.S.nodes.map(n=>n.result).filter(Boolean).join(',')}));
    assert.ok(moved.left>leftBefore+80,`Dragging inside the selection moves the ink, got ${moved.left-leftBefore}px`);
    assert.equal(moved.read,readBefore,'The reading travels with the ink it belongs to');
    assert.equal(moved.result,'6','The answer survives the move');
    await page.click('#btn-undo');await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>Math.min(...N.core.S.strokes.map(s=>s.bbox[0]))),leftBefore,'Undo puts a moved selection back');
    await page.evaluate(()=>N.ink.setTool('pen'));
  }
  console.log('Lasso: drag moves the selection, reading and answer travel with it');

  // A formula-model failure must remain visible, contained and recoverable:
  // an uncaught worker error must not surface as "Something broke", and a
  // worker the OS kills mid-setup must not leave the reader stuck on
  // "fetching…" with every recovery path attached to a dead promise.
  {
    const failCtx=await browser.newContext({viewport:{width:1180,height:820},serviceWorkers:'block'});
    const failPage=await failCtx.newPage();
    const uncaught=[];
    failPage.on('pageerror',error=>uncaught.push(error.message));
    await failPage.route('**/ink-worker.js',route=>route.fulfill({contentType:'application/javascript',
      body:`self.onmessage=e=>{if(e.data.type==='setup'){self.postMessage({id:e.data.id,ok:true});return;}throw new Error('out of memory');};`}));
    await failPage.goto(base+'/notas.html');
    await failPage.locator('#local-status').waitFor({state:'attached'});
    await failPage.waitForTimeout(2500);
    const crashed=await failPage.evaluate(async sum=>{
      N.tutorial&&N.tutorial.finish(false);
      N.core.S.strokes=sum;
      N.recog.rebuild();
      for(const cluster of N.core.S.clusters){cluster.asked=true;try{await N.recog.recognize(cluster);}catch(e){}}
      N.mathcore.run();
      return {toast:document.querySelector('#toast').textContent,
              result:N.core.S.nodes.map(n=>n.result).filter(Boolean).join(',')};
    },placeSum('3+3','s',10,160,0));
    assert.doesNotMatch(crashed.toast,/something broke/,'A formula worker crash stays out of the global error banner');
    assert.match(crashed.toast,/handwriting unavailable/,'The failure says why recognition stopped');
    assert.equal(crashed.result,'','A failed model never substitutes another recognizer');
    assert.deepEqual(uncaught,[],'A handled worker failure raises no uncaught page error');
    await failPage.close();

    // a worker killed mid-setup: one progress line, then silence forever
    const hungPage=await failCtx.newPage();
    let spawns=0;
    await hungPage.route('**/ink-worker.js',route=>{spawns++;route.fulfill({contentType:'application/javascript',
      body:`self.onmessage=e=>{self.postMessage({id:e.data.id,progress:true,status:'Stroke reading: loading…'});};`});});
    await hungPage.goto(base+'/notas.html');
    await hungPage.locator('#local-status').waitFor({state:'attached'});
    await hungPage.waitForTimeout(4000);
    const spawnsBefore=spawns;
    await hungPage.evaluate(()=>N.recog.switchEngine('ink'));
    await hungPage.waitForTimeout(2500);
    assert.ok(spawns>spawnsBefore,'Choosing the engine again starts a fresh worker instead of awaiting the dead one');
    // a quiet download is no longer nagged about: nothing offers retry until
    // the setup timeout (120 s) gives up on the silent worker
    assert.equal(await hungPage.locator('#local-status').filter({hasText:'retry'}).count(),0,'A silent worker is not called stalled after seconds');
    try{ await hungPage.locator('#local-status').filter({hasText:'retry'}).waitFor({timeout:130000}); }
    catch(error){
      /* say what the status line actually held, so a timeout here is diagnosable */
      const seen=await hungPage.evaluate(()=>{const el=document.getElementById('local-status');const r=el?el.getBoundingClientRect():null;
        return {text:el?.textContent,disabled:el?.disabled,box:r&&[r.x,r.y,r.width,r.height],aiOn:N.core.S.settings.aiOn,prep:document.getElementById('preparing').className,toast:document.querySelector('#toast').textContent};});
      console.log('Hung worker status never offered retry:',JSON.stringify({spawns,...seen}));
      throw error;
    }
    assert.equal(await hungPage.locator('#local-status').isDisabled(),false,
      'The status line stays tappable while the reader is preparing');
    const beforeRetry=spawns;
    await hungPage.locator('#local-status').click();
    /* the fresh worker is silent too, so "retry" only returns after the
       120 s setup timeout; what matters here is that a worker was started */
    for(let i=0;i<50&&spawns<=beforeRetry;i++)await hungPage.waitForTimeout(100);
    assert.ok(spawns>beforeRetry,'Retry starts the handwriting model again');
    await failCtx.close();
  }
  console.log('Formula-model failure: contained and recoverable');
  // Pasting images. Every route (Ctrl+V, drop, the clipboard button) shares
  // one normaliser, so the checks below cover sizing, format conversion,
  // placement, field focus and the async clipboard read used on tablets.
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
  const pasted=await page.evaluate(async()=>{
    N.ui.closeSheet();
    const S=N.core.S,M=N.core.M;
    S.images=[];
    const raster=(w,h,type)=>new Promise(r=>{const cv=document.createElement('canvas');cv.width=w;cv.height=h;const x=cv.getContext('2d');
      x.fillStyle='#48c';x.fillRect(0,0,w,h);cv.toBlob(b=>r(new File([b],'shot.'+type.split('/')[1],{type})),type);});
    const decoded=src=>new Promise(r=>{const i=new Image();i.onload=()=>r({w:i.naturalWidth,h:i.naturalHeight});i.onerror=()=>r(null);i.src=src;});
    const settle=n=>new Promise((res,rej)=>{const t0=Date.now();(function poll(){if(S.images.length===n)return res();if(Date.now()-t0>8000)return rej(new Error('expected '+n+' images, have '+S.images.length));setTimeout(poll,25);})();});
    const paste=(files,text,target)=>{const dt=new DataTransfer();for(const f of files)dt.items.add(f);if(text)dt.setData('text/plain',text);
      const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});(target||document.body).dispatchEvent(ev);return ev.defaultPrevented;};
    const out={errors:[]};
    // 1. an oversized screenshot is shrunk to the 2000px cap and fits the column
    const bigPrevented=paste([await raster(3000,1200,'image/png')]);
    await settle(1);
    const big=S.images[0],bigPx=await decoded(big.src);
    out.big={prevented:bigPrevented,mime:big.src.slice(5,14),px:bigPx,w:big.w,h:Math.round(big.h),x:big.x,y:big.y,fits:big.x+big.w<=M.contentW};
    // 2. a small JPEG keeps its bytes and pixel size
    await N.ui.insertImages([await raster(300,200,'image/jpeg')]);
    const jpg=S.images[1];
    out.jpg={mime:jpg.src.slice(5,15),w:jpg.w,h:jpg.h,offset:[jpg.x-big.x,jpg.y-big.y]};
    // 3. an SVG becomes PNG so the note can be exported and re-imported
    const svg=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="red"/></svg>'],'a.svg',{type:'image/svg+xml'});
    await N.ui.insertImages([svg]);
    const s=S.images[2];
    out.svg={mime:s.src.slice(5,14),px:await decoded(s.src),offset:[s.x-jpg.x,s.y-jpg.y]};
    // 4. text on the clipboard wins inside a field; an image alone still lands
    const field=document.createElement('input');document.body.appendChild(field);field.focus();
    out.fieldWithText={prevented:paste([await raster(50,50,'image/png')],'2+2',field),count:S.images.length};
    const onlyImage=paste([await raster(50,50,'image/png')],'',field);
    await settle(4);
    out.fieldImageOnly={prevented:onlyImage,count:S.images.length};
    field.remove();
    // 5. text-only paste and a broken image change nothing
    out.textOnly={prevented:paste([],'hello'),count:S.images.length};
    out.broken={added:await N.ui.insertImageFile(new File(['nope'],'x.png',{type:'image/png'})),count:S.images.length};
    // 6. a dialog keeps its own paste
    N.ui.menuSheet();
    out.underSheet={prevented:paste([await raster(50,50,'image/png')]),count:S.images.length};
    N.ui.closeSheet();
    // 7. drop lands at the pointer and undo removes it
    const sc=document.querySelector('#scroller');sc.scrollTop=0;sc.scrollLeft=0;
    const r=sc.getBoundingClientRect();
    const dt=new DataTransfer();dt.items.add(await raster(40,40,'image/png'));
    sc.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true,clientX:r.left+M.colLeft+150,clientY:r.top+400}));
    await settle(5);
    const dropped=S.images[4];
    out.drop={x:dropped.x,y:dropped.y};
    N.core.undo();
    out.undo={count:S.images.length};
    // 8. the tablet route: read the clipboard through the async API
    const blob=await (await raster(64,32,'image/png')).arrayBuffer();
    await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([blob],{type:'image/png'})})]);
    out.clipboard={ok:await N.ui.pasteFromClipboard(),count:S.images.length};
    await navigator.clipboard.writeText('just words');
    out.clipboardText={ok:await N.ui.pasteFromClipboard(),count:S.images.length,toast:document.querySelector('#toast').textContent};
    S.images=[];N.ink.render();
    return out;
  });
  console.log('Paste images:',JSON.stringify(pasted));
  assert.equal(pasted.big.prevented,true,'A pasted image is handled by Notas');
  assert.equal(pasted.big.mime,'image/png');
  assert.deepEqual(pasted.big.px,{w:2000,h:800},'A 3000px screenshot is stored at the 2000px cap');
  assert.equal(pasted.big.fits,true,'The pasted image fits the column');
  assert.equal(pasted.big.h,Math.round(pasted.big.w*800/2000),'Aspect ratio is kept');
  assert.equal(pasted.jpg.mime,'image/jpeg','A small JPEG keeps its bytes');
  assert.deepEqual([pasted.jpg.w,pasted.jpg.h],[300,200]);
  assert.deepEqual(pasted.jpg.offset,[24,24],'A second paste steps away from the first');
  assert.equal(pasted.svg.mime,'image/png','SVG is converted to PNG for export and re-import');
  assert.deepEqual(pasted.svg.px,{w:120,h:60});
  assert.deepEqual(pasted.svg.offset,[24,24],'A third paste steps again');
  assert.deepEqual(pasted.fieldWithText,{prevented:false,count:3},'Text plus image inside a field pastes the text');
  assert.deepEqual(pasted.fieldImageOnly,{prevented:true,count:4},'An image alone inside a field is inserted');
  assert.deepEqual(pasted.textOnly,{prevented:false,count:4},'Plain text is left to the browser');
  assert.deepEqual(pasted.broken,{added:false,count:4},'A broken image is refused without an error');
  assert.deepEqual(pasted.underSheet,{prevented:false,count:4},'A dialog keeps its own paste');
  assert.deepEqual(pasted.drop,{x:150,y:400},'A dropped image lands at the pointer');
  assert.equal(pasted.undo.count,4,'Undo removes the dropped image');
  assert.deepEqual(pasted.clipboard,{ok:true,count:5},'The Paste image button reads the clipboard');
  assert.equal(pasted.clipboardText.ok,false,'Text on the clipboard is reported, not inserted');
  assert.equal(pasted.clipboardText.count,5);
  assert.match(pasted.clipboardText.toast,/nothing to paste/);
  assert.equal(await page.evaluate(()=>{N.ui.menuSheet();const b=document.querySelector('#paste-image');const t=b?.textContent;N.ui.closeSheet();return t;}),'pastectrl/⌘ V','The menu offers Paste');
  console.log('Paste images: sizing, formats, placement, fields, drop, clipboard button');
  // Ink clipboard: Copy and Duplicate on the selection bar, Ctrl+C/X/D, and
  // paste through both the paste event and the menu's clipboard read. The
  // marker on the system clipboard decides whether copied ink is still newest.
  const inkClip=await page.evaluate(async()=>{
    const S=N.core.S,sc=document.querySelector('#scroller');sc.scrollTop=0;sc.scrollLeft=0;
    localStorage.removeItem('notas.clip');
    const mk=(id,pts)=>{const flat=pts.flatMap(([x,y])=>[x,y,.5]);return {id,author:'user',w:2.8,t0:1,t1:1,tool:'pen',pts:flat,bbox:N.ink.bboxOf(flat)};};
    const base=S.strokes.length;
    S.strokes=S.strokes.concat([mk('cp0',[[300,500],[340,500],[340,540]]),mk('cp1',[[350,500],[380,540]])]);
    N.ink.setTool('select');S.selection=['cp0','cp1'];N.ink.showSelBar();
    const out={};
    out.bar=[...document.querySelectorAll('#selbar button')].map(b=>b.textContent);
    N.ink.duplicateSelection();
    const dup=S.selection.map(id=>S.strokes.find(s=>s.id===id));
    out.dup={count:S.strokes.length-base,selected:dup.length,x:dup[0].bbox[0],y:dup[0].bbox[1],tool:S.tool,bar:document.querySelector('#selbar').hidden};
    N.core.undo();
    out.undo={count:S.strokes.length-base};
    S.selection=['cp0','cp1'];
    out.copied=N.ink.copySelection(false);
    await new Promise(r=>setTimeout(r,150));
    const clip=N.ink.readClip();
    out.clip={strokes:clip.strokes.length,w:clip.w,h:clip.h,rel:clip.strokes[0].pts.slice(0,2),marker:await navigator.clipboard.readText()===N.ink.clipMarker(clip)};
    const paste=(text,target)=>{const dt=new DataTransfer();dt.setData('text/plain',text);const ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});(target||document.body).dispatchEvent(ev);return ev.defaultPrevented;};
    const first=paste(N.ink.clipMarker(clip));
    let p=S.strokes[S.strokes.length-2];
    out.pasteMarker={prevented:first,count:S.strokes.length-base,selected:S.selection.length,x:p.bbox[0],y:p.bbox[1]};
    paste(N.ink.clipMarker(clip));
    p=S.strokes[S.strokes.length-2];
    out.pasteAgain={count:S.strokes.length-base,x:p.bbox[0],y:p.bbox[1]};
    out.staleText={prevented:paste('some words'),count:S.strokes.length-base};
    // inside a field the marker still means ink: the marker text is nonsense there
    const field=document.createElement('input');document.body.appendChild(field);field.focus();
    out.fieldMarker={prevented:paste(N.ink.clipMarker(clip),field),count:S.strokes.length-base};
    out.fieldWords={prevented:paste('2+2',field),count:S.strokes.length-base};
    field.remove();
    out.menuPaste={ok:await N.ui.pasteFromClipboard(),count:S.strokes.length-base};
    await navigator.clipboard.writeText('later words');
    out.menuStale={ok:await N.ui.pasteFromClipboard(),count:S.strokes.length-base,toast:document.querySelector('#toast').textContent};
    S.selection=['cp0','cp1'];N.ink.copySelection(true);
    out.cut={count:S.strokes.length-base,has:!!N.ink.readClip(),selected:S.selection.length};
    S.strokes=S.strokes.slice(0,base);N.ink.clearSelection();N.ink.after();localStorage.removeItem('notas.clip');
    return out;
  });
  console.log('Ink clipboard:',JSON.stringify(inkClip));
  // the test strokes are unread ink, so the bar also offers to ask nota about them
  assert.deepEqual(inkClip.bar,['solve this','ask nota','copy','duplicate','delete'],'Selection bar offers Copy and Duplicate');
  assert.deepEqual(inkClip.dup,{count:4,selected:2,x:300,y:564,tool:'select',bar:false},'Duplicate lands 24px below, selected, with the bar showing');
  assert.equal(inkClip.undo.count,2,'One undo removes the duplicate');
  assert.equal(inkClip.copied,true);
  assert.deepEqual(inkClip.clip,{strokes:2,w:80,h:40,rel:[0,0],marker:true},'Copy stores relative ink and puts its marker on the clipboard');
  assert.deepEqual(inkClip.pasteMarker,{prevented:true,count:4,selected:2,x:24,y:80},'Ctrl+V with the marker pastes ink at the top left of the view, selected');
  assert.deepEqual(inkClip.pasteAgain,{count:6,x:48,y:104},'A repeat paste steps diagonally');
  assert.deepEqual(inkClip.staleText,{prevented:false,count:6},'Words copied since leave the ink alone');
  assert.deepEqual(inkClip.fieldMarker,{prevented:true,count:8},'The marker inside a field still pastes ink');
  assert.deepEqual(inkClip.fieldWords,{prevented:false,count:8},'Words inside a field paste as words');
  assert.deepEqual(inkClip.menuPaste,{ok:true,count:10},'The menu Paste reads the marker from the clipboard and pastes ink');
  assert.equal(inkClip.menuStale.ok,false);
  assert.equal(inkClip.menuStale.count,10);
  assert.match(inkClip.menuStale.toast,/nothing new to paste/);
  assert.deepEqual(inkClip.cut,{count:8,has:true,selected:0},'Cut removes the ink and keeps a copy');

  // Pasted screenshots lose their uniform border; images without one are untouched.
  const cropped=await page.evaluate(async()=>{
    const raster=(w,h,type,paint)=>new Promise(r=>{const cv=document.createElement('canvas');cv.width=w;cv.height=h;const x=cv.getContext('2d');paint(x);cv.toBlob(b=>r(new File([b],'a.'+type.split('/')[1],{type})),type);});
    const decoded=src=>new Promise(r=>{const i=new Image();i.onload=()=>r({w:i.naturalWidth,h:i.naturalHeight});i.src=src;});
    const shot=await raster(400,300,'image/png',x=>{x.fillStyle='#fff';x.fillRect(0,0,400,300);x.fillStyle='#248';x.fillRect(100,100,120,60);});
    const a=await N.ui.normaliseImage(shot);
    const photo=await raster(300,200,'image/jpeg',x=>{const g=x.createLinearGradient(0,0,300,200);g.addColorStop(0,'#f00');g.addColorStop(1,'#00f');x.fillStyle=g;x.fillRect(0,0,300,200);});
    const b=await N.ui.normaliseImage(photo);
    const cutout=await raster(200,200,'image/png',x=>{x.fillStyle='#0a0';x.fillRect(80,80,40,40);});
    const c=await N.ui.normaliseImage(cutout);
    return {shot:{...await decoded(a.src),mime:a.src.slice(5,14)},photo:{...await decoded(b.src),mime:b.src.slice(5,15)},cutout:{...await decoded(c.src),mime:c.src.slice(5,14)}};
  });
  console.log('Auto-crop:',JSON.stringify(cropped));
  assert.deepEqual(cropped.shot,{w:152,h:92,mime:'image/png'},'A screenshot with a white border is trimmed to its content plus a margin');
  assert.deepEqual(cropped.photo,{w:300,h:200,mime:'image/jpeg'},'A photo with no uniform border keeps its bytes');
  assert.deepEqual(cropped.cutout,{w:72,h:72,mime:'image/png'},'A transparent-bordered cut-out is trimmed and stays PNG');

  // A typed line's answer is on the page too, and a click opens nothing.
  const typedAnswer=await page.evaluate(async()=>{
    const S=N.core.S;
    const ln=N.text.add(1200,false);ln.text='2+2';N.text.render();N.mathcore.run();
    await new Promise(r=>setTimeout(r,50));
    const chip=[...document.querySelectorAll('#margin .chip')].find(c=>c.dataset.node===ln.id);
    if(!chip)return {chip:false};
    chip.click();
    const out={chip:true,text:chip.textContent.trim(),plain:chip.children.length===0};
    S.lines=S.lines.filter(l=>l.id!==ln.id);N.text.render();N.mathcore.run();
    return out;
  });
  console.log('Typed answer:',JSON.stringify(typedAnswer));
  assert.deepEqual(typedAnswer,{chip:true,text:'4',plain:true},'A typed answer stays a plain answer on the page');



  await page.goto(base+'/notas.html?selftest=1');
  await page.locator('#selftest').waitFor();
  const failures=await page.locator('#selftest .f').allTextContents();
  assert.deepEqual(failures,[]);
  assert.deepEqual(remote,[],'No external runtime requests');
  assert.deepEqual(errors,[],'No browser errors');
  console.log('Built-in self tests, UI, and zero external requests: passed');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
