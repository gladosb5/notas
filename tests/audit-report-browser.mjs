// Regress the audit against production functions. Hooks are injected into the
// test responses only; shipped files have no additional debug surface.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';
import {notaBody,MODEL} from '../server/nota-body.mjs';
const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1000,height:800}}),errors=[];
const html=(await readFile(new URL('../notas.html',import.meta.url),'utf8'))
 .replace('N.ui = {','N.ui = {_audit:{exportBounds,exportGuard,insertImages,loadImages},')
 .replace('N.library = {','N.library = {_audit:{L,saveFolders,loadFolders,docOf,paint,exportNotes},')
 .replace('N.ink = {',`N.ink = {_audit:{beginStroke,commitStroke,eraseAlong,layStrokes,grabStrokes,selectionBox,penTakesOver,
   scale(){scaling=startScale('se',{x:100,y:100});scaleTo({x:500,y:500});},
   twin(){twin={kind:'ink',orig:grabStrokes(S.selection)};layStrokes(twin.orig,(x,y)=>[x+100,y+100],2);},
   get scaling(){return scaling;},get twinState(){return twin;},setActive(id){activeId=id;},pointers},`)
 .replace('function drawWrapped(ctx,text,left,top,maxWidth,lineHeight){','function drawWrapped(ctx,text,left,top,maxWidth,lineHeight){if(N.exportDraws)N.exportDraws.push({text,left,top,maxWidth});');
const nota=(await readFile(new URL('../nota.js',import.meta.url),'utf8'))
 .replace('const glyph=(ch)=>{','const glyph=(ch)=>{if(N.auditChars)N.auditChars.push(ch);')
 .replace('const letters=text=>{','const letters=text=>{if(N.auditMath)N.auditMath.push(text);')
 .replace('N.nota={','N.nota={_audit:{readSSE,streamTools,fireInk,lastPenLift,inkKey,readings,answer},');
const collab=(await readFile(new URL('../collab.js',import.meta.url),'utf8'))
 .replace('N.collab._test={','N.collab._test={start,stop,flush,pullAll,');
const recog=(await readFile(new URL('../local-recognition.js',import.meta.url),'utf8'))
 .replace('function buildTextGroups(clusters,byId,frames){','function buildTextGroups(clusters,byId,frames){if(typeof N!=="undefined"&&N.groupBuilds!==undefined)N.groupBuilds++;')
 .replace('N.recog={','N.recog={_audit:{backgroundGroups},');
