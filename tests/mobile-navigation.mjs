import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0);
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 for(const [width,height] of [[320,640],[390,844],[844,390],[820,1180],[1180,820]]){
  const ctx=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true,deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.library&&N.downloads);
  await page.evaluate(()=>{N.tutorial?.finish(false);N.ink.setTool('pen');for(const key of ['ink','text','cutout'])N.downloads.set(key,'download','',null,3000000,9000000);N.downloads.open(true);});
  await page.waitForTimeout(400);
  const bounds=await page.locator('#dlpop').boundingBox();
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height,`downloads fits ${width}x${height}: ${JSON.stringify(bounds)}`);
  assert.ok(await page.locator('#dlpop').evaluate(el=>el.scrollWidth<=el.clientWidth),'no horizontal clipping');
  if(width===390)await page.screenshot({path:'test-results/mobile-downloads.png'});
  if(width===390){
   await page.setViewportSize({width:320,height:240});
   await page.evaluate(()=>{for(const key of ['ink','text','cutout'])N.downloads.set(key,'download','',null,4000000,9000000);});
   const small=await page.locator('#dlpop').boundingBox();
   assert.ok(small.x>=0&&small.x+small.width<=320&&small.y+small.height<=240,'resizing to a short viewport keeps downloads on screen');
   assert.ok(await page.locator('#dlpop').evaluate(el=>getComputedStyle(el).overflowY==='auto'),'extra rows can scroll');
   await page.setViewportSize({width,height});
  }
  await page.evaluate(()=>N.downloads.open(false));
  const cdp=await ctx.newCDPSession(page);
  const swipe=async(x,y,dx,dy,points=1)=>{
   const contacts=(f)=>Array.from({length:points},(_,i)=>({x:x+dx*f+i*30,y:y+dy*f+i*30,radiusX:12,radiusY:12,force:.5,id:i}));
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:contacts(0)});
   for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:contacts(i/8)});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForTimeout(80);
  };
  const isOpen=()=>page.evaluate(()=>N.library.isOpen);
  await swipe(90,220,5,100);assert.equal(await isOpen(),false,'vertical scroll does not navigate');
  await swipe(90,220,120,0,2);assert.equal(await isOpen(),false,'two fingers do not navigate');
  await swipe(90,220,40,0);assert.equal(await isOpen(),false,'short swipe does not navigate');
  const phone=Math.min(width,height)<700;
  if(!phone){await swipe(width/2,220,120,0);assert.equal(await isOpen(),false,'tablet centre does not navigate');}
  const drawing=await page.evaluate(()=>N.core.S.strokes.length);
  await swipe(90,300,120,2);
  assert.equal(await isOpen(),false,'finger drawing does not navigate');
  assert.ok(await page.evaluate(()=>N.core.S.strokes.length)>drawing,'horizontal finger stroke is kept');
  await page.evaluate(()=>N.ink.setTool('text'));
  const before=await page.evaluate(()=>N.core.S.strokes.length);
  await swipe(phone?90:20,220,120,2);
  assert.equal(await isOpen(),true,`right swipe opens notes on ${width}x${height}`);
  assert.equal(await page.evaluate(()=>N.core.S.strokes.length),before,'navigation leaves no ink');
  await page.evaluate(()=>{N.library.close({immediate:true});N.ink.setTool('text');});
  await page.waitForTimeout(150);
  await swipe(phone?90:20,220,120,2);
  assert.equal(await isOpen(),true,'swipe also opens notes in text mode');
  assert.deepEqual(errors,[]);
  await ctx.close();
 }
 console.log('mobile downloads and notes swipe: ok');
}finally{await browser.close();server.close();}
