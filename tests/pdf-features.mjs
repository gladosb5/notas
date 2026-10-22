// PDF notebooks beyond the basics: the original stored apart from the note,
// encrypted and password-locked PDFs, long documents, forms, bookmarks and
// links, a PDF shared from Android, and asking nota about a passage.
import {chromium} from 'playwright';
import {PDFDocument,PDFName,PDFString,PDFArray,StandardFonts} from 'pdf-lib';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

const qpdf=createRequire(import.meta.url)('../assets/pdf/qpdf/qpdf.js');
async function encrypt(bytes,user){
  const log=console.log,error=console.error;console.log=console.error=()=>{};
  try{const q=await qpdf({});q.FS.writeFile('/in.pdf',bytes);const code=q.callMain(['--encrypt','--user-password='+user,'--owner-password=owner','--bits=256','--print=none','--modify=none','--','/in.pdf','/out.pdf']);assert.equal(code,0);return Buffer.from(q.FS.readFile('/out.pdf'));}
  finally{console.log=log;console.error=error;}
}
async function sample(pages,label='Page'){
  const d=await PDFDocument.create(),f=await d.embedFont(StandardFonts.Helvetica);
  for(let i=0;i<pages;i++){const p=d.addPage([595,842]);p.drawText(label+' '+(i+1),{x:50,y:780,font:f,size:20});}
  return d;
}
// a form: a text field, a checkbox, a radio group and a dropdown
const formDoc=await sample(2,'Form page'),form=formDoc.getForm(),fp=formDoc.getPage(0);
form.createTextField('student.name').addToPage(fp,{x:50,y:700,width:220,height:24});
form.createCheckBox('agree').addToPage(fp,{x:50,y:650,width:16,height:16});
const year=form.createRadioGroup('year');year.addOptionToPage('Y7',fp,{x:50,y:600,width:14,height:14});year.addOptionToPage('Y8',fp,{x:90,y:600,width:14,height:14});
const subject=form.createDropdown('subject');subject.addOptions(['maths','science']);subject.addToPage(fp,{x:50,y:550,width:140,height:22});
const formBytes=Buffer.from(await formDoc.save());
// bookmarks and links: page 1 links out and to page 3; the outline names chapters
const linked=await sample(3,'Chapter'),ctx=linked.context,refs=linked.getPages().map(p=>p.ref);
const outline=ctx.nextRef(),items=[ctx.nextRef(),ctx.nextRef()];
ctx.assign(items[0],ctx.obj({Title:PDFString.of('Introduction'),Parent:outline,Next:items[1],Dest:[refs[0],'XYZ',null,842,null]}));
ctx.assign(items[1],ctx.obj({Title:PDFString.of('Third chapter'),Parent:outline,Prev:items[0],Dest:[refs[2],'XYZ',null,400,null]}));
ctx.assign(outline,ctx.obj({Type:'Outlines',First:items[0],Last:items[1],Count:2}));
linked.catalog.set(PDFName.of('Outlines'),outline);
const annots=ctx.obj([ctx.obj({Type:'Annot',Subtype:'Link',Rect:[50,700,250,730],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of('https://example.com/notes')}}),
  ctx.obj({Type:'Annot',Subtype:'Link',Rect:[50,640,250,670],Border:[0,0,0],Dest:[refs[2],'Fit']})]);
linked.getPage(0).node.set(PDFName.of('Annots'),annots);
const linkedBytes=Buffer.from(await linked.save());
const long=Buffer.from(await (await sample(300)).save());
const plain=Buffer.from(await (await sample(2,'Locked page')).save());
const restricted=await encrypt(plain,''),secret=await encrypt(plain,'open sesame');

