// The typed lines live in one editing host, so a selection can run across
// lines natively: the browser extends, drags and copies it; the model does
// what the browser would otherwise do to the line divs (delete, type over,
// paste, join) in one undo step.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const url=`http://127.0.0.1:${server.address().port}/notas.html`;
const errors=[];
async function boot(page){
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(()=>window.N?.ui?.newNote&&N.core.S.id);
  await page.evaluate(()=>{
    N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');
    N.core.S.settings.aiOn=false;N.ai.toggle();N.ink.setTool('text');
    N.core.S.lines=[{id:'a',y:120,text:'first line'},{id:'b',y:150,text:'second line'},{id:'c',y:180,text:'third line'}];N.text.render();
  });
}
const texts=page=>page.evaluate(()=>N.core.S.lines.slice().sort((a,b)=>a.y-b.y).map(l=>l.text));
const sel=page=>page.evaluate(()=>{
  const s=document.getSelection(); const id=n=>n&&(n.nodeType===1?n:n.parentElement).closest('.line')?.firstChild.dataset.id;
  return {anchor:id(s.anchorNode),focus:id(s.focusNode),collapsed:s.isCollapsed,text:s.toString()};
});
const span=(page,a,s,b,e)=>page.evaluate(([a,s,b,e])=>{
  const A=document.querySelector('.txt[data-id="'+a+'"]'),B=document.querySelector('.txt[data-id="'+b+'"]');
  document.getElementById('lines').focus({preventScroll:true});
  document.getSelection().setBaseAndExtent(A.firstChild,s,B.firstChild,e);
},[a,s,b,e]);
const copied=async page=>{
  await page.evaluate(()=>{window.__copied='';document.addEventListener('copy',e=>{window.__copied=e.clipboardData.getData('text/plain');},{once:true});document.execCommand('copy');});
  return page.evaluate(()=>window.__copied);
};
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await boot(page);
  assert.equal(await page.evaluate(()=>document.getElementById('lines').isContentEditable),true,'the lines sit in one editing host');
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#lines > .line')].map(d=>d.firstChild.dataset.id)),['a','b','c'],'host holds the lines in page order');

  /* a selection set across two lines, the way a drag or the handles leave it */
  await span(page,'b',7,'c',5);
  assert.deepEqual(await sel(page),{anchor:'b',focus:'c',collapsed:false,text:'line\nthird'},'one native selection over two lines');
  assert.equal(await copied(page),'line\nthird','copy carries the words between the ends');
  await page.keyboard.press('x');
  assert.deepEqual(await texts(page),['first line','second x line'],'a key replaces the span and lands at the seam');
  await page.evaluate(()=>N.core.undo());
  assert.deepEqual(await texts(page),['first line','second line','third line'],'one undo brings the lines back');
  assert.equal(await page.evaluate(()=>N.core.S.lines.find(l=>l.id==='c').y),180,'the line below moved back down');

  /* Backspace over a span from the middle of the first line to the end of the last */
  await span(page,'a',5,'c',10);
  await page.keyboard.press('Backspace');
  assert.deepEqual(await texts(page),['first'],'Backspace takes the span and nothing more');
  await page.evaluate(()=>N.core.undo());

  /* Enter over a span: the words go, the line splits at the seam */
  await span(page,'b',7,'c',6);
  await page.keyboard.press('Enter');
  assert.deepEqual(await texts(page),['first line','second ','line'],'Enter deletes the span and splits at the seam');
  await page.evaluate(()=>{N.core.undo();N.core.undo();});
  assert.deepEqual(await texts(page),['first line','second line','third line']);

  /* the browser's own moves: Shift+Down grows the selection into the next line, Down moves the caret there */
  await page.evaluate(()=>N.text.focusLine('b',true));
  await page.keyboard.press('Shift+ArrowDown');
  const grown=await sel(page);
  assert.equal(grown.anchor,'b'); assert.equal(grown.focus,'c'); assert.equal(grown.collapsed,false,'Shift+Down extends into the line below natively');
  await page.keyboard.press('ArrowLeft');
  await page.evaluate(()=>N.text.focusLine('a',false));
  await page.keyboard.press('ArrowDown');
  assert.equal((await sel(page)).focus,'b','Down moves the caret to the line below natively');
  await page.keyboard.press('ArrowUp');
  assert.equal((await sel(page)).focus,'a','Up moves it back');

  /* Ctrl+A: every line, then one key replaces the lot */
  await page.keyboard.press('Control+a');
  const all=await sel(page);
  assert.equal(all.collapsed,false); assert.equal(all.text.includes('first line')&&all.text.includes('third line'),true,'Ctrl+A selects every line');
  assert.equal(await copied(page),'first line\nsecond line\nthird line','copy of everything joins the lines');
  await page.keyboard.press('y');
  assert.deepEqual(await texts(page),['y'],'a key replaces every line');
  await page.evaluate(()=>N.core.undo());
  assert.deepEqual(await texts(page),['first line','second line','third line']);

  /* joins at the edges: Backspace at a start, Delete at an end */
  await page.evaluate(()=>N.text.focusLine('c',false));
  await page.keyboard.press('Backspace');
  assert.deepEqual(await texts(page),['first line','second linethird line'],'Backspace at the start joins onto the line above');
  assert.equal((await sel(page)).focus,'b');
  await page.evaluate(()=>N.core.undo());
  await page.evaluate(()=>N.text.focusLine('a',true));
  await page.keyboard.press('Delete');
  assert.deepEqual(await texts(page),['first linesecond line','third line'],'Delete at the end draws the line below up');
  assert.equal(await page.evaluate(()=>N.core.S.lines.find(l=>l.id==='c').y),150,'the line below moved up');
  await page.evaluate(()=>N.core.undo());

  /* typing and Enter still work one line at a time */
  await page.evaluate(()=>N.text.focusLine('a',true));
  await page.keyboard.type(' more');
  assert.deepEqual(await texts(page),['first line more','second line','third line']);
  await page.keyboard.press('Enter');
  await page.keyboard.type('new');
  assert.deepEqual(await texts(page),['first line more','new','second line','third line'],'Enter starts a line under, the rest move down');
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#lines > .line')].map(d=>d.firstChild.dataset.id.length>1)),[false,true,false,false],'the new line sits in page order in the host');

  /* paste brings words, never markup */
  await page.evaluate(()=>{
    const t=document.querySelector('.txt[data-id="b"]'); N.text.focusLine('b',true);
    const dt=new DataTransfer(); dt.setData('text/html','<b>bold</b>'); dt.setData('text/plain','bold');
    t.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  });
  assert.deepEqual(await texts(page),['first line more','new','second linebold','third line'],'paste inserts the plain words');
  assert.equal(await page.evaluate(()=>document.querySelector('.txt[data-id="b"]').innerHTML),'second linebold','and leaves one text node');

  /* the ghost still lands after the equals sign */
  await page.evaluate(()=>{N.core.S.lines=[{id:'m',y:120,text:''}];N.text.render();N.text.focusLine('m',true);});
  await page.keyboard.type('3+3=');
  await page.evaluate(()=>N.mathcore.run());
  assert.equal(await page.locator('.ghost-layer .ghost').textContent(),'6','equals previews the answer');
  await page.keyboard.press('Space');
  assert.deepEqual(await texts(page),['3+3=6'],'Space accepts it');

  assert.deepEqual(errors,[],'no page errors');
  console.log('line selection: ok');
}finally{await browser.close();server.close();}
