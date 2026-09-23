import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0);
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.ui);
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done')); 
  await page.evaluate(()=>N.tutorial?.finish(false));
  for(const notes of [false,true]){
   await page.evaluate(notes=>N.ui.openSheet('<h2>Panel</h2><p>'+('longword'.repeat(80))+'</p>',notes),notes);
   await page.waitForTimeout(500);
   const grab=page.locator('.sheet:not(.leave) .notes-grab');
   const boxH=()=>page.locator('.sheet .box').evaluate(el=>Math.round(el.getBoundingClientRect().height));
   /* the sheet is dragged, not toggled: its height tracks the pointer while
      the button is down, in both directions, and only settles on release */
   const drag=async(grip,dy,{hold=false,pause=45}={})=>{
    const r=await grip.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
    await page.mouse.move(x,y);await page.mouse.down();
    for(let i=1;i<=8;i++){await page.mouse.move(x,y+dy*i/8);await page.waitForTimeout(pause);}
    const live=hold?await boxH():null;
    await page.mouse.up();await page.waitForTimeout(500);
    return live;
   };
   const resting=await boxH();
   const following=await drag(grab,-120,{hold:true});
   assert.ok(Math.abs(following-(resting+120))<=2,'the sheet follows the pointer: '+following+' vs '+(resting+120));
   assert.equal(await page.locator('.sheet.expanded').count(),1,'released above the resting height it settles at the top');
   const box=await page.locator('.sheet .box').boundingBox();assert.ok(box.y<=13,JSON.stringify(box));
   assert.equal(await page.locator('.sheet .body').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
   /* a sheet dragged down from the top returns to its resting height first,
      the way a bottom sheet with two detents does; the next drag dismisses */
   await drag(grab,120);
   assert.equal(await page.locator('.sheet.expanded').count(),0,'down from the top settles back at the resting height');
   assert.equal(await page.locator('.sheet').count(),1,'one drag down from the top does not dismiss');
   assert.ok(Math.abs(await boxH()-resting)<=2,'it is back at exactly the resting height');
   /* the heading is a grip too, so the reach is the width of the sheet */
   await drag(page.locator('.sheet .head h2'),-140);
   assert.equal(await page.locator('.sheet.expanded').count(),1,'the heading drags the sheet as well as the handle');
   /* a flick down, rather than a measured drag, leaves in one gesture */
   await drag(grab,140,{pause:8});
   await page.waitForTimeout(300);assert.equal(await page.locator('.sheet').count(),0,'a flick down dismisses from the top in one gesture');
  }
  await page.evaluate(()=>{N.ink.setTool('text');N.text.add(120,true);});
  const input=page.locator('.line .txt').last();
  await input.fill('Hey nota '+('longword'.repeat(100)));
  const sizes=await input.evaluate(el=>({w:el.clientWidth,sw:el.scrollWidth,h:el.clientHeight,sh:el.scrollHeight,ghost:el.parentElement.querySelector('.ghost-layer').scrollWidth}));
  assert.ok(sizes.sw<=sizes.w+1,JSON.stringify(sizes));assert.ok(sizes.sh<=sizes.h+1,JSON.stringify(sizes));assert.ok(sizes.ghost<=sizes.w+1,JSON.stringify(sizes));
  const restored=await input.evaluate(el=>{
   const ln=N.core.S.lines.find(l=>l.id===el.dataset.id),before=ln.h;
   ln.h=30;N.text.render();
   return {before,after:ln.h};
  });
  assert.equal(restored.after,restored.before,'remote heights must not override local wrapping');
  await page.close();
 }
 console.log('Panel snap gestures and long text wrapping pass at phone and desktop widths.');
}finally{await browser.close();server.close();}
