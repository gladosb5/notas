// Authored stroke shapes and controlled transcripts exercise routing and the
// real Nota writer; these are not handwriting-recognition accuracy tests.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
import {writing} from './fixtures/math-notes.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const base=`http://127.0.0.1:${server.address().port}`,LIVE='This is the live model answer.';
const calls=[],errors=[];
async function open(){
 const context=await browser.newContext({viewport:{width:1000,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('notas.prefs',JSON.stringify({notaOn:true,handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,animations:false})));
 await context.route(/\/nota\/chat$|api\.cerebras\.ai/,async route=>{
  calls.push(JSON.parse(route.request().postData()||'{}'));
  await route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:LIVE}}]})+'\n\ndata: [DONE]\n\n'});
 });
 await page.goto(base+'/notas.html');await page.waitForFunction(()=>N.tutorial?.running&&document.querySelector('#preparing').classList.contains('done'));
 await page.locator('.tut-next').click();
 await page.keyboard.insertText('12 x 7');await page.waitForFunction(()=>!document.querySelector('.tut-next').disabled);
 await page.locator('.tut-next').click();
 await page.evaluate(()=>{N.text.focusedLine().text='pens = 3';N.text.render();N.mathcore.run();});
 await page.locator('.tut-next').click();
 await page.evaluate(()=>{N.text.focusedLine().text='pens x 4 =';N.text.render();N.mathcore.run();});
 await page.locator('.tut-next').click();
 assert.equal(await page.locator('.tut').getAttribute('data-step'),'3');
 return {context,page};
}
const changeValue=page=>page.evaluate(()=>{N.core.S.lines.find(l=>l.text==='pens = 3').text='pens = 4';N.text.render();N.mathcore.run();});
const waitReply=page=>page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&l.text.includes('Change pens')));
async function ink(page,parts){
 await page.evaluate(({parts,strokes})=>{
  const S=N.core.S;S.strokes.push(...strokes);N.recog.rebuild();
  const groups=N.recog.textGroups().filter(g=>g.strokeIds.some(id=>id.startsWith('tutorial-question-'))).sort((a,b)=>a.bbox[1]-b.bbox[1]);
  if(groups.length!==parts.length)throw Error('Unexpected fixture groups: '+groups.length);
  for(let i=0;i<groups.length;i++){
   const g=groups[i],t={hash:g.hash,bbox:g.bbox,text:parts[i],confidence:.99,modelVersion:N.recog.textVersion};
   S.textTranscripts.push(t);N.nota.onTranscript(t,g);
  }
 },{parts,strokes:parts.flatMap((_,i)=>writing('61+1=',40,1200+i*54,'tutorial-question-'+i))});
}
try{
 {
  const {context,page}=await open();const before=calls.length;
  await page.evaluate(()=>{N.core.S.settings.notaOn=false;N.nota.toggle();const now=Date.now();localStorage.setItem('notas.nota.highload',JSON.stringify({until:now+60000,tried:now}));});await context.setOffline(true);
  await page.keyboard.insertText('Hey Nota, EXPLAIN the maths above?!');
  // Finishing the tutorial immediately must not turn its queued local reply
  // into an API request, nor require the feature switch or a provider key.
  await page.locator('.tut-next').click();await page.locator('.tut-next').click();
  await waitReply(page);assert.equal(calls.length,before);
  assert.equal(await page.evaluate(()=>N.nota.overloaded()),true,'a prepared reply does not reset the live provider cooldown');
  assert.equal(await page.evaluate(()=>N.core.S.lines.find(l=>l.text.startsWith('Hey Nota')).notaAsked),'explain the maths above');
  await context.setOffline(false);await page.evaluate(()=>{localStorage.removeItem('notas.nota.highload');N.core.S.settings.notaOn=true;N.nota.toggle();});
  const q=page.locator('.line:not(.tutor) .txt').filter({hasText:'Hey Nota, EXPLAIN the maths above?!'});
  await q.evaluate(el=>{el.focus();el.select();});await page.keyboard.insertText('hey nota, explain the maths above and give another example?');
  await page.waitForFunction(text=>N.core.S.lines.some(l=>l.tutor&&l.text===text),LIVE);
  assert.equal(calls.length,before+1);assert.equal(await page.evaluate(()=>N.core.S.lines.some(l=>l.tutor&&l.text.includes('Change pens'))),false);
  await context.close();console.log('Prepared typed reply: offline, AI disabled, quick finish, and editing into a live question passed');
 }
 for(const timing of ['before question','while queued']){
  const {context,page}=await open();const before=calls.length;
  if(timing==='before question')await changeValue(page);
  await page.keyboard.insertText('hey nota, explain the maths above?');
  if(timing==='while queued')await changeValue(page);
  await page.waitForFunction(text=>N.core.S.lines.some(l=>l.tutor&&l.text===text),LIVE);
  assert.equal(calls.length,before+1);assert.equal(await page.evaluate(()=>N.core.S.lines.some(l=>l.tutor&&l.text.includes('Change pens'))),false);
  await context.close();console.log('Changed working '+timing+' uses the live model');
 }
 {
  const {context,page}=await open();const before=calls.length;
  await page.evaluate(()=>{const l=N.text.add(900,false);l.text='also explain my shopping list';N.text.render();N.mathcore.run();N.text.focusLine(N.core.S.lines.find(l=>!l.text&&l.y>500)?.id||l.id);});
  await page.evaluate(()=>{const l=N.text.add(950,true);l.text='hey nota, explain the maths above?';N.text.render();N.nota.onTyped(l);});
  await page.waitForFunction(text=>N.core.S.lines.some(l=>l.tutor&&l.text===text),LIVE);
  assert.equal(calls.length,before+1);await context.close();console.log('Extra page text opts out of the prepared reply');
 }
 {
  const {context,page}=await open();const before=calls.length;
  await page.evaluate(()=>{N.core.S.settings.notaOn=false;N.nota.toggle();});await context.setOffline(true);
  await ink(page,['hey nota, explain','the maths above?']);
  await page.waitForFunction(()=>N.core.S.strokes.some(s=>s.author==='ai'),null,{timeout:15000});
  assert.equal(calls.length,before);assert.ok(await page.evaluate(()=>N.core.S.strokes.some(s=>s.author==='user'&&s.notaAsked)));
  await context.close();console.log('Prepared handwritten reply: wrapped question, offline and AI disabled passed');
 }
 {
  const {context,page}=await open();const before=calls.length;
  await ink(page,['hey nota, explain the maths above?','and give another example']);
  await page.waitForFunction(()=>N.core.S.strokes.some(s=>s.author==='ai'),null,{timeout:15000});
  assert.equal(calls.length,before+1);
  const body=JSON.stringify(calls.at(-1));assert.match(body,/give another example/);
  await context.close();console.log('Handwritten continuation uses the live model with the full question');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
