// nota looks up the notebook's other notes itself: the model calls
// list_notes and read_note, the page answers them from its own notebook, and
// the answer follows. A call is never written on the page, whether the
// provider parsed it or it came back as <tool_call> text; when the calls
// fail, the question ends quietly. The model is a scripted SSE stream, so
// this runs offline.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';
import {TOOLS,TOOL_ROUNDS,TOOL_CALLS} from '../server/nota-body.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block'});
 page.on('pageerror',e=>{throw e;});
 const source=(await readFile(new URL('../nota.js',import.meta.url),'utf8')).replace('N.nota={','N.nota={stream,');
 await page.route('**/nota.js',r=>r.fulfill({contentType:'application/javascript',body:source}));
 const calls=[];let script=[];
 const chunk=delta=>'data: '+JSON.stringify({choices:[{delta}]})+'\n\n';
 const sse=deltas=>deltas.map(chunk).join('')+'data: [DONE]\n\n';
 const words=text=>text.split(/(?<= )/).map(content=>({content}));
 const toolCall=(id,name,args)=>[{tool_calls:[{index:0,id,type:'function',function:{name,arguments:''}}]},...args.match(/.{1,7}/g).map(a=>({tool_calls:[{index:0,function:{arguments:a}}]}))];
 await page.route('**/nota/chat',async route=>{
  const body=route.request().postDataJSON();calls.push(body);
  const next=script.shift()||{deltas:words('fallback answer')};
  if(next.status)return route.fulfill({status:next.status,contentType:'text/plain',body:'refused'});
  return route.fulfill({contentType:'text/event-stream',body:sse(next.deltas)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.nota?.tools&&N.core?.Store);
 await page.evaluate(async()=>{
  const C=N.core,now=Date.now();
  const docs=[
   {id:'bio1',title:'photosynthesis',updated:now-1000,lines:[{id:'l1',y:40,text:'light + water + carbon dioxide -> glucose + oxygen'},{id:'l2',y:80,text:'happens in the chloroplasts'}],strokes:[],images:[],textTranscripts:[{hash:'h',text:'chlorophyll is green',confidence:0.9}],transcripts:[]},
   {id:'hist1',title:'french revolution',updated:now-5000,lines:[{id:'l3',y:40,text:'1789 storming of the bastille'}],strokes:[],images:[],textTranscripts:[],transcripts:[]},
   {id:'gone1',title:'photosynthesis draft',updated:now,lines:[{id:'l4',y:40,text:'old'}],strokes:[],images:[],textTranscripts:[],transcripts:[]}
  ];
  for(const d of docs)await C.Store.set('notas.note.'+d.id,{...d,created:d.updated,rev:1});
  const rows=docs.map(d=>({id:d.id,title:d.title,updated:d.updated,created:d.updated,preview:d.lines[0].text}));
  rows[2].trashed=now;
  await C.Store.putIndex([...(await C.Store.index()),...rows]);
 });
 const ask=(question='test me on my notes about photosynthesis')=>page.evaluate(async question=>{
  let text='';const pieces=[],grabs=[];
  try{
   await N.nota.stream(question,'page context',p=>{text+=p;pieces.push(p);},new AbortController().signal,null,{onGrab:()=>grabs.push(document.querySelector('#nota-receipt')?.textContent||'')});
   return {text,pieces,grabs:grabs.length};
  }catch(e){return {text,pieces,grabs:grabs.length,failed:!!e.toolsFailed,error:String(e.message)};}
 },question);

 assert.deepEqual(await page.evaluate(()=>N.nota.tools),TOOLS,'the page and the forward offer the same tools');
 assert.deepEqual(await page.evaluate(()=>N.nota.toolLimits),{rounds:TOOL_ROUNDS,calls:TOOL_CALLS},'and allow the same rounds and calls');

 /* the provider parses the calls: list, read, answer */
 script=[{deltas:toolCall('call_a','list_notes','{"query":"photosynthesis"}')},{deltas:[{content:''},...toolCall('call_b','read_note','{"id":"bio1"}')]},{deltas:words('1. Where does photosynthesis happen?')}];
 calls.length=0;
 let got=await ask();
 assert.equal(got.text,'1. Where does photosynthesis happen?');
 assert.equal(got.grabs,2,'each round of calls is told');
 assert.equal(calls.length,3);
 assert.ok(calls.every(c=>c.tools&&c.tools.length===2),'the tools go with every round');
 assert.match(calls[0].messages[0].content,/list_notes/);
 const listed=JSON.parse(calls[1].messages.at(-1).content);
 assert.equal(calls[1].messages.at(-1).role,'tool');assert.equal(calls[1].messages.at(-1).tool_call_id,'call_a');
 assert.equal(listed.notes[0].id,'bio1','the matching note first');
 assert.ok(!listed.notes.some(n=>n.id==='gone1'),'the bin is not listed');
 assert.deepEqual(calls[1].messages.at(-2).tool_calls,[{id:'call_a',type:'function',function:{name:'list_notes',arguments:'{"query":"photosynthesis"}'}}]);
 const read=JSON.parse(calls[2].messages.at(-1).content);
 assert.match(read.text,/chloroplasts/);assert.match(read.text,/chlorophyll is green/,'handwriting readings are part of the note');
 assert.equal(calls[2].messages.length,6,'system, question, then two calls and their results');

 /* a call the provider did not parse, written out as text in pieces: read
    here, and never part of the answer */
 const raw='<tool_call>\n{"name": "read_note", "arguments": {"id": "hist1"}}\n</tool_call>';
 script=[{deltas:[{content:'  '},...raw.match(/.{1,5}/gs).map(content=>({content}))]},{deltas:words('The Bastille fell in 1789.')}];
 calls.length=0;
 got=await ask('hey what year did my french revolution notes say');
 assert.equal(got.text,'The Bastille fell in 1789.');
 assert.ok(!got.pieces.join('').includes('tool'),'the call never reaches the page');
 assert.equal(got.grabs,1);
 assert.equal(calls[1].messages.at(-2).content.trim(),raw.trim());
 assert.match(calls[1].messages.at(-1).content,/^<tool_response>[\s\S]*1789 storming of the bastille[\s\S]*<\/tool_response>$/);

 /* a short answer comes whole once the round ends; a long one streams
    once past the first words held back */
 script=[{deltas:words('12 x 7 = 84.')}];calls.length=0;
 got=await ask('what is 12 times 7');
 assert.equal(got.text,'12 x 7 = 84.');
 assert.equal(got.grabs,0);
 const long='Photosynthesis is how a plant makes its own food. It takes in light, water and carbon dioxide, and makes sugar and oxygen. '.repeat(3).trim();
 script=[{deltas:words(long)}];
 got=await ask('what is photosynthesis');
 assert.equal(got.text,long);
 assert.ok(got.pieces.length>10,'the rest streams word by word: '+got.pieces.length);

 /* words before a call ("let me check your notes") are never written */
 script=[{deltas:[...words('Let me check your notes first. '),...toolCall('p1','read_note','{"id":"bio1"}')]},{deltas:words('Plants make food in the chloroplasts.')}];
 got=await ask();
 assert.equal(got.text,'Plants make food in the chloroplasts.');
 assert.ok(!/check your notes/.test(got.pieces.join('')),'the preamble never reaches the page');

 /* calls that make no sense, more rounds than allowed, or nothing answered
    after calls: the tools fail, and nothing was written */
 script=[{deltas:toolCall('c1','read_note','{"id":"nope"}')},{deltas:toolCall('c2','fetch_url','{}')},{deltas:toolCall('c3','read_note','not json')}];
 got=await ask();assert.ok(got.failed,'calls that make no sense: '+got.error);assert.equal(got.text,'');
 script=[1,2,3,4].map(i=>({deltas:toolCall('r'+i,'list_notes','{}')}));calls.length=0;
 got=await ask();assert.ok(got.failed,'too many rounds: '+got.error);
 assert.equal(calls.length,4);assert.equal(calls[3].tool_choice,'none','the last round may not call');
 script=[{deltas:toolCall('e1','list_notes','{}')},{deltas:[{content:'  '}]}];
 got=await ask();assert.ok(got.failed,'nothing answered after the calls: '+got.error);
 /* a refused request is an ordinary error, not a failure of the tools */
 script=[{status:400},{status:400}];
 got=await ask();assert.ok(!got.failed&&got.error==='refused','a refused request: '+got.error);

 /* through the page: the receipt says notes are being fetched while the
    paper plays, and never shows a raw call */
 const seen=[],toasts=[];
 await page.exposeFunction('__receipt',t=>seen.push(t));
 await page.exposeFunction('__toast',t=>toasts.push(t));
 await page.evaluate(()=>{
  const r=document.getElementById('nota-receipt');
  new MutationObserver(()=>window.__receipt((r.querySelector('.nota-think')?.hidden?'':'[playing] ')+r.textContent)).observe(r,{subtree:true,childList:true,characterData:true,attributes:true});
  const toast=N.core.toast;N.core.toast=(t,...rest)=>{window.__toast(String(t));return toast(t,...rest);};
  N.tutorial?.finish?.(false);localStorage.setItem('notas.nota.key','csk-test-0123456789');
 });
 const typed=(id,y,text)=>page.evaluate(({id,y,text})=>{const ln={id,x:0,y,text};N.core.S.lines.push(ln);N.nota.onTyped(ln);},{id,y,text});
 calls.length=0;
 script=[{deltas:toolCall('t1','read_note','{"id":"bio1"}')},{deltas:words('Where do plants make food?')}];
 await typed('q1',200,'hey nota, test me on my notes about photosynthesis');
 await page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&/plants make food/.test(l.text||'')),null,{timeout:20000});
 assert.ok(seen.some(t=>t==='[playing] nota is grabbing your notes for its reference.'),'the receipt says notes are fetched, the paper playing: '+JSON.stringify(seen));
 assert.ok(!seen.some(t=>/tool|read_note|\{/.test(t)),'no raw call is shown');
 assert.equal(calls.length,2);
 let reply=await page.evaluate(()=>N.core.S.lines.filter(l=>l.tutor).map(l=>l.text).join('\n'));
 assert.doesNotMatch(reply,/tool|read_note/);

 /* calls that fail end the question quietly: no second try, no error */
 calls.length=0;toasts.length=0;
 script=[{deltas:toolCall('f1','read_note','{"id":"nope"}')},{deltas:toolCall('f2','read_note','{"id":"nope"}')},{deltas:toolCall('f3','read_note','{"id":"nope"}')},{deltas:words('should never be asked for')}];
 await typed('q2',400,'hey nota, what did my notes say about rivers');
 for(let i=0;i<100&&calls.length<3;i++)await page.waitForTimeout(100);
 await page.waitForFunction(()=>!N.nota.busy&&document.getElementById('nota-receipt').hidden,null,{timeout:20000});
 await page.waitForTimeout(300);
 assert.equal(calls.length,3,'no second try once the calls fail');
 assert.deepEqual(toasts,[],'no error is shown');
 reply=await page.evaluate(()=>N.core.S.lines.filter(l=>l.tutor).map(l=>l.text).join('\n'));
 assert.doesNotMatch(reply,/never be asked|tool|read_note/,'nothing is written');
 console.log('Notes tools passed: calls answered in the browser (parsed or written as text), never written down, the receipt while fetching, failed calls end quietly.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
