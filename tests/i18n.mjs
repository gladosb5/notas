import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

/* Languages: chosen on the intro's first screen, then the intro, the app and
   nota's answers follow it. English is the app's own text, restored exactly. */
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const base=`http://127.0.0.1:${server.address().port}`;
await mkdir('test-results',{recursive:true});
const WANT={ms:{name:'Bahasa Melayu',hello:'hai, pelajar.',html:'ms',rule:/Malay/},zh:{name:'中文',hello:'嘿，同学。',html:'zh-Hans',rule:/Chinese/}};
try{
 for(const [code,width,height,theme] of [['ms',390,844,'dark'],['zh',1280,900,'light'],['zh',390,844,'light']]){
  const want=WANT[code],touch=width<900,label=`${code}-${width}`;
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],asked=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.getItem('notas.prefs')||localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:true})));
  await context.route(/\/nota\/chat$|api\.cerebras\.ai|oxionai\.com/,async route=>{
   try{asked.push(JSON.parse(route.request().postData()||'{}'));}catch{}
   await route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'4'}}]})+'\n\ndata: [DONE]\n\n'});
  });
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>document.querySelector('#intro .i-lang')&&document.querySelector('#preparing').classList.contains('done'));

  /* choose the language: the rest of the intro is in it at once */
  const button=page.locator('#intro .i-lang',{hasText:want.name});
  if(touch)await button.tap();else await button.click();
  await page.waitForFunction(()=>N.tutorial.screen===1,null,{timeout:6000});
  await page.waitForFunction(()=>N.tutorial.settled,null,{timeout:12000});
  assert.equal(await page.evaluate(()=>N.i18n.lang),code);
  assert.equal(await page.evaluate(()=>document.documentElement.lang),want.html);
  assert.equal(await page.locator('#intro h1 .sr-only').textContent(),want.hello);
  assert.notEqual(await page.locator('.intro-skipall').textContent(),'skip all','skip all speaks the language');
  const total=await page.evaluate(()=>N.tutorial.screens);
  for(let i=1;i<total;i++){
   await page.waitForFunction(n=>N.tutorial.screen===n&&N.tutorial.settled,i,{timeout:12000});
   const fit=await page.evaluate(()=>{
    const stage=document.querySelector('.intro-stage').getBoundingClientRect(),root=document.getElementById('intro');
    return [...root.querySelectorAll('canvas,.i-paper,.i-pill,.i-search,.i-result,.i-pic')].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&(r.left<stage.left-1||r.right>stage.right+1)).length;
   });
   assert.equal(fit,0,`screen ${i} fits ${label}`);
   await page.screenshot({path:`test-results/i18n-${label}-${String(i).padStart(2,'0')}.png`});
   if(i<total-1)await page.evaluate(()=>N.tutorial.next());
  }
  await page.waitForFunction(()=>!N.tutorial.running,null,{timeout:6000});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('notas.prefs')).language),code,'the choice is the default from now on');

  /* nota is told to answer in it */
  await page.evaluate(()=>{const ln=N.text.add(160,false);ln.text='hey nota, what is 2 + 2?';N.text.render();N.nota.onTyped(ln);});
  await page.waitForFunction(n=>window.__asked===undefined,0).catch(()=>{});
  for(let k=0;k<40&&!asked.length;k++)await page.waitForTimeout(250);
  assert.ok(asked.length,'nota was asked');
  const system=asked[0].messages?.find(m=>m.role==='system')?.content||'';
  assert.match(system,want.rule,'the system prompt names the language');

  /* it stays after a reload */
  await page.reload();
  await page.waitForFunction(()=>window.N?.i18n&&document.querySelector('#preparing').classList.contains('done'));
  assert.equal(await page.evaluate(()=>N.i18n.lang),code);
  assert.equal(await page.evaluate(()=>document.documentElement.lang),want.html);
  await page.screenshot({path:`test-results/i18n-${label}-app.png`});

  /* English from settings puts back exactly what the app wrote */
  await page.evaluate(()=>N.i18n.set('en'));
  assert.equal(await page.evaluate(()=>document.documentElement.lang),'en');
  assert.equal(await page.locator('#btn-undo').getAttribute('aria-label'),'undo');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('notas.prefs')).language),'en');

  assert.deepEqual(errors,[]);
  await context.close();
  console.log('ok',label);
 }
}finally{await browser.close();server.close();}
