import {chromium} from 'playwright';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
for(let i=1;i<=7;i++){
  const page=pdf.addPage([595,842]);
  page.drawText(`Page ${i} sentence one starts here and ends here.`,{x:45,y:750,size:18,font});
  page.drawText(`Page ${i} sentence two follows after the blank gap.`,{x:45,y:700,size:18,font});
}
const bytes=[...await pdf.save()],server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
try{
  for(const legacy of [false,true]){
    const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    if(legacy)await context.addInitScript(()=>Object.defineProperty(navigator,'userAgentData',{value:{brands:[{brand:'Chromium',version:'140'}]}}));
    await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
    await page.waitForFunction(()=>window.N?.pdf&&N.core.S.id);
    await page.evaluate(()=>{N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');N.core.S.settings.aiOn=false;});
    assert.equal(await page.evaluate(async bytes=>{const ok=await N.pdf.importFile(new File([new Uint8Array(bytes)],'Selection gaps.pdf',{type:'application/pdf'}));N.ink.setTool('text');return ok;},bytes),true);
    // Lazy page mounting must not change native DOM reading order.
    await page.evaluate(()=>N.pdf.go(5));await page.locator('#pdf-tl .textLayer span',{hasText:'Page 6 sentence one'}).waitFor();
    await page.evaluate(()=>N.pdf.go(3));await page.locator('#pdf-tl .textLayer span',{hasText:'Page 4 sentence one'}).waitFor();
    await page.waitForTimeout(120);
    const order=await page.locator('.pdf-tl-page').evaluateAll(elements=>elements.map(el=>Number.parseFloat(el.style.top)));
    assert.deepEqual(order,[...order].sort((a,b)=>a-b),'lazy text layers remain in page order');

    const first=page.locator('#pdf-tl .textLayer span',{hasText:'Page 4 sentence one'}),second=page.locator('#pdf-tl .textLayer span',{hasText:'Page 4 sentence two'});
    const a=await first.boundingBox(),b=await second.boundingBox();
    await page.mouse.move(a.x+80,a.y+a.height/2);await page.mouse.down();
    await page.mouse.move(a.x+a.width-5,a.y+a.height/2,{steps:8});
    const anchor=await page.evaluate(()=>{const s=getSelection();window.selectionAnchor=s.anchorNode;return {offset:s.anchorOffset,text:s.anchorNode.textContent};});
    assert.match(anchor.text,/Page 4 sentence one/);
    for(const [x,y] of [[a.x+a.width+35,a.y+a.height/2],[a.x+a.width+35,(a.y+a.height+b.y)/2],[b.x-15,(a.y+a.height+b.y)/2],[b.x+b.width-5,b.y+b.height/2]]){
      await page.mouse.move(x,y,{steps:6});await page.waitForTimeout(35);
      const selected=await page.evaluate(()=>{const s=getSelection();return {same:s.anchorNode===selectionAnchor,offset:s.anchorOffset,text:s.toString()};});
      assert.equal(selected.same,true,'crossing blank space keeps the original anchor');assert.equal(selected.offset,anchor.offset);
      assert.ok(!selected.text.includes('Page 1'),'selection never jumps to page one');
      assert.equal(await page.locator('#pdf-ask-chip').isVisible(),false,'confirmation button stays out of the drag path');
    }
    assert.match(await page.evaluate(()=>getSelection().toString()),/Page 4 sentence two/);
    assert.ok(await page.locator('.textLayer .endOfContent').count()>0,'viewer selection guards are mounted');
    // Auto-scroll can move the anchor page outside the lazy-render margin.
    await page.evaluate(()=>{N.pdf.go(5);N.ink.render();});
    await page.locator('#pdf-tl .textLayer span',{hasText:'Page 6 sentence one'}).waitFor();await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>selectionAnchor.isConnected&&getSelection().anchorNode===selectionAnchor),true,'scrolling cannot evict a selected text layer');
    await page.mouse.up();
    await page.evaluate(()=>{getSelection().removeAllRanges();N.ink.render();});
    await page.waitForFunction(()=>![...document.querySelectorAll('#pdf-tl .textLayer span')].some(el=>el.textContent.includes('Page 4 sentence one')));
    // Anchor protection must not retain stale geometry after a page is edited.
    await page.evaluate(()=>{const text=[...document.querySelectorAll('#pdf-tl .textLayer span')].find(el=>el.textContent.includes('Page 6 sentence one'));const range=new Range();range.selectNodeContents(text);getSelection().addRange(range);N.pdf.rotatePage(5);N.ink.render();});
    await page.waitForFunction(()=>document.querySelectorAll('.pdf-tl-page[data-page="'+N.core.S.pdf.pages[5].id+'"]').length===1);
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PDF selection passed: inter-sentence gaps, native anchor retention, lazy page order, auto-scroll, drag-safe confirmation and legacy Chromium guard.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
