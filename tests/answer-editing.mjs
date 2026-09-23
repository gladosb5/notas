import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0);
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.ui?.newNote&&N.core.S.id);
  await page.evaluate(()=>{
    N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');
    N.core.S.settings.aiOn=false;N.ai.toggle();N.ink.setTool('text');
    N.core.S.lines=[{id:'answer',y:120,text:''}];N.text.render();
  });
  const input=page.locator('.txt[data-id="answer"]');
  const val=()=>input.evaluate(el=>el.value);
  await input.focus();await input.pressSequentially('3+3=');
  assert.equal(await val(),'3+3=','Equals alone leaves the line unchanged');
  await page.evaluate(()=>N.mathcore.run());
  assert.equal(await page.locator('.ghost-layer .ghost').textContent(),'6','Equals previews the answer');
  assert.equal(await val(),'3+3=','Preview does not change the saved text');
  await input.press('Space');
  assert.equal(await val(),'3+3=6','Space after equals adds the editable answer');
  await input.pressSequentially('+1');await page.evaluate(()=>N.mathcore.run());
  assert.equal(await val(),'3+3=6+1');
  assert.equal(await page.evaluate(()=>N.core.S.nodes[0].result),'7');
  assert.equal(await page.locator('.line .txt').count(),1,'Continuation stays on the same line');
  assert.equal(await page.locator('.continue-answer').count(),0,'No continuation button');
  await input.press('=');assert.equal(await val(),'3+3=6+1=');
  await input.press('Space');assert.equal(await val(),'3+3=6+1=7');
  await input.pressSequentially('*2=');assert.equal(await val(),'3+3=6+1=7*2=');
  await input.press('Space');assert.equal(await val(),'3+3=6+1=7*2=14');
  await input.press('Backspace');assert.equal(await val(),'3+3=6+1=7*2=1');
  await input.press('Backspace');await page.evaluate(()=>N.mathcore.run());
  assert.equal(await val(),'3+3=6+1=7*2=','Deleted answer stays deleted');
  await input.fill('3+3');await page.evaluate(()=>N.mathcore.run());
  await input.press('End');await input.pressSequentially('+1');
  assert.equal(await val(),'3+3+1','Typing an operator leaves the line as typed');
  await page.evaluate(()=>N.mathcore.run());
  const id=await page.evaluate(async()=>{N.core.markDirty();await N.core.save();return N.core.S.id;});
  await page.evaluate(()=>N.ui.newNote());await page.evaluate(id=>N.ui.openNote(id),id);
  assert.equal(await val(),'3+3+1');
  assert.equal(await page.evaluate(()=>N.core.S.nodes[0].result),'7');
  await page.evaluate(async()=>{
    const entries=N.mathcore.savedAnswers();entries.find(([,v])=>v.result==='7')[1].result='cached result';
    N.mathcore.reset();N.mathcore.restoreAnswers(entries);N.mathcore.run();N.core.markDirty();await N.core.save();
  });
  assert.equal(await page.evaluate(()=>N.core.S.nodes[0].result),'cached result');
  await page.reload();await page.waitForFunction(()=>window.N?.core?.S.nodes.some(n=>n.src==='3+3+1'));
  assert.equal(await page.evaluate(()=>N.core.S.nodes[0].result),'cached result','Reload uses saved result');
  await page.evaluate(()=>{document.getElementById('preparing').classList.add('done');N.core.S.settings.aiOn=false;N.ai.toggle();});
  await input.fill('3+3+2');await page.evaluate(()=>N.mathcore.run());
  assert.equal(await page.evaluate(()=>N.core.S.nodes[0].result),'8');
  const point=await page.evaluate(()=>{
    const C=N.core,S=C.S;S.lines=[];S.strokes=[
      {id:'connected',author:'user',w:2,pts:[50,300,.6,350,300,.8],times:[0,300],t0:1,t1:301,bbox:[50,300,350,300]},
      {id:'untouched',author:'user',w:2,pts:[50,400,.6,350,400,.8],bbox:[50,400,350,400]}];
    N.text.render();N.ink.render();N.ink.setTool('eraser');
    const r=document.getElementById('scroller').getBoundingClientRect();
    return {x:r.left+C.M.colLeft+200*C.M.zoom,y:r.top+300*C.M.zoom};
  });
  await page.mouse.click(point.x,point.y);
  assert.deepEqual(await page.evaluate(()=>N.core.S.strokes.map(s=>s.id)),['untouched']);
  await page.evaluate(()=>N.core.undo());
  assert.deepEqual(await page.evaluate(()=>N.core.S.strokes.map(s=>s.id)),['connected','untouched']);
  await page.evaluate(()=>N.core.redo());assert.equal(await page.evaluate(()=>N.core.S.strokes.length),1);
  const letter=await page.evaluate(()=>{
    N.core.S.strokes=[];N.core.S.lines=[{id:'letters',y:120,text:'abcdef'}];N.text.render();N.ink.render();
    const d=document.querySelector('.line'),mirror=document.createElement('div');mirror.className='ghost-layer';mirror.textContent='abcdef';d.appendChild(mirror);
    const range=document.createRange();range.setStart(mirror.firstChild,2);range.setEnd(mirror.firstChild,3);
    const r=range.getBoundingClientRect();mirror.remove();return {x:r.x+r.width/2,y:r.y+r.height/2};
  });
  await page.mouse.click(letter.x,letter.y);
  const erased=await page.evaluate(()=>N.core.S.lines[0].text);
  assert.ok(erased.length>0&&erased.length<6&&!erased.includes('c'));
  await page.evaluate(()=>N.core.undo());assert.equal(await page.evaluate(()=>N.core.S.lines[0].text),'abcdef');
  console.log('Space-triggered inline answer chains, saved results, character deletion, whole-stroke erasing and undo passed.');
}finally{await browser.close();server.close();}
