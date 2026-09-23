import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:900,height:700}});
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.ink?.copySelection&&window.N?.ui?.importNoteFile);
  // the launch screen holds the page while the model downloads; draw only once it has let go
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'),null,{timeout:60000});
  await page.evaluate(()=>{N.tutorial?.finish?.(false);N.ink.setTool('pen');N.core.S.strokes=[];N.core.S.selection=[];});
  const box=await page.locator('#c-ink').boundingBox();
  assert.ok(box,'ink canvas is visible');
  const x=box.x+180,y=box.y+180;
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=1;i<=6;i++){await page.waitForTimeout(7);await page.mouse.move(x+i*16,y+(i%2)*7);}
  await page.mouse.up();
  const captured=await page.evaluate(()=>{
    const s=N.core.S.strokes.at(-1);return {pts:s?.pts?.length/3,times:s?.times?.slice(),t0:s?.t0,t1:s?.t1};
  });
  assert.ok(captured.pts>=3,JSON.stringify(captured));
  assert.equal(captured.times.length,captured.pts);
  assert.ok(captured.times.every((v,i,a)=>Number.isFinite(v)&&v>=0&&(!i||v>=a[i-1])));
  assert.ok(captured.times.at(-1)>captured.times[0],'captured point timing advances during a live stroke');

  const copied=await page.evaluate(()=>{
    const S=N.core.S,s=S.strokes.at(-1);S.selection=[s.id];N.ink.copySelection(false);
    const clip=N.ink.readClip();N.ink.pasteInk({x:s.bbox[0]+220,y:s.bbox[1]+40});
    const pasted=S.strokes.at(-1);return {clipTimes:clip.strokes[0].times,pastedTimes:pasted.times,pastedDuration:pasted.t1-pasted.t0};
  });
  assert.deepEqual(copied.clipTimes,captured.times);
  assert.deepEqual(copied.pastedTimes,captured.times);
  // t0 is a large performance.now() value, so t1-t0 carries float error of a few microseconds
  assert.ok(Math.abs(copied.pastedDuration-captured.times.at(-1))<1e-3,'pasted duration matches the captured timing');

  const exported=await page.evaluate(()=>JSON.stringify(N.core.serialize()));
  const round=await page.evaluate(async raw=>{
    const ok=await N.ui.importNoteFile(new File([raw],'timing.notas.json',{type:'application/json'}));
    return {ok,times:N.core.S.strokes.map(s=>s.times)};
  },exported);
  assert.equal(round.ok,true);
  assert.ok(round.times.some(t=>JSON.stringify(t)===JSON.stringify(captured.times)),'import preserves point timing');

  /* coloured ink, ink in the gutter left of the column, and a turned,
     cropped picture all come back as they went out */
  const styled=JSON.parse(exported);
  styled.strokes[0].color='#D64541';
  styled.strokes.push({...styled.strokes[0],id:'gutter',color:undefined,times:undefined,pts:[-40,300,.5,-20,310,.5]});
  const px='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  styled.images=[{id:'pic',x:-30,y:40,w:100,h:80,src:px,rot:0.5,full:px,crop:{l:.1,t:.1,r:.9,b:.9}}];
  const kept=await page.evaluate(async raw=>{
    const ok=await N.ui.importNoteFile(new File([raw],'styled.notas.json',{type:'application/json'}));
    const S=N.core.S,im=S.images[0]||{};
    return {ok,color:S.strokes[0].color,gutter:!!S.strokes.find(s=>s.id==='gutter'),rot:im.rot,x:im.x,crop:im.crop,full:!!im.full};
  },JSON.stringify(styled));
  assert.deepEqual(kept,{ok:true,color:'#D64541',gutter:true,rot:0.5,x:-30,crop:{l:.1,t:.1,r:.9,b:.9},full:true},'import keeps ink colour, gutter ink and a turned, cropped picture');

  const bad=JSON.parse(exported);bad.strokes[0].times=[0,20,10];
  assert.equal(await page.evaluate(async raw=>N.ui.importNoteFile(new File([raw],'bad-timing.notas.json',{type:'application/json'})),JSON.stringify(bad)),false);
  console.log('Live point timing, clipboard round-trip, export/import preservation and malformed timing rejection passed.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
