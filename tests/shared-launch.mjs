import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
const errors=[];
await mkdir('test-results',{recursive:true});
async function person(standalone){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1024,height:768}});
  await context.addInitScript(standalone=>{
    Object.defineProperty(navigator,'platform',{value:'MacIntel'});
    Object.defineProperty(navigator,'maxTouchPoints',{value:5});
    Object.defineProperty(navigator,'standalone',{value:standalone});
    try{
      localStorage.setItem('notas.tut','done');localStorage.setItem('notas.collab.name','launch test');
      localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:false}));
    }catch{}
  },standalone);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  return {context,page};
}
try{
  // The installed app must open its notebook even if the sharing bundle
  // never arrives. Loading the collaboration connection is separate work.
  {
    const {context,page}=await person(true);
    await context.addInitScript(()=>{const native=setTimeout;window.setTimeout=(fn,ms,...args)=>native(fn,ms===12000?800:ms,...args);});
    let release;const held=new Promise(resolve=>release=resolve);
    await page.route('**/assets/collab.js',async route=>{await held;await route.continue().catch(()=>{});});
    try{
      await page.goto(base+'/notas.html?share=abcdefgh&gen=launch-test',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('#preparing.done'),null,{timeout:5000});
      assert.equal(await page.evaluate(()=>N.core.S.id),'abcdefgh');
      await page.evaluate(()=>{N.text.add(190,true);});await page.keyboard.insertText('writing while sharing loads');
      assert.ok(await page.evaluate(()=>N.core.S.lines.some(line=>line.text==='writing while sharing loads')));
      await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('sharing took too long'));
      assert.equal(await page.evaluate(()=>N.collab.room),null,'stalled script reports a retry instead of keeping a partial room');
      await page.screenshot({path:'test-results/shared-launch-slow-bundle.png'});
    }finally{release();await context.close();}
  }
  // A blocked collaboration database also has a bounded wait. Its late
  // completion must not restart a stopped room or replace locally saved work.
  {
    const {context,page}=await person(true);
    await context.addInitScript(()=>{const native=setTimeout;window.setTimeout=(fn,ms,...args)=>native(fn,ms===12000?800:ms,...args);});
    const bundle=await readFile(new URL('../assets/collab.js',import.meta.url),'utf8');
    await page.route('**/assets/collab.js',route=>route.fulfill({contentType:'text/javascript',body:bundle+`\nwindow.Yjs={...window.Yjs,IndexeddbPersistence:class extends window.Yjs.IndexeddbPersistence{constructor(...args){super(...args);this.whenSynced=new Promise(resolve=>window.releaseSharedStorage=resolve);}}};`}));
    try{
      await page.goto(base+'/notas.html?share=qrstuvwx&gen=launch-test',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.releaseSharedStorage&&document.querySelector('#preparing.done'));
      await page.evaluate(async()=>{N.core.S.lines[0].text='kept during a blocked shared database';N.core.markDirty();await N.core.save();});
      await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('saved copy could not be read in time'));
      assert.equal(await page.evaluate(()=>N.collab.room),null);
      assert.equal(await page.evaluate(async()=>{
        const copies=(await N.core.Store.index()).filter(row=>row.id!=='qrstuvwx');
        for(const row of copies)if((await N.core.Store.get('notas.note.'+row.id))?.lines.some(line=>line.text==='kept during a blocked shared database'))return true;
        return false;
      }),true,'unsynced writing has an ordinary safety copy before any later retry');
      await page.evaluate(()=>window.releaseSharedStorage());
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>N.collab.room),null,'late database readiness cannot restart the room');
      assert.equal(await page.evaluate(async()=>(await N.core.Store.get('notas.note.qrstuvwx')).lines[0].text),'kept during a blocked shared database');
    }finally{await context.close();}
  }
  // A Safari handoff must never wait behind the launch drawing. Suspend
  // animation callbacks after the logo starts, then allow storage to load.
  {
    const {context,page}=await person(false);
    let release;const held=new Promise(resolve=>release=resolve);
    await page.route('**/assets/idb.js',async route=>{await held;await route.continue().catch(()=>{});});
    try{
      await page.goto(base+'/notas.html?share=ijklmnop&gen=launch-test',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>Number(document.querySelector('#prep-art').dataset.frame)>=8);
      await page.evaluate(()=>{window.originalRAF=requestAnimationFrame;window.requestAnimationFrame=()=>0;});
      release();
      await page.waitForFunction(()=>document.querySelector('[data-apple-shared]'));
      await page.waitForFunction(()=>document.querySelector('#preparing.done'),null,{timeout:3000});
      assert.equal(await page.evaluate(()=>N.collab.room),null);
      await page.locator('#apple-shared-copy').click();
      assert.equal(await page.locator('#preparing').isVisible(),false);
      await page.evaluate(()=>window.requestAnimationFrame=window.originalRAF);
      await page.screenshot({path:'test-results/shared-launch-handoff.png'});
    }finally{release();await context.close();}
  }
  assert.deepEqual(errors,[]);
  console.log('Shared startup: stalled bundle/database recover without blocking or losing work; suspended animation cannot hide the Safari handoff.');
}finally{
  await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