const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
await mkdir('test-results/pdf',{recursive:true});
const errors=[];
try{
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:true}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.core?.S.id&&N.pdf&&N.ui);
  await page.evaluate(()=>{N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');N.core.S.settings.aiOn=false;N.ai.toggle();});
  const load=(bytes,name)=>page.evaluate(async([data,name])=>N.pdf.importFile(new File([new Uint8Array(data)],name,{type:'application/pdf'})),[[...bytes],name]);
  const saveFile=async()=>{const d=page.waitForEvent('download');await page.locator('#pdf-save').click();return (await d).path();};
  const textOf=async path=>page.evaluate(async data=>{const [lib]=await N.pdf.libs();const doc=await lib.getDocument({data:new Uint8Array(data)}).promise;const out=[];for(let i=1;i<=doc.numPages;i++)out.push((await (await doc.getPage(i)).getTextContent()).items.map(x=>x.str).join(' '));await doc.loadingTask.destroy();return out;},[...await (await import('node:fs/promises')).readFile(path)]);

  // The original lives apart from the note: the stored note names it by hash.
  assert.equal(await load(long,'long.pdf'),true,'300 pages open: the old 200-page limit is gone');
  assert.equal(await page.evaluate(()=>N.core.S.pdf.pages.length),300);
  await page.waitForFunction(()=>!N.core.S.dirty);
  const stored=await page.evaluate(async()=>N.core.Store.get('notas.note.'+N.core.S.id));
  assert.match(stored.pdf.ref,/^[0-9a-f]{64}$/);assert.equal(stored.pdf.data,undefined,'saves never rewrite the PDF itself');
  assert.equal(stored.pdf.size,long.length);
  // Thumbnails are made only near the view.
  await page.locator('#pdf-toggle').click();await page.waitForTimeout(800);
  const canvases=await page.locator('#pdf-page-list canvas').count();
  assert.ok(canvases>0&&canvases<40,'only nearby thumbnails hold canvases ('+canvases+')');
  await page.locator('#pdf-close').click();
  // A note exported for another device carries its PDF inside again.
  const bundle=await page.evaluate(async()=>N.pdf.inline(N.core.serialize()));
  assert.ok(bundle.pdf.data.startsWith('JVBERi0'));assert.equal(bundle.pdf.ref,undefined);
  // A note from before this change (PDF inline) is moved out when opened.
  await page.evaluate(async b=>{await N.ui.newNote();const ok=await N.ui.importNoteFile(new File([JSON.stringify(b)],'old.notas.json',{type:'application/json'}));if(!ok)throw Error('import failed');},bundle);
  await page.waitForFunction(()=>N.core.S.pdf?.ref&&!N.core.S.pdf.data,null,{timeout:20000});

  // A restricted PDF (no password to open) imports and saves without asking.
  assert.equal(await load(restricted,'restricted.pdf'),true);
  assert.equal(await page.locator('.sheet').count(),0,'no password is asked for a restricted PDF');
  assert.match((await textOf(await saveFile()))[0],/Locked page 1/,'restricted PDFs save, text intact');
  // A password-locked PDF asks; a wrong password says so; the right one opens it.
  const opening=load(secret,'secret.pdf');
  await page.locator('.sheet input[type=password]').waitFor();
  await page.fill('.sheet input[type=password]','wrong');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.sheet .pdf-pass-note.bad'));
  await page.fill('.sheet input[type=password]','open sesame');await page.keyboard.press('Enter');
  assert.equal(await opening,true);
  assert.match((await textOf(await saveFile()))[1],/Locked page 2/);
  // Cancelling the password leaves the current note as it was.
  const before=await page.evaluate(()=>N.core.S.id),cancelled=load(secret,'secret.pdf');
  await page.locator('.sheet input[type=password]').waitFor();await page.keyboard.press('Escape');
  assert.equal(await cancelled,false);assert.equal(await page.evaluate(()=>N.core.S.id),before);

  // Forms: fill with the text tool, undo, and the saved PDF keeps the values in its form.
  assert.equal(await load(formBytes,'form.pdf'),true);
  await page.evaluate(()=>{N.ink.setTool('text');N.pdf.go(0);});
  await page.locator('#pdf-tl input.pdf-field[data-name="student.name"]').waitFor();
  await page.fill('#pdf-tl input.pdf-field[data-name="student.name"]','Ada Lovelace');await page.keyboard.press('Tab');
  await page.locator('#pdf-tl button.pdf-field[data-name="agree"]').click();
  await page.locator('#pdf-tl button.pdf-field[data-name="year"]').nth(1).click();
  await page.selectOption('#pdf-tl select.pdf-field[data-name="subject"]','science');
  assert.deepEqual(await page.evaluate(()=>N.core.S.pdf.fields),{'student.name':'Ada Lovelace',agree:true,year:'Y8',subject:'science'});
  await page.evaluate(()=>N.core.undo());assert.equal(await page.evaluate(()=>N.core.S.pdf.fields.subject),undefined);
  await page.evaluate(()=>N.core.redo());
  await page.screenshot({path:'test-results/pdf/form.png'});
  const filled=await PDFDocument.load(await (await import('node:fs/promises')).readFile(await saveFile())),out=filled.getForm();
  assert.equal(out.getTextField('student.name').getText(),'Ada Lovelace');assert.equal(out.getCheckBox('agree').isChecked(),true);
  assert.equal(out.getRadioGroup('year').getSelected(),'Y8');assert.deepEqual(out.getDropdown('subject').getSelected(),['science']);

  // Bookmarks open from the pages panel; links in the page work with the text tool.
  assert.equal(await load(linkedBytes,'linked.pdf'),true);
  await page.locator('#pdf-toggle').click();await page.locator('#pdf-outline-btn:not([hidden])').waitFor();
  await page.locator('#pdf-outline-btn').click();
  assert.deepEqual(await page.locator('#pdf-outline button').allTextContents(),['Introduction','Third chapter']);
  await page.locator('#pdf-outline button',{hasText:'Third chapter'}).click();
  await page.waitForFunction(()=>document.getElementById('pdf-count').textContent==='3 / 3');
  await page.evaluate(()=>{N.ink.setTool('text');N.pdf.go(0);});
  const out1=page.locator('#pdf-tl .pdf-link[href="https://example.com/notes"]');await out1.waitFor();
  await context.route('https://example.com/**',r=>r.fulfill({contentType:'text/html',body:'notes'}));
  const popup=context.waitForEvent('page');await out1.click();const opened=await popup;await opened.waitForURL('https://example.com/notes');await opened.close();
  await page.evaluate(()=>N.pdf.go(0));await page.locator('#pdf-tl .pdf-link[href="#"]').click();
  await page.waitForFunction(()=>document.getElementById('pdf-count').textContent==='3 / 3');
  // Saving keeps the bookmarks and links of the original, in the new page order.
  await page.evaluate(()=>N.pdf.movePage(0,1));
  const kept=await PDFDocument.load(await (await import('node:fs/promises')).readFile(await saveFile()));
  assert.ok(kept.catalog.get(PDFName.of('Outlines')),'bookmarks survive saving');
  assert.ok(kept.getPage(1).node.lookup(PDFName.of('Annots'),PDFArray).size()===2,'links travel with their page');
  assert.match((await page.evaluate(()=>N.core.S.pdf.pages.map(p=>p.source).join(','))),/^1,0,2$/);

  // Ask nota about a selected passage: the reply comes back beside it, not on the page.
  await page.evaluate(()=>{N.pdf.go(N.core.S.pdf.pages.findIndex(p=>p.source===0));N.nota.askText=async(q,context,on)=>{window.asked={q,context};for(const w of ['It ','is ','chapter ','one.'])on(w);return 'It is chapter one.';};});
  const span=page.locator('#pdf-tl .textLayer span',{hasText:'Chapter 1'});await span.waitFor();
  const box=await span.boundingBox();await page.mouse.move(box.x+1,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-1,box.y+box.height/2,{steps:6});await page.mouse.up();
  await page.locator('#pdf-ask-chip:not([hidden])').click();
  await page.keyboard.type('what is this?');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.getElementById('pdf-ask-reply').textContent==='It is chapter one.');
  assert.match(await page.evaluate(()=>window.asked.q),/Chapter 1[\s\S]*what is this\?/);
  assert.match(await page.evaluate(()=>window.asked.context),/Chapter 1/,'nota gets the page text as context');
  assert.equal(await page.evaluate(()=>N.core.S.lines.length+N.core.S.strokes.length),0,'nothing is written on the PDF');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#pdf-ask').isVisible(),false);

  // A PDF shared from Android: the service worker parks it, the page imports it.
  await page.evaluate(async data=>{const c=await caches.open('notas-shared');await c.put(new URL('./shared-pdf',location.href).href,new Response(new Blob([new Uint8Array(data)]),{headers:{'Content-Type':'application/pdf','X-File-Name':encodeURIComponent('shared notes.pdf')}}));},[...plain]);
  await page.goto(base+'/notas.html?shared-pdf=1');
  await page.waitForFunction(()=>N.core?.S.pdf&&N.core.S.title==='shared notes',null,{timeout:30000});
  assert.equal(new URL(page.url()).searchParams.has('shared-pdf'),false,'the address is cleaned up');

  // Stored originals no note refers to are cleared; ones in use stay.
  const counts=await page.evaluate(async()=>{
    const keys=async()=>(await idbKeyval.keys()).filter(k=>String(k).startsWith('notas.pdfdata.'));
    const orphan='notas.pdfdata.'+'0'.repeat(64);await idbKeyval.set(orphan,{v:1,at:0,size:1,blob:new Blob(['x'])});
    const before=(await keys()).length;await N.pdf.collect();const after=await keys();
    return {before,after:after.length,orphan:after.includes(orphan)};
  });
  assert.equal(counts.orphan,false);assert.equal(counts.after,counts.before-1);
  assert.deepEqual(errors,[]);
  console.log('PDF feature checks passed: stored originals, 300 pages, lazy thumbnails, old-note migration, restricted and password PDFs, forms, bookmarks, links, ask nota, shared PDFs and clean-up.');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
