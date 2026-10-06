import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/handwritten-y-equals-x.json',import.meta.url),'utf8'));
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block'});
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.recog?.recognize);
 const result=await page.evaluate(async fixture=>{
  N.tutorial.finish(false);const S=N.core.S;S.settings.aiOn=false;N.ai.toggle();N.recog.reset();S.strokes=fixture.strokes;S.clusters=[];N.recog.rebuild();
  const cl=S.clusters[0];await N.recog.recognize(cl,true);
  return {latex:cl.latex,alternatives:cl.alternatives,needsConfirmation:cl.needsConfirmation,confirmed:cl.confirmed,confidence:cl.confidence};
 },fixture);
 console.log(result);
 // recognition-v13 read these strokes as 41=x and the text reader's Y=X picked y=x from its
 // alternatives; recognition-v14 reads y=x itself. Either way the supplied ink must read y=x.
 assert.equal(result.latex,'y=x','The supplied strokes read y=x');
 assert.equal(result.needsConfirmation,true,'A short uncertain reading still asks to be checked');
 assert.equal(result.confirmed,false,'The application does not impersonate a user correction');
 const solved=await page.evaluate(()=>{N.mathcore.requestSolve(N.core.S.clusters[0].id);return {plots:document.querySelectorAll('.plot').length,unread:document.getElementById('margin').textContent.includes('could not read this')};});
 assert.equal(solved.plots,1,'Explicit Solve plots the corrected y=x');
 assert.equal(solved.unread,false,'The graph does not display the old unread error');

}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
