import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block'});
 const source=(await readFile(new URL('../nota.js',import.meta.url),'utf8')).replace('N.nota={','N.nota={stream,');
 await page.route('**/nota.js',r=>r.fulfill({contentType:'application/javascript',body:source}));
 const calls=[];
 const sse=text=>'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n';
 let failVision=false;
 await page.route('**/nota/chat',async route=>{
  const body=route.request().postDataJSON();calls.push(body);
  if(failVision&&Array.isArray(body.messages[1].content))return route.fulfill({status:400,body:'pictures refused'});
  return route.fulfill({contentType:'text/event-stream',body:sse('answer')});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.nota?.recall&&N.core?.Store);
 /* three other notes: one on photosynthesis in ink and words, one on the
    French revolution, one the bin holds */
 await page.evaluate(async()=>{
  const C=N.core,now=Date.now();
  const ink=[];for(let i=0;i<12;i++)ink.push(40+i*8,80+Math.sin(i)*6,0.5);
  const docs=[
   {id:'bio1',title:'photosynthesis',updated:now-1000,lines:[{id:'l1',y:40,text:'light + water + carbon dioxide -> glucose + oxygen'},{id:'l2',y:80,text:'happens in the chloroplasts'}],
    strokes:[{id:'s1',author:'user',w:2.4,pts:ink,bbox:[40,74,128,86]}],images:[],textTranscripts:[{hash:'h',text:'chlorophyll is green',confidence:0.9}],transcripts:[]},
   {id:'hist1',title:'french revolution',updated:now-5000,lines:[{id:'l3',y:40,text:'1789 storming of the bastille'}],strokes:[],images:[],textTranscripts:[],transcripts:[]},
   {id:'gone1',title:'photosynthesis draft',updated:now,lines:[{id:'l4',y:40,text:'old'}],strokes:[],images:[],textTranscripts:[],transcripts:[]}
  ];
  for(const d of docs)await C.Store.set('notas.note.'+d.id,{...d,created:d.updated,rev:1});
  const rows=docs.map(d=>({id:d.id,title:d.title,updated:d.updated,created:d.updated,preview:d.lines[0].text}));
  rows[2].trashed=now;
  await C.Store.putIndex([...(await C.Store.index()),...rows]);
 });
 const recall=(q,pictures)=>page.evaluate(async({q,pictures})=>{
  const m=await N.nota.recall(q,pictures);
  return m&&m.notes.map(n=>({id:n.id,title:n.title,text:n.text,picture:!!n.picture&&n.picture.url.startsWith('data:image/jpeg;base64,')}));
 },{q,pictures});

 /* "my notes" brings the notes, the matching one first; the bin is left out */
 let notes=await recall('test me on my notes about photosynthesis',false);
 assert.equal(notes[0].id,'bio1');
 assert.ok(!notes.some(n=>n.id==='gone1'),'a trashed note is never recalled');
 assert.match(notes[0].text,/chloroplasts/);
 assert.match(notes[0].text,/chlorophyll is green/,'handwriting readings are part of the note');
 /* "test me" with no topic still recalls the latest notes */
 notes=await recall('quiz me on my notes',false);
 assert.deepEqual(notes.map(n=>n.id).sort(),['bio1','hist1']);
 /* a note named by its title is recalled without saying "notes" */
 notes=await recall('what year was the french revolution',false);
 assert.deepEqual(notes.map(n=>n.id),['hist1']);
 /* a question about something else recalls nothing */
 assert.equal(await recall('what is 12 times 7',false),null);
 /* for the vision model the notes are pictured */
 notes=await recall('test me on my notes about photosynthesis',true);
 assert.ok(notes[0].picture,'the vision model gets a picture of the note');

 const ask=picture=>page.evaluate(async picture=>{
  const memory=await N.nota.recall('test me on my notes about photosynthesis',true);
  let text='';
  await N.nota.stream('test me on my notes about photosynthesis','page context',p=>text+=p,new AbortController().signal,
    picture?{url:'data:image/jpeg;base64,AAAA',w:1,h:1}:null,memory);
  return text;
 },picture);

 /* qwen: the page's picture and one note's picture, two at most */
 calls.length=0;assert.equal(await ask(true),'answer');
 assert.deepEqual(calls.map(c=>c.model),['qwen-3.8-27b']);
 let parts=calls[0].messages[1].content;
 assert.equal(parts.filter(p=>p.type==='image_url').length,2);
 assert.match(parts[0].text,/shown in picture 1 after the page/);
 assert.ok(!/chloroplasts/.test(parts[0].text),'a pictured note is not also sent as words');
 /* with no page picture, the notes are the pictures */
 calls.length=0;assert.equal(await ask(false),'answer');
 parts=calls[0].messages[1].content;
 assert.ok(parts.filter(p=>p.type==='image_url').length>=1&&parts.filter(p=>p.type==='image_url').length<=2);
 /* pictures refused: the question goes again as words, the notes with it */
 failVision=true;calls.length=0;assert.equal(await ask(true),'answer');
 assert.equal(typeof calls.at(-1).messages[1].content,'string');
 assert.match(calls.at(-1).messages[1].content,/chloroplasts/);
 /* a text model is given the notes as words */
 failVision=false;calls.length=0;
 await page.evaluate(async()=>{
  const memory=await N.nota.recall('test me on my notes about photosynthesis',false);
  const was=N.nota.config.model;N.nota.config.model='gpt-oss-120b';
  try{await N.nota.stream('test me on my notes','page context',()=>{},new AbortController().signal,null,memory);}finally{N.nota.config.model=was;}
 });
 assert.equal(typeof calls[0].messages[1].content,'string');
 assert.match(calls[0].messages[1].content,/\[note "photosynthesis"[\s\S]*chloroplasts/);
 console.log('Notes memory passed: recall by "my notes", test/quiz and title, trash left out, pictures for qwen within two, words for a text model and on fallback.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
