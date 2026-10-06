import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block'});
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.nota?.Writer);
 const result=await page.evaluate(()=>{
  N.tutorial.finish(false);
  const S=N.core.S;
  const run=(chunks)=>{
   S.strokes=[];S.lines=[];S.images=[];
   const w=N.nota.Writer({x:20,y:100,rowH:30,instant:true});
   const groups=[];
   for(const chunk of chunks){const before=S.strokes.length;w.feed(chunk);groups.push(S.strokes.slice(before).map(s=>s.bbox));}
   w.finish();return {groups,lines:S.lines.length,strokes:S.strokes.length,finite:S.strokes.every(s=>s.pts.every(Number.isFinite))};
  };
  return {
   inline:run(['Before ','$x=2$',' after ']),
   parens:run(['Before ','\\(x=2\\)',' after ']),
   display:run(['Before ','$$x=2$$',' after ']),
   displayNewline:run(['Before ','$$x=2$$','\n after ']),
   unicode:run(['Hello ','✓ 😀 你好 ','done ']),
   crlf:run(['First\r','\nSecond ']),
   tall:run(['$\\frac{1}{2}$',' after\n','next '])
  };
 });
 const top=g=>Math.min(...g.map(b=>b[1]));
 for(const key of ['inline','parens']){
  const g=result[key].groups;
  assert.ok(Math.abs(top(g[0])-top(g[2]))<3,key+' following prose stays on the same row');
  assert.ok(Math.min(...g[2].map(b=>b[0]))>Math.max(...g[1].map(b=>b[2])),key+' prose follows math horizontally');
 }
 assert.ok(top(result.display.groups[2])>top(result.display.groups[0])+30,'display math gets its own row');
 assert.ok(Math.abs(top(result.display.groups[2])-top(result.displayNewline.groups[2]))<3,'display newline is not counted twice');
 for(const key of ['unicode','crlf']){assert.equal(result[key].lines,0,key+' remains ink');assert.ok(result[key].strokes>0);assert.equal(result[key].finite,true);}
 assert.ok(result.unicode.groups[1].length>0,'unsupported characters have pen strokes');
 assert.ok(top(result.tall.groups[2])>Math.max(...result.tall.groups[0].map(b=>b[3])),'next row clears a tall fraction');
 console.log('Reply rendering passed: inline/display math, Unicode ink, CRLF and tall fractions.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
