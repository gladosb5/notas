import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {startServer} from '../scripts/serve.mjs';
import {writing,stroke} from './fixtures/math-notes.mjs';

const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
  let page=await browser.newPage({serviceWorkers:'block',viewport:{width:1100,height:850}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.recog?.classifyHandwriting);
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'),null,{timeout:120000});
  await page.evaluate(()=>{N.tutorial?.finish(false);N.core.S.settings.aiOn=false;N.ai.toggle();});

  // Real stroke geometry plus independent text metadata, with adversarial
  // formula output. These test routing/UI behavior, not model accuracy.
  const seed=async(ascii,text,options={})=>page.evaluate(({ascii,text,options,strokes})=>{
    const S=N.core.S;S.settings.aiOn=false;N.recog.reset();
    S.lines=[];S.images=[];S.strokes=strokes;S.clusters=[];S.textTranscripts=[];N.recog.rebuild();
    if(S.clusters.length!==1)throw Error('Expected one fixture expression');
    const cl=S.clusters[0];
    Object.assign(cl,{ascii,latex:ascii,modelVersion:N.recog.resultVersion,confidence:.999,needsConfirmation:false,...options});
    N.recog.cache.set(cl.hash,{ascii,latex:ascii,modelVersion:N.recog.resultVersion,confidence:.999,confirmed:false,...options});
    S.textTranscripts=N.recog.textGroups().map(g=>({hash:g.hash,bbox:g.bbox,text,confidence:options.textConfidence??.99,modelVersion:N.recog.textVersion}));
    N.mathcore.run();
    return {kind:N.recog.handwritingKind(cl),node:S.nodes.find(n=>n.ref===cl),scope:S.scope};
  },{ascii,text,options,strokes:options.withoutEquals?writing('61+1',40,180,'intent'):writing('61+1=',40,180,'intent')});

  for(const [formula,text] of [['=2y*y*y*y=','hello'],['x=7','Homework 3'],['2+*3=','remember to revise'],['2+3=','2026-10-09'],['6+4=','to do']]){
    await seed(formula,text);
    assert.equal(await page.locator('.chip,.plot').count(),0,`No math UI for ${text}, even when formula output is ${formula}`);
    assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result||n.error||n.provides)),false,'No evaluation or scope pollution');
    assert.doesNotMatch(await page.locator('#page-accessible').textContent(),/cannot calculate|calculation issue|solve is offered/);
  }
  await seed('61+1=','61+1=',{textConfidence:.4,pending:true});
  assert.equal(await page.locator('.chip').count(),0,'Unclassified background ink does not show a pending chip');
  await seed('','hello',{review:true,error:'could not finish reading this expression'});
  assert.equal(await page.locator('.chip').count(),0,'Background reading failure stays quiet');

  await seed('61+1=','61+1=');
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='62')),'Real written equals plus math evidence auto-calculates');
  assert.equal(await page.locator('.chip.error').count(),0);
  await seed('61+1=','61+1',{withoutEquals:true});
  assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result)),false,'Invented equals cannot auto-calculate');
  assert.equal(await page.locator('.chip.offer .solve').count(),1,'Clear math remains available to Solve');
  await page.evaluate(()=>N.mathcore.requestSolve(N.core.S.clusters[0].id));
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='62')),'Explicit Solve remains an override');

  await seed('2+*3=','hello');
  await page.evaluate(()=>N.mathcore.requestSolve(N.core.S.clusters[0].id));
  assert.equal(await page.locator('.chip.error').count(),1,'An explicit failed Solve supplies feedback');
  await seed('61+1=','61+1=');
  await page.evaluate(()=>{N.core.S.textTranscripts[0].text='hello';N.mathcore.run();});
  assert.equal(await page.locator('.chip,.plot').count(),0,'Reclassification removes stale math output');

  await seed('2+3=','hello');
  const raw=await page.evaluate(()=>JSON.stringify(N.core.serialize()));
  const reopened=await page.evaluate(async raw=>{
    const ok=await N.ui.importNoteFile(new File([raw],'intent.notas.json',{type:'application/json'}));
    N.core.S.settings.aiOn=false;N.mathcore.run();return ok;
  },raw);
  assert.equal(reopened,true);assert.equal(await page.locator('.chip,.plot').count(),0,'Saved prose with an old formula reading reopens quietly');

  // Run the actual production readers on authored handwriting vectors. The
  // word paths are a development fixture, not captured human handwriting.
  await page.close();page=await browser.newPage({serviceWorkers:'block',viewport:{width:1100,height:850}});
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.recog?.classifyHandwriting);
  await page.evaluate(async()=>{N.tutorial?.finish(false);await N.ai.setup();});
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'));
  const hello=[[[420,160],[420,210],[430,190],[445,188],[450,210]],[[462,162],[462,210]],
    [[475,160],[475,210]],[[488,160],[488,210]],[[505,185],[500,205],[515,212],[522,195],[512,182]]]
    .map((pts,i)=>stroke('word'+i,pts,2.8,99+i));
  const real=await page.evaluate(async ({hello,math})=>{
    N.nota.onTranscript=()=>{};
    const S=N.core.S;S.settings.aiOn=true;N.recog.reset();S.strokes=[...hello,...math];S.clusters=[];S.lines=[];S.images=[];S.textTranscripts=[];
    N.recog.rebuild();
    for(const cl of S.clusters)await N.recog.recognize(cl);
    for(const group of N.recog.textGroups())await N.recog.recognizeText(group);
    S.settings.aiOn=false;N.mathcore.run();
    return S.clusters.map(cl=>({kind:N.recog.handwritingKind(cl),ascii:cl.ascii,text:S.textTranscripts.find(t=>t.bbox?.[1]===N.recog.textGroups().find(g=>g.strokeIds.includes(cl.strokeIds[0]))?.bbox[1])?.text,strokeIds:cl.strokeIds,result:S.nodes.find(n=>n.ref===cl)?.result,review:cl.review,error:cl.error,pending:cl.pending}));
  },{hello,math:writing('61+1=',40,340,'actual-math')});
  const word=real.find(c=>c.strokeIds.includes('word0')),math=real.find(c=>c.strokeIds.some(id=>id.startsWith('actual-math')));
  assert.equal(word?.kind,'text',JSON.stringify(real));assert.ok(!word.ascii,'Actual prose bypasses formula decoder');
  assert.equal(math?.kind,'math',JSON.stringify(real));assert.ok(math.ascii,'Actual math still gets read');
  await page.evaluate(()=>{N.ink.setTool('pen');N.ink.render();N.mathcore.run();});
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await page.screenshot({path:new URL('../test-results/handwriting-intent.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
  console.log('Handwriting routing/UI regressions and real-worker authored strokes passed:',JSON.stringify(real));

  // Optional local IAM images provide genuine handwriting evidence for the
  // text gate. They cannot measure the stroke decoder: IAM here is raster.
  if(process.env.NOTAS_IAM_CORPUS){
    const corpus=path.resolve(process.env.NOTAS_IAM_CORPUS),labels=JSON.parse(await readFile(path.join(corpus,'labels.json'),'utf8'));
    const images=new Map(await Promise.all(labels.map(async item=>[item.file,await readFile(path.join(corpus,item.file))])));
    await page.route('**/intent-corpus/*',route=>{
      const bytes=images.get(new URL(route.request().url()).pathname.split('/').at(-1));
      return bytes?route.fulfill({contentType:'image/jpeg',body:bytes}):route.abort();
    });
    const rows=await page.evaluate(async labels=>{
      const worker=new Worker('./text-worker.js');let id=0;
      const send=(payload,transfer=[])=>new Promise((resolve,reject)=>{
        const request=++id,timer=setTimeout(()=>{worker.terminate();reject(Error('Text worker timeout'));},120000);
        const receive=({data})=>{if(data.id!==request||data.progress)return;clearTimeout(timer);worker.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data);};
        worker.addEventListener('message',receive);worker.postMessage({...payload,id:request},transfer);
      });
      const rows=[];
      try{
        await send({type:'setup'});
        for(const item of labels){
          const bitmap=await createImageBitmap(await(await fetch('/intent-corpus/'+item.file)).blob());
          const scale=Math.min(1,2048/bitmap.width,1024/bitmap.height,Math.sqrt(900000/(bitmap.width*bitmap.height)));
          const width=Math.floor(bitmap.width*scale),height=Math.floor(bitmap.height*scale),canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
          ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);bitmap.close();
          const buffer=ctx.getImageData(0,0,width,height).data.buffer,start=performance.now();
          const out=await send({type:'recognize',width,height,buffer},[buffer]);
          rows.push({...item,prediction:out.text,confidence:out.confidence,kind:N.recog.classifyHandwriting(out),ms:performance.now()-start});
        }
      }finally{worker.terminate();}
      return rows;
    },labels);
    const promoted=rows.filter(r=>r.kind==='math');assert.deepEqual(promoted,[],'Genuine English handwriting does not become math');
    const times=rows.map(r=>r.ms).sort((a,b)=>a-b),counts=Object.fromEntries(['text','mixed','uncertain','math'].map(k=>[k,rows.filter(r=>r.kind===k).length]));
    const result={generatedAt:new Date().toISOString(),browser:await browser.version(),corpus,count:rows.length,counts,medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],
      scope:'Genuine IAM raster handwriting through the text reader and intent gate; does not measure online ink decoder accuracy.',
      modelContract:await page.evaluate(()=>NOTAS_MODEL_CONTRACT),sampleHashes:Object.fromEntries([...images].map(([file,data])=>[file,createHash('sha256').update(data).digest('hex')])),rows};
    await writeFile(new URL('../test-results/handwriting-intent-iam.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
    console.log('IAM English handwriting gate:',JSON.stringify({count:result.count,counts,medianMs:result.medianMs,p95Ms:result.p95Ms}));
  }
  assert.deepEqual(errors,[],'No browser script errors');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
