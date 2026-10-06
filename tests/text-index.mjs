// A note that is not open gets its handwriting read for search in the
// background: the transcripts land beside the stored note, its revision is
// untouched, and the pass is remembered so it is not repeated.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
let browser;
try{
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
  const page=await (await browser.newContext()).newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.locator('#local-status').filter({hasText:'handwriting ready.'}).waitFor({state:'attached',timeout:180000});
  const result=await page.evaluate(async()=>{
    N.tutorial.finish(false);
    const C=N.core;
    // the same word tests/browser.mjs has PP-OCR read, stored as a note of its own
    const w=[[[420,60],[420,110],[430,90],[445,88],[450,110]],[[462,62],[462,110]],
             [[475,60],[475,110]],[[488,60],[488,110]],[[505,85],[500,105],[515,112],[522,95],[512,82]]];
    const strokes=w.map((pts,i)=>({id:'w'+i,author:'user',w:2.8,t0:99+i,t1:100+i,pts:pts.flatMap(([x,y])=>[x,y,.5]),
      bbox:[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))]}));
    const doc={id:'bgnote1',title:'an old note',created:1000,updated:2000,rev:3,strokes,lines:[{id:'l1',y:120,text:''}],images:[],docH:1600,localVersion:2,transcripts:[],textTranscripts:[]};
    await C.Store.set('notas.note.'+doc.id,doc);
    const ix=await C.Store.index(); ix.push({id:doc.id,title:doc.title,updated:doc.updated}); await C.Store.putIndex(ix);
    const groups=N.recog.textGroupsOfDoc(doc).groups.length;
    await N.recog.indexOthers();
    const stored=await C.Store.get('notas.note.'+doc.id),record=await C.Store.get('notas.textindex');
    const hit=N.ui.searchHit(stored,(stored.textTranscripts[0]||{}).text||'');
    await N.recog.indexOthers();     /* a second pass finds the record and reads nothing */
    return {groups,rev:stored.rev,updated:stored.updated,transcripts:stored.textTranscripts,record:record&&record.notes,version:record&&record.version,
      textVersion:N.recog.textVersion,hit,openUntouched:!N.core.S.textTranscripts.length};
  });
  console.log('background text index:',JSON.stringify(result));
  assert.equal(result.groups,1,'the word is one line to read');
  assert.equal(result.transcripts.length,1,'the stored note got its transcript');
  assert.ok(result.transcripts[0].text,'the transcript has text');
  assert.equal(result.transcripts[0].modelVersion,result.textVersion,'under the current text model');
  assert.equal(result.rev,3,'the note\'s revision is untouched');
  assert.equal(result.updated,2000,'and so is its last-changed time');
  assert.equal(result.record.bgnote1,2000,'the pass is remembered against the note\'s last change');
  assert.equal(result.version,result.textVersion);
  assert.ok(result.hit&&result.hit.kind==='handwriting','search finds the note by its handwriting: '+JSON.stringify(result.hit));
  assert.ok(result.openUntouched,'the open note is not given the other note\'s transcripts');
  assert.deepEqual(errors,[],'no page errors');
  console.log('background text index: passed');
}finally{
  if(browser)await browser.close();
  server.close();
}
