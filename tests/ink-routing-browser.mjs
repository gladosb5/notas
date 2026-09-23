import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
import {samples as authored} from './fixtures/math-notes.mjs';

const corpus=JSON.parse(await readFile('experiments/ocr-quality/mathwriting-notebook/test-corpus.json','utf8'));
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

  for(const id of ['00fee560e6c9af79-isolated','026fd85034106735-isolated']){
    const sample=corpus.samples.find(s=>s.id===id);assert.ok(sample,id);
    const corrected=await run(sample);
    assert.equal(corrected.latex,sample.latex,'sampling consensus reaches the notebook for '+id);
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
