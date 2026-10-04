import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
import {samples as authored} from './fixtures/math-notes.mjs';

// experiments/ is gitignored: without the local MathWriting corpus there is nothing to route
const corpusFile=new URL('../experiments/ocr-quality/mathwriting-notebook/test-corpus.json',import.meta.url);
let corpusText;
try{corpusText=await readFile(corpusFile,'utf8');}catch(e){
  if(e.code!=='ENOENT')throw e;
  console.log('SKIPPED ink routing: experiments/ocr-quality/mathwriting-notebook/test-corpus.json is not present (gitignored dataset).');
  process.exit(0);
}
const corpus=JSON.parse(corpusText);
const online=corpus.samples.find(s=>s.id==='004c9413be3ff1be-isolated');
assert.ok(online,'known held-out online sample exists');
const fallback=authored.find(s=>s.id==='61+1=-isolated');
const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.recog?.recognize&&window.N?.core?.S);
  async function run(sample){
    return page.evaluate(async sample=>{
      const S=N.core.S;N.recog.reset();S.settings.aiOn=true;S.strokes=sample.strokes;S.clusters=[];S.images=[];N.recog.rebuild();
      const ids=new Set(sample.targetIds),cl=S.clusters.find(c=>c.strokeIds.some(id=>ids.has(id)));
      if(!cl)throw Error('target cluster missing');
      await N.recog.recognize(cl);
      const live=S.clusters.find(c=>c.hash===cl.hash);
      return {latex:live?.latex,alternatives:live?.alternatives,modelVersion:live?.modelVersion,confidence:live?.confidence,needsConfirmation:live?.needsConfirmation,strokeIds:live?.strokeIds};
    },sample);
  }
  const primary=await run(online);
  assert.match(primary.modelVersion||'',/:ink$/,'held-out online strokes take the ink-primary route');
  assert.equal(primary.latex,online.latex,'known held-out success remains exact through production routing');
  assert.ok(primary.confidence>=.70,JSON.stringify(primary));
  assert.ok(primary.alternatives?.length>0,'completed stroke alternatives survive production routing');
  assert.ok(!primary.alternatives.includes(primary.latex),'primary reading is not duplicated');
  assert.deepEqual([...primary.strokeIds].sort(),[...online.targetIds].sort(),'route receives exactly the intended strokes');

  // These two were recognition-v13's sampling-consensus repairs (r/mu, b/p). Which of two
  // variable-like letters a writer meant is the model's call and changes with the weights;
  // routing must still deliver the whole expression: every symbol and structure (the
  // radical included, which box detection once dropped), at most one letter-for-letter swap.
  const toks=s=>String(s||'').match(/\\[A-Za-z]+|\\.|[^\s]/g)||[];
  const letter=/^(?:[A-Za-z]|\\(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|chi|psi|omega))$/;
  for(const id of ['00fee560e6c9af79-isolated','026fd85034106735-isolated']){
    const sample=corpus.samples.find(s=>s.id===id);assert.ok(sample,id);
    const corrected=await run(sample);
    const got=toks(corrected.latex),want=toks(sample.latex);
    assert.equal(got.length,want.length,'the whole expression reaches the notebook for '+id+': '+corrected.latex);
    const swaps=want.map((t,i)=>[t,got[i]]).filter(([a,b])=>a!==b);
    assert.ok(swaps.length<=1&&swaps.every(([a,b])=>letter.test(a)&&letter.test(b)),'only a variable letter may differ for '+id+': '+corrected.latex);
    assert.match(corrected.modelVersion||'',/:ink$/);
    assert.deepEqual([...corrected.strokeIds].sort(),[...sample.targetIds].sort());
  }

  // With no second model, a completed low-confidence stroke reading is kept
  // and marked to be checked rather than dropped.
  const low=await run(fallback);
  assert.match(low.modelVersion||'',/:ink$/,'low-confidence authored strokes stay on the stroke reader');
  assert.ok(low.latex,'a completed low-confidence reading is still shown');
  assert.equal(low.needsConfirmation,true,'and asks to be checked before solving');
  assert.equal(await page.evaluate(()=>typeof N.recog.readImage),'undefined','pictures are no longer read');
  console.log('Production ink-primary success and low-confidence handling passed.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
