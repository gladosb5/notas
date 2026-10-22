// Pasted words are a step of their own: Ctrl+Z takes the paste back (not the
// letters typed before it), the browser's own undo carries on with the typing
// after that, and Ctrl+Y / Ctrl+Shift+Z bring both back in order.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N&&N.ui&&N.text&&N.core.S.id);
  await page.waitForTimeout(400);
  const reset=lines=>page.evaluate(lines=>{
    N.tutorial?.finish?.(false);document.getElementById('preparing')?.classList.add('done');
    N.core.Undo.back.length=0;N.core.Undo.fwd.length=0;N.core.Undo.typing=null;
    N.core.S.lines=lines;N.text.render();N.ink.setTool('text');N.text.focusLine(lines[0].id,true);
  },lines);
  const paste=t=>page.evaluate(t=>{const dt=new DataTransfer();dt.setData('text/plain',t);document.activeElement.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},t);
  const texts=()=>page.evaluate(()=>N.core.S.lines.slice().sort((a,b)=>a.y-b.y).map(l=>l.text));

  // 1. typed, then pasted: Ctrl+Z takes the paste, the next one the typing
  await reset([{id:'a',y:60,text:'',h:30}]);
  await page.keyboard.type('abc ');
  await paste('hello world');
  assert.deepEqual(await texts(),['abc hello world']);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await texts(),['abc '],'Ctrl+Z takes back the paste');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await texts(),['abc'],'the next Ctrl+Z takes back the typing before it');
  await page.keyboard.press('Control+y');
  assert.deepEqual(await texts(),['abc '],'Ctrl+Y brings the typing back');
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual(await texts(),['abc hello world'],'and Ctrl+Shift+Z the paste');
  await page.keyboard.type('!');
  assert.deepEqual(await texts(),['abc hello world!'],'typing after a redone paste lands at its end');

  // 2. a paste into an empty line is undone too (the browser has nothing of its own to undo)
  await reset([{id:'b',y:60,text:'',h:30}]);
  await paste('first'+String.fromCharCode(10)+'second');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await texts(),[''],'a paste into an empty line is undone');
  await page.keyboard.press('Control+y');
  assert.deepEqual(await texts(),['first\nsecond'],'and redone');

  // 3. a paste over a selection across lines is one step: undo brings the lines back
  await reset([{id:'c',y:60,text:'one two',h:30},{id:'d',y:90,text:'three four',h:30}]);
  await page.evaluate(()=>{
    const a=document.querySelector('[data-id="c"]'),b=document.querySelector('[data-id="d"]');
    const ta=[...a.childNodes].find(n=>n.nodeType===3),tb=[...b.childNodes].find(n=>n.nodeType===3);
    document.getSelection().setBaseAndExtent(ta,4,tb,5);
  });
  await paste('2 3');
  assert.deepEqual(await texts(),['one 2 3 four'],'the paste replaces the words between the ends');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await texts(),['one two','three four'],'one Ctrl+Z brings both lines back');
  await page.keyboard.press('Control+y');
  assert.deepEqual(await texts(),['one 2 3 four'],'Ctrl+Y pastes again');

  // 4. the undo button takes a paste back as well
  await reset([{id:'e',y:60,text:'x',h:30}]);
  await paste('yz');
  await page.evaluate(()=>document.getElementById('btn-undo').click());
  assert.deepEqual(await texts(),['x'],'the undo button takes back the paste');
  assert.deepEqual(errors,[]);
  console.log('paste-undo: ok');
}finally{
  await browser.close();server.close();
}
