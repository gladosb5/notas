import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:900,height:700}});
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.core?.toast);
  const drag=async direction=>{
    await page.evaluate(()=>N.core.toast('note deleted',5000));
    const box=await page.locator('#toast').boundingBox();
    const x=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(x,y); await page.mouse.down();
    await page.mouse.move(x+(direction==='left'?-140:direction==='right'?140:0),y+(direction==='down'?110:0),{steps:8});
    await page.mouse.up();
    await page.waitForFunction(()=>!document.querySelector('#toast').classList.contains('in'));
  };
  for(const direction of ['down','left','right'])await drag(direction);

  await page.evaluate(()=>N.core.toast('old',5000));
  const box=await page.locator('#toast').boundingBox();
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y); await page.mouse.down();
  await page.mouse.move(x+140,y,{steps:8}); await page.mouse.up();
  await page.evaluate(()=>N.core.toast('new',5000));
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(()=>({text:document.querySelector('#toast').textContent,visible:document.querySelector('#toast').classList.contains('in')})),
    {text:'new',visible:true},'replacing a swiped toast keeps the new notice visible');
  const manifest=await (await page.request.get(base+'/manifest.webmanifest')).json();
  assert.equal(manifest.short_name,'notas');
  console.log('Toast swipes down, left and right; replacement survives dismissal; app name is lowercase.');
}finally{
  await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
