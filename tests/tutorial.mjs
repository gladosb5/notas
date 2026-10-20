import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';
import {writing} from './fixtures/math-notes.mjs';

const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const base=`http://127.0.0.1:${server.address().port}`;
await mkdir('test-results',{recursive:true});
try{
 for(const [width,height,theme] of [[1280,900,'light'],[390,844,'dark'],[320,740,'light'],[844,390,'dark']]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<900,colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];let requests=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:true})));
  await context.route(/\/nota\/chat$|api\.cerebras\.ai/,async route=>{
   requests++;
   await route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'Twelve groups of seven make eighty-four.'}}]})+'\n\ndata: [DONE]\n\n'});
  });
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.tutorial?.running&&document.querySelector('#preparing').classList.contains('done'));
  const next=page.locator('.tut-next');
  const step=async n=>assert.equal(await page.locator('.tut').getAttribute('data-step'),String(n));
  const type=async text=>{await page.keyboard.insertText(text);await page.waitForTimeout(250);};
  const selectLine=()=>page.locator('.line .txt').last().evaluate(el=>{el.focus();el.select();});
  await step(-1);
  assert.equal(await page.locator('.tut-say').textContent(),'let’s write something together.');
  assert.equal(await page.locator('.tut-body,.tut-hint,.tut-status,.tut-steps,.tut-tools,.tut-mark').count(),0,'no panel copy, progress rail or duplicate tool controls');
  assert.equal(await page.locator('.tut').evaluate(el=>{const s=getComputedStyle(el);return s.backgroundImage==='none'&&s.boxShadow==='none'&&parseFloat(s.borderTopWidth)===0;}),true,'guidance has no surface or border');
  assert.ok((await page.locator('.tut').boundingBox()).height<120,'the introduction is a short note on the paper');
  await page.emulateMedia({media:'print'});assert.equal(await page.locator('.tut').isVisible(),false,'temporary guidance never prints');await page.emulateMedia({media:'screen'});
  await page.screenshot({path:`test-results/tutorial-welcome-${width}.png`});
  await next.click();await step(0);
  assert.equal(await page.evaluate(()=>N.core.S.tool),'text');
  // Neither a single digit nor an invalid expression counts as a calculation.
  await type('12');assert.equal(await next.isDisabled(),true);
  await selectLine();await type('12 x');assert.equal(await next.isDisabled(),true);
  await selectLine();await type('12 x 7');
  await page.waitForFunction(()=>!document.querySelector('.tut-next').disabled);
  assert.equal(await page.locator('.tut-say').textContent(),'there you go.');
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='84')));
  await page.screenshot({path:`test-results/tutorial-calculate-${width}.png`});
  await next.click();await step(1);assert.equal(await next.isDisabled(),true);
  await type('pens = 3');await page.keyboard.press('Enter');await type('pens / 0');
  assert.equal(await next.isDisabled(),true,'a dependency with a calculation error cannot pass');
  await selectLine();await type('pens x 4');
  await page.waitForFunction(()=>!document.querySelector('.tut-next').disabled);
  assert.equal(await page.locator('.tut-say').textContent(),'they’re connected.');
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='12'&&!n.provides)));
  await next.click();await step(2);
  await type('hey nota, explain the maths above?');
  await page.waitForFunction(()=>document.querySelector('.tut-next').textContent==='done');
  await page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&l.text.includes('Twelve groups')));
  await page.waitForFunction(()=>!N.nota.busy);
  assert.ok(requests>0,'the lesson exercises the real Nota request path with a mocked provider');
  await page.screenshot({path:`test-results/tutorial-nota-${width}.png`});
  await next.click();await step(3);
  await page.screenshot({path:`test-results/tutorial-complete-${width}.png`});
  const content=await page.evaluate(()=>({lines:N.core.S.lines.map(l=>l.text).filter(Boolean),ink:N.core.S.strokes.length}));
  await next.click();assert.equal(await page.locator('.tut').count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('notas.tut')),'done');
  await page.evaluate(()=>N.tutorial.maybeStart());assert.equal(await page.locator('.tut').count(),0);
  // Replay creates no sample content and does not inherit the existing answers.
  await page.evaluate(()=>N.tutorial.start(true));await step(-1);
  assert.deepEqual(await page.evaluate(()=>({lines:N.core.S.lines.map(l=>l.text).filter(Boolean),ink:N.core.S.strokes.length})),content);
  await next.click();await step(0);assert.equal(await next.isDisabled(),true);
  await page.locator('#pill .tool[data-tool="pen"]').click();
  await page.waitForFunction(()=>document.querySelector('.tut-say').textContent.includes('reader is off'));
  await page.keyboard.press('Escape');
  await page.locator('#pill .tool[data-tool="text"]').click();assert.equal(await page.evaluate(()=>N.core.S.tool),'text');
  assert.equal(await next.isDisabled(),true);
  // Replaying several times cannot leave a delayed dismissal from an old run.
  await page.evaluate(()=>{N.tutorial.finish(false);N.tutorial.start(true);N.tutorial.finish(false);N.tutorial.start(true);});
  await page.waitForTimeout(800);await step(-1);
  await page.locator('.tut-skip').click();assert.equal(await page.locator('.tut').count(),0);
  assert.deepEqual(errors,[]);
  console.log(`Tutorial typed path, real Nota pipeline, validation, replay and skip: ${width}x${height} ${theme} passed`);
  await context.close();
 }

 // Controlled recognition readings test the actual Solve UI and tutorial state,
 // not handwriting-model accuracy. Both mathematical lessons use only ink here.
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
 const page=await context.newPage();
 const solve=async()=>{
  const button=page.locator('.chip.offer .solve').first();await button.waitFor();
  await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();
  // A physical pen's tap goes through the canvas to the real Solve handler.
  const pos={pointerId:83,pointerType:'pen',isPrimary:true,button:0,clientX:box.x+box.width/2,clientY:box.y+box.height/2,bubbles:true};
  await page.locator('#c-ink').dispatchEvent('pointerdown',{...pos,buttons:1,pressure:.5});
  await page.locator('#c-ink').dispatchEvent('pointerup',{...pos,buttons:0,pressure:0});
 };
 await page.addInitScript(()=>localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:false})));
 await page.goto(base+'/notas.html');await page.waitForFunction(()=>N.tutorial?.running&&document.querySelector('#preparing').classList.contains('done'));
 await page.locator('.tut-next').click();await page.locator('#pill .tool[data-tool="pen"]').click();await page.keyboard.press('Escape');
 const seed=async expressions=>page.evaluate(({expressions,strokes})=>{
  const S=N.core.S;S.strokes.push(...strokes);N.recog.rebuild();
  const targets=S.clusters.filter(cl=>cl.strokeIds.some(id=>id.startsWith('lesson-'))).sort((a,b)=>a.bbox[1]-b.bbox[1]);
  for(let i=0;i<expressions.length;i++){
   Object.assign(targets[i],{ascii:expressions[i],latex:expressions[i],confidence:.99,confirmed:true,asked:false,review:false,pending:false,modelVersion:N.recog.resultVersion});
  }
  N.ink.render();N.mathcore.run();N.tutorial.check('stroke');
  return {count:S.strokes.length,targets:targets.length};
 },{expressions,strokes:expressions.flatMap((_,i)=>writing('61+1=61+1=',40,150+i*110,'lesson-'+expressions.length+'-'+i))});
 let seeded=await seed(['12*7']);assert.ok(seeded.count>10);assert.equal(await page.evaluate(()=>N.tutorial.running),true,'drawing never retires the lesson');
 assert.equal(await page.locator('.tut-next').isDisabled(),true,'reading alone is not success');
 await solve();
 await page.waitForFunction(()=>!document.querySelector('.tut-next').disabled);
 assert.equal(await page.locator('.tut-say').textContent(),'there you go.');
 assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='84')));
 await page.locator('.tut-next').click();
 // Clear the previous exercise's injected clusters before adding two new rows.
 await page.evaluate(()=>{N.core.S.strokes=[];N.core.S.clusters=[];N.recog.reset();N.mathcore.run();});
 await seed(['pens=3','pens*4']);
 assert.equal(await page.locator('.tut-next').isDisabled(),true);
 await solve();
 assert.equal(await page.locator('.tut-next').isDisabled(),true);
 await solve();
 await page.waitForFunction(()=>!document.querySelector('.tut-next').disabled);
 await page.locator('.tut-next').click();
 // A recognised handwritten question can finish even with Nota switched off.
 await page.evaluate(()=>{N.core.S.textTranscripts.push({hash:'tutorial-question',text:'hey nota, explain this maths?',confidence:.95});N.tutorial.check('text');});
 assert.equal(await page.locator('.tut-next').textContent(),'done');
 await page.locator('.tut-next').click();assert.equal(await page.locator('.tut').getAttribute('data-step'),'3');
 await page.locator('.tut-next').click();
 // The optional AI lesson is also skippable, without a fake answer or question.
 await page.evaluate(()=>{N.tutorial.start(true);});await page.locator('.tut-next').click();
 await page.evaluate(()=>{const a=N.text.add(700,false);a.text='6*7';N.text.render();N.mathcore.run();});
 await page.locator('.tut-next').click();
 await page.evaluate(()=>{const a=N.text.add(800,false);a.text='cups=2';const b=N.text.add(840,false);b.text='cups*3';N.text.render();N.mathcore.run();});
 await page.locator('.tut-next').click();assert.equal(await page.locator('.tut-next').textContent(),'later');
 await page.locator('.tut-next').click();assert.equal(await page.locator('.tut').getAttribute('data-step'),'3');
 await page.locator('.tut-next').click();await context.close();
 console.log('Tutorial ink/Solve path, >10 strokes, handwritten Nota, disabled AI and optional AI completion passed');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
