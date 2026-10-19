import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
import {writing} from './fixtures/math-notes.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,notaOn:false,backgroundRemovalOn:false})));
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.mathcore?.harden()&&N.nota?.Writer&&document.querySelector('#preparing').classList.contains('done'));
 await page.evaluate(async()=>{N.tutorial?.finish(false);await N.boot.loadCAS();N.ink.setTool('text');});
 const typed=async expression=>page.evaluate(expression=>{
  const S=N.core.S;S.lines=[{id:'silent-line',text:expression,y:120,h:N.core.LINE_H}];S.strokes=[];S.clusters=[];
  N.text.render();N.mathcore.run();return S.nodes.map(n=>({result:n.result,error:n.error}));
 },expression);
 const quiet=async()=>{
  assert.equal(await page.locator('.chip:visible,.plot:visible').count(),0,'failed calculations show no chip or graph');
  assert.equal(await page.locator('.ghost-layer .ghost').count(),0,'failed calculations leave no stale answer preview');
  assert.doesNotMatch(await page.locator('#page-accessible').textContent(),/calculation issue|cannot calculate|could not read|could not graph|syntax error/i);
 };
 for(const expression of ['2+*3=','sqrt(=','unknown+2=','1/0=','2+)=']){
  assert.equal((await typed('2+2='))[0].result,'4');
  assert.equal(await page.locator('.ghost-layer .ghost').textContent(),'4');
  const nodes=await typed(expression);assert.ok(nodes[0].error,`evaluates an actual failure: ${expression}`);
  await quiet();
  await page.evaluate(()=>{N.text.focusLine('silent-line');document.activeElement?.blur();N.mathcore.run();});
  await quiet();
 }
 // A saved or explicitly requested malformed model reading stays silent too.
 for(const reading of ['2+*3=','invalid_latex("\\\\frac{")','1/0=']){
  for(const review of [false,true]){
   const state=await page.evaluate(({strokes,reading,review})=>{
    const S=N.core.S;S.lines=[];S.strokes=strokes;S.clusters=[];N.recog.reset();N.recog.rebuild();
    Object.assign(S.clusters[0],{ascii:reading,latex:reading,pending:false,review,asked:true,confirmed:true,error:review?'could not finish reading this expression':''});
    N.text.render();N.mathcore.run();return {result:S.nodes[0]?.result,error:S.nodes[0]?.error};
   },{strokes:writing('61+1=',40,180,'silent'),reading,review});
   assert.ok(!state.result,'malformed handwriting produces no answer');await quiet();
  }
 }
 await typed('y=1/0');await quiet();
 await typed('y=x^2');assert.equal(await page.locator('.plot:visible').count(),1,'valid graphs still appear');
 await typed('y=1/0');await quiet();
 // Quick maths must clear both visual and screen-reader feedback, then recover.
 const input=page.locator('#quick-expression');
 await input.fill('2+2');await input.press('Enter');
 await page.waitForFunction(()=>document.querySelector('#quick-answer .qa-value').textContent==='= 4');
 for(const expression of ['2+','sqrt(','1/0','unknown+2']){
  await input.fill(expression);await input.press('Enter');await page.waitForTimeout(250);
  assert.equal(await page.locator('#quick-result').isVisible(),false);
  assert.equal(await page.locator('#quick-status').textContent(),'');assert.equal(await input.getAttribute('aria-invalid'),null);assert.equal(await input.getAttribute('title'),'');
 }
 await input.fill('6*7');await input.press('Enter');await page.waitForFunction(()=>document.querySelector('#quick-answer .qa-value').textContent==='= 42');
 assert.equal((await typed('6*7'))[0].result,'42','valid calculations recover after failures');
 assert.ok(await page.locator('.chip:visible').count()>0);
 assert.deepEqual(errors,[]);
 console.log('Silent calculation errors: typed input, stale previews, malformed model output, explicit Solve, graphs, quick maths and recovery passed');
}finally{await browser.close();server.close();}
