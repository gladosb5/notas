import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
  const context=await browser.newContext(),page=await context.newPage();
  const url=`http://127.0.0.1:${server.address().port}/notas.html`;
  await page.goto(url);await page.waitForFunction(()=>window.N?.core?.S.id);
  const first=await page.evaluate(async()=>{
    N.tutorial.finish(false);const C=N.core,S=C.S;
    S.title='Retry indexing';C.markDirty();const put=C.Store.putIndex;C.Store.putIndex=async()=>false;
    const failed=await C.save();C.Store.putIndex=put;
    const retry=await C.save();const row=(await C.Store.index()).find(r=>r.id===S.id);
    const rev=S.savedRev;await C.save();await C.save();
    return {failed,retry,row,rev,after:S.savedRev,id:S.id};
  });
  assert.equal(first.failed,false);assert.equal(first.retry,true);assert.equal(first.row.title,'Retry indexing');assert.equal(first.after,first.rev);
  const lock=await page.evaluate(async()=>{
    const C=N.core;const original=navigator.locks.request.bind(navigator.locks);
    navigator.locks.request=()=>Promise.reject(Error('lock rejected'));
    C.S.title='After rejected lock';C.markDirty();const failed=await C.save();navigator.locks.request=original;
    return {failed,retried:await C.save(),title:(await C.Store.read('notas.note.'+C.S.id)).title};
  });
  assert.deepEqual(lock,{failed:false,retried:true,title:'After rejected lock'});
  const peer=await context.newPage();await peer.goto(url);await peer.waitForFunction(()=>window.N?.core?.S.id);
  await peer.evaluate(id=>N.ui.openNote(id),first.id);
  await page.evaluate(async()=>{N.core.S.title='Fresh peer title';N.core.markDirty();await N.core.save();});
  await peer.waitForFunction(()=>N.core.S.title==='Fresh peer title');
  const clean=await peer.evaluate(async()=>{const C=N.core,rev=C.S.savedRev;await C.save();return {id:C.S.id,rev,after:C.S.savedRev,rows:await C.Store.index()};});
  assert.equal(clean.id,first.id);assert.equal(clean.after,clean.rev);assert.ok(!clean.rows.some(r=>/conflict copy/.test(r.title)));
  const index=await page.evaluate(async()=>{
    const C=N.core;await C.patchIndexRows([C.S.id],()=>({folder:'school',pinned:true,trashed:123}));
    await C.Store.putIndex([]);await C.repairIndex();return (await C.Store.index())[0];
  });
  assert.equal(index.folder,'school');assert.equal(index.pinned,true);assert.equal(index.trashed,123);
  await page.evaluate(()=>N.core.patchIndexRows([N.core.S.id],()=>({trashed:undefined})));
  const rescue=await page.evaluate(async()=>{
    const C=N.core;C.S.title='Last unsaved words';C.markDirty();C.rescueSave();
    // Simulate termination before the queued write reaches IndexedDB.
    C.S.dirty=false;await C.recoverRescues();return (await C.Store.index()).map(r=>r.title);
  });
  assert.ok(rescue.includes('Last unsaved words'));
  const fidelity=await page.evaluate(async()=>{
    const C=N.core;const raw={localVersion:2,title:'Imported',created:123456789,folder:'school',strokes:[],lines:[{id:'one',text:'hello',y:120,h:30}],images:[]};
    const ok=await N.ui.importNoteFile(new File([JSON.stringify(raw)],'note.json'));
    const row=(await C.Store.index()).find(r=>r.id===C.S.id);
    return {ok,created:C.S.created,folder:row.folder,invalid:C.whenLabel('corrupt')};
  });
  assert.deepEqual(fidelity,{ok:true,created:123456789,folder:'school',invalid:'unknown date'});
  const eraser=await page.evaluate(()=>{
    const C=N.core;C.S.lines=[{id:'zero',y:120,text:'a\u200bb',h:30}];N.text.render();
    return N.text.eraseCharacters(()=>true,20).map(e=>e.after);
  });
  assert.deepEqual(eraser,['']);
  const pages=await page.evaluate(async()=>{
    const C=N.core;C.S.lines=[{id:'long',y:100000,text:'last line',h:30}];N.text.render();
    let rejected=false;try{await N.ui.renderExport();}catch{rejected=true;}
    const canvas=await N.ui.renderExport({top:99000,height:1200});return {rejected,width:canvas.width,height:canvas.height,column:C.M.colW};
  });
  assert.equal(pages.rejected,true);assert.ok(pages.width>=pages.column);assert.ok(pages.height>=1200);
  await context.close();console.log('Storage edges passed: retry, rejected lock, clean peer reload, metadata repair, rescue, import, eraser, readable export pages.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
