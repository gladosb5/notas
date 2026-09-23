// The gliding caret on a touch screen: with nothing selected the native
// caret is transparent and #caret glides in its place, as with a mouse; a
// selected range keeps the native caret colour (iPadOS draws the selection
// handles in it) and the bar steps aside. A mouse keeps the native caret
// hidden whatever is selected.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const state=page=>page.evaluate(()=>{
  const ta=N.text.currentText(),caret=document.getElementById('caret');
  return {coarse:matchMedia('(hover:none),(pointer:coarse)').matches,glide:document.getElementById('lines').classList.contains('glide'),
    caretColor:getComputedStyle(ta).caretColor,bar:caret.classList.contains('on')&&getComputedStyle(caret).display!=='none'};
});
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function typeHello(page){
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N&&N.text&&N.typing);
  await page.evaluate(()=>{const skip=[...document.querySelectorAll('.tut button')].find(b=>b.textContent.trim()==='skip');if(skip)skip.click();});
  await page.evaluate(()=>N.text.focusLast());
  await page.keyboard.type('hello there');
  await settle(page);
}
const select=(page,s,e)=>page.evaluate(([s,e])=>{N.text.currentText().setSelectionRange(s,e);document.dispatchEvent(new Event('selectionchange'));},[s,e]);
try{
  // an iPad: touch, no hover
  const ipad=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true,isMobile:true});
  const page=await ipad.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await typeHello(page);
  let s=await state(page);
  assert.ok(s.coarse,'the context is a touch screen');
  assert.ok(s.glide&&s.bar,'nothing selected: the gliding bar shows on a touch screen');
  assert.equal(s.caretColor,'rgba(0, 0, 0, 0)','nothing selected: the native caret is hidden');
  await select(page,0,5);await settle(page);
  s=await state(page);
  assert.ok(!s.glide&&!s.bar,'a selected range: the bar steps aside');
  assert.notEqual(s.caretColor,'rgba(0, 0, 0, 0)','a selected range keeps the native caret colour for the handles');
  await select(page,3,3);await settle(page);
  s=await state(page);
  assert.ok(s.glide&&s.bar&&s.caretColor==='rgba(0, 0, 0, 0)','collapsing the selection brings the bar back');
  assert.deepEqual(errors,[]);
  await ipad.close();

  // a mouse: unchanged, the native caret stays hidden even over a range
  const desk=await browser.newContext({viewport:{width:1180,height:820}});
  const dp=await desk.newPage();
  await typeHello(dp);
  await select(dp,0,5);await settle(dp);
  s=await state(dp);
  assert.ok(!s.coarse&&s.bar&&s.caretColor==='rgba(0, 0, 0, 0)','with a mouse the bar glides over a range too');
  await desk.close();
  console.log('touch caret: ok');
}finally{await browser.close();server.close();}
