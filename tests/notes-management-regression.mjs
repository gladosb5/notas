import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
try{
  for(const width of [1440,1180,820,390]){
    const context=await browser.newContext({viewport:{width,height:820},serviceWorkers:'block',hasTouch:width<1100});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(base+'/notas.html');
    await page.waitForFunction(()=>window.N?.library&&N.core.S.id);
    await page.evaluate(async()=>{
      N.tutorial?.finish(false);N.core.S.settings.aiOn=false;N.ai.toggle();
      const notes=Array.from({length:100},(_,i)=>({title:i===0?'exam scope (before a big change)':`lesson ${i}`,
        created:Date.now()-100000,updated:Date.now()-i*1000,strokes:[],images:[],localVersion:2,
        lines:[{id:'line-'+i,y:120,text:`topic ${i} study notes`}],folder:i===1?'biology':''}));
      await N.library.importBundle({notasBundle:1,notes});
      const ix=await N.core.Store.index();await N.ui.openNote(ix.find(r=>/exam scope/.test(r.title)).id);
    });
    await page.locator('#brand').click();
    await page.waitForFunction(()=>N.library.mode==='overview'&&!document.documentElement.classList.contains('library-transition'));
    assert.equal(await page.locator('.note-row').count(),100);
    assert.equal(await page.locator('.lib-close').isVisible(),false,'no redundant overview back button');
    assert.equal(await page.locator('#lib-current-title').textContent(),'exam scope');
    const layout=await page.locator('.note-row').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom};}));
    for(let i=0;i<layout.length;i++){
      assert.ok(layout[i].h>100,'every card is readable at '+width);
      for(let j=i+1;j<layout.length;j++){
        const a=layout[i],b=layout[j];
        assert.ok(a.x+a.w<=b.x+1||b.x+b.w<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,'cards do not overlap at '+width);
      }
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('.lib-chip[data-view="f:biology"]').click();
    await page.locator('#search').fill('topic 0');
    await page.waitForFunction(()=>document.querySelectorAll('.note-row').length===1&&document.querySelector('.lib-name')?.textContent==='exam scope');
    assert.equal(await page.locator('.lib-chips').isVisible(),false,'search hides folders and create folder');
    await page.locator('#search').fill('');
    assert.equal(await page.locator('.lib-chips').isVisible(),true);
    await page.locator('.lib-chip[data-view="all"]').click();
    const before=await page.evaluate(()=>N.core.S.id);
    await page.locator('.note-row[aria-current="true"] .lib-more').click();
    await page.locator('.lib-pop .mi, .sheet .mi',{hasText:'move to trash'}).click();
    await page.waitForFunction(id=>N.core.S.id!==id&&document.querySelector('#lib-current-preview').dataset.id===N.core.S.id,before);
    assert.equal(await page.locator('#lib-current-title').textContent(),'lesson 1','deletion immediately switches preview title');
    await page.waitForFunction(()=>document.querySelectorAll('.note-row').length===99);
    assert.equal(await page.locator('.note-row').count(),99);
    await page.waitForFunction(()=>document.querySelector('#lib-current-preview img'));
    if(width===1180){await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/notes-100-tablet.png'});}
    assert.deepEqual(errors,[]);
    await context.close();
  }

  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
  const page=await context.newPage(),calls=[];
  await context.route(/\/nota\/chat$|api\.cerebras\.ai/,async route=>{
    calls.push(JSON.parse(route.request().postData()));
    await route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'This follows from the earlier explanation.'}}]})+'\n\ndata: [DONE]\n\n'});
  });
  await page.goto(base+'/notas.html');await page.waitForFunction(()=>window.N?.nota&&N.core.S.id);
  const note=await page.evaluate(async()=>{
    N.tutorial?.finish(false);N.core.S.settings.aiOn=false;N.ai.toggle();
    const C=N.core,S=C.S;
    S.lines=[{id:'student',y:220,text:'Explain plants'},{id:'prior-typed',y:280,text:'Chlorophyll absorbs light.',tutor:true}];
    S.textTranscripts=[{hash:'ink-title',text:'Photosynthesis',confidence:.9,bbox:[10,80,300,110]}];
    N.ui.refreshTitle();
    const title=document.querySelector('#title').textContent;
    S.title='biology';
    const writer=N.nota.Writer({x:10,y:380,rowH:24,instant:true});
    writer.feed('Plants turn light into chemical energy.');writer.finish();
    C.markDirty();await C.save();
    return {id:S.id,title,serialized:C.serialize()};
  });
  assert.equal(note.title,'Photosynthesis','earlier ink supplies the automatic title');
  assert.deepEqual(note.serialized.textTranscripts[0].bbox,[10,80,300,110],'ink title geometry persists');
  assert.ok(note.serialized.strokes.some(st=>st.notaText==='Plants turn light into chemical energy.'),'handwritten reply stores its words');
  await page.reload();await page.waitForFunction(id=>window.N?.nota&&N.core.S.id===id,note.id);
  await page.evaluate(()=>{
    const S=N.core.S;
    S.lines.push({id:'follow-up',y:700,text:'hey nota, explain your previous answers further'});
    N.text.render();N.mathcore.run();N.nota.onTyped(S.lines.find(l=>l.id==='follow-up'));
  });
  await page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&l.text.includes('earlier explanation')));
  const content=calls[0].messages[1].content;
  const words=typeof content==='string'?content:content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
  assert.match(words,/\[nota reply\] Chlorophyll absorbs light/,'typed reply reaches the actual follow-up request after reload');
  assert.match(words,/\[nota reply\] Plants turn light into chemical energy/,'handwritten reply reaches the actual follow-up request after reload');
  await page.evaluate(()=>{
    const S=N.core.S,st=S.strokes.find(st=>st.notaGroup&&!st.notaText);S.strokes=S.strokes.filter(s=>s.id!==st.id);
  });
  assert.doesNotMatch(await page.evaluate(()=>N.nota.context()),/Plants turn light into chemical energy/,'erased reply is not sent as intact text');
  await page.evaluate(()=>N.ui.newNote());
  assert.doesNotMatch(await page.evaluate(()=>N.nota.context()),/Chlorophyll|chemical energy/,'replies do not leak into another note');
  await context.close();
  console.log('notes management: 100-card layouts, global search, deletion preview, ink titles, saved typed and ink follow-up context pass');
}finally{await browser.close();server.close();}
