import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {PDFDocument, rgb} from 'pdf-lib';
import {startServer} from '../scripts/serve.mjs';

const pdf=await PDFDocument.create();
for(const color of [rgb(1,1,1),rgb(.1,.3,.9)]){
  const page=pdf.addPage([595,842]);
  page.drawRectangle({x:0,y:0,width:595,height:842,color});
}
const bytes=Buffer.from(await pdf.save());
const server=await startServer(0);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.pdf?.importFile&&N.core.S.id);
  await page.evaluate(()=>{N.tutorial.finish(false);document.querySelector('#preparing').classList.add('done');N.core.S.settings.aiOn=false;N.ai.toggle();});
  assert.equal(await page.evaluate(async data=>{
    const file=new File([Uint8Array.from(data)],'viewport.pdf',{type:'application/pdf'});
    return N.pdf.importFile(file);
  },[...bytes]),true,'test PDF imports');
  await page.waitForFunction(()=>N.core.S.pdf?.pages.length===2&&N.core.S.savedRev);
  await page.evaluate(()=>N.ink.setTool('mark'));

  const screen=async(x,y)=>page.evaluate(([x,y])=>{
    const C=N.core,sc=document.querySelector('#scroller'),r=sc.getBoundingClientRect();
    return {x:r.left+C.M.colLeft-sc.scrollLeft+x*C.M.zoom,y:r.top-sc.scrollTop+y*C.M.zoom};
  },[x,y]);
  const sample=async(layer,worldX,worldY)=>page.evaluate(([layer,x,y])=>{
    const C=N.core,sc=document.querySelector('#scroller'),cv=document.querySelector('#c-'+layer);
    const px=(C.M.colLeft-sc.scrollLeft+x*C.M.zoom)*C.M.dpr;
    const py=(-sc.scrollTop+y*C.M.zoom)*C.M.dpr;
    return [...cv.getContext('2d').getImageData(Math.round(px),Math.round(py),1,1).data];
  },[layer,worldX,worldY]);
  const a=await screen(120,260),b=await screen(320,260);
  await page.mouse.move(a.x,a.y);await page.mouse.down();
  await page.mouse.move(b.x,b.y,{steps:16});
  const live=await sample('ink',220,260);
  assert.ok(live[3]>0&&live[0]>live[2]+70,'live highlighter has visible yellow pixels');
  const liveNeighbor=await sample('ink',180,260);
  assert.ok(Math.abs(live[1]-liveNeighbor[1])<8,'live highlighter does not accumulate dark segment layers');
  await page.mouse.up();
  await page.waitForFunction(()=>N.core.S.strokes.length===1);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const committed=await sample('commit',220,260),baseline=await sample('commit',220,300);
  assert.ok(committed[0]>committed[2]+70&&committed[1]<baseline[1]-10,
    `completed highlighter is visible, got ${committed} against ${baseline}`);
  assert.equal(await page.evaluate(()=>N.core.S.strokes[0].author),'mark');

  // The original tablet report used a pencil. Exercise the pen pointer path,
  // including live pixels, completion, and consecutive strokes.
  const penEvent=async(type,x,y)=>page.evaluate(({type,x,y})=>{
    const C=N.core,sc=document.querySelector('#scroller'),r=sc.getBoundingClientRect();
    const ev=new PointerEvent(type,{
      bubbles:true,cancelable:true,pointerId:73,pointerType:'pen',isPrimary:true,
      button:0,buttons:type==='pointerup'?0:1,pressure:type==='pointerup'?0:.65,
      clientX:r.left+C.M.colLeft-sc.scrollLeft+x*C.M.zoom,
      clientY:r.top-sc.scrollTop+y*C.M.zoom
    });
    document.querySelector('#c-ink').dispatchEvent(ev);
  },{type,x,y});
  await penEvent('pointerdown',140,360);
  for(let x=150;x<=420;x+=15)await penEvent('pointermove',x,360);
  const livePen=await sample('ink',220,360);
  assert.ok(livePen[3]>0&&livePen[0]>livePen[2]+70,`pen highlighter draws live: ${livePen}`);
  assert.ok(Math.abs(livePen[1]-(await sample('ink',300,360))[1])<8,'pen stroke is evenly coloured');
  await penEvent('pointerup',420,360);
  await page.waitForFunction(()=>N.core.S.strokes.length===2);
  // A highlight joins its colour's single band on the next painted frame.
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const committedPen=await sample('commit',220,360),ghost=await sample('ink',220,360);
  assert.ok(committedPen[0]>committedPen[2]+70&&committedPen[3]>0,`pen highlight persists: ${committedPen}`);
  assert.equal(ghost[3],0,'pen lift clears the live overlay');
  await penEvent('pointerdown',140,405);
  for(let x=150;x<=420;x+=15)await penEvent('pointermove',x,405);
  await penEvent('pointerup',420,405);
  await page.waitForFunction(()=>N.core.S.strokes.length===3);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.ok((await sample('commit',220,405))[3]>0,'second pen highlight is committed independently');
  // A band the tablet splits in two, or two passes over the same words,
  // must not leave a darker disc where the pieces overlap.
  const before=await page.evaluate(()=>N.core.S.strokes.length);
  await penEvent('pointerdown',140,450);
  for(let x=150;x<=280;x+=10)await penEvent('pointermove',x,450);
  await penEvent('pointerup',280,450);
  await penEvent('pointerdown',280,450);
  for(let x=290;x<=420;x+=10)await penEvent('pointermove',x,450);
  await penEvent('pointerup',420,450);
  await page.waitForFunction(n=>N.core.S.strokes.length===n+2,before);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const join=await sample('commit',280,450),plain=await sample('commit',200,450);
  assert.ok(Math.abs(join[0]-plain[0])<6&&Math.abs(join[1]-plain[1])<6&&Math.abs(join[2]-plain[2])<6,
    `overlapping highlight pieces are one even band: ${join} against ${plain}`);
  assert.equal((await sample('ink',220,405))[3],0,'second pen stroke leaves no overlay');

  const pixel=async dataUrl=>page.evaluate(async src=>{
    const image=new Image();image.src=src;await image.decode();
    const cv=document.createElement('canvas');cv.width=image.width;cv.height=image.height;
    const ctx=cv.getContext('2d');ctx.drawImage(image,0,0);
    return [...ctx.getImageData(Math.floor(image.width*.5),Math.floor(image.height*.5),1,1).data];
  },dataUrl);
  const original=await page.evaluate(async()=>N.library.renderThumb(N.core.serialize()));
  assert.ok(original?.src?.startsWith('data:image/'),'PDF has a thumbnail');
  const first=await pixel(original.src);
  await page.evaluate(()=>{
    const C=N.core,sc=document.querySelector('#scroller');
    sc.scrollTop=Math.round((C.S.pdf.pages[1].y+90)*C.M.zoom);
    C.saveView(C.S.id,sc.scrollTop,sc.scrollLeft,C.M.zoom);
  });
  await page.waitForTimeout(350);
  const second=await page.evaluate(async()=>N.library.renderThumb(N.core.serialize()));
  const secondPixel=await pixel(second.src);
  assert.ok(secondPixel[2]>secondPixel[0]+70,`preview follows second blue PDF page: ${secondPixel}`);
  assert.ok(first[0]>235&&first[1]>235&&first[2]>235,`preview initially shows first white page: ${first}`);
  assert.notEqual(second.viewKey,original.viewKey,'saved viewport changes thumbnail key');
  const pdfId=await page.evaluate(()=>N.core.S.id);
  await page.evaluate(async()=>{await N.core.save();await N.library.open({overview:true});});
  await page.waitForFunction(()=>document.querySelector('#lib-current-preview img')?.complete);
  const preview=await page.locator('#lib-current-preview img').getAttribute('src');
  assert.ok((await pixel(preview))[2]>150,'notes-management preview shows the last PDF page');
  await page.evaluate(()=>N.library.close({immediate:true}));

  // Reload and reopening a different note must not reset the last PDF page.
  const savedScroll=await page.evaluate(()=>{
    N.core.flushView();return document.querySelector('#scroller').scrollTop;
  });
  await page.reload();
  await page.waitForFunction(id=>N.core?.S.id===id&&N.core.S.pdf?.pages.length===2&&
    !N.ui?.changing&&document.querySelector('#preparing')?.classList.contains('done'),pdfId,{timeout:20000});
  await page.evaluate(()=>{N.tutorial.finish(false);document.querySelector('#preparing').classList.add('done');N.core.S.settings.aiOn=false;N.ai.toggle();});
  const restored=await page.evaluate(async()=>({
    top:document.querySelector('#scroller').scrollTop,
    view:N.core.getView(N.core.S.id),
    thumb:await N.library.renderThumb(N.core.serialize())
  }));
  assert.ok(Math.abs(restored.top-savedScroll)<5,`PDF scroll position survives reload: ${restored.top} vs ${savedScroll}`);
  assert.ok((await pixel(restored.thumb.src))[2]>150,'PDF thumbnail survives reload at last visible page');
  await page.evaluate(async()=>{
    await N.ui.newNote();
    N.core.S.lines[0].text='Another note for navigation';
    N.text.render();N.core.markDirty();await N.core.save();
  });
  const newId=await page.evaluate(()=>N.core.S.id);
  const inactive=await page.evaluate(async id=>{
    const doc=await N.core.Store.get('notas.note.'+id);
    return N.library.renderThumb(doc);
  },pdfId);
  assert.ok((await pixel(inactive.src))[2]>150,'inactive PDF renders its saved page');
  await page.evaluate(()=>N.library.open({overview:true}));
  await page.waitForFunction(id=>{
    const img=document.querySelector('.lib-thumb[data-thumb="'+CSS.escape(id)+'"] img');
    return img?.complete&&img.naturalWidth>0;
  },pdfId,{timeout:12000});
  const cardSrc=await page.locator('.lib-thumb[data-thumb="'+pdfId+'"] img').getAttribute('src');
  assert.ok((await pixel(cardSrc))[2]>150,'inactive PDF card displays its last visible page');
  await page.evaluate(()=>N.library.close({immediate:true}));
  await page.evaluate(id=>N.ui.openNote(id),pdfId);
  await page.waitForFunction(id=>N.core.S.id===id,pdfId);
  assert.ok(Math.abs((await page.evaluate(()=>document.querySelector('#scroller').scrollTop))-savedScroll)<5,
    'switching notes restores the saved PDF scroll position');
  await page.evaluate(id=>N.ui.openNote(id),newId);
  await page.waitForFunction(id=>N.core.S.id===id,newId);

  const sentence='A line positioned far to the right needs the same full writing width as a normal line, so it should remain readable and selectable.';
  const width=await page.evaluate(text=>{
    const C=N.core;
    C.S.lines=[{id:'far-line',x:975,y:240,text}];
    C.S.strokes=[];N.text.render();C.layout();N.text.render();N.ink.setTool('select');
    const sc=document.querySelector('#scroller');sc.scrollLeft=390;
    const line=document.querySelector('.line');
    return {style:parseFloat(line.style.width),expected:C.M.contentW,height:C.S.lines[0].h,scrollWidth:sc.scrollWidth,clientWidth:sc.clientWidth};
  },sentence);
  assert.equal(width.style,width.expected,'far right text retains normal line width');
  assert.ok(width.height<125,`far right text does not wrap excessively: ${JSON.stringify(width)}`);
  assert.ok(width.scrollWidth>width.clientWidth,'far right text remains reachable by horizontal scrolling');
  const corners=[[940,220],[1260,220],[1260,360],[940,360],[940,220]];
  const points=await Promise.all(corners.map(([x,y])=>screen(x,y)));
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();
  for(const p of points.slice(1))await page.mouse.move(p.x,p.y,{steps:7});
  await page.mouse.up();
  assert.ok((await page.evaluate(()=>N.core.S.selection)).includes('far-line'),'lasso selects far right text');

  // A plain note's card should also follow its last scroll position.
  await page.evaluate(()=>{
    const C=N.core,S=C.S,sc=document.querySelector('#scroller');
    S.selection=[];S.lines=[];
    S.strokes=[
      {id:'top-ink',author:'user',pts:[150,180,.5,300,180,.5],color:'#0000ff',w:42,bbox:[150,180,300,180]},
      {id:'bottom-ink',author:'user',pts:[150,1380,.5,300,1380,.5],color:'#ff0000',w:42,bbox:[150,1380,300,1380]}
    ];
    C.growDoc(2000);C.layout();sc.scrollLeft=0;sc.scrollTop=0;N.text.render();N.ink.render();
  });
  const notesAtTop=await page.evaluate(async()=>N.library.renderThumb(N.core.serialize()));
  await page.evaluate(()=>{
    const C=N.core,sc=document.querySelector('#scroller');
    sc.scrollTop=1300;C.saveView(C.S.id,sc.scrollTop,sc.scrollLeft,C.M.zoom);
  });
  await page.waitForTimeout(300);
  const notesAtBottom=await page.evaluate(async()=>N.library.renderThumb(N.core.serialize()));
  const inkPalette=async src=>page.evaluate(async src=>{
    const im=new Image();im.src=src;await im.decode();
    const cv=document.createElement('canvas');cv.width=im.width;cv.height=im.height;
    const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(im,0,0);
    const {data}=ctx.getImageData(0,0,im.width,im.height);let red=0,blue=0;
    for(let i=0;i<data.length;i+=4){if(data[i]>data[i+2]+75)red++;if(data[i+2]>data[i]+75)blue++;}
    return {red,blue};
  },src);
  const topPalette=await inkPalette(notesAtTop.src),bottomPalette=await inkPalette(notesAtBottom.src);
  assert.ok(topPalette.blue>100&&topPalette.red===0,`top note preview shows only top ink: ${JSON.stringify(topPalette)}`);
  assert.ok(bottomPalette.red>100&&bottomPalette.blue===0,`scrolled note preview shows only bottom ink: ${JSON.stringify(bottomPalette)}`);
  assert.notEqual(notesAtTop.viewKey,notesAtBottom.viewKey,'note scroll position is recorded for previews');
  assert.deepEqual(errors,[]);
  console.log('PDF highlighter pixels, last-viewport PDF and note thumbnails, inactive previews and far-right text/lasso passed.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
