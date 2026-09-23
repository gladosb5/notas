import {chromium, devices} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

/* Typing on a phone. A finger's tap on the paper focuses a line and the
   caret stays there: the browser's own mouse events for the tap arrive after
   the line was focused, and a mousedown on bare paper used to take the focus
   straight back, so the keyboard never rose and nothing blinked. A tap on a
   line puts the caret where the finger was, not at the end of the line. */
const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({...devices['Pixel 7'],serviceWorkers:'block'});
await context.route(/encoder\.onnx/,route=>route.fulfill({status:200,contentType:'application/octet-stream',body:Buffer.alloc(3*1048576)}));
const page=await context.newPage();
try{
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.ui?.importNoteFile);
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'),null,{timeout:60000});
  await page.evaluate(()=>{N.tutorial?.finish(false);N.core.S.settings.aiOn=false;N.ai.toggle();});
  await page.evaluate(()=>{N.ink.setTool('text');N.core.S.lines=[{id:'one',y:120,text:'hello there selectable words'}];N.text.render();document.activeElement.blur();});
  await page.waitForTimeout(200);
  const state=()=>page.evaluate(()=>{
    const sel=getSelection(),a=document.activeElement,host=document.getElementById('lines');
    return {inHost:a===host||host.contains(a),line:N.text.focusedLine()?.id||null,off:sel.anchorOffset,inText:sel.anchorNode?.nodeType===3,collapsed:sel.isCollapsed};
  });
  const line=await page.evaluate(()=>{const b=document.querySelector('.line .txt').getBoundingClientRect();return {x:b.x,y:b.y+b.height/2,h:b.height};});

  // a tap on bare paper below the line starts a line there and keeps it
  await page.touchscreen.tap(line.x+40,line.y+140);
  await page.waitForTimeout(400);
  let s=await state();
  assert.equal(s.inHost,true,'A tap on the paper leaves a line focused: '+JSON.stringify(s));
  assert.ok(s.line&&s.line!=='one','The new line under the finger has the caret');
  assert.equal(await page.evaluate(()=>N.core.S.lines.length),2,'A line was started where the finger tapped');
  await page.keyboard.type('ok');
  assert.equal(await page.evaluate(()=>N.core.S.lines.find(l=>l.id!=='one').text),'ok','Typing lands in the new line');

  // a tap on a typed line puts the caret where the finger was
  await page.touchscreen.tap(line.x+60,line.y);
  await page.waitForTimeout(400);
  s=await state();
  assert.equal(s.line,'one','The tapped line has the caret');
  assert.ok(s.inText&&s.collapsed&&s.off>0&&s.off<28,'The caret is where the finger was, not at the end: '+JSON.stringify(s));
  await page.keyboard.type('Z');
  const text=await page.evaluate(()=>N.core.S.lines.find(l=>l.id==='one').text);
  assert.ok(/^hello \w*Z/.test(text)&&!/Z$/.test(text),'Typing goes in at the finger: '+text);

  // Enter, then words, then the toolbar's undo (a two-finger tap on a
  // tablet): the words go first, then the split, and redo brings both back
  const lines=()=>page.evaluate(()=>N.core.S.lines.slice().sort((a,b)=>a.y-b.y).map(l=>l.text));
  const before=await lines();
  await page.keyboard.press('Enter');
  const split=await lines();
  await page.keyboard.type('more ');
  const typedOut=await lines();
  assert.equal(split.length,before.length+1,'Enter split the line');
  assert.notDeepEqual(typedOut,split,'The words landed');
  await page.evaluate(()=>N.core.undo());
  assert.deepEqual(await lines(),split,'The first undo takes back only the words typed since Enter');
  await page.evaluate(()=>N.core.undo());
  assert.deepEqual(await lines(),before,'The second undo joins the split line back');
  await page.evaluate(()=>{N.core.redo();N.core.redo();});
  assert.deepEqual(await lines(),typedOut,'Redo brings back the split and the words');

  console.log('Mobile text: paper tap keeps focus, line tap places the caret, typing lands passed');
}finally{
  await browser.close();server.close();
}
