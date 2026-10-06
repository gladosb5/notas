import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.core?.S.id&&N.ui);
  await page.evaluate(()=>{
    N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');
    N.core.S.settings.aiOn=false;N.ai.toggle();N.core.S.lines=[];N.text.render();N.ink.setTool('pen');
  });
  let serial=0;
  const seed=async zoom=>{
    await page.evaluate(([zoom,id])=>{
      const S=N.core.S;
      S.strokes=[{id,author:'user',w:2.8,t0:1,pts:[100,300,.5,160,300,.5,160,340,.5,220,340,.5],bbox:[100,300,220,340]}];
      N.recog.rebuild();Object.assign(S.clusters[0],{ascii:'6+2',latex:'6+2',pending:false,review:false,confirmed:false,asked:false});
      N.core.setZoom(zoom,400,350);N.mathcore.run();N.ink.render();
    },[zoom,'tap-'+(++serial)]);
    const r=await page.locator('.chip .solve').boundingBox();return {x:r.x+r.width/2,y:r.y+r.height/2};
  };
  const pen=async(type,p)=>page.locator('#c-ink').dispatchEvent(type,{pointerId:73,pointerType:'pen',isPrimary:true,button:0,buttons:type==='pointerup'||type==='pointercancel'?0:1,pressure:type==='pointerup'?0:.5,clientX:p.x,clientY:p.y,bubbles:true});
  for(const zoom of [.8,1,1.25]){
    const p=await seed(zoom);
    await pen('pointerdown',p);
    await pen('pointermove',{x:p.x+7,y:p.y+2});
    assert.equal(await page.locator('.chip.yield').count(),0,'Pen jitter must not dismiss Solve');
    // Simulate the background evaluator repainting the button during contact.
    await page.evaluate(()=>{delete document.querySelector('.chip').dataset.html;N.mathcore.run();});
    await page.waitForTimeout(450);
    await pen('pointerup',{x:p.x+7,y:p.y+2});
    assert.equal(await page.evaluate(()=>N.core.S.nodes.find(n=>n.kind==='cluster').result),'8');
    assert.equal(await page.evaluate(()=>N.core.S.strokes.length),1,'Solve tap leaves no dot or stroke');
  }
  let p=await seed(1);
  await pen('pointerdown',p);await pen('pointercancel',p);
  assert.equal(await page.evaluate(()=>N.core.S.strokes.length),1,'Cancelled tap leaves no stroke');
  assert.equal(await page.evaluate(()=>!!N.core.S.clusters[0].asked),false);
  p=await seed(1);
  await pen('pointerdown',p);await pen('pointermove',{x:p.x+45,y:p.y+20});await pen('pointermove',p);await pen('pointerup',p);
  assert.equal(await page.evaluate(()=>N.core.S.strokes.length),2,'Writing through a chip still draws');
  assert.equal(await page.evaluate(()=>!!N.core.S.clusters[0].asked),false,'Out-and-back stroke is not a tap');
  console.log('Pen Solve: held taps, jitter, repaint, zoom, cancellation and writing through passed.');
}finally{await browser.close();server.close();}