await context.route('**/notas.html',route=>route.fulfill({contentType:'text/html',body:html}));
for(const [file,body] of [['nota.js',nota],['collab.js',collab],['local-recognition.js',recog]])await context.route(base+'/'+file,route=>route.fulfill({contentType:'text/javascript',body}));
const ready=async page=>{
 page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/notas.html');
 await page.waitForFunction(()=>window.N?.nota&&N.core.S.id&&N.library);
 await page.evaluate(()=>{N.tutorial.finish(false);N.core.S.settings.aiOn=false;N.ai.toggle();N.core.S.settings.animations=false;});
};
const page=await context.newPage();
try{
 await ready(page);
 const writer=await page.evaluate(()=>{
  const S=N.core.S;
  const run=chunks=>{S.strokes=[];S.lines=[];S.images=[];N.auditChars=[];const w=N.nota.Writer({x:20,y:120,rowH:30,instant:true});for(const chunk of chunks)w.feed(chunk);w.finish();return N.auditChars.join('');};
  const tokens='12 - 5 = 7, so 2 + 3 = 5 and x > 3. 3 * 4, item #3 and |-3| = 3.'.split(/(?= )/);
  const result={tokens:run(tokens),emphasis:run(['A ','*very ','important* ','step.']),key1:N.nota._audit.inkKey(new Set(['a'])),key2:N.nota._audit.inkKey(new Set(['b']))};
  N.auditMath=[];run(['$𝑥+1=4$ $😀$']);result.math=N.auditMath;return result;
 });
 assert.equal(writer.tokens,'12-5=7,so2+3=5andx>3.3*4,item#3and|-3|=3.');assert.equal(writer.emphasis,'Averyimportantstep.');assert.notEqual(writer.key1,writer.key2);
 assert.ok(writer.math.includes('x'));assert.ok(writer.math.includes('😀'));assert.ok(!writer.math.some(ch=>/^[\uD800-\uDFFF]$/.test(ch)));
 console.log('F67/F68/F77: streamed operators, emphasis and ink question identity');

 const grouping=await page.evaluate(async()=>{
  const S=N.core.S;S.images=[];S.lines=[];S.strokes=Array.from({length:120},(_,i)=>({id:'cache'+i,author:'user',w:2,rev:0,t0:i*100,t1:i*100+5,pts:[20+i%6*20,100+Math.floor(i/6)*50,.5,30+i%6*20,120+Math.floor(i/6)*50,.5],bbox:[20+i%6*20,100+Math.floor(i/6)*50,30+i%6*20,120+Math.floor(i/6)*50]}));
  N.groupBuilds=0;N.recog.rebuild();const a=N.recog.textGroups();for(let i=0;i<10;i++)for(const c of S.clusters)N.recog.handwritingKind(c);
  const builds=N.groupBuilds,same=a===N.recog.textGroups(),doc=N.core.serialize(),expected=N.recog.textGroupsOfDoc(doc).groups;
  const offThread=await N.recog._audit.backgroundGroups(doc);
  S.strokes[0].pts[0]+=5;S.strokes[0].rev++;S.strokes[0].bbox[0]+=5;N.recog.rebuild();
  return {same,builds,background:JSON.stringify(offThread.groups)===JSON.stringify(expected),invalidated:a!==N.recog.textGroups()};
 });
 assert.deepEqual(grouping,{same:true,builds:1,background:true,invalidated:true});
 console.log('F04/F53/F66: cached live groups and identical worker grouping');

 const gestures=await page.evaluate(()=>{
  const C=N.core,S=C.S,a=N.ink._audit;N.ink.finishInput();S.lines=[];S.images=[];S.clusters=[];
  S.strokes=[{id:'selected',author:'user',w:2,pts:[20,100,.5,80,150,.5],bbox:[20,100,80,150]}];S.selection=['selected'];
  C.Undo.back=[];C.Undo.fwd=[];C.act('first move',()=>{S.strokes[0].pts[0]=30;},()=>{S.strokes[0].pts[0]=20;});
  const original=JSON.stringify(S.strokes[0].pts);a.scale();const preview=JSON.stringify(S.strokes[0].pts)!==original;
  C.undo();const blocked=C.Undo.back.length===1&&C.Undo.fwd.length===0;
  N.ink.finishInput();const restored=JSON.stringify(S.strokes[0].pts)===original&&S.strokes[0].w===2&&!a.scaling;
  a.twin();a.penTakesOver();const twin=JSON.stringify(S.strokes[0].pts)===original&&S.strokes[0].w===2&&!a.twinState;
  S.strokes=[];S.selection=['missing'];const before=C.Undo.back.length,deleted=N.ink.deleteSelection();
  S.selection=[];const ev={clientX:200,clientY:200,pressure:.5,pointerType:'pen',timeStamp:1};a.beginStroke(ev,'pen');a.beginStroke({...ev,timeStamp:2},'pen');a.commitStroke();N.ink.finishInput();
  const saved=C.serialize();S.strokes[0].pts[0]+=100;
  return {preview,blocked,restored,twin,phantom:!deleted&&before===C.Undo.back.length-2,strokes:S.strokes.length,snapshot:saved.strokes[0].pts[0]!==S.strokes[0].pts[0]};
 });
 assert.equal(gestures.preview,true);assert.equal(gestures.blocked,true);assert.equal(gestures.restored,true);assert.equal(gestures.twin,true);assert.equal(gestures.strokes,2);assert.equal(gestures.snapshot,true);assert.equal(gestures.phantom,true);
 console.log('F03/F27/F41/F42/F47/F50/F51: interrupted transforms, orphan strokes and detached snapshots');

 const exports=await page.evaluate(async()=>{
  const C=N.core,S=C.S;S.strokes=[{id:'wide',author:'user',w:2,pts:[-80,20,.5,1600,30,.5],bbox:[-80,20,1600,30]}];
  S.lines=[{id:'offset',x:-30,y:50,text:'offset text',h:30}];S.images=[{id:'rotated',x:100,y:100,w:600,h:100,rot:Math.PI/2,src:'data:image/png;base64,invalid'}];S.clusters=[];
  N.exportDraws=[];const bounds=N.ui._audit.exportBounds(),aabb=C.imageBounds(S.images[0]);
  const cv=await N.ui.renderExport({loaded:[],bounds,top:bounds.top,height:600});const width=cv.width;cv.width=cv.height=0;
  const check=N.ui._audit.exportGuard();C.markDirty();let guarded=false;try{check();}catch{guarded=true;}
  const raw={localVersion:2,title:'roundtrip',strokes:Array.from({length:40},(_,i)=>({id:'stroke'+String(i).padStart(6,'0'),author:'user',w:2,pts:[0,0,.5],bbox:[0,0,0,0]})),lines:[{id:'line',x:-40,y:100,text:'2+2',h:30}],images:[],answers:[['line:line',{key:'answer-v3|2+2|deg|0|',result:'5'}]]};
  const hash=raw.strokes.map(st=>st.id).join(',')+':abcdefg';raw.transcripts=[{hash,ascii:'2+2',confirmed:true}];raw.textTranscripts=[{hash:'text:'+hash,text:'hello'}];
  const imported=N.ui.validateImportedNote(raw);return {bounds,aabb,width,left:N.exportDraws.find(d=>d.text==='offset text').left,guarded,importX:imported.lines[0].x,answers:imported.answers.length,readings:imported.transcripts.length,text:imported.textTranscripts.length};
 });
 assert.ok(exports.bounds.width>1600);assert.ok(exports.bounds.left<=-80);assert.ok(exports.width>=exports.bounds.width);assert.equal(exports.left,-28);assert.ok(exports.aabb[3]>=449);assert.equal(exports.guarded,true);assert.equal(exports.importX,-40);assert.equal(exports.answers,0);assert.equal(exports.readings,1);assert.equal(exports.text,1);
 console.log('F02/F06/F07/F08/F09/F13/F25/F30: export extents, line offsets, import fidelity and cache trust');

 const peer=await context.newPage();await ready(peer);
 await page.evaluate(()=>{N.core.S.images=[];N.core.S.strokes=[];N.core.S.lines=[];});
 const folders=await Promise.all([page.evaluate(()=>N.library._audit.saveFolders(cur=>[...cur,'one'])),peer.evaluate(()=>N.library._audit.saveFolders(cur=>[...cur,'two']))]);assert.ok(folders.every(Boolean));
 const storage=await page.evaluate(async()=>{
  const C=N.core,L=N.library._audit,folders=await C.Store.read('notas.folders'),read=C.Store.read;
  C.Store.read=async key=>{if(key==='notas.folders')throw Error('transient read failure');return read.call(C.Store,key);};
  const failed=await L.saveFolders(()=>['bad']);C.Store.read=read;const retained=await read.call(C.Store,'notas.folders');
  const id='missingrecord123';await C.withIndexLock(async()=>{await C.Store.putIndex([...(await C.Store.index()),{id,title:'missing',updated:1}]);});localStorage.setItem('notas.view.'+id,'{}');
  const deleted=await C.deleteStoredNote(id),gone=!(await C.Store.index()).some(r=>r.id===id),view=localStorage.getItem('notas.view.'+id);
  await C.Store.set('notas.note.projection',{title:'picture note',lines:[{text:'searchable',y:120}],strokes:[{pts:[1,2,3]}],images:[{src:'a'.repeat(1000000)}]});
  const projection=await L.docOf('projection');
  return {folders,failed,retained,deleted,gone,view,projectionImages:projection.images,projectionStrokes:projection.strokes};
 });
 assert.deepEqual(storage.folders.sort(),['one','two']);assert.equal(storage.failed,false);assert.deepEqual(storage.retained.sort(),['one','two']);assert.equal(storage.deleted,true);assert.equal(storage.gone,true);assert.equal(storage.view,null);assert.equal(storage.projectionImages,undefined);assert.equal(storage.projectionStrokes,undefined);
 console.log('F26/F32/F37/F38: atomic folders, deletable missing rows and bounded search projections');

 const update=await page.evaluate(async()=>{
  const C=N.core,save=C.save,timeout=window.setTimeout,fetcher=window.fetch;C.S.dirty=true;
  window.fetch=async(url,opts)=>String(url).includes('sw.js')||String(url).includes('?update=')?new Response('<html>fresh</html>',{headers:{'Content-Type':'text/html'}}):fetcher(url,opts);
  N.ui.menuSheet();C.save=async()=>false;await document.getElementById('refresh-site').onclick();const failed=document.getElementById('toast').textContent;
  N.ui.menuSheet();C.save=()=>new Promise(()=>{});window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===15000?0:ms,...args);
  await document.getElementById('refresh-site').onclick();const timedOut=document.getElementById('toast').textContent;
  C.save=save;window.setTimeout=timeout;window.fetch=fetcher;C.S.dirty=false;return {failed,timedOut};
 });
 assert.match(update.failed,/not saved/);assert.match(update.timedOut,/not saved/);
 console.log('F01/F23: failed and timed-out saves both abort the update');

 const lifecycle=await page.evaluate(async()=>{
  const C=N.core,S=C.S;await N.ui.newNote();S.lines=[{id:'private',y:120,text:'private text',h:30}];C.markDirty();await C.save();const id=S.id;
  history.replaceState(null,'','?share='+id+'&gen=testgen1#host='+'bad'.repeat(8));await N.collab.openLink();
  const guarded=S.lines.some(l=>l.text==='private text')&&!N.collab.isShared(id)&&!localStorage.getItem('notas.collab.host.'+id);
  localStorage.setItem('notas.collab.shared',JSON.stringify({[id]:Date.now()}));localStorage.setItem('notas.collab.host.'+id,'a'.repeat(32));
  const fetcher=window.fetch;window.fetch=async()=>new Response('',{status:503});let failed=false;try{await N.collab.purge(id);}catch{failed=true;}
  const retained=!!localStorage.getItem('notas.collab.host.'+id)&&N.collab.isShared(id);
  window.fetch=async()=>new Response('',{status:200});await N.collab.purge(id);window.fetch=fetcher;
  return {guarded,failed,retained,forgot:!N.collab.isShared(id)&&!localStorage.getItem('notas.collab.host.'+id)};
 });
 assert.deepEqual(lifecycle,{guarded:true,failed:true,retained:true,forgot:true});
 console.log('F85/F88: failed retirement retains credentials, successful purge cleans up, host fragments cannot replace private notes');

 await page.addScriptTag({url:base+'/assets/collab.js'});
 const collaboration=await page.evaluate(async()=>{
  const C=N.core,S=C.S,T=N.collab._test,{Y}=Yjs;N.ink.finishInput();await N.ui.newNote();
  const ytext=new Y.Text(),d=new Y.Doc();d.getMap('lines').set('test',ytext);ytext.insert(0,'abcYef');T.editText(ytext,'abcdef','aXf');const overlap=ytext.toString();d.destroy();
  S.lines=[{id:'line',y:120,text:'abcdef',h:30},{id:'untouched',y:180,text:'old remote',h:30}];S.images=[];
  S.strokes=[{id:'delete',author:'user',w:2,pts:[10,10,.5,20,20,.5],bbox:[10,10,20,20]},{id:'keep',author:'user',w:2,pts:[30,30,.5,40,40,.5],bbox:[30,30,40,40]}];S.title='base';
  const remote=new Y.Doc();for(const st of S.strokes)remote.getMap('strokes').set(st.id,{...st});
  for(const ln of S.lines){const m=new Y.Map();remote.getMap('lines').set(ln.id,m);m.set('attrs',{y:ln.y});m.set('text',new Y.Text(ln.id==='line'?'abcYef':'peer changed'));}
  remote.getMap('meta').set('title','peer title');
  const OriginalLib=window.Yjs,OriginalIDB=Yjs.IndexeddbPersistence,OriginalProvider=Yjs.WebsocketProvider;window.Yjs={...OriginalLib};let finish;
  Yjs.IndexeddbPersistence=class{constructor(name,doc){this.whenSynced=new Promise(resolve=>{finish=()=>{Y.applyUpdate(doc,Y.encodeStateAsUpdate(remote));resolve();};});}destroy(){}};
  Yjs.WebsocketProvider=class extends OriginalProvider{constructor(url,id,doc,opts){super(url,id,doc,{...opts,connect:false,disableBc:true});}};
  localStorage.setItem('notas.collab.shared',JSON.stringify({[S.id]:Date.now()}));localStorage.setItem('notas.collab.gen.'+S.id,'testgen1');
  const pending=T.start(S.id,false,'testgen1');for(let i=0;i<50&&!finish;i++)await new Promise(r=>setTimeout(r,10));if(!finish)throw Error('mock persistence did not start');
  S.lines[0].text='aXf';S.lines.push({id:'inserted',y:250,text:'new local',h:30});S.strokes=S.strokes.filter(st=>st.id!=='delete');S.title='local title';C.markDirty();finish();await pending;
  const merged={text:S.lines.find(l=>l.id==='line').text,peer:S.lines.find(l=>l.id==='untouched').text,inserted:S.lines.some(l=>l.id==='inserted'),deleted:!S.strokes.some(st=>st.id==='delete'),title:S.title};
  const r=N.collab.room,before=C.strokeById('keep');r.doc.transact(()=>r.strokes.set('keep',{...r.strokes.get('keep'),pts:[300,300,.5,310,310,.5]}),'remote');const live=C.strokeById('keep');
  r.doc.transact(()=>{const bad=new Y.Map();r.lines.set('malformed',bad);bad.set('attrs',{y:300});bad.set('text','forged');},'remote');
  S.lines.find(l=>l.id==='malformed').text='repaired';S.title='still syncing';T.flush();
  const repaired=r.lines.get('malformed').get('text') instanceof Y.Text&&r.lines.get('malformed').get('text').toString()==='repaired'&&r.meta.get('title')==='still syncing';
  r.doc.transact(()=>r.meta.set('gen','attacker'),'remote');const gen=r.provider.params.gen;
  T.stop();window.Yjs=OriginalLib;remote.destroy();localStorage.setItem('notas.collab.shared','{}');
  return {overlap,merged,lookup:live!==before&&live===S.strokes.find(st=>st.id==='keep'),repaired,gen};
 });
 assert.equal(collaboration.overlap,'aXYf');assert.deepEqual(collaboration.merged,{text:'aXYf',peer:'peer changed',inserted:true,deleted:true,title:'local title'});assert.equal(collaboration.lookup,true);assert.equal(collaboration.repaired,true);assert.equal(collaboration.gen,'testgen1');
 console.log('F16/F19/F40/F81/F83/F84: concurrent initialization, overlapping text, live indexes and malformed peers');

 const streams=await page.evaluate(async()=>{
  const read=N.nota._audit.readSSE;let partial='',eof=false,length=false;
  try{await read(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),d=>partial+=d.content||'');}catch(e){eof=e.interrupted;}
  try{await read(new Response('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'),()=>{});}catch(e){length=e.interrupted;}
  await read(new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'),()=>{});
  return {partial,eof,length};
 });assert.deepEqual(streams,{partial:'partial',eof:true,length:true});

 let bodies=[],script=[];
 await page.route('**/nota/chat',async route=>{
  const body=route.request().postDataJSON();assert.ok(notaBody(body),'strict proxy accepts every request');bodies.push(body);
  const next=script.shift()||{choices:[{delta:{content:'answer'}}]};
  await route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify(next)+'\n\ndata: [DONE]\n\n'});
 });
 script=[{choices:[{delta:{tool_calls:[{index:0,id:'same',function:{name:'invented',arguments:'{}'}}]}}]},{choices:[{delta:{content:'corrected answer'}}]}];
 const tools=await page.evaluate(async model=>{let answer='';await N.nota._audit.streamTools('question','x'.repeat(200000),p=>answer+=p,new AbortController().signal,null,model);return answer;},MODEL);
 assert.equal(tools,'corrected answer');assert.equal(bodies.length,2);assert.ok(bodies[1].messages.every(m=>!m.tool_calls));
 bodies=[];script=[{choices:[{delta:{tool_calls:[{index:0,id:'call_0_1',function:{name:'list_notes',arguments:'{}'}},{index:1,id:'call_0_1',function:{name:'list_notes',arguments:'{}'}}]}}]},{choices:[{delta:{content:'deduplicated'}}]}];
 await page.evaluate(async model=>N.nota._audit.streamTools('question','page',()=>{},new AbortController().signal,null,model),MODEL);
 assert.equal(new Set(bodies[1].messages.find(m=>m.tool_calls).tool_calls.map(c=>c.id)).size,2);
 console.log('F20/F71/F72: interrupted SSE, bounded context, invalid calls and duplicate ids');

 bodies=[];
 const privacy=await page.evaluate(async()=>{
  const C=N.core,S=C.S,T=N.nota._audit;N.nota.reset();S.strokes=[];S.lines=[];S.images=[];S.clusters=[];
  const isShared=N.collab.isShared,isLive=N.collab.isLive,claimNota=N.collab.claimNota,groups=N.recog.textGroups;
  N.collab.isShared=()=>true;N.collab.claimNota=async()=>({state:'claimed',finish:async()=>{}});
  let group={hash:'peer-question',strokeIds:['peer-ink'],bbox:[20,50,300,80]};N.recog.textGroups=()=>[group];
  const stroke={id:'peer-ink',author:'user',w:2,t1:N.ink.now()-5000,pts:[20,50,.5,300,80,.5],bbox:group.bbox};S.strokes=[stroke];
  T.readings.set(group.hash,{text:'hey nota, summarise my private notes?',group,confidence:1});
  await T.fireInk(group.hash,0);const peerStarted=N.nota.busy;
  N.collab.isShared=()=>false;N.collab.isLive=()=>true;
  N.nota.localStroke(stroke);await T.fireInk(group.hash,0);while(N.nota.busy)await new Promise(r=>setTimeout(r,20));
  S.strokes.push({id:'future-peer',author:'user',_peer:true,t1:N.ink.now()+1e9,pts:[10,10,.5],bbox:[10,10,10,10],w:2});
  const clock=T.lastPenLift()<N.ink.now();
  N.collab.isShared=isShared;N.collab.isLive=isLive;N.collab.claimNota=claimNota;N.recog.textGroups=groups;return {peerStarted,clock};
 });
 assert.equal(privacy.peerStarted,false);assert.equal(privacy.clock,true);assert.equal(bodies.length,1);assert.equal(bodies[0].tools,undefined);
 console.log('F14/F21/F69/F70: peer ink has no authority over this notebook, shared answers have no private tools');
 await peer.close();assert.deepEqual(errors,[]);console.log('Audit browser regressions passed.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
