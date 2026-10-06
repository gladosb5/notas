import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.core?.S.id&&N.nota?.Writer);
  const result=await page.evaluate(()=>{
    N.tutorial.finish(false);const C=N.core,S=C.S;
    S.settings.aiOn=false;N.ai.toggle();S.settings.animations=false;
    const prices=N.nota.tidy('costs $5 and $10; escaped \\$3');
    const matches=N.nota.mathMatches('costs $5 and $10; solve $x+2$');
    S.strokes=[];S.lines=[];C.Undo.back=[];C.Undo.fwd=[];
    const writer=N.nota.Writer({x:10,y:200,right:600,instant:true,unit:1});
    writer.feed('Hello ');writer.feed('你好 😀');writer.finish();
    const unicode=S.lines.length,ink=S.strokes.length;C.undo();const removed=S.lines.length===0&&S.strokes.length===0;C.redo();
    return {prices,matches:matches.map(m=>m[0]),unicode,ink,removed,restored:S.strokes.length};
  });
  assert.equal(result.prices,'costs $5 and $10; escaped $3');
  assert.deepEqual(result.matches,['$x+2$']);
  assert.equal(result.unicode,0);assert.ok(result.ink>0);assert.equal(result.removed,true);assert.equal(result.restored,result.ink);
  console.log('Tutor edges passed: literal currency, escaped dollars, math delimiters, Unicode ink and undo/redo.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
