// Mock every model request: these are persistence and race regressions,
// independent of provider availability or the recognition model's guesses.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
const calls=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
await context.addInitScript(()=>{
  localStorage.setItem('notas.tut','done');
  localStorage.setItem('notas.prefs',JSON.stringify({animations:false}));
});
await context.route(/\/assets\/(?:ink|text|smart)\//,route=>route.abort());
const collabSource=(await readFile(new URL('../collab.js',import.meta.url),'utf8')).replace('N.collab={','N.collab={strokeSig,cleanLineAttrs,cleanStroke,');
await context.route('**/collab.js',route=>route.fulfill({contentType:'text/javascript',body:collabSource}));
let mode='ok',release;
const REPLY='Four is the answer. Here is the explanation, written on the page once and kept there for later. This response is long enough to appear while streaming, before the connection is interrupted in the partial-reply regression.';
const event=content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n';
await context.route(/\/nota\/chat$|api\.cerebras\.ai/,async route=>{
  calls.push(route.request().postDataJSON());
  if(mode==='held')await new Promise(r=>release=r);
  await route.fulfill({contentType:'text/event-stream',body:mode==='empty'?'data: {"error":{"message":"no reply"}}\n\n':event(mode==='one-word'?'Yes':REPLY)+(mode==='partial'?'data: {"error":{"message":"connection interrupted"}}\n\n':'data: [DONE]\n\n')});
});
async function ready(){
  await page.waitForFunction(()=>window.N?.nota&&document.querySelector('#preparing').classList.contains('done'));
  await page.evaluate(()=>{N.core.S.settings.aiOn=false;N.ai.toggle();});
}
async function settled(count){
  await page.waitForFunction(()=>!N.nota.busy);
  assert.equal(calls.length,count,'one model request per new question');
}
async function typed(question,id){
  return page.evaluate(({question,id})=>{
    const ln=id?N.core.S.lines.find(l=>l.id===id):N.text.add(120,true);
    ln.text='hey nota, '+question;N.text.render();N.core.markDirty();N.nota.onTyped(ln);return ln.id;
  },{question,id});
}
async function waitReply(count){
  await page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&!l.wait));
  await settled(count);
}
async function ink(id,question='what is two plus two?'){
  return page.evaluate(({id,question})=>{
    const pts=[];for(let x=40;x<=280;x+=5)pts.push(x,420+Math.sin(x/9)*8,.5);
    N.core.S.strokes.push({id,author:'user',w:2.4,t0:1,t1:2,pts,bbox:N.ink.bboxOf(pts)});
    N.recog.rebuild();
    N.collab.strokeSig(N.core.S.strokes.find(s=>s.id===id)); // prime the sharing signature cache
    const group=N.recog.textGroups().find(g=>g.strokeIds.includes(id));
    // Nota accepts this confidence; the search index deliberately does not.
    N.nota.onTranscript({hash:group.hash,text:'hey nota, '+question,confidence:.6},group);
    return group;
  },{id,question});
}
async function saveReload(){
  await page.evaluate(()=>N.core.save());await page.reload();await ready();
}
async function newNote(){await page.evaluate(()=>N.ui.newNote());}
try{
  await page.goto(base+'/notas.html',{waitUntil:'domcontentloaded'});await ready();

  // A restored typed prompt may be emitted again by an editor/peer. It must
  // not append another answer, even after the original reply was removed.
  const typedId=await typed('what is 2 + 2?');await waitReply(1);
  await saveReload();
  await page.evaluate(id=>N.nota.onTyped(N.core.S.lines.find(l=>l.id===id)),typedId);
  await page.waitForTimeout(800);await settled(1);
  assert.equal(await page.locator('.line.call').count(),1,'restored typed call stays blue');
  await page.evaluate(id=>{
    N.core.S.lines=N.core.S.lines.filter(l=>!l.tutor);N.text.render();N.nota.onTyped(N.core.S.lines.find(l=>l.id===id));
  },typedId);
  await page.waitForTimeout(800);await settled(1);
  await typed('what is 2 - 2?',typedId);await waitReply(2);
  console.log('Typed receipts survive reload and reply removal; a meaningful edit still asks anew.');

  await newNote();
  await ink('question');
  await page.waitForFunction(()=>N.core.S.strokes.some(s=>s.author==='ai'));
  await settled(3);
  assert.equal(await page.evaluate(()=>JSON.parse(N.collab.strokeSig(N.core.S.strokes.find(s=>s.id==='question'))).notaAsked),true,'sharing publishes the receipt even when the stroke signature was cached');
  assert.equal(await page.evaluate(()=>N.core.S.textTranscripts.length),0,'low-confidence prompt has no search transcript');
  await saveReload();
  assert.equal(await page.evaluate(()=>N.nota.isAskedStroke('question')),true,'handwritten question stays blue after reload');
  await page.evaluate(()=>{
    // Moving ink changes its grouping hash. An OCR refresh can also change
    // punctuation and wording without creating a new physical question.
    const st=N.core.S.strokes.find(s=>s.id==='question');
    for(let i=0;i<st.pts.length;i+=3)st.pts[i]+=14;
    st.bbox=N.ink.bboxOf(st.pts);N.recog.rebuild();
    const g=N.recog.textGroups().find(g=>g.strokeIds.includes(st.id));
    N.nota.onTranscript({hash:g.hash,text:'hey nota what is 2 plus 2?',confidence:.95},g);
  });
  await page.waitForTimeout(900);await settled(3);
  assert.equal(await page.evaluate(()=>N.nota.isAskedStroke('question')),true);
  // Export/import validation must retain the receipt alongside the ink.
  await page.evaluate(()=>{window.receiptExport=N.core.serialize();});
  await page.evaluate(async()=>N.ui.importNoteFile(new File([JSON.stringify(window.receiptExport)],'receipt.notas.json',{type:'application/json'})));
  await page.waitForFunction(()=>N.core.S.strokes.some(s=>s.id==='question'));
  assert.equal(await page.evaluate(()=>N.nota.isAskedStroke('question')),true,'import preserves the blue receipt');
  console.log('Handwritten receipts survive missing OCR metadata, reload, moved ink, OCR rewording and export/import.');

  await newNote();mode='partial';
  const partialId=await typed('explain a partly received answer?');await waitReply(4);
  await page.evaluate(id=>N.nota.onTyped(N.core.S.lines.find(l=>l.id===id)),partialId);
  await page.waitForTimeout(800);await settled(4);
  await saveReload();
  await page.evaluate(id=>N.nota.onTyped(N.core.S.lines.find(l=>l.id===id)),partialId);
  await page.waitForTimeout(800);await settled(4);
  assert.equal(await page.locator('.line.tutor:not(.wait)').count(),1);
  console.log('A reply retained after a broken stream is not repeated, including after reload.');

  await newNote();mode='ok';
  // Keep the claim unresolved across another input notification. Both the
  // ordinary debounce and claim path must treat it as one in-flight job.
  await page.evaluate(()=>{
    window.realClaim=N.collab.claimNota;window.claimCount=0;
    N.collab.claimNota=async()=>{window.claimCount++;await new Promise(r=>window.releaseClaim=r);return {state:'claimed',finish:async()=>{}};};
  });
  const raceId=await typed('can a slow claim run twice when the question is long? '+('Please explain this carefully using the context of the notebook. '.repeat(4))+'Can you help?');
  await page.waitForFunction(()=>window.claimCount===1);
  await page.evaluate(id=>N.nota.onTyped(N.core.S.lines.find(l=>l.id===id)),raceId);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(()=>window.claimCount),1,'only one unresolved claim');
  await page.evaluate(()=>{window.releaseClaim();N.collab.claimNota=window.realClaim;});await waitReply(5);
  assert.equal(await page.evaluate(id=>{
    const source=N.core.S.lines.find(l=>l.id===id);
    return source.notaAsked.length>200&&N.collab.cleanLineAttrs(source).notaAsked===source.notaAsked;
  },raceId),true,'long typed receipts survive shared-note validation');
  console.log('Repeated input during a slow room claim creates one claim and one answer.');

  // Switching away and back to the same note invalidates old callbacks,
  // including a delayed claim and a model response already in flight.
  await newNote();
  const returnTo=await page.evaluate(()=>N.core.S.id);
  await page.evaluate(()=>{N.collab.claimNota=async()=>{await new Promise(r=>window.releaseClaim=r);return {state:'claimed',finish:async()=>{}};};window.releaseClaim=null;});
  await typed('should this old claim survive a note switch?');
  await page.waitForFunction(()=>typeof window.releaseClaim==='function');
  await newNote();await page.evaluate(id=>N.ui.openNote(id),returnTo);
  await page.evaluate(()=>{window.releaseClaim();N.collab.claimNota=window.realClaim;});
  await page.waitForTimeout(800);await settled(5);

  mode='held';
  await typed('should an old response land after reopening?');
  await page.waitForFunction(()=>N.nota.busy);
  while(!release)await new Promise(r=>setTimeout(r,20));
  await newNote();await page.evaluate(id=>N.ui.openNote(id),returnTo);
  release();await page.waitForTimeout(800);await settled(6);
  assert.equal(await page.locator('.line.tutor').count(),0,'stale response never appends to reopened note');
  console.log('Delayed claims and responses are discarded after switching away and back.');

  await newNote();mode='ok';
  // Migrate notes saved by older builds before a model refresh can discard
  // their OCR-only answered flags.
  await page.evaluate(()=>{
    const pts=[40,420,.5,280,435,.5];
    N.core.S.strokes.push({id:'legacy',author:'user',w:2.4,t0:1,t1:2,pts,bbox:N.ink.bboxOf(pts)});
    N.recog.rebuild();
    const group=N.recog.textGroups().find(g=>g.strokeIds.includes('legacy'));
    N.core.S.textTranscripts=[{hash:group.hash,text:'hey nota, an old answered question?',confidence:.95,modelVersion:'older-ocr',asked:true}];
    N.recog.rebuild();
  });
  assert.equal(await page.evaluate(()=>N.core.S.strokes.find(s=>s.id==='legacy').notaAsked),true,'legacy answered flag migrated before OCR cleanup');
  await saveReload();
  assert.equal(await page.evaluate(()=>N.nota.isAskedStroke('legacy')),true);
  await settled(6);
  console.log('Older answered transcripts migrate to persistent blue source ink before OCR cleanup.');

  await newNote();
  await ink('selected','why does this selection ask once?');
  await page.evaluate(()=>{
    N.recog.readStrokesText=async()=>{
      await new Promise(r=>setTimeout(r,800));
      return {text:'hey nota, why does this selection ask once?',confidence:.9,bbox:N.core.S.strokes.find(s=>s.id==='selected').bbox};
    };
    N.core.S.selection=['selected'];window.selectionAnswer=N.nota.askSelection();
  });
  await page.evaluate(()=>window.selectionAnswer);
  await page.waitForTimeout(1200);await settled(7);
  assert.equal(await page.evaluate(()=>N.nota.isAskedStroke('selected')),true);
  await saveReload();
  await page.evaluate(()=>{
    const group=N.recog.textGroups().find(g=>g.strokeIds.includes('selected'));
    N.nota.onTranscript({hash:group.hash,text:'hey nota, why does this selection ask once?',confidence:.9},group);
  });
  await page.waitForTimeout(800);await settled(7);
  console.log('Lasso requests and automatic handwriting detection share the same source receipt.');

  await newNote();mode='empty';
  const beforeFailure=calls.length;
  const firstFailure=page.waitForResponse(response=>response.url().endsWith('/nota/chat'));
  const emptyId=await typed('can I retry when nothing was written?');
  await firstFailure;await page.waitForFunction(()=>!N.nota.busy);
  const afterFailure=calls.length; // typed provider routing differs between the two apps
  assert.ok(afterFailure>beforeFailure);
  assert.equal(await page.evaluate(id=>N.core.S.lines.find(l=>l.id===id).notaAsked,emptyId),undefined);
  mode='ok';
  await page.evaluate(id=>N.nota.onTyped(N.core.S.lines.find(l=>l.id===id)),emptyId);
  await waitReply(afterFailure+1);
  console.log('A failure before any output leaves the question available for an intentional retry.');

  await newNote();mode='one-word';
  await ink('one-word');
  await page.waitForFunction(()=>N.core.S.strokes.some(s=>s.author==='ai'));
  await settled(afterFailure+2);await saveReload();
  assert.equal(await page.evaluate(()=>N.nota.isAskedStroke('one-word')),true,'a single buffered word receives a durable receipt when flushed');
  console.log('Single-word ink replies retain their receipt even when all strokes are flushed at stream completion.');
  assert.deepEqual(errors,[]);
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
