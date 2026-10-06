import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
let browser,context;
try{
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
  context=await browser.newContext();
  const page=await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.core?.S.id && window.idbKeyval);
  const result=await page.evaluate(async()=>{
    N.tutorial.finish(false);
    const C=N.core,S=C.S;
    await C.save();
    const first=S.id;
    S.title='Saved before new'; C.markDirty();
    await N.ui.newNote();
    const second=S.id;
    S.title='Saved before open'; C.markDirty();
    await N.ui.openNote(first);
    const switched={first:S.title,second:(await C.Store.get('notas.note.'+second)).title};

    const originalSet=C.Store.set;
    let release,started;
    const waiting=new Promise(r=>started=r);
    C.Store.set=async(k,v)=>{
      if(k==='notas.note.'+first){started(); await new Promise(r=>release=r);}
      return originalSet(k,v);
    };
    S.title='Snapshot title'; C.markDirty();
    const saving=C.save();
    await waiting;
    const secondDoc=await C.Store.get('notas.note.'+second);
    S.id=second; S.title='Newer title'; S.savedRev=secondDoc?.rev||0; S.remoteRev=0; C.markDirty();
    release(); await saving;
    const delayed={row:(await C.Store.index()).find(r=>r.id===first),dirty:S.dirty};
    C.Store.set=originalSet;
    await C.save();

    /* an edit made while the previous save of the same note is still being
       written is saved by the next save, not taken as already written */
    let releaseOverlap,overlapStarted;
    const overlapWaiting=new Promise(r=>overlapStarted=r);
    C.Store.set=async(k,v)=>{
      if(k==='notas.note.'+S.id&&releaseOverlap===undefined){overlapStarted(); await new Promise(r=>releaseOverlap=r);}
      return originalSet(k,v);
    };
    S.title='Overlap one'; C.markDirty();
    const firstSave=C.save();
    await overlapWaiting;
    S.title='Overlap two'; C.markDirty();
    const secondSave=C.save();
    releaseOverlap(); await firstSave; await secondSave;
    C.Store.set=originalSet;
    const overlap={stored:(await C.Store.get('notas.note.'+S.id)).title,dirty:S.dirty};

    /* another note trashed while this note's save is rewriting the list of
       notes stays trashed: the save does not write back the list it read */
    const originalPut=C.Store.putIndex;
    let releaseIndex,indexHeld;
    const indexWaiting=new Promise(r=>indexHeld=r);
    C.Store.putIndex=async ix=>{
      if(releaseIndex===undefined){indexHeld(); await new Promise(r=>releaseIndex=r);}
      return originalPut.call(C.Store,ix);
    };
    S.title='Index race'; C.markDirty();
    const racingSave=C.save();
    await indexWaiting;
    const trashing=C.patchIndexRows([first],()=>({trashed:1}));
    await new Promise(r=>setTimeout(r,150));
    releaseIndex(); await racingSave; await trashing;
    C.Store.putIndex=originalPut;
    const indexRace=!!(await C.Store.index()).find(r=>r.id===first)?.trashed;
    await C.patchIndexRows([first],()=>({trashed:undefined}));

    C.Store.set=async()=>false;
    S.title='Unsaved'; C.markDirty();
    await N.ui.newNote();
    const failed={id:S.id,title:S.title,dirty:S.dirty};
    C.Store.set=originalSet;
    await C.save();

    const idb=window.idbKeyval;
    await idb.set('storage-regression',{title:'Old'});
    window.idbKeyval={...idb,set:async()=>{throw Error('quota');}};
    const saved=await C.Store.set('storage-regression',{title:'New'});
    window.idbKeyval=idb;
    const fallback=await C.Store.get('storage-regression');
    await C.Store.del('storage-regression');
    const deleted=await C.Store.get('storage-regression');
    return {switched,delayed,overlap,indexRace,failed,first,second,saved,fallback,deleted};
  });
  assert.deepEqual(result.switched,{first:'Saved before new',second:'Saved before open'});
  assert.equal(result.delayed.row.title,'Snapshot title');
  assert.equal(result.delayed.dirty,true);
  assert.equal(result.indexRace,true,'A note trashed during the save of another stays trashed');
  assert.deepEqual(result.overlap,{stored:'Overlap two',dirty:false},'An edit made during a save is written by the next save');
  assert.deepEqual(result.failed,{id:result.second,title:'Unsaved',dirty:true});
  assert.equal(result.saved,true);
  assert.deepEqual(result.fallback,{title:'New'});
  assert.equal(result.deleted,undefined);

  // Findings 11/15/20: the active note, its viewport, and device-level
  // preferences are independent pieces of state. Reopening an older note must
  // survive reload, and creating a fresh note must still start at the top.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(async id=>{
    N.core.S.settings.theme='dark';N.core.savePrefs();N.ui.applyTheme();
    await N.ui.openNote(id);
    /* at phone width the column fits the screen, so a sideways position only
       exists once the page is zoomed in; the zoom is part of the view too */
    N.core.setZoom(2);
    const sc=document.querySelector('#scroller');sc.scrollTop=333;sc.scrollLeft=222;
    N.core.saveView(id,333,222,2);N.core.setActive(id);
  },result.first);
  await page.reload();
  await page.waitForFunction(()=>window.N?.core?.S.id&&window.N?.ui?.newNote);
  const continuity=await page.evaluate(()=>({
    id:N.core.S.id,theme:N.core.S.settings.theme,
    top:document.querySelector('#scroller').scrollTop,left:document.querySelector('#scroller').scrollLeft
  }));
  assert.equal(continuity.id,result.first,'Reload reopens the explicitly active note even when another note was newer');
  assert.equal(continuity.theme,'dark','Opening a note does not overwrite the app-level theme preference');
  assert.equal(continuity.top,333,'Per-note vertical position is restored');
  assert.equal(continuity.left,222,'Per-note horizontal position is restored');
  await page.evaluate(()=>N.ui.newNote());
  assert.deepEqual(await page.evaluate(()=>({top:document.querySelector('#scroller').scrollTop,left:document.querySelector('#scroller').scrollLeft})),
    {top:0,left:0},'A new note starts at the top-left instead of inheriting the previous note viewport');
  await page.evaluate(id=>N.ui.openNote(id),result.second);
  assert.equal(await page.evaluate(()=>N.core.S.settings.theme),'dark','Theme remains device-scoped after switching again');

  const peer=await context.newPage();
  await peer.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await peer.waitForFunction(()=>window.N?.core?.S.id && window.idbKeyval);
  // Exercise the IndexedDB mutex fallback too, not only Chromium's Web Locks.
  await Promise.all([page,peer].map(p=>p.evaluate(()=>Object.defineProperty(navigator,'locks',{value:undefined,configurable:true}))));
  await Promise.all([
    page.evaluate(id=>N.ui.openNote(id),result.second),
    peer.evaluate(id=>N.ui.openNote(id),result.second)
  ]);
  const race=await Promise.all([
    page.evaluate(async()=>{N.core.S.title='Concurrent A';N.core.markDirty();return await N.core.save();}),
    peer.evaluate(async()=>{N.core.S.title='Concurrent B';N.core.markDirty();return await N.core.save();})
  ]);
  assert.deepEqual(race,[true,true]);
  const versions=await page.evaluate(async id=>{
    const rows=await N.core.Store.index(),out=[];
    for(const row of rows){
      if(row.id===id||/Concurrent [AB] \((?:conflict|recovered) copy\)/.test(row.title||'')){
        const doc=await N.core.Store.get('notas.note.'+row.id);if(doc)out.push({id:row.id,title:doc.title});
      }
    }
    return out;
  },result.second);
  assert.ok(versions.some(v=>v.title==='Concurrent A'||v.title==='Concurrent B'),'One concurrent save remains the canonical note');
  assert.ok(versions.some(v=>/Concurrent [AB] \(conflict copy\)/.test(v.title)),'The other concurrent save becomes a conflict copy');

  await peer.evaluate(id=>N.ui.openNote(id),result.second);
  const stale=await peer.evaluate(()=>({id:N.core.S.id,rev:N.core.S.savedRev,title:N.core.S.title}));
  assert.equal(stale.id,result.second);
  assert.equal(await page.evaluate(id=>N.core.deleteStoredNote(id),result.second),true);
  const recovered=await peer.evaluate(async()=>{N.core.S.title='After remote delete';N.core.markDirty();return {ok:await N.core.save(),id:N.core.S.id,title:N.core.S.title};});
  assert.equal(recovered.ok,true);
  assert.notEqual(recovered.id,result.second,'A stale tab does not resurrect a deleted note ID');
  assert.match(recovered.title,/\(recovered copy\)$/);
  assert.equal(await page.evaluate(id=>N.core.Store.get('notas.note.'+id),result.second),undefined,'Deleted canonical note stays deleted');
  await peer.close();
  console.log('Storage regressions passed: switching, delayed saves, failed saves, fallback reads, atomic concurrent saves, and delete/save recovery');
}finally{
  if(context)await context.close();
  if(browser)await browser.close();
  await new Promise(r=>server.close(r));
}
