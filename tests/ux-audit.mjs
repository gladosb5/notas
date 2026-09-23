import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const remote=[];
context.on('request',r=>{if(!r.url().startsWith(base+'/')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))remote.push(r.url());});
const page=await context.newPage();
const tinyPng='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfWQAAAAASUVORK5CYII=';

try{
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.ui?.importNoteFile&&window.N?.ink?.resizeImage);
  await page.evaluate(()=>{N.tutorial?.finish(false);N.core.S.settings.aiOn=false;N.ai.toggle();N.ink.setTool('text');});
  const input=page.locator('.line .txt').first();

  // Findings 2/4: shared panels are named modal dialogs, take keyboard focus,
  // keep the background inert, and restore focus to the opener when closed.
  await page.locator('#btn-menu').focus();
  await page.locator('#btn-menu').click();
  const dialog=page.getByRole('dialog',{name:'Menu'});
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute('aria-modal'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('sheet-x')),true,'Panel focus enters the close control');
  assert.equal(await page.evaluate(()=>document.querySelector('#scroller').inert),true,'Notebook is inert while a panel is open');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.sheet')),true,'Tab remains inside the modal panel');
  await dialog.getByRole('button',{name:'Close'}).click();
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'btn-menu','Closing restores focus to the opener');

  // Finding 13: invalid maths stays quiet while the student is actively typing,
  // then becomes visible as soon as editing of that line ends.
  await input.fill('unknown+2');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.chip.error').count(),0,'Invalid maths is not flagged mid-typing');
  await input.evaluate(el=>el.blur());
  await page.waitForTimeout(80);
  assert.match(await page.locator('.chip.error').first().textContent(),/unknown has no value yet/,'Invalid maths explains itself after blur');

  // Finding 1 coverage: Ctrl+Z remains the line's native history, rather
  // than consuming notebook-level ink/history actions.
  await input.fill('abc');
  await input.focus();
  await input.pressSequentially('d');
  const undoDepth=await page.evaluate(()=>N.core.Undo.back.length);
  await page.keyboard.press('Control+Z');
  assert.equal(await input.evaluate(el=>el.value),'abc','Ctrl+Z undoes the typed edit');
  assert.equal(await page.evaluate(()=>N.core.Undo.back.length),undoDepth,'Native typing undo does not consume notebook history');

  // Findings 14/33: Enter splits at the actual caret, while a composition Enter
  // is ignored by the line editor so an IME can commit its candidate normally.
  await input.fill('abcdef');
  await input.evaluate(el=>el.setSelectionRange(3,3));
  await input.press('Enter');
  assert.deepEqual(await page.evaluate(()=>N.core.S.lines.slice().sort((a,b)=>a.y-b.y).map(l=>l.text)),['abc','def'],'Enter splits a line at the caret');
  await page.evaluate(()=>N.core.undo());
  assert.deepEqual(await page.evaluate(()=>N.core.S.lines.slice().sort((a,b)=>a.y-b.y).map(l=>l.text)),['abcdef'],'The whole caret split is one undo action');
  await input.focus();
  const beforeCompose=await page.evaluate(()=>N.core.S.lines.length);
  await input.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true})));
  assert.equal(await page.evaluate(()=>N.core.S.lines.length),beforeCompose,'IME composition Enter does not create a notebook line');

  // Finding 23: long typed text grows the line and the export renderer reaches
  // the final token instead of drawing one clipped line.
  const longText='start '+('wrapped-word '.repeat(100))+'THE-END';
  await input.fill(longText);
  assert.ok(await input.evaluate(el=>el.getBoundingClientRect().height)>30,'Long typed text wraps to multiple visual lines');
  const wrappedExport=await page.evaluate(async()=>{
    const proto=CanvasRenderingContext2D.prototype,orig=proto.fillText,seen=[];
    proto.fillText=function(text,...rest){seen.push(String(text));return orig.call(this,text,...rest);};
    try{await N.ui.renderExport();}finally{proto.fillText=orig;}
    return seen.some(s=>s.includes('THE-END'));
  });
  assert.equal(wrappedExport,true,'Export draws the final token of wrapped long text');

  // Findings 17/28/30 and export fidelity: a parameterised graph persists its
  // sliders, publishes numerical sample values, and is composited into export.
  await input.fill('y=a*x');
  await input.evaluate(el=>el.blur());
  await page.locator('.plot').waitFor();
  assert.match(await page.locator('.plot-desc').textContent(),/y\(-5\).*y\(0\).*y\(5\)/,'Graph exposes sample coordinates as well as ranges');
  const graphDraws=await page.evaluate(async()=>{
    let plots=0;const proto=CanvasRenderingContext2D.prototype,orig=proto.drawImage;
    proto.drawImage=function(source,...rest){if(source instanceof HTMLCanvasElement&&source.closest?.('.plot'))plots++;return orig.call(this,source,...rest);};
    try{await N.ui.renderExport();}finally{proto.drawImage=orig;}
    return plots;
  });
  assert.ok(graphDraws>0,'PNG/PDF renderer composites graph canvases');
  const slider=page.locator('.plot input[type="range"]').first();
  await slider.evaluate(el=>{el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}));});
  const graphNote=await page.evaluate(()=>N.core.S.id);
  await page.waitForFunction(async id=>{
    const d=await N.core.Store.get('notas.note.'+id),line=d?.lines?.find(l=>l.text==='y=a*x');
    return line?._plotVals?.a===3;
  },graphNote,{timeout:6000});
  await page.reload();
  await page.waitForFunction(()=>window.N?.ui?.renderExport&&window.N?.core?.S.id);
  await page.locator('.plot').waitFor();
  assert.equal(await page.locator('.plot input[type="range"]').first().inputValue(),'3','Graph slider survives autosave and reload');

  // Findings 12/16: a phone narrows the column instead of letting the working
  // run off the right edge, so a fresh note never scrolls sideways and the
  // whole graph is on screen without panning. What a wider screen already
  // wrote is not stranded by that: the paper keeps the width of its furthest
  // ink, and touch panning still moves in both axes to reach it.
  await page.evaluate(()=>{const s=document.querySelector('#scroller');s.scrollLeft=0;s.scrollTop=0;});
  assert.equal(await page.evaluate(()=>{const s=document.querySelector('#scroller');return s.scrollWidth<=s.clientWidth;}),true,
    'A note written at phone width does not scroll sideways');
  const restingPlot=await page.locator('.plot').boundingBox();
  assert.ok(restingPlot&&restingPlot.x>=-1&&restingPlot.x+restingPlot.width<=391,
    'The complete graph is on a 390px screen without panning for it');
  await page.evaluate(()=>{
    /* ink at coordinates only a laptop could have written */
    N.core.S.strokes.push({id:'far-right',author:'ai',w:2.8,t0:1,pts:[660,520,.5,700,520,.5],bbox:[660,514,700,526]});
    N.core.layout();N.ink.render();
  });
  await page.evaluate(()=>{
    const c=document.querySelector('#c-ink');
    const fire=(name,id,x,y,buttons)=>c.dispatchEvent(new PointerEvent(name,{pointerId:id,pointerType:'touch',isPrimary:id===71,clientX:x,clientY:y,button:name==='pointermove'?-1:0,buttons,width:30,height:30,pressure:.5,bubbles:true}));
    fire('pointerdown',71,330,500,1);fire('pointerdown',72,370,500,1);
    for(let i=1;i<=18;i++){fire('pointermove',71,330-i*14,500,1);fire('pointermove',72,370-i*14,500,1);}
    fire('pointerup',71,78,500,0);fire('pointerup',72,118,500,0);
  });
  await page.waitForTimeout(80);
  assert.ok(await page.evaluate(()=>document.querySelector('#scroller').scrollLeft)>150,'Two-finger touch pan reaches horizontally hidden document content');
  await page.evaluate(()=>{const s=document.querySelector('#scroller');s.scrollLeft=s.scrollWidth-s.clientWidth;});
  await page.waitForTimeout(50);
  const rightInkScreenX=await page.evaluate(()=>N.core.M.colLeft-document.querySelector('#scroller').scrollLeft+680);
  assert.ok(rightInkScreenX>=0&&rightInkScreenX<=390,'Existing ink at document x=680 is reachable after narrowing');
  await page.evaluate(()=>{N.core.S.strokes=N.core.S.strokes.filter(s=>s.id!=='far-right');N.core.layout();N.ink.render();const s=document.querySelector('#scroller');s.scrollLeft=0;});

  // Finding 10 timing edge: renderExport flushes evaluation before it paints.
  const line=page.locator('.line .txt').first();
  await line.fill('2+2');await line.evaluate(el=>el.blur());await page.waitForTimeout(220);
  await line.fill('2+3');
  const immediate=await page.evaluate(async()=>{await N.ui.renderExport();return N.core.S.nodes.find(n=>n.kind==='line')?.result||'';});
  assert.equal(immediate,'5','Immediate export recalculates the edited line before rendering');

  // Finding 26: resize is undoable and Menu > Manage images provides a
  // keyboard-only manipulation route. (Pictures are no longer read, so a
  // resize has no recognition bounds to rebuild; a reading saved by an older
  // build is dropped rather than turned into a cluster.)
  const imageState=await page.evaluate(src=>{
    const S=N.core.S;S.images=[{id:'img-a',x:100,y:500,w:100,h:50,src,ascii:'2+2=',confirmed:true}];
    N.recog.rebuild();N.mathcore.run();N.ink.render();
    const clusters=N.core.S.clusters.filter(c=>c.imageId==='img-a').length;
    N.ink.resizeImage('img-a',1.18);
    return {clusters,w:S.images[0].w};
  },tinyPng);
  assert.equal(imageState.clusters,0,'A picture never becomes an expression cluster');
  assert.ok(imageState.w>100,'Image resize applies');
  await page.evaluate(()=>N.core.undo());
  assert.equal(await page.evaluate(()=>N.core.S.images[0].w),100,'Undo restores image size');
  await page.evaluate(()=>N.core.redo());
  assert.ok(await page.evaluate(()=>N.core.S.images[0].w)>100,'Redo reapplies image size');
  await page.evaluate(()=>N.ui.menuSheet());
  await page.getByRole('button',{name:/manage images/}).click();
  const moveRight=page.getByRole('button',{name:'move image 1 right'});
  const beforeX=await page.evaluate(()=>N.core.S.images[0].x);
  await moveRight.focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>N.core.S.images[0].x),beforeX+10,'Keyboard can move an inserted image without canvas dragging');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'move image 1 right','Image action keeps keyboard focus after repaint');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>N.core.S.images[0].x),beforeX+20,'The same image action can be repeated without re-tabbing');
  await page.getByRole('button',{name:'Close'}).click();

  // Findings 5/25: an editable export round-trips as a new note, unsafe image
  // URLs are rejected before state changes, and a failed final import save stays
  // visibly dirty instead of claiming success.
  const exported=await page.evaluate(()=>JSON.stringify(N.core.serialize()));
  const round=await page.evaluate(async raw=>{
    const before=N.core.S.id,ok=await N.ui.importNoteFile(new File([raw],'round.notas.json',{type:'application/json'}));
    return {ok,before,after:N.core.S.id,lines:N.core.S.lines.map(l=>l.text),images:N.core.S.images.length,reading:'ascii' in N.core.S.images[0]};
  },exported);
  assert.equal(round.ok,true);assert.notEqual(round.after,round.before,'Import creates a new note rather than overwriting the source');
  assert.ok(round.lines.includes('2+3'));assert.equal(round.images,1);assert.equal(round.reading,false,'An old image reading is dropped on import: pictures are pictures');
  const malicious=JSON.parse(exported);malicious.images[0].src='https://example.invalid/tracker.png';
  const beforeBad=await page.evaluate(()=>N.core.S.id);
  const bad=await page.evaluate(async raw=>N.ui.importNoteFile(new File([raw],'bad.notas.json',{type:'application/json'})),JSON.stringify(malicious));
  assert.equal(bad,false);assert.equal(await page.evaluate(()=>N.core.S.id),beforeBad,'Invalid import is rejected before replacing the current note');
  assert.deepEqual(remote,[],'Import validation never fetches an arbitrary image URL');
  const failDoc=JSON.parse(exported);failDoc.title='Imported Failure';
  const failed=await page.evaluate(async raw=>{
    const C=N.core,original=C.Store.set;
    C.Store.set=async(k,v)=>k.startsWith('notas.note.')&&v?.title==='Imported Failure'?false:original(k,v);
    let ok;try{ok=await N.ui.importNoteFile(new File([raw],'failure.notas.json',{type:'application/json'}));}finally{C.Store.set=original;}
    return {ok,dirty:C.S.dirty,alert:!document.querySelector('#save-alert').hidden,title:C.S.title};
  },JSON.stringify(failDoc));
  assert.deepEqual(failed,{ok:false,dirty:true,alert:true,title:'Imported Failure'},'Failed import save remains visibly unsaved and does not show success');
  assert.equal(await page.evaluate(()=>N.core.save()),true,'Imported unsaved state remains recoverable with Retry/save');

  // Smoothness pass: panels animate in and out, and the leaving panel is gone
  // from the accessibility tree at once so it cannot be found twice.
  await page.evaluate(()=>N.ui.menuSheet());
  assert.equal(await page.evaluate(()=>!!document.querySelector('.sheet')&&!document.querySelector('.sheet').classList.contains('enter')),true,'Panel enter transition is released after insertion');
  await page.evaluate(()=>N.ui.closeSheet());
  const leaving=await page.evaluate(()=>{const el=document.querySelector('.sheet');return el?{leave:el.classList.contains('leave'),role:el.getAttribute('role'),hidden:el.getAttribute('aria-hidden')}:{gone:true};});
  assert.ok(leaving.gone||(leaving.leave&&leaving.role===null&&leaving.hidden==='true'),'A closing panel leaves the accessibility tree immediately');
  await page.waitForFunction(()=>!document.querySelector('.sheet'),null,{timeout:2000});

  // Text tool: a finger drag meant as a scroll must not create a line; a tap does.
  const tapState=await page.evaluate(()=>{
    N.ink.setTool('text');
    const doc=document.getElementById('doc');const n0=N.core.S.lines.length;
    const f=(n,x,y)=>doc.dispatchEvent(new PointerEvent(n,{pointerId:77,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,bubbles:true}));
    f('pointerdown',200,500);f('pointermove',200,400);f('pointerup',200,400);
    const afterDrag=N.core.S.lines.length;
    /* clear of the picture left at world y 500-560 above: a tap on a picture selects it */
    f('pointerdown',200,660);f('pointerup',201,661);
    const afterTap=N.core.S.lines.length;
    N.ink.setTool('pen');
    return {n0,afterDrag,afterTap};
  });
  assert.equal(tapState.afterDrag,tapState.n0,'A drag in text mode does not add a line');
  assert.equal(tapState.afterTap,tapState.n0+1,'A tap in text mode adds a line');

  // Two fingers keep the page moving after they lift; a pinch changes the zoom
  // and the ink is still stored in page coordinates.
  const motion=await page.evaluate(()=>{
    N.core.S.docH=6000;N.core.layout();
    const c=document.getElementById('c-ink'),sc=document.querySelector('#scroller');
    const f=(n,id,x,y,b)=>c.dispatchEvent(new PointerEvent(n,{pointerId:id,pointerType:'touch',isPrimary:id===11,clientX:x,clientY:y,button:n==='pointermove'?-1:0,buttons:b,width:50,height:50,pressure:.5,bubbles:true}));
    f('pointerdown',11,150,500,1);f('pointerdown',12,250,500,1);
    return new Promise(res=>{
      let i=0;const step=()=>{i++;f('pointermove',11,150,500-i*12,1);f('pointermove',12,250,500-i*12,1);
        if(i<8)requestAnimationFrame(step);else{f('pointerup',11,150,500-i*12,0);f('pointerup',12,250,500-i*12,0);
          const lifted=sc.scrollTop;setTimeout(()=>{
            const coasted=sc.scrollTop;
            f('pointerdown',21,150,300,1);f('pointerdown',22,250,300,1);
            for(let k=1;k<=6;k++){f('pointermove',21,150-k*10,300,1);f('pointermove',22,250+k*10,300,1);}
            f('pointerup',21,90,300,0);f('pointerup',22,310,300,0);
            const zoom=N.core.M.zoom;N.core.setZoom(1);
            res({lifted,coasted,zoom});
          },300);}};
      requestAnimationFrame(step);
    });
  });
  assert.ok(motion.coasted>motion.lifted,'Two-finger scrolling coasts after the fingers lift');
  assert.ok(motion.zoom>1.2,'A pinch zooms the page');

  // A finger line already under way stays when a second finger lands; the
  // brief first contact of a pinch does not become a stroke.
  const kept=await page.evaluate(()=>new Promise(res=>{
    N.core.S.settings.touchDraw=true;N.ink.setTool('pen');
    const c=document.getElementById('c-ink'),n0=N.core.S.strokes.length;
    const f=(n,id,x,y,b)=>c.dispatchEvent(new PointerEvent(n,{pointerId:id,pointerType:'touch',isPrimary:id===31,clientX:x,clientY:y,button:n==='pointermove'?-1:0,buttons:b,width:50,height:50,pressure:.5,bubbles:true}));
    f('pointerdown',31,200,400,1);
    let i=0;const step=()=>{i++;f('pointermove',31,200+i*8,400+i*2,1);if(i<12)requestAnimationFrame(step);else setTimeout(()=>{
      f('pointerdown',32,300,500,1);f('pointerup',31,200+i*8,400+i*2,0);f('pointerup',32,300,500,0);
      const afterLong=N.core.S.strokes.length;
      f('pointerdown',41,200,600,1);f('pointermove',41,203,600,1);f('pointerdown',42,300,700,1);
      for(let k=1;k<=4;k++){f('pointermove',41,200-k*10,600,1);f('pointermove',42,300+k*10,700,1);}
      f('pointerup',41,160,600,0);f('pointerup',42,340,700,0);N.core.setZoom(1);
      res({n0,afterLong,afterBrief:N.core.S.strokes.length});
    },200);};
    requestAnimationFrame(step);
  }));
  assert.equal(kept.afterLong,kept.n0+1,'A finger stroke in progress is kept when another finger lands');
  assert.equal(kept.afterBrief,kept.afterLong,'The first contact of a pinch is not a stroke');

  // Autosave is silent; an explicit save still confirms.
  const quiet=await page.evaluate(async()=>{
    document.querySelector('#status').textContent='';   // the recovery save above legitimately said Saved
    N.core.S.lines[0].text='quiet';N.core.markDirty();await N.core.save();
    const auto=document.querySelector('#status').textContent;
    await N.core.save({announce:true});
    return {auto,explicit:document.querySelector('#status').textContent};
  });
  assert.equal(quiet.auto,'','Autosave does not flash a status');
  assert.equal(quiet.explicit,'saved.','An explicit save confirms');

  console.log('UX audit regressions passed: focused errors, native typing undo, graph persistence/export/samples, mobile reach, image manipulation, safe import recovery, panel motion, text-tool taps, scroll momentum, pinch zoom, and quiet autosave');
}finally{
  await context.close();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
