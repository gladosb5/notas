import {chromium} from 'playwright';
import {PDFDocument,StandardFonts,rgb,degrees} from 'pdf-lib';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

const source=await PDFDocument.create(),font=await source.embedFont(StandardFonts.Helvetica);
for(let i=0;i<3;i++){
  const p=source.addPage(i===1?[420,595]:[595,842]);
  p.drawText('Original PDF page '+(i+1),{x:40,y:p.getHeight()-65,font,size:22,color:rgb(.05,.2,.45)});
  p.drawRectangle({x:30,y:30,width:80,height:50,color:rgb(.1,.7,.3)});
  if(i===1)p.setRotation(degrees(90));
  if(i===2)p.setCropBox(15,20,550,780);
}
const sample=Buffer.from(await source.save());
const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
await mkdir('test-results/pdf',{recursive:true});
const errors=[];
try{
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy|pdf/i.test(m.text()))errors.push(m.text());});
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.core?.S.id&&N.pdf&&N.ui);
  await page.evaluate(()=>{N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');N.core.S.settings.aiOn=false;N.ai.toggle();});
  // Import through the user-facing menu and native file picker.
  await page.locator('#btn-menu').click();
  const chooser=page.waitForEvent('filechooser');await page.locator('#im-pdf').click();
  await (await chooser).setFiles({name:'worksheet.pdf',mimeType:'application/pdf',buffer:sample});
  await page.waitForFunction(()=>N.core.S.pdf?.pages.length===3);
  await page.waitForFunction(()=>!N.core.S.dirty);
  await page.waitForTimeout(1800);
  assert.equal(await page.locator('#pdf-count').textContent(),'1 / 3');
  assert.equal(await page.evaluate(()=>N.core.S.images.length),0,'PDF backgrounds are not movable images');
  assert.equal(await page.evaluate(()=>N.core.M.contentW),720);
  const pdfId=await page.evaluate(()=>N.core.S.id);
  // Pen through real pointer events, and text precisely at the clicked x/y.
  const screen=async(x,y)=>page.evaluate(([x,y])=>{const C=N.core,r=document.getElementById('scroller').getBoundingClientRect(),sc=document.getElementById('scroller');return {x:r.left+C.M.colLeft-sc.scrollLeft+x*C.M.zoom,y:r.top-sc.scrollTop+y*C.M.zoom};},[x,y]);
  await page.evaluate(()=>{localStorage.setItem('notas.penbeta','seen-scribble');N.ink.setTool('pen');});
  const a=await screen(120,260),b=await screen(260,290);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();
  assert.equal(await page.evaluate(()=>N.core.S.strokes.length),1,'pen writes over PDF paper');
  await page.evaluate(()=>N.ink.setTool('text'));
  const textPoint=await screen(180,330);await page.mouse.click(textPoint.x,textPoint.y);await page.keyboard.type('My PDF annotation');
  assert.equal(await page.evaluate(()=>N.core.S.lines[0].text),'My PDF annotation');
  assert.ok(Math.abs(await page.evaluate(()=>N.core.S.lines[0].x)-180)<2);
  await page.keyboard.press('Escape');
  const drag=async(a,b)=>{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();};
  // The highlighter exists on PDFs; its marks are kept apart from handwriting.
  await page.evaluate(()=>N.ink.setTool('mark'));
  assert.equal(await page.locator('.tool[data-tool="mark"]').getAttribute('aria-pressed'),'true');
  await drag(await screen(100,200),await screen(320,200));
  assert.deepEqual(await page.evaluate(()=>N.core.S.strokes.map(s=>s.author)),['user','mark']);
  // Outside the pages nothing is drawn, whatever the tool: the drag scrolls.
  await page.evaluate(()=>{N.ink.setTool('pen');N.pdf.go(0);});
  const top0=await page.evaluate(()=>document.getElementById('scroller').scrollTop);
  await drag(await screen(-40,620),await screen(-40,380));
  assert.equal(await page.evaluate(()=>N.core.S.strokes.length),2,'a margin drag draws nothing');
  assert.ok(await page.evaluate(()=>document.getElementById('scroller').scrollTop)>top0+100,'a margin drag scrolls the document');
  await page.evaluate(()=>{N.ink.setTool('select');N.pdf.go(0);});
  await drag(await screen(-40,620),await screen(-40,380));
  assert.equal(await page.evaluate(()=>N.core.S.selection.length),0,'a margin drag never lassos');
  await page.evaluate(()=>{N.ink.setTool('text');N.pdf.go(0);});
  // Annotate rotated and cropped pages, using their own coordinates.
  await page.evaluate(()=>{const C=N.core,S=C.S;for(let i=1;i<3;i++){const p=S.pdf.pages[i];S.lines.push({id:C.uid(),x:90,y:p.y+140,text:'Annotation page '+(i+1),h:30});}N.text.render();C.markDirty();});
  await page.locator('#pdf-toggle').click();assert.equal(await page.locator('#pdf-page-list .pdf-thumb').count(),3);
  await page.locator('#pdf-page-list .pdf-thumb').nth(1).click();
  assert.equal(await page.locator('#pdf-count').textContent(),'2 / 3');
  await page.screenshot({path:'test-results/pdf/desktop-rotated.png'});
  // Insert between pages; all later annotations move with their page. Undo restores them.
  const before=await page.evaluate(()=>N.core.S.lines.map(l=>({id:l.id,y:l.y})));
  await page.evaluate(()=>N.pdf.go(0));await page.locator('#pdf-add').click();
  assert.equal(await page.evaluate(()=>N.core.S.pdf.pages.length),4);
  assert.equal(await page.evaluate(()=>N.core.S.pdf.pages[1].source),null);
  let shifted=await page.evaluate(()=>N.core.S.lines.map(l=>({id:l.id,y:l.y})));
  assert.equal(shifted[0].y,before[0].y);assert.ok(shifted[1].y>before[1].y);
  await page.evaluate(()=>N.core.undo());assert.deepEqual(await page.evaluate(()=>N.core.S.lines.map(l=>({id:l.id,y:l.y}))),before);
  await page.evaluate(()=>N.core.redo());assert.equal(await page.evaluate(()=>N.core.S.pdf.pages.length),4);
  // Turning, moving and deleting pages carry their annotations, and undo restores every one.
  const snap=()=>page.evaluate(()=>JSON.stringify({p:N.core.S.pdf.pages.map(p=>[p.id,p.rot||0,Math.round(p.h)]),s:N.core.S.strokes.map(s=>s.pts.slice(0,6).map(Math.round)),l:N.core.S.lines.map(l=>[Math.round(l.x),Math.round(l.y)])}));
  const layout=await snap();
  await page.evaluate(()=>N.pdf.rotatePage(0));
  assert.equal(await page.evaluate(()=>N.core.S.pdf.pages[0].rot),90);
  assert.notEqual(await snap(),layout,'turned page moves its ink');
  await page.evaluate(()=>N.core.undo());assert.equal(await snap(),layout);
  const firstId=await page.evaluate(()=>N.core.S.pdf.pages[0].id),inkY=await page.evaluate(()=>N.core.S.strokes[0].pts[1]);
  await page.locator('#pdf-down').click();
  assert.equal(await page.evaluate(()=>N.core.S.pdf.pages[1].id),firstId);
  assert.ok(await page.evaluate(()=>N.core.S.strokes[0].pts[1])>inkY,'moved page takes its ink');
  await page.evaluate(()=>N.core.undo());assert.equal(await snap(),layout);
  await page.evaluate(()=>N.pdf.go(2));await page.locator('#pdf-delete').click();
  assert.equal(await page.evaluate(()=>N.core.S.pdf.pages.length),3);assert.equal(await page.evaluate(()=>N.core.S.lines.length),2,'deleted page takes its notes');
  await page.evaluate(()=>N.core.undo());assert.equal(await snap(),layout);
  // Blank page is writable and makes it into the exported file.
  await page.evaluate(()=>{const C=N.core;C.S.lines.push({id:C.uid(),x:70,y:C.S.pdf.pages[1].y+100,text:'Extra working on blank page',h:30});N.text.render();C.markDirty();});
  const saved=await page.evaluate(async()=>{await N.core.save();return N.core.serialize();});
  await page.reload();await page.waitForFunction(id=>N.core?.S.id===id&&N.core.S.pdf?.pages.length===4,pdfId);
  assert.equal(await page.evaluate(()=>N.core.S.strokes.length),2);
  assert.equal(await page.evaluate(()=>N.core.S.strokes[1].author),'mark','highlighter marks survive reopening');
  assert.equal(await page.evaluate(()=>N.core.S.lines.length),4);
  assert.equal(await page.evaluate(()=>N.core.S.pdf.ref),saved.pdf.ref,'the stored original survives saving and reopening');
  assert.equal(await page.evaluate(async()=>(await N.pdf.bytesOf(N.core.S.pdf)).length),sample.length);
  assert.equal(saved.pdf.data,undefined,'the note itself never carries the PDF');
  await page.evaluate(()=>{N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');});
  // Search finds the PDF's own words on every page; the text tool can select them.
  await page.evaluate(()=>{N.pdf.go(0);N.pdf.openFind();});await page.fill('#pdf-find-input','original pdf page');
  await page.waitForFunction(()=>document.getElementById('pdf-find-count').textContent==='1 / 3');
  await page.keyboard.press('Enter');assert.equal(await page.locator('#pdf-find-count').textContent(),'2 / 3');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#pdf-find').isVisible(),false);
  await page.evaluate(()=>{N.ink.setTool('text');N.pdf.go(0);});
  await page.waitForFunction(()=>[...document.querySelectorAll('#pdf-tl .textLayer span')].some(s=>/Original PDF page 1/.test(s.textContent)));
  await page.evaluate(()=>{document.activeElement?.blur();N.pdf.go(0);});await page.keyboard.press('PageDown');
  assert.equal(await page.locator('#pdf-count').textContent(),'2 / 4');
  // Exported PDF retains source page geometry, selectable original text and annotations.
  const download=page.waitForEvent('download');await page.locator('#pdf-save').click();const exported=await download;await exported.saveAs('test-results/pdf/annotated.pdf');
  const exportedBytes=await (await import('node:fs/promises')).readFile('test-results/pdf/annotated.pdf');
  const output=await PDFDocument.load(exportedBytes);assert.equal(output.getPageCount(),4);
  assert.equal(output.getPage(2).getRotation().angle,90);assert.equal(output.getPage(3).getCropBox().width,550);
  const {PDFName,PDFDict}=await import('pdf-lib');
  assert.ok(output.getPage(0).node.Resources().lookupMaybe(PDFName.of('ExtGState'),PDFDict)?.keys().length>0,'highlighter blends into the page');
  assert.ok(exportedBytes.length<sample.length+120000,'ink is written as lines, not page-sized pictures');
  // Text extraction proves the original PDF wasn't flattened into screenshots.
  const originalText=await page.evaluate(async data=>{const [lib]=await N.pdf.libs();const doc=await lib.getDocument({data:new Uint8Array(data),isEvalSupported:false}).promise;const result=[];for(let i=1;i<=doc.numPages;i++)result.push((await (await doc.getPage(i)).getTextContent()).items.map(x=>x.str).join(' '));await doc.loadingTask.destroy();return result;},[...exportedBytes]);
  assert.match(originalText[0],/Original PDF page 1/);assert.match(originalText[2],/Original PDF page 2/);assert.match(originalText[3],/Original PDF page 3/);
  assert.match(originalText[0],/My PDF annotation/,'typed notes are searchable in the saved PDF');assert.match(originalText[1],/Extra working on blank page/);
  // Note backups and multi-note bundles preserve the source and page order.
  await page.evaluate(async saved=>{await N.ui.newNote();const ok=await N.ui.importNoteFile(new File([JSON.stringify(saved)],'backup.notas.json',{type:'application/json'}));if(!ok)throw Error('backup import failed');},saved);
  assert.equal(await page.evaluate(()=>N.core.S.pdf.pages.length),4);
  await page.evaluate(async saved=>N.library.importBundle({notasBundle:1,notes:[saved]}),saved);
  const docs=await page.evaluate(async()=>{const ix=await N.core.Store.index();return Promise.all(ix.map(r=>N.core.Store.get('notas.note.'+r.id)));});
  assert.ok(docs.filter(d=>d?.pdf?.ref===saved.pdf.ref).length>=3);
  // Malformed files leave the existing document untouched.
  const active=await page.evaluate(()=>N.core.S.id);
  assert.equal(await page.evaluate(()=>N.pdf.importFile(new File(['not a PDF'],'broken.pdf',{type:'application/pdf'}))),false);
  assert.equal(await page.evaluate(()=>N.core.S.id),active);
  assert.equal(await page.evaluate(()=>{try{N.pdf.validate({data:'not base64',pages:[]});return false;}catch{return true;}}),true);
  await page.evaluate(()=>N.library.close());
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>N.core.M.vw===390);
  await page.evaluate(()=>{N.core.setZoom((N.core.M.vw-24)/720);N.pdf.go(0);N.ink.setTool('text');});
  await page.waitForTimeout(900);await page.screenshot({path:'test-results/pdf/mobile.png'});
  const navBox=await page.locator('#pdf-nav').boundingBox();assert.ok(navBox.x>=0&&navBox.x+navBox.width<=390);
  const thumb=page.locator('#pdf-toggle');assert.ok(await thumb.isVisible());
  // Leaving PDF mode restores ordinary notebooks and their responsive width.
  await page.evaluate(()=>N.ui.newNote());assert.equal(await page.locator('#pdf-nav').isVisible(),false);assert.equal(await page.evaluate(()=>N.core.S.pdf),null);assert.ok(await page.evaluate(()=>N.core.M.contentW<720));
  assert.deepEqual(errors,[],'no browser or PDF CSP errors');
  // Fresh browser installation caches the PDF engine and its worker. Reload
  // offline, reopen the saved source and export without a network connection.
  const offlineContext=await browser.newContext({viewport:{width:1000,height:850}}),off=await offlineContext.newPage();
  const offlineErrors=[];off.on('pageerror',e=>offlineErrors.push(e.message));
  await off.goto(base+'/notas.html');await off.waitForFunction(()=>N.core?.S.id&&N.pdf);
  await off.evaluate(()=>{N.tutorial.finish(false);N.core.S.settings.aiOn=false;N.ai.toggle();});
  assert.equal(await off.evaluate(async data=>N.pdf.importFile(new File([new Uint8Array(data)],'offline.pdf',{type:'application/pdf'})),[...sample]),true);
  await off.waitForFunction(()=>document.getElementById('offline-status').textContent.includes('available offline.'),null,{timeout:90000});
  await off.evaluate(()=>navigator.serviceWorker.ready);await offlineContext.setOffline(true);await off.reload();
  await off.waitForFunction(()=>N.core?.S.pdf?.pages.length===3);
  await off.evaluate(()=>{N.core.setZoom(.6);N.pdf.go(0);});
  await off.waitForFunction(()=>{const C=N.core,cv=document.getElementById('c-commit'),sc=document.getElementById('scroller'),p=C.S.pdf.pages[0],x=Math.round((C.M.colLeft+70*C.M.zoom-sc.scrollLeft)*C.M.dpr),y=Math.round(((p.y+p.h-55)*C.M.zoom-sc.scrollTop)*C.M.dpr);if(y<0||y>=cv.height)return false;const d=cv.getContext('2d').getImageData(x,y,1,1).data;return d[1]>d[0]+50&&d[1]>d[2]+30;},null,{timeout:30000});
  const offlineDownload=off.waitForEvent('download');await off.locator('#pdf-save').click();await (await offlineDownload).saveAs('test-results/pdf/offline.pdf');
  assert.equal((await PDFDocument.load(await (await import('node:fs/promises')).readFile('test-results/pdf/offline.pdf'))).getPageCount(),3);
  assert.deepEqual(offlineErrors,[]);await offlineContext.close();
  console.log('PDF browser checks passed: import, pen/text/highlighter, margin scrolling, navigation, page insert/move/turn/delete with undo, search, text layer, reopen, vector PDF export, rotated/cropped pages, backups, errors, mobile and offline.');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
