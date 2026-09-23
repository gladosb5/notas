// The gliding caret on a touch screen: with nothing selected the native
// caret is transparent and #caret glides in its place, as with a mouse; a
// selected range keeps the native caret colour (iPadOS draws the selection
// handles in it) and the bar steps aside. A mouse keeps the native caret
// hidden whatever is selected. A tap puts the caret between the characters
// under it (iOS would snap it to a word boundary), in any line.
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
  // a tap mid-word lands between those characters even when the browser
  // snaps the caret to the word's end first, as iOS does; a tap on an
  // earlier line moves the caret there
  await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.type('second line');await settle(page);
  const at=(line,off)=>page.evaluate(([line,off])=>{
    const t=document.querySelectorAll('#lines .line .txt')[line],r=document.createRange();r.setStart(t.firstChild,off);r.setEnd(t.firstChild,off);
    const c=r.getBoundingClientRect();return {x:c.left+1,y:c.top+c.height/2};
  },[line,off]);
  const snapLikeIOS=()=>page.evaluate(()=>setTimeout(()=>{const t=N.text.currentText();if(t){const w=t.value.indexOf(' ',t.selectionStart);t.setSelectionRange(w<0?t.value.length:w,w<0?t.value.length:w);}},20));
  const caretIs=()=>page.evaluate(()=>{const t=N.text.currentText();return t&&{text:t.value,start:t.selectionStart,end:t.selectionEnd};});
  let p=await at(0,3);await page.touchscreen.tap(p.x,p.y);await snapLikeIOS();await page.waitForTimeout(400);
  assert.deepEqual(await caretIs(),{text:'hello there',start:3,end:3},'a tap in an earlier line puts the caret between the tapped characters');
  await page.keyboard.type(' ');
  assert.equal((await caretIs()).text,'hel lo there','typing after the tap lands at the tapped character');
  p=await at(1,4);await page.touchscreen.tap(p.x,p.y);await page.waitForTimeout(400);
  assert.deepEqual(await caretIs(),{text:'second line',start:4,end:4},'a tap in another line moves the caret into it');
  // a double tap's word selection is left alone
  p=await at(1,2);await page.touchscreen.tap(p.x,p.y);
  await page.evaluate(()=>N.text.currentText().setSelectionRange(0,6));await page.waitForTimeout(400);
  assert.deepEqual(await caretIs(),{text:'second line',start:0,end:6},'a selected word is not collapsed by the tap');
  // focusing a line by script (no tabindex now) still lands in it
  await page.evaluate(()=>N.text.focusLast());
  assert.equal((await caretIs()).text,'second line','focus() by script still lands in the line');
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
