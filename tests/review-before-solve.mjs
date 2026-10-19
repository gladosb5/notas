import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
import {writing} from './fixtures/math-notes.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:false})));
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.mathcore?.harden()&&N.core.S.id&&document.querySelector('#preparing').classList.contains('done'));
  await page.evaluate(async()=>{N.tutorial?.finish(false);await N.boot.loadCAS();N.ink.setTool('text');});
  const seed=async(source,confirmed=false)=>page.evaluate(({source,confirmed,strokes})=>{
   const C=N.core,S=C.S;S.settings.aiOn=false;N.ai.toggle();N.recog.reset();S.strokes=strokes;S.lines=[];S.clusters=[];S.textTranscripts=[];N.recog.rebuild();
   const cl=S.clusters[0];Object.assign(cl,{ascii:source,latex:source,confidence:.999,needsConfirmation:false,confirmed,asked:false,pending:false,modelVersion:N.recog.resultVersion});
   N.recog.cache.set(cl.hash,{ascii:source,latex:source,confidence:.999,needsConfirmation:false,confirmed,asked:false,modelVersion:N.recog.resultVersion});
   S.textTranscripts=N.recog.textGroups().map(g=>({hash:g.hash,bbox:g.bbox,text:source,confidence:.999,modelVersion:N.recog.textVersion}));
   N.text.render();N.ink.render();N.mathcore.run();C.markDirty();return cl.id;
  },{source,confirmed,strokes:writing('61+1=',40,200,'review')});
  for(const [source,confirmed] of [['61+1=',false],['61+1',false],['61+1=',true],['y=x^2',false]]){
   await seed(source,confirmed);
   assert.equal(await page.locator('.chip.offer .solve').count(),1,`review first: ${source}, confirmed=${confirmed}`);
   assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result||n.plot||n.provides)),false,'no calculation, graph or variable definition before Solve');
   assert.ok((await page.locator('.chip.offer .reading').textContent()).replace(/\s/g,'').includes(source));
   assert.equal(await page.locator('.plot:visible').count(),0);
   await page.locator('.chip.offer .reading').click();
   assert.equal(await page.locator('.chip.offer .solve').count(),1,'tapping the equation does not solve it');
   // Repaints and stored answer memos cannot bypass review.
   await page.evaluate(()=>{N.mathcore.restoreAnswers([['cluster:'+N.core.S.clusters[0].hash,{key:'unused',result:'999'}]]);N.mathcore.run();N.recog.rebuild();N.mathcore.run();});
   assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result||n.plot)),false);
   if(width===390&&source==='61+1='&&!confirmed)await page.screenshot({path:'test-results/review-before-solve-mobile.png'});
   await page.locator('.chip.offer .solve').click();
   if(source.startsWith('y=')){
    assert.equal(await page.locator('.plot:visible').count(),1);assert.equal(await page.locator('.plot-reading').textContent(),source);
    assert.equal(await page.evaluate(()=>N.core.S.lines.some(l=>l.answerOf)),false,'a graph is the answer, with no scalar one written under it');
   }else{
    assert.equal(await page.locator('#margin .chip').count(),0,'Solve takes the box away: the margin keeps nothing');
    const written=await page.evaluate(()=>{
      const cl=N.core.S.clusters[0],ln=N.core.S.lines.find(l=>l.answerOf===cl.hash);
      if(!cl||!ln)return null;
      return {text:ln.text,y:ln.y,bb:cl.bbox,
              starts:Math.min(Math.max(0,Math.round(cl.bbox[0])),Math.max(0,N.core.M.contentW-80))===ln.x,
              reads:document.querySelector('#lines .line .txt')?.textContent===ln.text};
    });
    assert.ok(written,'the answer is written on the paper as a typed line, not a chip');
    assert.equal(written.text,'= 62');
    assert.equal(written.starts,true,'the answer starts where the working starts');
    assert.ok(written.y>=written.bb[3]+8,'the answer sits just under the working');
    assert.ok(written.reads,'the written answer reads on the paper');
    if(width===390&&source==='61+1='&&!confirmed)await page.screenshot({path:'test-results/review-solved-mobile.png'});
   }
  }
  await seed('61+1=');await page.locator('.chip.offer .solve').click();
  assert.equal(await page.evaluate(()=>N.core.S.lines.find(l=>l.answerOf)?.text),'= 62','the pressed answer is on the paper');
  await page.evaluate(()=>N.recog.confirm(N.core.S.clusters[0],'61+2='));
  assert.equal(await page.evaluate(()=>N.core.S.lines.some(l=>l.answerOf)),false,'a corrected reading takes its written answer with it');
  assert.equal(await page.locator('.chip.offer .solve').count(),1,'a corrected equation needs a new Solve');
  assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result)),false);
  await page.locator('.chip.offer .solve').click();
  assert.equal(await page.evaluate(()=>N.core.S.lines.filter(l=>l.answerOf).length),1,'the corrected answer replaced the old one on the paper');
  assert.equal(await page.evaluate(()=>N.core.S.lines.find(l=>l.answerOf)?.text),'= 63');
  assert.equal(await page.locator('#margin .chip').count(),0,'the margin keeps nothing after Solve');
  await page.evaluate(strokes=>{N.core.S.strokes.push(...strokes);N.recog.rebuild();N.mathcore.run();},writing('1',210,200,'added'));
  assert.ok(await page.evaluate(()=>N.core.S.clusters.every(c=>!c.asked)),'changed ink does not inherit Solve permission');
  assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result)),false);
  // Reload an unsolved note whose transcript already has a complete equation.
  await seed('61+1=');await page.evaluate(()=>N.core.save());await page.reload();
  await page.waitForFunction(()=>window.N?.core?.S.clusters.length&&document.querySelector('#preparing').classList.contains('done'));
  await page.locator('.chip.offer .solve').waitFor();assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result)),false,'saved readings never auto-solve on reopen');
  await page.locator('.chip.offer .solve').click();
  assert.equal(await page.evaluate(()=>N.core.S.lines.find(l=>l.answerOf)?.text),'= 62','a reopened note writes the answer on the paper, on demand');
  assert.equal(await page.locator('#margin .chip').count(),0);
  await page.evaluate(()=>{const ln=N.text.add(600,false);ln.text='2+2=';N.text.render();N.mathcore.run();});
  assert.equal(await page.locator('.ghost-layer .ghost').textContent(),'4','typed answer previews still work');
  assert.deepEqual(errors,[]);
  console.log(`Review before Solve: equals, confidence, corrections, changed strokes, saved readings, graphs and equation beside answer pass at ${width}px`);
  await context.close();
 }
}finally{await browser.close();server.close();}
