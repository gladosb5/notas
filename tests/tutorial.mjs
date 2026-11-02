import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

/* The intro: a white page before the notebook that plays on its own, one
   idea per screen fading into the next, then the notebook. Nothing to press.
   It never asks nota anything and never touches the note. */
const PICK='Choose your language. Pilih bahasa kamu. 选择你的语言。';
const SAYS=[PICK,'hey, student.','this is your paper.',
  'don\'t think about calculating maths. think about what you are going to create with maths.',
  'also your handwriting too.','let me introduce myself.','tap the eraser again.','tap the pen again.',
  'swipe the tools left.','double-tap a picture.','search reads your handwriting.','good luck.'];

const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const base=`http://127.0.0.1:${server.address().port}`;
await mkdir('test-results',{recursive:true});
try{
 for(const [width,height,theme,motion] of [[1280,900,'light','no-preference'],[390,844,'dark','reduce'],[320,740,'light','reduce'],[844,390,'dark','reduce']]){
  const touch=width<900,label=`${width}-${theme}`;
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,colorScheme:theme,serviceWorkers:'block',reducedMotion:motion});
  const page=await context.newPage(),errors=[];let requests=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:true})));
  await context.route(/\/nota\/chat$|api\.cerebras\.ai|oxionai\.com/,route=>{requests++;return route.abort();});
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.tutorial?.running&&document.querySelector('#preparing').classList.contains('done')&&document.querySelector('#intro .i-lang'));

  const expected=SAYS;
  assert.equal(await page.evaluate(()=>N.tutorial.screens),expected.length);
  assert.equal((await page.locator('.intro-skipall').textContent()),'skip all');
  assert.equal(await page.locator('#topbar').evaluate(el=>!!el.closest('[inert]')),true,'the notebook waits behind the intro');
  const bg=await page.locator('#intro').evaluate(el=>getComputedStyle(el).backgroundColor);
  if(theme==='light')assert.equal(bg,'rgb(255, 255, 255)','a white page');else assert.notEqual(bg,'rgb(255, 255, 255)','dark mode keeps the dark paper');

  /* the notebook's keys stay asleep while the intro is up */
  const toolBefore=await page.evaluate(()=>N.core.S.tool);
  await page.keyboard.press('p');
  assert.equal(await page.evaluate(()=>N.core.S.tool),toolBefore,'P does not switch to the pen behind the intro');

  for(let i=0;i<expected.length;i++){
   assert.equal(await page.evaluate(()=>N.tutorial.screen),i);
   assert.equal(await page.locator('#intro h1 .sr-only').textContent(),expected[i]);
   if(i===0){
    /* the first screen asks for a language, each in its own words, and waits */
    await page.waitForFunction(()=>N.tutorial.settled,null,{timeout:12000});
    await page.screenshot({path:`test-results/intro-00-${label}.png`});
    assert.deepEqual(await page.locator('#intro .i-lang').allTextContents(),['English','Bahasa Melayu','中文']);
    await page.waitForTimeout(1600);
    assert.equal(await page.evaluate(()=>N.tutorial.screen),0,'the language screen waits for a choice');
    if(touch)await page.locator('#intro .i-lang',{hasText:'English'}).tap();else await page.locator('#intro .i-lang',{hasText:'English'}).click();
    await page.waitForFunction(()=>N.tutorial.screen===1,null,{timeout:6000});
    assert.equal(await page.evaluate(()=>N.i18n.lang),'en');
    i=1;await page.waitForFunction(()=>N.tutorial.settled,null,{timeout:12000});
    assert.equal(await page.locator('#intro h1 .sr-only').textContent(),expected[1]);
    assert.equal(await page.locator('#intro button:not(.intro-skipall)').count(),0,'nothing to press but skip all: no next');
    await page.screenshot({path:`test-results/intro-01-${label}.png`});
    /* taps and keys do not move it on; it goes with its own flow */
    await page.mouse.click(width/2,height/2);await page.keyboard.press('Enter');await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(()=>N.tutorial.screen),1,'a tap or a key never skips ahead');
    /* the greeting moves on by itself, fading into the next */
    await page.waitForFunction(()=>N.tutorial.screen===2,null,{timeout:12000});
    if(motion!=='reduce')assert.equal(await page.locator('.intro-stage').evaluate(el=>el.classList.contains('out')),false);
    await page.waitForFunction(()=>N.tutorial.settled,null,{timeout:12000});
    i=2;assert.equal(await page.locator('#intro h1 .sr-only').textContent(),expected[2]);
   }
   await page.waitForFunction(()=>N.tutorial.settled,null,{timeout:12000});
   const fit=await page.evaluate(()=>{
    const stage=document.querySelector('.intro-stage').getBoundingClientRect(),root=document.getElementById('intro');
    const wide=[...root.querySelectorAll('canvas,.i-paper,.i-pill,.i-pop,.i-search,.i-result,.i-pic,.i-sheet')].filter(e=>e.getBoundingClientRect().width).map(e=>e.getBoundingClientRect()).filter(r=>r.left<stage.left-1||r.right>stage.right+1);
    return {wide:wide.length,overflow:document.documentElement.scrollWidth>innerWidth||root.scrollWidth>root.clientWidth};
   });
   assert.deepEqual(fit,{wide:0,overflow:false},`screen ${i} fits ${label}`);
   await page.screenshot({path:`test-results/intro-${String(i).padStart(2,'0')}-${label}.png`});
   if(i===expected.length-1)break;
   const tip={6:'button.i-tool',7:'button.i-tool',8:'.i-slide',9:'button.i-pic'}[i];
   if(tip&&(width===1280||width===390)){
    /* a tip waits for the student to try it, then moves on a second later */
    await page.waitForTimeout(1600);
    assert.equal(await page.evaluate(()=>N.tutorial.screen),i,`screen ${i} waits to be tried`);
    const target=page.locator('#intro '+tip);
    assert.equal(await target.evaluate(el=>el.classList.contains(el.classList.contains('i-slide')?'i-hint':'i-want')),true,'what to do is shown');
    if(i===8){
     /* a swipe from right to left on a mouse; the › on a phone */
     if(touch)await page.locator('#intro button.i-more').tap();
     else{const b=await target.boundingBox();await page.mouse.move(b.x+b.width-50,b.y+b.height/2);await page.mouse.down();for(let k=1;k<=8;k++)await page.mouse.move(b.x+b.width-50-k*12,b.y+b.height/2);await page.mouse.up();}
    }
    else if(i===9){if(touch){await target.tap();await target.tap();}else await target.dblclick();}
    else for(let k=0;k<2;k++){if(touch)await target.tap();else await target.click();}
    const tried=Date.now();
    await page.waitForFunction(n=>N.tutorial.screen===n,i+1,{timeout:6000});
    const waited=Date.now()-tried;
    assert.ok(waited>=900,`a second to take it in, waited ${waited}`);
    await page.waitForFunction(()=>N.tutorial.settled,null,{timeout:12000});
    continue;
   }
   await page.evaluate(()=>N.tutorial.next());
  }
  /* good luck. fades into the notebook on its own */
  await page.waitForFunction(()=>!N.tutorial.running&&!document.getElementById('intro'),null,{timeout:5000});
  assert.equal(await page.evaluate(()=>localStorage.getItem('notas.tut')),'done');
  assert.equal(await page.locator('#topbar').evaluate(el=>!!el.closest('[inert]')),false,'the notebook is live again');
  assert.equal(await page.evaluate(()=>N.core.S.lines.filter(l=>l.text?.trim()).length+N.core.S.strokes.length),0,'the intro left nothing on the note');
  await page.screenshot({path:`test-results/intro-after-${label}.png`});

  /* once seen, never again on its own */
  await page.reload();
  await page.waitForFunction(()=>window.N?.tutorial&&document.querySelector('#preparing').classList.contains('done'));
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>N.tutorial.running),false);

  /* the menu replays it, and escape leaves at once */
  await page.locator('#btn-menu').click();
  await page.locator('#mi-tut').click();
  await page.waitForFunction(()=>document.querySelector('#intro .i-lang'));
  assert.equal(await page.evaluate(()=>N.tutorial.screen),0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.getElementById('intro'),null,{timeout:3000});

  /* skip all leaves from any screen at once */
  await page.evaluate(()=>N.tutorial.start(true));
  await page.waitForFunction(()=>document.querySelector('#intro .i-lang'));
  await page.evaluate(()=>{N.tutorial.next();N.tutorial.next();});
  if(touch)await page.locator('.intro-skipall').tap();else await page.locator('.intro-skipall').click();
  await page.waitForFunction(()=>!document.getElementById('intro'),null,{timeout:3000});
  assert.equal(await page.locator('#topbar').evaluate(el=>!!el.closest('[inert]')),false);

  assert.equal(requests,0,'the intro never asks nota');
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('ok',label);
 }
}finally{await browser.close();server.close();}
