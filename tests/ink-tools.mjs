import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1200,height:900}});
 await page.addInitScript(()=>{try{localStorage.setItem('notas.tutorial','done');localStorage.setItem('notas.tutorialDone','1');}catch(e){}});
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.ui?.applyTheme&&N.ink?.setTool);
 await page.evaluate(()=>{document.querySelectorAll('.tut,.tut-mark,.sheet').forEach(e=>e.remove());});
 /* world point -> screen point */
 const screen=(x,y)=>page.evaluate(([x,y])=>{const r=document.getElementById('scroller').getBoundingClientRect(),M=N.core.M,sc=document.getElementById('scroller');
   return [r.left+M.colLeft+(x-sc.scrollLeft/M.zoom)*M.zoom,r.top+(y-sc.scrollTop/M.zoom)*M.zoom];},[x,y]);
 const drag=async(points,hold=0)=>{
  const [x0,y0]=await screen(...points[0]);await page.mouse.move(x0,y0);await page.mouse.down();
  for(const p of points.slice(1)){const [x,y]=await screen(...p);await page.mouse.move(x,y,{steps:2});}
  if(hold)await page.waitForTimeout(hold);
  await page.mouse.up();await page.waitForTimeout(60);
 };
 const line=(x0,y0,x1,y1,n=30)=>Array.from({length:n+1},(_,i)=>[x0+(x1-x0)*i/n,y0+(y1-y0)*i/n]);
 const eraserButton=page.locator('#pill .tool[data-tool="eraser"]');

 /* one horizontal pen stroke */
 await page.evaluate(()=>{N.core.S.strokes=[];N.ink.setTool('pen');N.ink.render();});
 await drag(line(100,300,400,300));
 assert.equal(await page.evaluate(()=>N.core.S.strokes.length),1);

 /* a tap on the eraser picks it; a second tap (a double tap) switches it to
    the pixel eraser, and another back to the stroke eraser */
 await page.evaluate(()=>{localStorage.removeItem('notas.eraser');});
 await eraserButton.click();
 const mode=()=>page.evaluate(()=>document.body.dataset.erase);
 const startMode=await mode();
 await eraserButton.click();
 assert.notEqual(await mode(),startMode,'a second tap switches the eraser');
 await eraserButton.click();
 assert.equal(await mode(),startMode,'and a third switches it back');
 await eraserButton.dblclick();
 assert.equal(await page.evaluate(()=>N.core.S.tool),'eraser');
 if(await mode()!=='pixel')await eraserButton.click();
 assert.equal(await mode(),'pixel');
 assert.equal(await page.evaluate(()=>localStorage.getItem('notas.eraser')),'pixel','the choice is remembered');
 const icon=()=>eraserButton.locator('i').getAttribute('class');
 assert.match(await icon(),/ph-circle-dashed/,'the pixel eraser has its own icon');

 /* the pixel eraser cuts the stroke in two where it crossed it */
 const before=await page.evaluate(()=>N.core.S.strokes[0].id);
 await drag(line(250,270,250,330,12));
 const cut=await page.evaluate(()=>N.core.S.strokes.map(s=>({id:s.id,l:s.bbox[0],r:s.bbox[2]})));
 assert.equal(cut.length,2,'two pieces are left');
 assert.ok(!cut.some(s=>s.id===before),'the original is replaced');
 assert.ok(cut.some(s=>s.r<250)&&cut.some(s=>s.l>250),'one piece either side of the eraser');
 await page.evaluate(()=>N.core.undo());
 assert.deepEqual(await page.evaluate(()=>N.core.S.strokes.map(s=>s.id)),[before],'undo restores the whole stroke');
 await page.evaluate(()=>N.core.redo&&N.core.redo());

 /* the stroke eraser still takes a whole stroke */
 await eraserButton.click();
 assert.equal(await mode(),'stroke');
 assert.match(await icon(),/ph-eraser/,'and the stroke eraser its own');
 const left=await page.evaluate(()=>N.core.S.strokes.length);
 const [l0]=await page.evaluate(()=>N.core.S.strokes.map(s=>(s.bbox[0]+s.bbox[2])/2));
 await drag(line(l0,280,l0,320,8));
 assert.equal(await page.evaluate(()=>N.core.S.strokes.length),left-1,'the stroke eraser removes a whole stroke');

 /* holding at the end of a wobbly circle with a gap tidies it into an ellipse */
 await page.evaluate(()=>{N.core.S.strokes=[];N.ink.setTool('pen');N.ink.render();});
 const circle=Array.from({length:44},(_,i)=>{const a=i/44*Math.PI*2*0.9;return [300+80*Math.cos(a)+3*Math.sin(i*1.7),500+80*Math.sin(a)+3*Math.cos(i*2.3)];});
 await drag(circle,800);
 assert.equal(await page.evaluate(()=>N.core.S.strokes[0].pts.length/3),65,'a held, gapped circle becomes an ellipse');
 const wobbly=line(100,700,420,712,30).map(([x,y],i)=>[x,y+4*Math.sin(i*0.9)]);
 await drag(wobbly,800);
 assert.equal(await page.evaluate(()=>N.core.S.strokes.at(-1).pts.length/3),2,'a held, wobbly line becomes straight');

 /* settings: paper, text colour, nota colour */
 await page.evaluate(()=>N.ink.setTool('text'));
 await page.evaluate(()=>{const S=N.core.S;S.settings.paper='white';S.settings.textColor='#2e8b57';S.settings.notaColor='#7b4fbf';N.ui.applyTheme();});
 const look=await page.evaluate(()=>{const cs=getComputedStyle(document.documentElement);return {paper:cs.getPropertyValue('--paper').trim(),text:cs.getPropertyValue('--text-ink').trim(),nota:N.ink.colors.red,theme:document.documentElement.dataset.theme};});
 assert.equal(look.paper.toUpperCase(),'#FFFFFF');
 assert.equal(look.theme,'light','white paper keeps dark ink');
 assert.equal(look.text,'#2e8b57');
 assert.equal(look.nota,'#7b4fbf','nota writes in the chosen colour');
 await page.evaluate(()=>{const S=N.core.S;S.settings.paper='default';S.settings.textColor='';S.settings.notaColor='';N.ui.applyTheme();});
 assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--nota')),'','back to the theme colour');

 /* the menu has nota's colour and the paper; text colour is the text tool's */
 await page.evaluate(()=>N.ui.menuSheet());
 await page.waitForSelector('#nota-colour');
 assert.equal(await page.locator('#text-colour').count(),0,'text colour is not in the menu');
 await page.locator('#seg-paper button[data-v="white"]').click();
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.paper),'white');
 await page.locator('#nota-colour button[data-v="#2E8B57"]').click();
 assert.equal(await page.evaluate(()=>N.ink.colors.red.toLowerCase()),'#2e8b57');
 await page.locator('#nota-colour .pick input').evaluate(el=>{el.value='#123456';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('notas.prefs')).notaColor),'#123456','the picked colour is saved');
 assert.equal(await page.locator('#nota-colour .pick').getAttribute('aria-pressed'),'true');

 /* the text tool, tapped again, opens its colours as the pen does */
 await page.evaluate(()=>{N.ui.closeSheet();N.ink.setTool('pen');});await page.waitForFunction(()=>!document.querySelector('.sheet')&&!document.getElementById('pill').inert);
 const textButton=page.locator('#pill .tool[data-tool="text"]');
 await textButton.click();
 assert.equal(await page.locator('#textpop').isVisible(),false,'the first tap only picks the text tool');
 await textButton.click();
 assert.equal(await page.locator('#textpop').isVisible(),true,'the second tap opens the text colours');
 assert.equal(await textButton.getAttribute('aria-expanded'),'true');
 await page.locator('#textpop .tool.swatch[data-color="#D64541"]').click();
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--text-ink').trim()),'#D64541');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('notas.prefs')).textColor),'#D64541','the colour is saved');
 assert.equal(await page.locator('#textpop .tool.swatch[data-color="#D64541"]').getAttribute('aria-pressed'),'true');
 await page.locator('#text-pick').evaluate(el=>{el.value='#0a7f6f';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.equal(await page.evaluate(()=>N.core.S.settings.textColor),'#0a7f6f');
 assert.equal(await page.locator('#textpop .tool.pick').getAttribute('data-on'),'true');
 await textButton.dblclick();
 assert.equal(await page.locator('#textpop').isVisible(),true,'a double tap leaves it open');
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#textpop').isVisible(),false,'esc closes it');
 await page.evaluate(()=>N.ink.setTool('pen'));
 await textButton.dblclick();
 assert.equal(await page.locator('#textpop').isVisible(),true,'a double tap from another tool opens it');
 await page.evaluate(()=>N.ink.setTool('pen'));
 assert.equal(await page.locator('#textpop').isVisible(),false,'another tool closes it');

 /* the pen's own picker */
 await page.locator('#pen-pick').evaluate(el=>{el.value='#abcdef';el.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.evaluate(()=>N.ink.pen.color),'#abcdef');
 assert.equal(await page.evaluate(()=>N.core.S.tool),'pen');
 console.log('Ink tools passed: eraser double tap switches stroke/pixel, pixel cut and undo, looser shape tidy, white paper, text/nota colours, colour pickers, text button colours, eraser icons.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
