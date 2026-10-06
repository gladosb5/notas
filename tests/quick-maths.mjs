import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
// a question's words, whether it went as text alone or as text and a picture of the page
const said=c=>typeof c==='string'?c:c.filter(p=>p.type==='text').map(p=>p.text).join('\n');
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 for(const width of [320,390,820,1280]){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<1000,serviceWorkers:'block'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.mathcore?.harden()&&N.nota?.Writer);
 await page.evaluate(()=>N.tutorial?.finish(false));
 const toolbar=await page.locator('#topbar').evaluate(el=>({w:el.clientWidth,scroll:el.scrollWidth}));assert.ok(toolbar.scroll<=toolbar.w,'toolbar fits '+width);
 const input=page.locator('#quick-expression'),answer=page.locator('#quick-answer');
 assert.equal(await input.evaluate(el=>!!el.closest('#topbar')),true,'input is part of top bar');
 for(const [expr,result] of [['2 + 4 * 7 / 5','= 7.6'],['sqrt(81)','= 9'],['sin(30)','= 0.5'],['2x + 3 = 7','x = 2']]){
 await input.fill(expr);await input.press('Enter');await page.waitForFunction(result=>document.querySelector('#quick-answer .qa-value')?.textContent===result,result,{timeout:15000});
 }
 assert.equal(await page.locator('.sheet').count(),0,'calculator never opens a sheet');
 await input.fill('2 +');await input.press('Enter');await page.waitForFunction(()=>document.querySelector('#quick-expression').getAttribute('aria-invalid')==='true');assert.equal(await answer.isVisible(),false);
 const bar=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();return{title:r('#title'),quick:r('#quick-maths'),downloads:r('#btn-downloads'),menu:r('#btn-menu'),top:r('#topbar')};});
 assert.ok(bar.menu.right>bar.top.right-20,'menu sits at the right end '+width);
 if(width>=700){assert.ok(bar.quick.left>=bar.title.right&&bar.quick.right<=bar.downloads.left,'quick maths sits between the name and the buttons '+width);assert.ok(bar.downloads.left-bar.quick.right<40,'quick maths takes the middle '+width);}
 await input.fill('2 + 4 * 7 / 5');await page.waitForFunction(()=>document.querySelector('#quick-answer .qa-value').textContent==='= 7.6'&&!document.querySelector('#quick-result').hidden);
 const drop=await page.evaluate(()=>({input:document.querySelector('#quick-expression').getBoundingClientRect().bottom,answer:document.querySelector('#quick-answer').getBoundingClientRect().top,menu:document.querySelector('#quick-insert').hidden}));
 assert.ok(drop.answer>drop.input,'answer shows below the field');assert.equal(drop.menu,true,'insert choices wait for enter');
 await input.press('Enter');await page.waitForFunction(()=>!document.querySelector('#quick-insert').hidden&&document.activeElement?.dataset.mode==='text');
 await page.evaluate(()=>{N.core.S.strokes.push({id:'latest',author:'user',w:2,pts:[80,240,.5,100,260,.5],bbox:[80,240,100,260],t0:1,t1:2});N.ink.render();});
 await page.locator('#quick-insert [data-mode="text"]').click();
 const line=await page.evaluate(()=>N.core.S.lines.find(l=>l.text==='2 + 4 * 7 / 5'));
 assert.ok(line&&line.y>260,'text is inserted after the latest stroke');
 assert.deepEqual(await page.evaluate(()=>N.core.S.selection),[line.id],'text is lasso-selected');
 assert.equal(await page.evaluate(()=>N.core.S.tool),'select');
 await page.waitForFunction(id=>N.core.S.nodes.some(n=>n.id===id&&n.result==='7.6'),line.id);
 await page.locator('#selbar button',{hasText:'delete'}).click();
 assert.equal(await page.evaluate(id=>N.core.S.lines.some(l=>l.id===id),line.id),false,'selected text can be deleted');
 await page.evaluate(()=>N.core.undo());
 assert.equal(await page.evaluate(id=>N.core.S.lines.some(l=>l.id===id),line.id),true,'text deletion is undoable');
 const count=await page.evaluate(()=>N.core.S.strokes.length);
 await input.focus();await answer.click();await page.locator('#quick-insert [data-mode="writing"]').click();
 const written=await page.evaluate(()=>({selection:N.core.S.selection,strokes:N.core.S.strokes.filter(s=>N.core.S.selection.includes(s.id)),blue:N.ink.colors.blue,graphite:N.ink.colors.graphite}));
 assert.ok(written.strokes.length>10,'writing is real strokes');
 assert.equal(written.selection.length,written.strokes.length,'all inserted writing is selected');
 assert.ok(written.strokes.some(s=>s.color===written.blue)&&written.strokes.some(s=>s.color===written.graphite),'question and answer use graphite and blue');
 assert.ok(written.strokes.every(s=>s.bbox[1]>260),'writing is below the latest stroke');
 const semantic=await page.evaluate(()=>{
   const S=N.core.S,where={x:0,y:900},original=S.strokes.slice();
   const before=N.nota.context(where);
   const imported=N.ui.validateImportedNote(N.core.serialize());
   S.strokes=imported.strokes;const restored=N.nota.context(where);
   S.strokes=S.strokes.map(st=>N.collab._test.cleanStroke(st,st.id));const shared=N.nota.context(where);
   const i=S.strokes.findIndex(st=>st.quickGroup&&!st.quickMath);const removed=S.strokes.splice(i,1)[0];
   const partial=N.nota.context(where);S.strokes.splice(i,0,removed);
   const skip=N.nota.context({...where,skip:new Set([removed.id])});
   S.strokes=original;
   return {before,restored,shared,partial,skip};
 });
 for(const key of ['before','restored','shared'])assert.ok(semantic[key].includes('2 + 4 * 7 / 5 = 7.6'),'Quick Maths exact context survives '+key);
 for(const key of ['partial','skip'])assert.ok(!semantic[key].includes('2 + 4 * 7 / 5 = 7.6'),'Incomplete or excluded writing leaves no stale context '+key);
 await page.evaluate(()=>N.ink.duplicateSelection());
 assert.equal(await page.evaluate(()=>N.nota.context({x:0,y:900}).split('2 + 4 * 7 / 5 = 7.6').length-1),2,'Duplicated writing has its own context group');
 await page.evaluate(()=>N.core.undo());
 await page.evaluate(()=>N.core.undo());assert.equal(await page.evaluate(()=>N.core.S.strokes.length),count,'one undo removes the complete writing');
 await page.evaluate(()=>N.core.redo());assert.equal(await page.evaluate(()=>N.core.S.strokes.length),count+written.strokes.length,'redo restores writing');
 if(width===1280){
   let request;
   await page.route('**/nota/chat',route=>{request=route.request().postDataJSON();return route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'Work through the operations in order.'}}]})+'\n\ndata: [DONE]\n\n'});});
   await page.evaluate(()=>{const ln=N.text.add(900,false);ln.text='hey nota, why is that the answer?';N.text.render();N.mathcore.run();N.nota.onTyped(ln);});
   for(let i=0;i<50&&!request;i++)await page.waitForTimeout(100);
   assert.ok(request,'Tutor request was sent');
   assert.ok(said(request.messages[1].content).includes('2 + 4 * 7 / 5 = 7.6'),'Actual tutor request includes the inserted calculation');
   await page.waitForFunction(()=>!N.nota.busy);
   assert.ok(await page.evaluate(()=>N.core.S.lines.some(l=>l.tutor&&l.text.includes('Work through the operations'))),'Mock tutor reply appears');
   assert.ok(await page.evaluate(()=>!N.nota.context({x:0,y:900}).includes('Work through the operations')),'Tutor replies remain excluded');
 }
 await page.waitForTimeout(350);
 if(width===390||width===1280)await page.screenshot({path:`test-results/quick-maths-inline-${width}.png`});
 await page.locator('#btn-menu').click();await page.locator('#seg-motion [data-v="0"]').click();
 assert.equal(await page.evaluate(()=>N.core.reducedMotion()),true);
 await page.reload();await page.waitForFunction(()=>window.N?.core);assert.equal(await page.evaluate(()=>N.core.S.settings.animations),false);
 assert.deepEqual(errors,[]);await context.close();
 }
 console.log('inline quick maths, insertion, selection, undo and motion: ok');
}finally{await browser.close();server.close();}
