(function(){
'use strict';
const C=N.core,S=C.S;
// Covers the stroke recognizer and everything that turns ink into an expression.
// Preprocessing, weights and decoding all change stored
// transcripts, so any such change must bump this version and re-read them.
// v11: the Smart image model is gone; the stroke reader is the one maths engine
// and pictures are pictures.
const MODEL_VERSION='recognition-v14:'+globalThis.NOTAS_MODEL_CONTRACT.math.id;
const RESULT_VERSION={ink:MODEL_VERSION+':ink'};
const TEXT_VERSION='ppocrv6-small-v3:'+globalThis.NOTAS_MODEL_CONTRACT.text.id;
// Joint calibration: 0.80 retains 90/100 real IAM handwriting lines while the
// negative fixtures in tests/noise-probe.mjs (grid, axes, doodle, arrows and
// maths marks) produce no stored letter/number transcript above this floor.
// This is deliberately script-neutral; content validation below uses Unicode.
const TEXT_CONFIDENCE_MIN=.80;
const INK_CONFIDENCE_MIN=.70;
const ENGINES={
  ink:{url:'./ink-worker.js',setup:120000,run:30000}
};
const engines=new Map();
let serial=0,queue=Promise.resolve(),active=null;
const cache=new Map(),attempted=new Set();
let timer=null,epoch=0,warned=false,inkError='';
let memoryPaused=0;
function memoryFailure(error){return /out of memory|\boom\b|memory access out of bounds|allocat|memory.*(?:grow|limit)|no available backend/i.test(String(error?.message||error));}
function readerError(error){
  if(!error?.memory&&!memoryFailure(error))return error;
  return Object.assign(new Error('Not enough available memory for handwriting recognition. Close a few apps or tabs, then tap retry. You can keep writing.'),{memory:true});
}
function pauseForImage(){
  memoryPaused++;
  const cancelled=new DOMException('Handwriting paused while processing your image','AbortError');
  stop(cancelled);stopText(cancelled);
  clearTimeout(timer);clearTimeout(textTimer);clearTimeout(indexTimer);
  let resumed=false;
  return ()=>{
    if(resumed)return;resumed=true;memoryPaused--;
    if(!memoryPaused&&enabled()){attempted.clear();textAttempted.clear();schedule();scheduleText();scheduleIndex();}
  };
}
const textState={worker:null,booting:null,ready:false,requests:new Map(),broken:false,gen:0};
const textAttempted=new Set();
let textTimer=null,textQueue=Promise.resolve(),textRestartSeq=0;
// Ignore any legacy saved recognizer preference. There is one math engine.
function preferred(){return 'ink';}
function compatibleReading(stored){
  return !!stored.confirmed||Object.values(RESULT_VERSION).includes(stored.modelVersion);
}
function clearUnconfirmedReadings(){
  for(const [hash,value] of [...cache])if(!value?.confirmed)cache.delete(hash);
  for(const cl of S.clusters||[])if(!cl.confirmed){
    cl.latex='';cl.ascii='';cl.alternatives=[];cl.confidence=0;cl.pending=false;cl.review=false;cl.error='';
  }
  S.textTranscripts=[];
  attempted.clear();textAttempted.clear();
}
function state(name){
  // gen rises on every teardown and every fresh boot. A boot that fails after
  // an explicit retry has already replaced it must not run its own cleanup, or
  // it terminates the worker the user just asked for and the retry does nothing.
  if(!engines.has(name))engines.set(name,{worker:null,booting:null,ready:false,requests:new Map(),broken:false,gen:0});
  return engines.get(name);
}
const status=document.createElement('button');
status.id='local-status';status.type='button';status.setAttribute('aria-live','polite');
status.textContent='setting up handwriting.';
status.title='handwriting is read on this device.';
document.body.appendChild(status);
// Download progress owns the status until setup has completed.
let preparing=false;
function report(text,retry=false,force=false){
  if(preparing&&!force)return;
  status.textContent=text;status.disabled=!retry;status.dataset.retry=String(retry);
}
// Progress is not an alarm: the models popover counts the download in, and
// the status line stays out of the way until setup has finished or failed.
// A transfer that goes quiet is left to finish (a slow link is not a fault);
// a worker that never answers at all reaches the setup timeout in send().
// The opening screen follows the stroke reader's setup: fetching, then
// starting. Watchers get every step, and a late watcher gets the latest one
// at once.
const watchers=new Set();
let lastProgress=null;
function progress(phase,detail,loaded,total){
  lastProgress={phase,detail:detail||'',loaded:loaded||0,total:total||0,at:Date.now()};
  for(const fn of watchers){try{fn(lastProgress);}catch(e){}}
}
function watch(fn){watchers.add(fn);if(lastProgress)fn(lastProgress);return()=>watchers.delete(fn);}
// The text reader's setup is followed the same way, for the downloads panel.
const textWatchers=new Set();
let lastTextProgress=null;
function textProgress(phase,detail,loaded,total){
  lastTextProgress={phase,detail:detail||'',loaded:loaded||0,total:total||0,at:Date.now()};
  for(const fn of textWatchers){try{fn(lastTextProgress);}catch(e){}}
}
function watchText(fn){textWatchers.add(fn);if(lastTextProgress)fn(lastTextProgress);return()=>textWatchers.delete(fn);}
function textSetupState(){
  if(!enabled())return {phase:'off',detail:''};
  if(textState.broken)return {phase:'error',detail:lastTextProgress&&lastTextProgress.phase==='error'?lastTextProgress.detail:''};
  if(textState.ready)return {phase:'ready',detail:''};
  if(!textState.booting)return {phase:'idle',detail:''};
  const p=lastTextProgress&&lastTextProgress.phase!=='ready'&&lastTextProgress.phase!=='error'?lastTextProgress:null;
  return {phase:p?p.phase:'download',detail:p?p.detail:'',loaded:p?p.loaded:0,total:p?p.total:0};
}
// What a chip that is waiting can say about the reader: the stroke reader
// being fetched, or starting. Ready or broken says nothing; a failure reaches
// the chip as its own error.
function setupState(){
  const ink=state('ink');
  if(!enabled())return {phase:'off',detail:''};
  if(ink.broken)return {phase:'error',detail:inkError};
  if(!ink.ready){
    const p=lastProgress&&lastProgress.phase!=='ready'&&lastProgress.phase!=='error'?lastProgress:null;
    return {phase:p?p.phase:'download',detail:p?p.detail:'',loaded:p?p.loaded:0,total:p?p.total:0};
  }
  return {phase:'ready',detail:''};
}
// the download counts up on the chip that is waiting for it
watch(()=>{try{N.mathcore&&N.mathcore.refreshWaiting&&N.mathcore.refreshWaiting();}catch(e){}});
function phaseOf(text){
  const m=/downloading (\d+)(?: of (\d+))? MB/i.exec(text||'');
  if(m)return {phase:'download',detail:m[2]?m[1]+' of '+m[2]+' MB':m[1]+' MB'};
  if(/fetching|loading/i.test(text||''))return {phase:'download',detail:''};
  if(/starting/i.test(text||''))return {phase:'starting',detail:''};
  return {phase:'download',detail:''};
}
function enabled(){return S.settings.aiOn!==false;}
function stop(message='recognition stopped.',only){
  preparing=false;
  for(const [name,e] of engines){
    if(only&&only!==name)continue;
    e.gen++;
    e.worker?.terminate();e.worker=null;e.ready=false;e.booting=null;
    for(const request of e.requests.values()){clearTimeout(request.timer);request.reject(typeof message==='string'?new Error(message):message);}
    e.requests.clear();
  }
  active=null;
}
function stopText(message='Handwriting search stopped'){
  textState.gen++;
  if(textState.broken&&message?.name!=='AbortError')textProgress('error',typeof message==='string'?message:message.message);
  textState.worker?.terminate();textState.worker=null;textState.ready=false;textState.booting=null;
  for(const request of textState.requests.values()){
    clearTimeout(request.timer);request.reject(typeof message==='string'?new Error(message):message);
  }
  textState.requests.clear();
}
function send(name,payload,transfer=[],timeout=15000){
  if(memoryPaused)return Promise.reject(new DOMException('Handwriting paused while processing your image','AbortError'));
  const e=state(name);
  return new Promise((resolve,reject)=>{
    const id=++serial;
    const expire=()=>{stop('handwriting took too long. tap retry to try again.',name);report('handwriting paused, retry.',true);};
    if(!e.worker){reject(new Error('Handwriting stopped'));return;}
    e.requests.set(id,{resolve,reject,expire,timeout,timer:setTimeout(expire,timeout)});
    try{e.worker.postMessage({...payload,id},transfer);}catch(error){stop(readerError(error),name);}
  });
}
// The model files are kept in IndexedDB by the workers (model-store.js),
// and the text reader and runtime by the service worker. Persistent storage
// asks the browser to leave this origin's data out of its own eviction, so
// a model downloaded once stays for as long as the notebook is on the
// device: Chrome grants it silently on engagement or when installed,
// Firefox asks once, Safari grants it. Asked once a session, before the
// first model is fetched.
let persistAsked=false;
function persistStorage(){
  if(persistAsked)return;persistAsked=true;
  try{
    const storage=navigator.storage;
    if(!storage||!storage.persist)return;
    storage.persisted().then(yes=>yes||storage.persist()).catch(()=>{});
  }catch(e){}
}
// The stroke reader is about 44 MB, fetched once and kept on the device;
// small enough to fetch unasked.
async function setup(name=preferred()){
  if(memoryPaused)throw new DOMException('Handwriting paused while processing your image','AbortError');
  const e=state(name),spec=ENGINES[name];
  if(!spec)throw new Error('unknown handwriting engine.');
  if(e.ready) return;
  if(e.booting) return e.booting;
  const gen=++e.gen;
  const mine=()=>e.gen===gen;
  e.booting=(async()=>{
    preparing=true;
    report('preparing handwriting.',false,true);
    if(!window.Worker || !window.OffscreenCanvas || !/^https?:$/.test(location.protocol)) throw new Error('open notas through its web address to enable local handwriting.');
    progress('download','');
    persistStorage();
    e.worker=new Worker(spec.url);
    e.worker.onmessage=({data})=>{
      if(!mine())return;
      const request=e.requests.get(data.id);
      if(data.progress){
        // Progress keeps the timeout alive. A tap restarts a stalled download.
        const p=phaseOf(data.status);progress(p.phase,p.detail,data.loaded,data.total);
        if(request){clearTimeout(request.timer);request.timer=setTimeout(request.expire,request.timeout);}
        return;
      }
      if(!request)return;
      clearTimeout(request.timer);e.requests.delete(data.id);
      data.error?request.reject(readerError(new Error(data.error))):request.resolve(data);
    };
    // An uncaught error inside a worker is re-reported on window unless the
    // event is cancelled here. That is what turned a failure this code already
    // handles into a permanent "Something broke" banner.
    e.worker.onerror=event=>{
      event&&event.preventDefault&&event.preventDefault();
      if(!mine())return;
      // A worker that throws at top level reports "Uncaught Error: <message>";
      // only the message is worth showing.
      const why=String((event&&event.message)||'').replace(/^Uncaught (?:\w*Error: )?/,'')||'handwriting could not start. reconnect and retry.';
      stop(why,name);report('handwriting unavailable, retry.',true,true);
    };
    await send(name,{type:'setup'},[],spec.setup);
    // Everything past here belongs to the newest boot only. A boot that an
    // explicit retry has already replaced must not report, must not claim the
    // engine is ready, and must not hand back the status line the new one holds.
    if(!mine())return;
    preparing=false;inkError='';status.title='handwriting is read on this device.';
    e.ready=true;
    report('handwriting ready.',false,true);
    progress('ready','');
  })().catch(error=>{error=readerError(error);if(mine()){preparing=false;progress('error',error?.message||'');stop(error.message,name);}throw error;});
  return e.booting;
}
function textSend(payload,transfer=[],timeout=45000){
  if(memoryPaused)return Promise.reject(new DOMException('Handwriting paused while processing your image','AbortError'));
  return new Promise((resolve,reject)=>{
    const id=++serial;
    const expire=()=>{textBroke();stopText('Handwriting search took too long.');reject(new Error('Handwriting search took too long.'));};
    if(!textState.worker){reject(new Error('Handwriting search stopped'));return;}
    const request={resolve,reject,timer:setTimeout(expire,timeout),expire,timeout};
    textState.requests.set(id,request);
    try{textState.worker.postMessage({...payload,id},transfer);}catch(error){stopText(readerError(error));}
  });
}
// A failure is not for the whole session: the reader is tried again once
// a while has passed (a stalled download, a timeout while both models were
// arriving, a connection that was not there), and at once when the page
// asks for it outright (ask nota) or the connection returns.
const TEXT_RETRY_AFTER=45000;
// the text reader reads a line this long after the last change, and only
// once the pen has been up this long (see readText)
const TEXT_SETTLE=2000,TEXT_REST=900;
function textBroke(error){textState.broken=true;textState.brokeAt=Date.now();textState.memoryBlocked=!!(error?.memory||memoryFailure(error));}
function textHealable(){return textState.broken&&!textState.memoryBlocked&&Date.now()-(textState.brokeAt||0)>=TEXT_RETRY_AFTER;}
function healText(){textState.broken=false;textState.brokeAt=0;textState.memoryBlocked=false;}
window.addEventListener('online',()=>{if(textState.broken){healText();scheduleText();}});
async function setupText(){
  if(memoryPaused)throw new DOMException('Handwriting paused while processing your image','AbortError');
  if(textState.ready)return;
  if(textHealable())healText();
  if(textState.broken)throw new Error('Handwriting search is unavailable.');
  if(textState.booting)return textState.booting;
  const gen=++textState.gen,mine=()=>textState.gen===gen;
  textState.booting=(async()=>{
    if(!window.Worker||!window.OffscreenCanvas||!/^https?:$/.test(location.protocol))
      throw new Error('Open notas through its web address to enable handwriting search.');
    textState.worker=new Worker('./text-worker.js');
    textState.worker.onmessage=({data})=>{
      if(!mine())return;
      const request=textState.requests.get(data.id);if(!request)return;
      if(data.progress){
        // the download keeps the timeout alive, as the stroke reader's does
        const p=phaseOf(String(data.status||'').replace(/^Text reading:\s*/,''));textProgress(p.phase,p.detail,data.loaded,data.total);
        clearTimeout(request.timer);request.timer=setTimeout(request.expire,request.timeout);
        return;
      }
      clearTimeout(request.timer);textState.requests.delete(data.id);
      data.error?request.reject(readerError(new Error(data.error))):request.resolve(data);
    };
    textState.worker.onerror=event=>{
      event&&event.preventDefault&&event.preventDefault();
      if(!mine())return;
      const error=readerError(new Error((event&&event.message)||'Handwriting search could not start. Tap retry.'));
      textBroke(error);
      stopText(error.message);
    };
    textProgress('download','');
    persistStorage();
    await textSend({type:'setup'},[],120000);
    if(!mine())return;
    textState.ready=true;
    textProgress('ready','');
  })().catch(error=>{error=readerError(error);if(mine()){textBroke(error);stopText(error.message);}throw error;});
  return textState.booting;
}
// Setup failure remains visible and retryable; never substitute another model.
let bootSeq=0;
async function boot(){
  const seq=++bootSeq;
  try{
    try{await setup('ink');}
    catch(error){
      if(!(error.memory||memoryFailure(error)))throw error;
      release();
      await setup('ink');
    }
  }
  catch(error){
    if(seq!==bootSeq||error.name==='AbortError')return;
    state('ink').broken=true;
    inkError=readerError(error)?.message||'handwriting could not start.';
    status.title=inkError;
    report('handwriting unavailable, retry.',true,true);
    if(!warned){warned=true;C.toast(inkError);}
    throw error;
  }
}
// A worker killed for memory never answers and never errors, so setup()'s
// in-flight guard would hand every later caller that same dead promise: the
// status line sat at "fetching…" for the whole timeout while both recovery
// paths - Retry, and the Settings toggle - silently attached to it and did
// nothing. An explicit retry now
// tears the engine down first so it always gets a fresh worker.
let restartSeq=0;
function restart(){
  restartSeq++;bootSeq++;preparing=false;
  stop('Handwriting restarted');
  for(const e of engines.values())e.broken=false;
  attempted.clear();warned=false;
  for(const cl of S.clusters)if(!cl.confirmed&&(!cl.latex||cl.error)){
    cl.latex='';cl.ascii='';cl.alternatives=[];cl.pending=false;cl.error='';cache.delete(cl.hash);
  }
}
status.onclick=()=>{restart();boot().then(schedule).catch(()=>{});};
window.addEventListener('online',()=>{
  if(!state('ink').ready&&enabled()){
    restart();boot().then(schedule).catch(()=>{});
  }
  if(enabled()){textState.broken=false;scheduleText();}
});
// The hash keys stored transcripts, so its value cannot change: it is still
// FNV-1a over the decimal text of every coordinate. What changed is the cost.
// It used to iterate that text through a string iterator, for every point of
// every cluster, on every stroke - most of the pen-up stall on a full page.
// Now it is charCodeAt over the same text, and the result is remembered per
// stroke set until one of those strokes is moved (moveStrokes bumps st.rev).
const hashMemo=new Map();
function fnv(hash,text){
  for(let k=0;k<text.length;k++){hash^=text.charCodeAt(k);hash=Math.imul(hash,16777619);}
  return hash;
}
function hashOf(list){
  const ids=list.map(s=>s.id).sort().join(',');
  const key=ids+'|'+list.map(s=>(s.rev||0)+'.'+s.pts.length).join(',');
  const memo=hashMemo.get(key);
  if(memo)return memo;
  let hash=2166136261;
  for(const st of list){
    hash=fnv(hash,String(st.id));
    const p=st.pts;for(let i=0;i<p.length;i++)hash=fnv(hash,String(p[i]));
    hash=fnv(hash,String(st.w));
  }
  const out=ids+':'+(hash>>>0).toString(36);
  if(hashMemo.size>4000)hashMemo.clear();
  hashMemo.set(key,out);
  return out;
}
/* ---- frames: boxes, rules and outlines drawn round the writing ----
   Notes are set out with boxes ("Definition" beside "Representation"), a
   rule under a heading, a line across a box under its title, a ring round
   an answer. None of that is writing, and both readers took it for some:
   a box edge beside a word, a header rule read as a fraction bar over the
   words below it. Such strokes are told apart here by shape, before any
   grouping, and kept out of it. What stays is conservative: a rule must be
   long for the writing on the page and straight; a box side or corner is
   made of long straight runs along the page's axes; an outline is closed
   and has writing inside it. A fraction bar has writing under it, so a
   horizontal rule counts only when nothing is written right under it,
   when it runs into a box side at both ends, or when it is far longer
   than any fraction. */
const shapeMemo=new Map();
function simplify(pts,tol){
  if(pts.length<3)return pts.slice();
  const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;
  const stack=[[0,pts.length-1]];
  while(stack.length){
    const [a,b]=stack.pop();let far=-1,best=tol;
    const ax=pts[a][0],ay=pts[a][1],dx=pts[b][0]-ax,dy=pts[b][1]-ay,L=Math.hypot(dx,dy)||1;
    for(let i=a+1;i<b;i++){const d=Math.abs(dy*(pts[i][0]-ax)-dx*(pts[i][1]-ay))/L;if(d>best){best=d;far=i;}}
    if(far>=0){keep[far]=1;stack.push([a,far],[far,b]);}
  }
  return pts.filter((p,i)=>keep[i]);
}
function strokeShape(st){
  const key=st.id+':'+(st.rev||0)+':'+st.pts.length+':'+st.bbox.join(',');
  const memo=shapeMemo.get(key);if(memo)return memo;
  const p=st.pts,n=p.length/3|0,b=st.bbox,w=b[2]-b[0],h=b[3]-b[1],size=Math.max(w,h);
  let len=0;for(let i=3;i<p.length;i+=3)len+=Math.hypot(p[i]-p[i-3],p[i+1]-p[i-2]);
  const chord=n>1?Math.hypot(p[p.length-3]-p[0],p[p.length-2]-p[1]):0;
  const pts=[];for(let i=0;i<n;i++)pts.push([p[i*3],p[i*3+1]]);
  const kept=simplify(pts,Math.max(2.5,size*.035));
  let axis=0;
  for(let i=1;i<kept.length;i++){
    const dx=Math.abs(kept[i][0]-kept[i-1][0]),dy=Math.abs(kept[i][1]-kept[i-1][1]),L=Math.hypot(dx,dy);
    if(dy<=dx*.3||dx<=dy*.3)axis+=L;
  }
  const straight=len>0&&chord>=len*.92;
  const shape={w,h,size,len,straight,horiz:straight&&w>=h*4,vert:straight&&h>=w*4,
    closed:n>8&&chord<=Math.max(8,size*.18)&&len>=size*2.2,axisShare:len?axis/len:0,vertices:kept.length};
  if(shapeMemo.size>20000)shapeMemo.clear();
  shapeMemo.set(key,shape);
  return shape;
}
function frameInfo(strokes){
  const ids=new Set(),boxes=[];
  if(strokes.length<2)return {ids,boxes};
  const hs=strokes.map(s=>s.bbox[3]-s.bbox[1]).filter(h=>h>2);
  const H=Math.max(12,median(hs.length?hs:[12]));
  const inside=(st,min)=>{
    const b=st.bbox;let n=0;
    for(const o of strokes){
      if(o===st)continue;
      const cx=(o.bbox[0]+o.bbox[2])/2,cy=(o.bbox[1]+o.bbox[3])/2;
      if(cx>b[0]&&cx<b[2]&&cy>b[1]&&cy<b[3]&&o.bbox[2]-o.bbox[0]<b[2]-b[0]&&++n>=min)return true;
    }
    return false;
  };
  /* A radical sign has a box corner's outline: a steep rise and a long top
     bar. Unlike a corner it starts above its lowest point, dips to a tick,
     rises on the left and ends at the right of the bar, with writing under it. */
  const radical=st=>{
    const p=st.pts,b=st.bbox,w=b[2]-b[0],h=b[3]-b[1],n=p.length/3|0;
    let low=0;for(let i=1;i<n;i++)if(p[i*3+1]>p[low*3+1])low=i;
    if(p[1]>b[3]-h*.15||p[0]>b[0]+w*.25||p[low*3]>b[0]+w*.35)return false;
    const endX=p[p.length-3],endY=p[p.length-2];
    if(endX<b[2]-w*.1||endY>b[1]+h*.25)return false;
    let top=-1;for(let i=low;i<n;i++)if(p[i*3+1]<=b[1]+h*.25){top=i;break;}
    if(top<0||p[top*3]>b[0]+w*.4)return false;
    for(let i=top;i<n;i++)if(p[i*3+1]>b[1]+h*.3)return false;
    return inside(st,1);
  };
  const walls=[];
  for(const st of strokes){
    if(!Array.isArray(st.pts)||st.pts.length<6||!st.bbox)continue;
    const s=strokeShape(st);
    if(s.size<Math.max(80,4*H))continue;
    const wall=(s.vert&&s.h>=Math.max(90,5*H))||
      (!s.straight&&s.vertices<=10&&s.axisShare>=.8&&s.size>=Math.max(100,5*H)&&Math.min(s.w,s.h)>=Math.max(24,1.5*H)&&!radical(st))||
      (s.closed&&Math.min(s.w,s.h)>=Math.max(40,2.5*H)&&inside(st,2));
    if(wall){ids.add(st.id);walls.push(st);}
  }
  const near=(x,y,b,r)=>x>=b[0]-r&&x<=b[2]+r&&y>=b[1]-r&&y<=b[3]+r;
  for(const st of strokes){
    if(ids.has(st.id)||!Array.isArray(st.pts)||st.pts.length<6||!st.bbox)continue;
    const s=strokeShape(st);
    if(!s.horiz||s.w<Math.max(90,5*H))continue;
    const b=st.bbox,p=st.pts;
    const a=[p[0],p[1]],z=[p[p.length-3],p[p.length-2]];
    const meets=walls.some(f=>near(a[0],a[1],f.bbox,H*1.2))&&walls.some(f=>near(z[0],z[1],f.bbox,H*1.2));
    const m0=b[0]+s.w*.2,m1=b[2]-s.w*.2;
    const under=strokes.some(o=>o!==st&&!ids.has(o.id)&&o.bbox&&o.bbox[3]>b[3]+2&&o.bbox[1]>=b[1]-2&&o.bbox[1]-b[3]<=1.6*H&&o.bbox[0]<m1&&o.bbox[2]>m0);
    if(s.w>=10*H||meets||!under){ids.add(st.id);if(meets)walls.push(st);}
  }
  /* the walls that touch make up a box; its inside is a region of the page
     whose writing is read on its own */
  const parent=walls.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  for(let i=0;i<walls.length;i++)for(let j=i+1;j<walls.length;j++){
    const g=gap(walls[i].bbox,walls[j].bbox);
    if(g.dx<=H*1.5&&g.dy<=H*1.5)parent[find(i)]=find(j);
  }
  const sets=new Map();walls.forEach((w,i)=>{const r=find(i);if(!sets.has(r))sets.set(r,[]);sets.get(r).push(w);});
  for(const set of sets.values()){
    const b=boxOf(set);
    if(b[2]-b[0]>=3*H&&b[3]-b[1]>=2.5*H&&set.some(w=>{const s=strokeShape(w);return !s.horiz;}))boxes.push(b);
  }
  return {ids,boxes};
}
/* which box a point is in: the smallest that holds it, or -1 */
function boxAt(boxes,x,y){
  let best=-1,area=Infinity;
  boxes.forEach((b,i)=>{if(x>b[0]&&x<b[2]&&y>b[1]&&y<b[3]){const a=(b[2]-b[0])*(b[3]-b[1]);if(a<area){area=a;best=i;}}});
  return best;
}
let pageFrames={ids:new Set(),boxes:[]};
// Maths clusters are deliberately tight so nearby symbols form one expression.
// Text search needs the opposite: word-sized clusters on the same baseline must
// be merged back into a whole handwriting line so spaces survive OCR. A row
// is not merged across a box's side, though: two boxes side by side are two
// columns of writing, not one line.
function textGroups(clusters,byId,frames){
  frames=frames||(clusters?null:pageFrames);
  clusters=clusters||S.clusters;byId=byId||C.strokeById;
  const ink=clusters.filter(c=>c.source==='ink').slice().sort((a,b)=>
    ((a.bbox[1]+a.bbox[3])-(b.bbox[1]+b.bbox[3]))||a.bbox[0]-b.bbox[0]);
  if(!ink.length)return [];
  const hs=ink.map(c=>c.bbox[3]-c.bbox[1]).filter(Boolean).sort((a,b)=>a-b);
  const typical=Math.max(16,hs[Math.floor(hs.length*.6)]||20);
  // Shaky/slanted handwriting moves character centres more than neat writing.
  // Use both centre distance and vertical overlap so one untidy line does not
  // fragment into several OCR crops, without simply widening the merge radius
  // enough to swallow the next line.
  const tolerance=Math.min(30,Math.max(12,typical*.82));
  const lines=[];
  for(const cl of ink){
    const mid=(cl.bbox[1]+cl.bbox[3])/2;
    let best=null,bestD=Infinity;
    for(const line of lines){
      const d=Math.abs(mid-line.mid);
      const overlap=Math.max(0,Math.min(cl.bbox[3],line.bbox[3])-Math.max(cl.bbox[1],line.bbox[1]));
      const minH=Math.max(1,Math.min(cl.bbox[3]-cl.bbox[1],line.bbox[3]-line.bbox[1]));
      if((d<=tolerance||overlap>=minH*.45)&&d<bestD){best=line;bestD=d;}
    }
    if(!best){best={clusters:[],mid,bbox:cl.bbox.slice()};lines.push(best);}
    best.clusters.push(cl);
    const n=best.clusters.length;
    best.mid=(best.mid*(n-1)+mid)/n;
    best.bbox=[Math.min(best.bbox[0],cl.bbox[0]),Math.min(best.bbox[1],cl.bbox[1]),
      Math.max(best.bbox[2],cl.bbox[2]),Math.max(best.bbox[3],cl.bbox[3])];
  }
  const boxes=frames&&frames.boxes&&frames.boxes.length?frames.boxes:null;
  const parts=[];
  for(const line of lines){
    line.clusters.sort((a,b)=>a.bbox[0]-b.bbox[0]);
    if(!boxes){parts.push(line.clusters);continue;}
    let run=[],was=null;
    for(const cl of line.clusters){
      const at=boxAt(boxes,(cl.bbox[0]+cl.bbox[2])/2,(cl.bbox[1]+cl.bbox[3])/2);
      if(run.length&&at!==was){parts.push(run);run=[];}
      run.push(cl);was=at;
    }
    if(run.length)parts.push(run);
  }
  return parts.map(list=>{
    const ids=[...new Set(list.flatMap(c=>c.strokeIds))];
    const strokes=ids.map(id=>byId(id)).filter(Boolean);
    return {hash:'text:'+hashOf(strokes),strokeIds:ids,bbox:boxOf(list.map(c=>({bbox:c.bbox})))};
  }).sort((a,b)=>a.bbox[1]-b.bbox[1]);
}
function validText(text,confidence){
  return !!String(text||'').trim() && Number(confidence)>=TEXT_CONFIDENCE_MIN && /[\p{L}\p{N}]/u.test(String(text));
}
function syncTextTranscripts(groups){
  if(!Array.isArray(S.textTranscripts))S.textTranscripts=[];
  const valid=new Set(groups.map(g=>g.hash));
  for(const hash of [...textAttempted])if(!valid.has(hash))textAttempted.delete(hash);
  const before=S.textTranscripts.length;
  S.textTranscripts=S.textTranscripts.filter(t=>valid.has(t.hash)&&t.modelVersion===TEXT_VERSION&&validText(t.text,t.confidence));
  if(S.textTranscripts.length!==before)C.markDirty();
}
function boxOf(list){
  return [Math.min(...list.map(s=>s.bbox[0])),Math.min(...list.map(s=>s.bbox[1])),
    Math.max(...list.map(s=>s.bbox[2])),Math.max(...list.map(s=>s.bbox[3]))];
}
function boxMetrics(b){return {w:Math.max(1,b[2]-b[0]),h:Math.max(1,b[3]-b[1]),cx:(b[0]+b[2])/2,cy:(b[1]+b[3])/2};}
function overlap(a0,a1,b0,b1){return Math.max(0,Math.min(a1,b1)-Math.max(a0,b0));}
function gap(a,b){
  const dx=Math.max(a[0]-b[2],b[0]-a[2],0),dy=Math.max(a[1]-b[3],b[1]-a[3],0);
  return {dx,dy,d:Math.hypot(dx,dy)};
}
function median(values){const a=values.slice().sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:1;}
function typicalHeight(values){
  const a=values.slice().filter(Number.isFinite).sort((x,y)=>x-y);
  // Multi-stroke glyphs often contain several short crossbars/diagonals, so a
  // median of individual stroke heights understates the written row. A high
  // robust quantile recovers the body height while still ignoring one unusually
  // long descender or nearby vertical stroke.
  return a.length?a[Math.ceil((a.length-1)*.72)]:1;
}
function sequenceGap(a,b){
  let best=Infinity;
  for(const x of a)for(const y of b)best=Math.min(best,Math.abs((x.order??0)-(y.order??0)));
  return Number.isFinite(best)?best:0;
}
function temporalGap(a,b){
  const x=temporalBounds(a),y=temporalBounds(b);
  if(!x||!y)return 0;
  return Math.max(x[0]-y[1],y[0]-x[1],0);
}
function temporalBounds(items){
  let first=Infinity,last=-Infinity,seen=false;
  for(const item of items){
    const st=item.st||item,start=Number(st.t0),end=Number(st.t1);
    if(Number.isFinite(start)){first=Math.min(first,start);last=Math.max(last,start);seen=true;}
    if(Number.isFinite(end)){first=Math.min(first,end);last=Math.max(last,end);seen=true;}
  }
  return seen?[first,last]:null;
}
// A stroke drawn as one straight line: its chord covers nearly all of the
// travelled path.
function straightStroke(st){
  const p=st.pts;if(!Array.isArray(p)||p.length<6)return true;
  let len=0;for(let i=3;i<p.length;i+=3)len+=Math.hypot(p[i]-p[i-3],p[i+1]-p[i-2]);
  return len<=1e-6||Math.hypot(p[p.length-3]-p[0],p[p.length-2]-p[1])>=len*.65;
}
// Whether two strokes' chords intersect within the middle half of both, as
// the arms of a cross, plus or asterisk do. The crossbar of a 4, 7 or t meets
// its partner near an end, so those glyphs do not qualify.
function chordsCross(a,b){
  const p=a.st.pts,q=b.st.pts,x1=p[0],y1=p[1],x2=p[p.length-3],y2=p[p.length-2],x3=q[0],y3=q[1],x4=q[q.length-3],y4=q[q.length-2];
  // Shrink both chords to their middle halves; they must still intersect.
  const mid=(a0,a1)=>[a0+(a1-a0)*.25,a0+(a1-a0)*.75];
  const [px1,px2]=mid(x1,x2),[py1,py2]=mid(y1,y2),[qx1,qx2]=mid(x3,x4),[qy1,qy2]=mid(y3,y4);
  return segmentsCross(px1,py1,px2,py2,qx1,qy1,qx2,qy2);
}
function segmentsCross(x1,y1,x2,y2,x3,y3,x4,y4){
  const d=(x2-x1)*(y4-y3)-(y2-y1)*(x4-x3);if(Math.abs(d)<1e-6)return false;
  const t=((x3-x1)*(y4-y3)-(y3-y1)*(x4-x3))/d,u=((x3-x1)*(y2-y1)-(y3-y1)*(x2-x1))/d;
  return t>=0&&t<=1&&u>=0&&u<=1;
}
// A single stroke that crosses its own path, as a cursive x does.
function selfCrossing(st){
  const p=st.pts,n=p.length/3|0;if(n<8)return false;
  const step=Math.max(1,Math.floor(n/40)),idx=[];for(let i=0;i<n;i+=step)idx.push(i);if(idx.at(-1)!==n-1)idx.push(n-1);
  for(let i=0;i+1<idx.length;i++)for(let j=i+2;j+1<idx.length;j++){
    const a=idx[i]*3,b=idx[i+1]*3,c=idx[j]*3,d=idx[j+1]*3;
    if(segmentsCross(p[a],p[a+1],p[b],p[b+1],p[c],p[c+1],p[d],p[d+1]))return true;
  }
  return false;
}
// Binary operator shapes at the edge of fragment `c` that faces `other`: a
// cross, plus or asterisk (comparable straight strokes crossing at a shared
// center), a small mid-row self-crossing stroke (a cursive x used as times),
// a lone minus bar in the row band, or an equals pair. Digits, letters with
// a short crossbar, fraction rules and underlines do not qualify, so shape
// alone cannot bridge unrelated ink. `h` is the row height.
function edgeOperator(c,other,h){
  const facingRight=other.cx>c.cx,items=c.items;
  // Returns the operator's bbox when `set` is the fragment's facing edge.
  const atEdge=set=>{
    const b=boxOf(set.map(x=>x.st));
    if(Math.max(b[2]-b[0],b[3]-b[1])>h*1.5)return null;
    return items.every(x=>set.includes(x)||x.tiny||(facingRight?x.st.bbox[0]<=b[2]-h*.1:x.st.bbox[2]>=b[0]+h*.1))?b:null;
  };
  const straight=items.filter(x=>!x.tiny&&straightStroke(x.st));
  for(const seed of straight){
    const size=Math.max(seed.w,seed.h);
    if(size<h*.2)continue;
    const set=straight.filter(x=>x===seed||(Math.max(x.w,x.h)>=size*.45&&Math.max(x.w,x.h)<=size/.45&&chordsCross(seed,x)));
    if(set.length>=2&&set.length<=4){const b=atEdge(set);if(b)return b;}
  }
  for(const item of items){
    const size=Math.max(item.w,item.h);
    if(item.tiny||item.bar||size<h*.3||size>h*.75||item.w<item.h*.6||item.h<item.w*.6)continue;
    if(Math.abs(item.cy-c.glyphCy)>h*.2||Math.abs(item.cy-other.glyphCy)>h*.2)continue;
    if(selfCrossing(item.st)){const b=atEdge([item]);if(b)return b;}
  }
  // A two-stroke letter x whose arcs touch rather than cross: two small
  // mid-row strokes sharing one roughly square footprint.
  const small=items.filter(x=>!x.tiny&&!x.bar&&Math.max(x.w,x.h)>=h*.25&&Math.max(x.w,x.h)<=h*.75);
  for(const first of small)for(const second of small){
    if(first===second)continue;
    const box=boxOf([first.st,second.st]),w=box[2]-box[0],height=box[3]-box[1],cy=(box[1]+box[3])/2;
    if(Math.max(w,height)>h*.9||w<height*.6||height<w*.55)continue;
    if(Math.abs(cy-c.glyphCy)>h*.2||Math.abs(cy-other.glyphCy)>h*.2)continue;
    if(overlap(first.st.bbox[0],first.st.bbox[2],second.st.bbox[0],second.st.bbox[2])<Math.min(first.w,second.w)*.3||
      overlap(first.st.bbox[1],first.st.bbox[3],second.st.bbox[1],second.st.bbox[3])<Math.min(first.h,second.h)*.5)continue;
    const b=atEdge([first,second]);if(b)return b;
  }
  const bars=items.filter(x=>x.bar&&x.w>=h*.25&&x.w<=h*1.3);
  for(const bar of bars){
    // A minus has nothing stacked above or below it; a fraction rule or an
    // underline does. Both fragments must agree that it sits mid-row.
    const clear=items.every(x=>x===bar||overlap(x.st.bbox[0],x.st.bbox[2],bar.st.bbox[0],bar.st.bbox[2])<=bar.w*.25);
    if(clear&&Math.abs(bar.cy-c.glyphCy)<=h*.4){const b=atEdge([bar]);if(b)return b;}
    for(const mate of bars){
      if(mate===bar)continue;
      const dy=Math.abs(bar.cy-mate.cy),minW=Math.min(bar.w,mate.w);
      if(dy<2||dy>h*.5||minW<Math.max(bar.w,mate.w)*.55||overlap(bar.st.bbox[0],bar.st.bbox[2],mate.st.bbox[0],mate.st.bbox[2])<minW*.5)continue;
      const b=atEdge([bar,mate]);if(b)return b;
    }
  }
  return null;
}
// Build math groups from line anchors first, then attach bars, dots, fractions
// and scripts. Pairwise transitive bbox merging let an equals bar or dot bridge
// two close notebook lines, so a perfectly good expression was sometimes sent
// to the model together with ink above or below it.
// `orderOf`, when given, is each stroke's place in the whole page: a part of
// the page regrouped on its own keeps the drawing order it has in the whole.
function mathStrokeGroups(strokes,orderOf){
  strokes=strokes.filter(st=>Array.isArray(st.bbox)&&st.bbox.length===4&&st.bbox.every(Number.isFinite)&&st.bbox[2]>=st.bbox[0]&&st.bbox[3]>=st.bbox[1]&&st.pts?.length>=3&&st.pts.length%3===0&&Array.from(st.pts).every(Number.isFinite));
  if(!strokes.length)return [];
  // Bound the expensive geometry pass even on the first load of a large note.
  // Split near the middle at the widest spatial gap, retaining original order.
  // A gap is clear paper past everything before it, on either axis: a band
  // of rows is wider than tall, and cutting it across would halve each line.
  if(strokes.length>240){
    orderOf=orderOf||new Map(strokes.map((st,i)=>[st,i]));
    let best;
    for(const axis of [1,0]){
      const sorted=strokes.slice().sort((a,b)=>(a.bbox[axis]+a.bbox[axis+2])-(b.bbox[axis]+b.bbox[axis+2]));
      const lo=Math.floor(sorted.length/3),hi=Math.ceil(sorted.length*2/3);
      let reach=-Infinity;for(let i=0;i<lo;i++)reach=Math.max(reach,sorted[i].bbox[axis+2]);
      for(let i=lo;i<hi;i++){
        reach=Math.max(reach,sorted[i-1].bbox[axis+2]);
        const distance=sorted[i].bbox[axis]-reach;
        if(!best||distance>best.gap)best={gap:distance,cut:i,sorted};
      }
    }
    return [...mathStrokeGroups(best.sorted.slice(0,best.cut),orderOf),...mathStrokeGroups(best.sorted.slice(best.cut),orderOf)];
  }
  const info=strokes.map((st,order)=>{
    const m=boxMetrics(st.bbox),bar=m.w>Math.max(12,m.h*3.2),tiny=!bar&&Math.max(m.w,m.h)<10;
    return {st,...m,bar,tiny,order:orderOf?orderOf.get(st):order};
  });
  const anchors=info.filter(m=>!m.bar&&!m.tiny).sort((a,b)=>a.cy-b.cy||a.st.bbox[0]-b.st.bbox[0]);
  const lines=[];
  for(const item of anchors){
    let best=null,bestScore=Infinity;
    for(const line of lines){
      // The row's median height is kept on the row (see below): recomputing
      // it here, for every stroke against every row, was a sort per pair and
      // most of the pen-lift stall on a long note.
      const lh=line.lh,dy=Math.abs(item.cy-line.cy);
      const xGap=Math.max(item.st.bbox[0]-line.bbox[2],line.bbox[0]-item.st.bbox[2],0);
      // Use the row's robust center/height band instead of its full bbox. A
      // single long down-stroke can legitimately extend into the next row, but
      // it must not turn that entire vertical reach into evidence that the two
      // rows share a baseline.
      const core=[line.cy-lh*.58,line.cy+lh*.58];
      const ov=overlap(item.st.bbox[1],item.st.bbox[3],core[0],core[1]);
      // Vertical alignment alone is not a line relationship. A large heading
      // or diagram hundreds of pixels away must not inflate this line's height
      // and then transitively pull neighboring notebook rows into it.
      if(xGap>Math.max(64,Math.max(item.h,lh)*1.8))continue;
      // A radical, integral or long descender can be much taller than ordinary
      // row glyphs. It may overlap a neighboring row without sharing its
      // baseline, so vertical tolerance follows the smaller row scale.
      const maxDy=Math.max(14,Math.min(item.h,lh)*.68);
      const same=dy<=maxDy&&(ov>=Math.min(item.h,lh)*.18||dy<=Math.max(11,Math.min(item.h,lh)*.52));
      if(!same)continue;
      // Drawing order is a weak tie-breaker only. It helps a short arithmetic
      // stroke stay with marks written around the same moment without making
      // later edits or out-of-order writing impossible to group spatially.
      const seq=sequenceGap([item],line.items);
      const score=dy/Math.max(1,Math.max(item.h,lh))+Math.min(seq,8)*.02;
      if(score<bestScore){best=line;bestScore=score;}
    }
    if(!best){best={items:[],bbox:item.st.bbox.slice(),cy:item.cy};lines.push(best);}
    best.items.push(item);best.bbox=boxOf(best.items.map(x=>x.st));
    best.cy=median(best.items.map(x=>x.cy));best.lh=median(best.items.map(x=>x.h));
  }
  // Equal-height glyphs with nearly identical centers can seed two fragments
  // simply because the y-sort visits a later character first. Rejoin only
  // nearby fragments on the same baseline. The horizontal cap keeps distant
  // headings/columns independent.
  let lineChanged=true;
  while(lineChanged){
    lineChanged=false;
    outerLines:for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
      const a=lines[i],b=lines[j],ah=a.lh,bh=b.lh;
      const xGap=Math.max(a.bbox[0]-b.bbox[2],b.bbox[0]-a.bbox[2],0),dy=Math.abs(a.cy-b.cy),reachH=Math.max(ah,bh),rowH=Math.min(ah,bh);
      if(xGap>Math.max(64,reachH*1.8)||dy>Math.max(11,rowH*.52))continue;
      a.items.push(...b.items);a.bbox=boxOf(a.items.map(x=>x.st));a.cy=median(a.items.map(x=>x.cy));a.lh=median(a.items.map(x=>x.h));
      lines.splice(j,1);lineChanged=true;break outerLines;
    }
  }
  let groups=[];
  for(const line of lines){
    // A complete annotation or neighboring expression may overlap another
    // expression's bounding box, so x-overlap alone cannot prove continuity.
    // Keep widely separated writing bursts independent here; the structural
    // passes below can still reconnect fractions/scripts and small later edits.
    const byTime=line.items.slice().sort((a,b)=>(Number(a.st.t0)||0)-(Number(b.st.t0)||0)||a.order-b.order),bursts=[];
    let burst=[];
    for(const item of byTime){
      if(burst.length&&temporalGap(burst,[item])>8000){bursts.push(burst);burst=[];}
      burst.push(item);
    }
    if(burst.length)bursts.push(burst);
    for(const temporal of bursts){
      const items=temporal.slice().sort((a,b)=>a.st.bbox[0]-b.st.bbox[0]);
      const h=Math.max(12,median(items.map(x=>x.h)));let current=[];
      for(const item of items){
        if(current.length){
          const b=boxOf(current.map(x=>x.st));
          const xGap=item.st.bbox[0]-b[2],timeGap=temporalGap(current,[item]);
          // A two-stroke operator may contribute only its vertical stroke to the
          // anchor pass. Leave enough room for the horizontal attachment that is
          // added later, while still splitting genuinely separate columns.
          // Long pen-time gaps become useful evidence only when the spatial join
          // is weak. Strongly touching ink can still reconnect as a later edit.
          if(xGap>Math.max(48,h*1.5)||(timeGap>3000&&xGap>Math.max(10,h*.24))){groups.push(current);current=[];}
        }
        current.push(item);
      }
      if(current.length)groups.push(current);
    }
  }
  const refresh=items=>{
    const strokes=items.map(x=>x.st),bbox=boxOf(strokes),m=boxMetrics(bbox);
    const glyphs=items.filter(x=>!x.bar&&!x.tiny),body=glyphs.length?glyphs:items,
      glyphH=typicalHeight(body.map(x=>x.h)),glyphBBox=boxOf(body.map(x=>x.st));
    return {items,strokes,bbox,...m,glyphH,glyphBBox,glyphCy:median(body.map(x=>x.cy))};
  };
  let comps=groups.map(refresh);
  // Script fragments stay separate until bars/dots have local context. The
  // final coalescing pass below handles them with tighter row-aware geometry;
  // the former early script merge was a major source of adjacent-row pollution.
  // Pair parallel bars before attachment. That keeps '=' together and lets a
  // plus sign's horizontal bar attach to its vertical anchor as one local unit.
  const bars=info.filter(m=>m.bar);
  const barContexts=bar=>{
    const nearby=[];
    for(let i=0;i<comps.length;i++){
      const c=comps[i],h=Math.max(14,c.glyphH||c.h),dy=Math.abs(bar.cy-(c.glyphCy||c.cy)),timeGap=temporalGap([bar],c.items);
      const dx=Math.max(c.bbox[0]-bar.st.bbox[2],bar.st.bbox[0]-c.bbox[2],0);
      if(dy>Math.max(10,h*.48)||dx>Math.max(42,h*1.2))continue;
      if(timeGap>3000&&(dx>h*.24||dy>h*.45))continue;
      nearby.push(i);
    }
    return nearby;
  };
  const barPairs=[];
  for(let i=0;i<bars.length;i++)for(let j=i+1;j<bars.length;j++){
    const a=bars[i],b=bars[j],minW=Math.min(a.w,b.w),maxW=Math.max(a.w,b.w),
      xo=overlap(a.st.bbox[0],a.st.bbox[2],b.st.bbox[0],b.st.bbox[2]),ac=barContexts(a),bc=barContexts(b);
    // Parallel bars only form one symbol when they belong to the same local
    // row/context. Similar x positions on adjacent equations are not evidence
    // for an equals sign and must never create a transitive cross-row union.
    const shared=ac.some(k=>bc.includes(k));
    const seq=sequenceGap([a],[b]);
    if(!shared&&((ac.length||bc.length)||seq>3))continue;
    if(!shared&&temporalGap([a],[b])>3000)continue;
    // Sharing a nearby glyph is not enough to make two horizontal strokes an
    // equals-like symbol. A short cross-stroke inside Theta/pi/A/etc. can sit
    // beside a much longer fraction rule and share exactly the same context.
    // Real '='/'equiv' strokes should still have broadly comparable spans.
    if(minW<maxW*(shared?.55:.68))continue;
    // With no surrounding glyph to identify the row, require the two strokes
    // themselves to look like one equals sign: similar span and nearly the same
    // horizontal center. Merely overlapping is too weak because separate rules
    // or notebook marks can overlap substantially in x.
    if(!shared&&(xo<minW*.72||Math.abs(a.cx-b.cx)>minW*.22))continue;
    const maxDy=shared?Math.max(16,Math.min(a.w,b.w)*.55):16;
    const dy=Math.abs(a.cy-b.cy);
    if(xo<minW*.5||dy>maxDy)continue;
    // Equals is a two-stroke symbol. Rank plausible pairs, then consume each bar
    // at most once so a nearby third bar cannot join through union-find
    // transitivity. Geometry, rather than input-specific IDs or coordinates,
    // decides which pair is the most equals-like.
    const score=dy/Math.max(1,minW)+Math.abs(a.cx-b.cx)/Math.max(1,minW)*1.4+
      (1-minW/Math.max(1,maxW))*.8+Math.min(seq,8)*.02-(shared ? .04 : 0);
    barPairs.push({i,j,score});
  }
  barPairs.sort((a,b)=>a.score-b.score);
  const mate=bars.map(()=>-1);
  for(const pair of barPairs){
    if(mate[pair.i]>=0||mate[pair.j]>=0)continue;
    mate[pair.i]=pair.j;mate[pair.j]=pair.i;
  }
  const emitted=new Set(),barSets=[];
  bars.forEach((bar,i)=>{
    if(emitted.has(i))return;
    const partner=mate[i];
    if(partner>=0){barSets.push([bar,bars[partner]]);emitted.add(partner);}else barSets.push([bar]);
    emitted.add(i);
  });
  for(const set of barSets){
    const part=refresh(set),above=[],below=[];
    if(set.length>=2){
      // A multi-bar relation written inside an already assembled burst belongs
      // to that local burst. Without this check, a late '=' or '\equiv' could
      // use an older neighboring expression as its "left" context and bridge
      // two otherwise separated formulas solely because their bboxes touch.
      let host=-1,hostScore=Infinity;
      for(let i=0;i<comps.length;i++){
        const c=comps[i],b=c.glyphBBox||c.bbox,h=Math.max(14,c.glyphH||c.h),
          dy=Math.abs(part.cy-(c.glyphCy||c.cy)),timeGap=temporalGap(set,c.items);
        if(timeGap>3000||part.cx<b[0]-h*.12||part.cx>b[2]+h*.12||dy>h*.52)continue;
        const score=timeGap/3000+dy/h+Math.abs(part.cx-c.cx)/Math.max(h,c.w)*.25;
        if(score<hostScore){host=i;hostScore=score;}
      }
      if(host>=0){comps[host]=refresh([...comps[host].items,...set]);continue;}
      let left=-1,right=-1,leftScore=Infinity,rightScore=Infinity;
      for(let i=0;i<comps.length;i++){
        const c=comps[i],h=Math.max(14,c.h),dy=Math.abs(part.cy-c.cy),timeGap=temporalGap(set,c.items);
        if(timeGap>8000)continue;
        if(dy>h*.62)continue;
        if(c.bbox[2]<=part.bbox[0]+3){
          const dx=part.bbox[0]-c.bbox[2];
          const score=dx+Math.min(timeGap,8000)/800;
          if(dx<=Math.max(42,h*1.15)&&score<leftScore){left=i;leftScore=score;}
        }
        if(c.bbox[0]>=part.bbox[2]-3){
          const dx=c.bbox[0]-part.bbox[2];
          const score=dx+Math.min(timeGap,8000)/800;
          if(dx<=Math.max(42,h*1.15)&&score<rightScore){right=i;rightScore=score;}
        }
      }
      if(left>=0&&right>=0&&left!==right){
        const hi=Math.max(left,right),lo=Math.min(left,right),merged=refresh([...comps[left].items,...set,...comps[right].items]);
        comps.splice(hi,1);comps.splice(lo,1,merged);continue;
      }
    }
    for(const [i,c] of comps.entries()){
      const xo=overlap(part.bbox[0],part.bbox[2],c.bbox[0],c.bbox[2]),ratio=xo/Math.max(1,Math.min(part.w,c.w));
      const timeGap=temporalGap(set,c.items);
      if(timeGap>8000)continue;
      // A fraction rule spans almost all of its numerator/denominator. A short
      // operator bar merely happening to sit between two lines must never join
      // those lines. Center containment also rejects offset neighboring work.
      // Writers often draw a fraction rule a little shorter than a wide Greek
      // numerator/denominator. Requiring almost full glyph-width coverage split
      // otherwise unambiguous fractions. Keep the test fraction-specific and
      // center-contained, but tolerate a modestly short handwritten rule.
      if(ratio<.65||part.w<c.w*.68||c.cx<part.bbox[0]-part.w*.15||c.cx>part.bbox[2]+part.w*.15)continue;
      const touch=Math.max(4,(c.glyphH||c.h)*.18);
      // Handwritten numerator/denominator ink often touches or slightly crosses
      // the fraction bar. Use the component center to decide the side, allowing
      // a small edge overlap instead of requiring a clean whitespace gap.
      const fractionReach=Math.max(30,c.h*1.05);
      if((c.glyphCy||c.cy)<part.cy&&c.bbox[3]<=part.cy+touch&&part.bbox[1]-c.bbox[3]<=fractionReach)above.push([i,c]);
      if((c.glyphCy||c.cy)>part.cy&&c.bbox[1]>=part.cy-touch&&c.bbox[1]-part.bbox[3]<=fractionReach)below.push([i,c]);
    }
    // Two or more parallel bars are an equals-like local symbol, not a
    // fraction separator. Treating '=' as a candidate fraction is exactly how
    // vertically aligned equations on adjacent notebook lines got bridged.
    if(set.length===1&&above.length&&below.length){
      const ai=above.sort((x,y)=>gap(part.bbox,x[1].bbox).d-gap(part.bbox,y[1].bbox).d)[0][0];
      const bi=below.sort((x,y)=>gap(part.bbox,x[1].bbox).d-gap(part.bbox,y[1].bbox).d)[0][0];
      if(ai!==bi){
        const hi=Math.max(ai,bi),lo=Math.min(ai,bi),merged=refresh([...comps[ai].items,...comps[bi].items,...set]);
        comps.splice(hi,1);comps.splice(lo,1,merged);continue;
      }
    }
    let best=-1,bestScore=Infinity;
    for(let i=0;i<comps.length;i++){
      const c=comps[i],g=gap(part.bbox,c.glyphBBox||c.bbox),dy=Math.abs(part.cy-(c.glyphCy||c.cy)),h=Math.max(14,c.glyphH||c.h),timeGap=temporalGap(set,c.items);
      // Bars already attached to a component must not enlarge the geometry used
      // to attach later bars. Otherwise a real fraction/equality rule can make a
      // nearby contextless notebook mark reachable only after the first merge.
      const lateEdit=set.length<=2&&Math.max(part.w,part.h)<=Math.max(18,h*1.15)&&g.dx<=Math.max(4,h*.12)&&dy<=h*.35;
      if(timeGap>8000&&!lateEdit)continue;
      if(g.dx>h*1.05||dy>h*.68||(timeGap>3000&&(g.dx>h*.24||dy>h*.45)&&!lateEdit))continue;
      const seq=sequenceGap(set,c.items),score=g.dx/h+dy/h*.7+Math.min(seq,8)*.02+Math.min(timeGap,8000)/8000*.35;
      if(score<bestScore){best=i;bestScore=score;}
    }
    if(best>=0)comps[best]=refresh([...comps[best].items,...set]);else comps.push(part);
  }
  for(const item of info.filter(m=>m.tiny)){
    let best=-1,bestScore=Infinity;
    // Pen taps and very short cleanup strokes can be legitimate parts of a
    // multi-stroke glyph. If such a mark lies inside a glyph body's own bbox and
    // was written in the same local burst, keep it there before considering a
    // nearby notebook row whose bbox merely passes close to the point.
    for(let i=0;i<comps.length;i++){
      const c=comps[i],b=c.glyphBBox||c.bbox,timeGap=temporalGap([item],c.items);
      if(timeGap>3000||item.cx<b[0]-2||item.cx>b[2]+2||item.cy<b[1]-2||item.cy>b[3]+2)continue;
      const seq=sequenceGap([item],c.items),score=timeGap/3000+Math.min(seq,8)*.03;
      if(score<bestScore){best=i;bestScore=score;}
    }
    if(best>=0){comps[best]=refresh([...comps[best].items,item]);continue;}
    best=-1;bestScore=Infinity;
    // A small dot directly above a narrow stem is strong local evidence for a
    // dotted glyph. Check that relation before generic proximity so an upper
    // row's plus/descender cannot steal an i-dot in dense notes.
    for(let i=0;i<comps.length;i++)for(const candidate of comps[i].items){
      const b=candidate.st.bbox,cw=b[2]-b[0],ch=b[3]-b[1],dx=Math.abs(candidate.cx-item.cx),dy=b[1]-item.st.bbox[3],timeGap=temporalGap([item],[candidate]);
      if(timeGap>8000)continue;
      if(cw>Math.max(5,ch*.28)||ch<10||dy< -2||dy>Math.max(24,ch*.75)||dx>Math.max(5,cw+3))continue;
      const score=dx/Math.max(1,cw+3)+dy/Math.max(1,ch)+Math.min(timeGap,8000)/8000*.25;
      if(score<bestScore){best=i;bestScore=score*.35;}
    }
    if(best>=0){comps[best]=refresh([...comps[best].items,item]);continue;}
    for(let i=0;i<comps.length;i++){
      const c=comps[i],g=gap(item.st.bbox,c.bbox),h=Math.max(14,c.glyphH||c.h),timeGap=temporalGap([item],c.items);
      if(timeGap>8000)continue;
      if(g.dx>h*.55||g.dy>h*.95)continue;
      // Dots can overlap the bbox of a long stroke from a neighboring row.
      // Prefer the component whose normal glyph center is closest so an i-dot
      // stays with its own baseline even when another row's descender passes by.
      const seq=sequenceGap([item],c.items);
      const score=g.dx/h+g.dy/h+Math.abs(item.cy-(c.glyphCy||c.cy))/h*.35+Math.min(seq,8)*.02+Math.min(timeGap,8000)/8000*.25;
      if(score<bestScore){best=i;bestScore=score;}
    }
    if(best>=0)comps[best]=refresh([...comps[best].items,item]);else comps.push(refresh([item]));
  }
  // The anchor pass intentionally errs toward splitting notebook rows. After
  // bars and dots have acquired local context, rejoin only relationships that
  // are hard to explain as separate rows: adjacent fragments with substantial
  // vertical overlap, or a narrow script/fraction fragment tucked against a
  // much wider expression. This recovers real subscripts that are nearly body
  // height without reopening the old transitive nearby-row bridge.
  // The operator bridge below only runs once the structural rules have
  // converged, so it cannot reorder fraction or script assembly inside an
  // expression written in one burst.
  let comparisons=0;
  for(const bridging of [false,true]){
  let coalesced=true;
  while(coalesced){
    coalesced=false;
    outerCoalesce:for(let i=0;i<comps.length;i++)for(let j=i+1;j<comps.length;j++){
      if(++comparisons>50000){coalesced=false;break outerCoalesce;}
      const a=comps[i],b=comps[j],ah=Math.max(10,a.glyphH),bh=Math.max(10,b.glyphH),h=Math.max(ah,bh);
      const g=gap(a.bbox,b.bbox),yo=overlap(a.bbox[1],a.bbox[3],b.bbox[1],b.bbox[3]);
      const rowH=Math.min(ah,bh),smallLateEdit=c=>c.items.length<=2&&Math.max(c.w,c.h)<=Math.max(18,rowH*1.15);
      const timeGap=temporalGap(a.items,b.items),aTime=temporalBounds(a.items),bTime=temporalBounds(b.items),
        aIsLate=smallLateEdit(a)&&aTime&&bTime&&aTime[0]>=bTime[1],bIsLate=smallLateEdit(b)&&aTime&&bTime&&bTime[0]>=aTime[1],
        lateCandidate=aIsLate?a:(bIsLate?b:null);
      // A late correction is useful evidence only when it is temporally isolated.
      // If another component was written in the same new burst, this small piece
      // is much more likely to be the first glyph/operator of a separate formula.
      // Blocking that first cross-burst join prevents transitive absorption of
      // the rest of the later expression.
      const isolatedLateEdit=lateCandidate&&timeGap>3000&&!comps.some((other,k)=>{
        if(k===i||k===j)return false;
        const localTime=temporalGap(lateCandidate.items,other.items);
        if(localTime>3000)return false;
        const localGap=gap(lateCandidate.bbox,other.bbox),scale=Math.max(10,lateCandidate.glyphH,other.glyphH);
        return localGap.dx<=Math.max(22,scale*.8)&&localGap.dy<=Math.max(18,scale*.7);
      });
      const strongRow=isolatedLateEdit&&g.dx<=2;
      const sameRow=g.dx<=Math.max(16,h*.62)&&yo>=Math.min(ah,bh)*.34&&Math.abs(a.glyphCy-b.glyphCy)<=h*.72&&
        (timeGap<=3000||strongRow);
      // Nested radicals can make the root and numerator form one anchor
      // component before the fraction rule is processed. Recover that structure
      // when a bar-bearing component immediately follows/overlaps it. The short
      // time window and substantial x overlap keep this from becoming a generic
      // row merger.
      const aGlyph=a.glyphBBox||a.bbox,bGlyph=b.glyphBBox||b.bbox,barGap=gap(aGlyph,bGlyph),
        barOverlap=overlap(aGlyph[0],aGlyph[2],bGlyph[0],bGlyph[2]),
        chronologicalComponents=aTime&&bTime&&(aTime[1]<=bTime[0]||bTime[1]<=aTime[0]);
      const barStructure=timeGap<=3000&&(a.items.some(x=>x.bar)||b.items.some(x=>x.bar))&&
        barOverlap>=Math.min(aGlyph[2]-aGlyph[0],bGlyph[2]-bGlyph[0])*.28&&
        barGap.dy<=Math.max(8,rowH*.32)&&Math.abs(a.glyphCy-b.glyphCy)<=Math.max(24,h*1.05);
      // If the bar has already attached to just one side of a fraction, the
      // glyph-only bbox of that component can be too narrow to see the other
      // side. Complete only a real two-sided fraction relation around the actual
      // horizontal rule, with sequential pen timing and strong x containment.
      const completesFraction=(barComp,other)=>{
        if(other.items.some(x=>x.bar))return false;
        const rules=barComp.items.filter(x=>x.bar);
        if(!rules.length)return false;
        const rule=rules.reduce((best,x)=>!best||x.w>best.w?x:best,null);
        const body=barComp.items.filter(x=>!x.bar&&!x.tiny);
        if(!body.length)return false;
        const bodyCy=median(body.map(x=>x.cy)),otherCy=other.glyphCy||other.cy;
        if((bodyCy-rule.cy)*(otherCy-rule.cy)>=0)return false;
        const ob=other.glyphBBox||other.bbox,ow=Math.max(1,ob[2]-ob[0]);
        const xo=overlap(rule.st.bbox[0],rule.st.bbox[2],ob[0],ob[2]);
        const vGap=Math.max(ob[1]-rule.st.bbox[3],rule.st.bbox[1]-ob[3],0);
        const centered=other.cx>=rule.st.bbox[0]-rule.w*.12&&other.cx<=rule.st.bbox[2]+rule.w*.12;
        const covered=ow<=2?centered:xo>=Math.min(ow,rule.w)*.6;
        return covered&&centered&&vGap<=Math.max(30,rowH*1.1);
      };
      const fractionCompletion=timeGap<=3000&&chronologicalComponents&&
        (completesFraction(a,b)||completesFraction(b,a));
      const small=a.w<=b.w?a:b,big=small===a?b:a,bigH=Math.max(10,big.glyphH);
      // Script reach should not inherit an arbitrarily tall integral/radical
      // height. A genuine base is usually within roughly two script heights;
      // cap only the relation scale while retaining the component's real bbox.
      const scriptH=Math.min(bigH,Math.max(10,small.glyphH*2));
      const xo=overlap(small.bbox[0],small.bbox[2],big.bbox[0],big.bbox[2]);
      const seq=sequenceGap(small.items,big.items),smallDim=Math.max(small.w,small.h);
      // Some real multi-stroke capitals contain a long hesitation inside one
      // glyph. In HWRT, for example, an E writer paused about nine seconds after
      // the vertical stem before adding its crossbars. Recover only that highly
      // specific geometry: one narrow stem plus at least two horizontal strokes
      // whose ends attach to the stem. This is not a generic long-pause merge.
      const stemCrossbars=(stemComp,crossComp)=>stemComp.items.some(stem=>{
        const sb=stem.st.bbox,sw=Math.max(.01,sb[2]-sb[0]),sh=Math.max(.01,sb[3]-sb[1]);
        if(sh<12||sh<sw*5)return false;
        const sx=(sb[0]+sb[2])/2;
        let attached=0;
        for(const cross of crossComp.items){
          const cb=cross.st.bbox,cw=Math.max(.01,cb[2]-cb[0]),ch=Math.max(.01,cb[3]-cb[1]);
          if(cw<6||cw<ch*5)continue;
          const cy=(cb[1]+cb[3])/2,edge=Math.min(Math.abs(cb[0]-sx),Math.abs(cb[2]-sx));
          if(edge<=3&&cy>=sb[1]-2&&cy<=sb[3]+2)attached++;
        }
        return attached>=2;
      });
      const delayedGlyphCompletion=chronologicalComponents&&timeGap>8000&&timeGap<=12000&&seq<=1&&
        (stemCrossbars(a,b)||stemCrossbars(b,a));
      // The anchor/burst passes may have deliberately separated a complete
      // neighboring expression after a long pen pause. Script-like geometry
      // must not silently undo that decision. A tiny <=2-stroke correction is
      // the only late exception, matching the same late-edit policy used for a
      // strong same-row join above.
      const structuralTimeOk=timeGap<=8000||(isolatedLateEdit&&lateCandidate===small&&g.dx<=2&&!small.items.some(x=>x.bar)&&(g.dy<=2||small.glyphH<=bigH*.6));
      // Conservative anchor grouping can peel a second stroke off a multi-stroke
      // glyph (P, Omega, dotted i) or split a tightly tucked script body. Restore
      // only immediately consecutive, same-burst pieces whose bboxes actually
      // touch or nearly touch. This deliberately does not use a body-height reach,
      // so a freshly started neighboring row cannot qualify just because it was
      // written quickly after the previous one.
      const componentTouch=chronologicalComponents&&timeGap<=1200&&seq<=1&&g.dx<=3&&g.dy<=Math.max(6,rowH*.18);
      const strokeTouch=a.items.some(x=>b.items.some(y=>{
        if(Math.abs((x.order??0)-(y.order??0))!==1)return false;
        const xt=temporalBounds([x]),yt=temporalBounds([y]);
        if(!xt||!yt||!(xt[1]<=yt[0]||yt[1]<=xt[0])||temporalGap([x],[y])>8000)return false;
        const local=gap(x.st.bbox,y.st.bbox);
        return local.dx<=3&&local.dy<=6;
      }));
      const consecutiveTouch=componentTouch||strokeTouch;
      const tucked=(structuralTimeOk&&small.w<=Math.max(scriptH*2.4,big.w*.45)&&
        (xo>=Math.min(small.w,big.w)*.18||g.dx<=scriptH*.42)&&g.dy<=scriptH*.62&&
        Math.abs(small.glyphCy-big.glyphCy)>=scriptH*.22&&Math.abs(small.glyphCy-big.glyphCy)<=scriptH*.82&&
        small.cx>=big.bbox[0]-scriptH*.3&&small.cx<=big.bbox[2]+scriptH*.7);
      // A right-hand script can be almost as tall as its base. Require a
      // consecutive writing burst and a short horizontal reach instead of
      // assuming that all superscripts fit inside the base's center band.
      const rightScript=timeGap<=1800&&seq<=1&&chronologicalComponents&&
        small.items.length<=4&&small.glyphH<=bigH*.95&&small.w<=bigH*1.5&&
        small.bbox[0]>=big.bbox[2]-bigH*.15&&g.dx<=bigH*.55&&g.dy<=bigH*.4&&
        Math.abs(small.glyphCy-big.glyphCy)>=bigH*.4&&Math.abs(small.glyphCy-big.glyphCy)<=bigH*1.2&&
        !small.items.some(x=>x.bar);
      // An equals sign at an expression edge is evidence that the next
      // same-row component belongs to it, even with generous writing space.
      const edgeEquals=(c,other)=>{
        const horizontal=c.items.filter(x=>x.w>=3&&x.w>=x.h*2.5);
        for(let u=0;u<horizontal.length;u++)for(let v=u+1;v<horizontal.length;v++){
          const x=horizontal[u],y=horizontal[v],dy=Math.abs(x.cy-y.cy);
          if(dy<2||dy>h*.5||overlap(x.st.bbox[0],x.st.bbox[2],y.st.bbox[0],y.st.bbox[2])<Math.min(x.w,y.w)*.35)continue;
          const left=Math.min(x.st.bbox[0],y.st.bbox[0]),right=Math.max(x.st.bbox[2],y.st.bbox[2]);
          if(other.cx>c.cx?right>=c.bbox[2]-h*.2:left<=c.bbox[0]+h*.2)return true;
        }
        return false;
      };
      const equationJoin=timeGap<=1800&&seq<=2&&chronologicalComponents&&
        g.dx<=h*1.2&&yo>0&&Math.abs(a.glyphCy-b.glyphCy)<=h*.8&&
        (edgeEquals(a,b)||edgeEquals(b,a));
      // Short arithmetic such as "12 × 8" is often written as "12", a thinking
      // pause, then "× 8", or with generous space around the operator. The
      // burst and anchor passes then leave the operator at the facing edge of
      // one fragment (or alone between two). A binary operator shape there is
      // hard to explain as a separate expression on the same row, so bridge it
      // regardless of pen timing. The reach stays short and the neighbor must
      // be the nearest same-row fragment, so distant columns remain separate.
      const operatorBridge=bridging&&Math.min(a.bbox[3],b.bbox[3])-Math.max(a.bbox[1],b.bbox[1])>=-2&&
        !comps.some((other,k)=>k!==i&&k!==j&&other.cx>Math.min(a.cx,b.cx)&&other.cx<Math.max(a.cx,b.cx)&&
          overlap(other.bbox[1],other.bbox[3],Math.min(a.bbox[1],b.bbox[1]),Math.max(a.bbox[3],b.bbox[3]))>0)&&
        [[a,b,bh],[b,a,ah]].some(([c,other,rowH])=>{
          // Scale and row band come from the fragment being joined, not from
          // the tallest glyph anywhere, so a radical or bracket cannot extend
          // the reach. The operator itself must sit in that fragment's row.
          const op=g.dx<=rowH*1.6&&Math.abs(c.glyphCy-other.glyphCy)<=rowH*.75&&edgeOperator(c,other,rowH);
          return !!op&&Math.abs((op[1]+op[3])/2-other.glyphCy)<=rowH*.45;
        });
      // Attach a detached overbar to its local glyph, not to the center of
      // an entire expression (which may have a different baseline).
      const overbar=(rule,body)=>rule.items.length===1&&rule.items[0].bar&&body.items.some(glyph=>{
        const bar=rule.items[0],bb=bar.st.bbox,gb=glyph.st.bbox;
        return !glyph.bar&&!glyph.tiny&&sequenceGap([bar],[glyph])<=1&&temporalGap([bar],[glyph])<=1800&&
          bb[3]<=gb[1]+glyph.h*.15&&gb[1]-bb[3]<=glyph.h*.4&&
          bar.w>=glyph.w*.6&&bar.w<=glyph.w*1.5&&
          overlap(bb[0],bb[2],gb[0],gb[2])>=Math.min(bar.w,glyph.w)*.8;
      });
      const accentJoin=overbar(a,b)||overbar(b,a);
      // A detached script or fraction fragment is often almost completely
      // contained in x, shifted roughly one body height, and written immediately
      // before/after the base. Requiring all three signals is much stricter than
      // the old early "small nearby component" merge, which could bridge an
      // adjacent notebook row transitively.
      const fragmentSized=small.items.length<=Math.max(4,Math.ceil(big.items.length*.4));
      const containedScript=(structuralTimeOk&&fragmentSized&&small.glyphH<=bigH*.76&&seq<=2&&
        xo>=Math.max(1,small.w)*.68&&g.dy<=bigH*.24&&
        Math.abs(small.glyphCy-big.glyphCy)>=bigH*.45&&Math.abs(small.glyphCy-big.glyphCy)<=bigH*1.28&&
        small.cx>=big.bbox[0]-bigH*.1&&small.cx<=big.bbox[2]+bigH*.1);
      // Tiny punctuation and ellipsis strokes can be peeled off a long baseline
      // by the conservative anchor pass. Only reattach a tiny fragment when its
      // drawing order is immediately adjacent and its center stays in the body's
      // row band; this lets a chain of dots reconnect without pulling in a
      // neighboring equation.
      const inlineTiny=(structuralTimeOk&&small.items.length<=2&&smallDim<=Math.max(7,bigH*.16)&&seq<=2&&
        g.dx<=bigH*.48&&g.dy<=bigH*.18&&Math.abs(small.glyphCy-big.glyphCy)<=bigH*.42);
      if(!sameRow&&!barStructure&&!fractionCompletion&&!consecutiveTouch&&!delayedGlyphCompletion&&!tucked&&!rightScript&&!equationJoin&&!operatorBridge&&!accentJoin&&!containedScript&&!inlineTiny)continue;
      const merged=refresh([...a.items,...b.items]);comps.splice(j,1);comps.splice(i,1,merged);coalesced=true;break outerCoalesce;
    }
  }
  }
  return comps.map(c=>c.strokes);
}
/* ---- regrouping only where the ink changed ----
   Grouping the whole page compares every piece of ink with every other, so
   on a long note it cost more with every line written, and it ran after
   every pen lift. Nothing groups across more than a couple of rows, so
   after a stroke only the groups near what changed are worked out again,
   together with anything the new grouping reaches, and the rest of the page
   keeps its groups as they were. A group that comes out with the same
   strokes keeps their order too, so its reading is still found under its
   hash. A small page, or a large change, is simply grouped whole. */
const LOCAL_MIN=240;
let grouped=null;
function strokeSig(st){return (st.rev||0)+':'+st.pts.length+':'+st.bbox.join(',');}
function idsKey(list){return list.map(st=>st.id).sort().join(',');}
function remember(strokes,groups){
  const sig=new Map(),box=new Map();
  for(const st of strokes){sig.set(st.id,strokeSig(st));box.set(st.id,st.bbox.slice());}
  const hs=strokes.map(st=>st.bbox[3]-st.bbox[1]).filter(h=>h>2);
  grouped={sig,box,groups:groups.map(g=>g.map(st=>st.id)),h:Math.max(12,typicalHeight(hs.length?hs:[12]))};
  return groups;
}
function groupInk(strokes){
  const prev=grouped;
  if(!prev||strokes.length<LOCAL_MIN)return remember(strokes,mathStrokeGroups(strokes));
  const now=new Map(strokes.map(st=>[st.id,st])),dirty=[];
  for(const st of strokes){
    const was=prev.sig.get(st.id);
    if(was===strokeSig(st))continue;
    dirty.push(st.bbox);if(was!==undefined)dirty.push(prev.box.get(st.id));
  }
  for(const [id,b] of prev.box)if(!now.has(id))dirty.push(b);
  const old=prev.groups.map(ids=>ids.map(id=>now.get(id)).filter(Boolean)).filter(g=>g.length);
  if(!dirty.length)return remember(strokes,old);
  if(dirty.length>Math.max(24,strokes.length*.15))return remember(strokes,mathStrokeGroups(strokes));
  const R=Math.max(160,prev.h*5),boxes=old.map(g=>boxOf(g));
  const near=(b,region)=>region.some(d=>b[0]<=d[2]+R&&b[2]>=d[0]-R&&b[1]<=d[3]+R&&b[3]>=d[1]-R);
  const known=new Set();for(const g of old)for(const st of g)known.add(st.id);
  const orderOf=new Map(strokes.map((st,i)=>[st,i])),take=new Set();
  let region=dirty;
  for(let pass=0;pass<6;pass++){
    boxes.forEach((b,i)=>{if(!take.has(i)&&near(b,region))take.add(i);});
    const inTaken=new Set();for(const i of take)for(const st of old[i])inTaken.add(st.id);
    const subset=strokes.filter(st=>inTaken.has(st.id)||!known.has(st.id));
    const fresh=mathStrokeGroups(subset,orderOf);
    const before=new Map();for(const i of take)before.set(idsKey(old[i]),old[i]);
    // a group that came out differently may now reach groups left alone
    const moved=fresh.filter(g=>!before.has(idsKey(g))).map(g=>boxOf(g));
    if(boxes.some((b,i)=>!take.has(i)&&near(b,moved))){region=region.concat(moved);continue;}
    const kept=old.filter((g,i)=>!take.has(i));
    return remember(strokes,kept.concat(fresh.map(g=>before.get(idsKey(g))||g)));
  }
  return remember(strokes,mathStrokeGroups(strokes));
}
/* a group that runs across a box's side is two pieces of writing */
function splitAtBoxes(groups,boxes){
  if(!boxes.length)return groups;
  const out=[];
  for(const g of groups){
    const by=new Map();
    for(const st of g){const at=boxAt(boxes,(st.bbox[0]+st.bbox[2])/2,(st.bbox[1]+st.bbox[3])/2);if(!by.has(at))by.set(at,[]);by.get(at).push(st);}
    if(by.size<2)out.push(g);else out.push(...by.values());
  }
  return out;
}
function inkOf(strokes){
  const frames=frameInfo(strokes);
  return {frames,ink:frames.ids.size?strokes.filter(s=>!frames.ids.has(s.id)):strokes};
}
function rebuild(){
  const {frames,ink:strokes}=inkOf(S.strokes.filter(s=>s.author==='user'));
  pageFrames=frames;
  const groups=splitAtBoxes(groupInk(strokes),frames.boxes);
  const previous=new Map(S.clusters.map(c=>[c.hash,c]));
  // An explicit Solve request belongs to the ink, not to one grouping of it.
  // Adding a digit or a bracket to an expression changes its hash, so the
  // request is inherited from any earlier cluster that shared its strokes.
  const askedStrokes=new Set();
  for(const c of S.clusters)if(c.asked&&c.source==='ink')for(const id of c.strokeIds)askedStrokes.add(id);
  S.clusters=groups.map(list=>{
    const hash=hashOf(list);
    const legacyHash=list.map(s=>s.id+':'+(s.pts.length/3|0)).sort().join('|');
    const stored=cache.get(hash)||cache.get(legacyHash)||{};
    const saved=compatibleReading(stored,hash)?stored:{};
    const prior=previous.get(hash)||{};
    const inherited=!prior.hash&&!stored.asked&&list.some(s=>askedStrokes.has(s.id));
    return {id:'cl_'+list[0].id,hash,strokeIds:list.map(s=>s.id),
      bbox:[Math.min(...list.map(s=>s.bbox[0])),Math.min(...list.map(s=>s.bbox[1])),Math.max(...list.map(s=>s.bbox[2])),Math.max(...list.map(s=>s.bbox[3]))],
      latex:saved.latex||'',ascii:saved.ascii||'',kind:saved.kind||'expression',confidence:saved.confidence||0,
      needsConfirmation:!!saved.needsConfirmation,modelVersion:saved.modelVersion,alternatives:saved.alternatives||[],confirmed:!!saved.confirmed,review:false,pending:prior.pending||false,asked:!!(stored.asked||prior.asked||inherited),...(stored.dismissed||prior.dismissed?{dismissed:true}:{}),_plotVals:stored.plotVals||prior._plotVals||{},source:'ink'};
  });
  // A neighbor can change expression completeness without changing this
  // cluster's own hash. Recheck cached readings after every grouping rebuild.
  for(const cl of S.clusters)if(!cl.confirmed&&ambiguousGrouping(cl))cl.needsConfirmation=true;
  syncTextTranscripts(textGroups());schedule();scheduleText();
}
function schedule(){
  clearTimeout(timer);
  if(memoryPaused||!enabled()||document.hidden)return;
  timer=setTimeout(async()=>{
    const todo=S.clusters.filter(c=>c.source==='ink'&&!c.latex&&!c.ascii&&!c.pending&&!attempted.has(c.hash));
    for(const cl of todo){if(!enabled()||document.hidden)break;await recognize(cl);}
  },800);
}
function scheduleText(){
  clearTimeout(textTimer);
  if(memoryPaused||!enabled()||document.hidden)return;
  if(textState.broken){if(textHealable())healText();else{if(!textState.memoryBlocked)textTimer=setTimeout(scheduleText,TEXT_RETRY_AFTER);return;}}
  textTimer=setTimeout(readText,TEXT_SETTLE);
}
// The grouping after a stroke waits for the hand to rest, so writing on
// without a rest never restarted the timer above: it ran mid-sentence, read
// half a question, and "hey nota, what is" was taken as asked. Nothing is
// read while the pen is down or has only just lifted.
function penResting(){
  if(!N.ink)return true;
  if(N.ink.drawing&&N.ink.drawing())return false;
  if(!N.ink.now)return true;
  // only this device's pen: someone writing on a shared note elsewhere
  // must not hold this device's reading back
  let last=0;for(const st of S.strokes)if(st.author==='user'&&!st._peer&&st.t1>last)last=st.t1;
  return N.ink.now()-last>=TEXT_REST;
}
async function readText(){
  if(!penResting()){textTimer=setTimeout(readText,400);return;}
  const groups=textGroups();syncTextTranscripts(groups);
  const saved=new Set((S.textTranscripts||[]).map(t=>t.hash));
  // the line just written first: a "hey nota," there should not wait
  // behind the rest of the page
  const latest=g=>{let t=0;for(const id of g.strokeIds){const st=C.strokeById(id);if(st&&st.t1>t)t=st.t1;}return t;};
  const todo=groups.filter(g=>!saved.has(g.hash)&&!textAttempted.has(g.hash)).sort((a,b)=>latest(b)-latest(a));
  for(const group of todo){
    if(!enabled()||document.hidden||textState.broken)break;
    if(!penResting()){textTimer=setTimeout(readText,400);return;}
    await recognizeText(group);
  }
  scheduleIndex();
}
function crop(cl){
  if(!Array.isArray(cl?.bbox)||cl.bbox.length!==4||!cl.bbox.every(Number.isFinite)||cl.bbox[2]<cl.bbox[0]||cl.bbox[3]<cl.bbox[1])throw new Error('invalid stroke bounds');
  const strokes=(cl.strokeIds||[]).map(id=>C.strokeById(id)).filter(Boolean);
  if(!strokes.length||strokes.some(st=>!st.pts?.length||st.pts.length%3!==0||!Array.from(st.pts).every(Number.isFinite)||!Number.isFinite(st.w)||st.w<=0))throw new Error('invalid or empty strokes');
  const pad=12,w=Math.max(12,cl.bbox[2]-cl.bbox[0])+pad*2,h=Math.max(12,cl.bbox[3]-cl.bbox[1])+pad*2;
  const scale=Math.min(2,1000/w,500/h);
  const cv=document.createElement('canvas');cv.width=Math.ceil(w*scale);cv.height=Math.ceil(h*scale);
  const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,cv.width,cv.height);
  ctx.scale(scale,scale);ctx.translate(-cl.bbox[0]+pad,-cl.bbox[1]+pad);ctx.strokeStyle='#111';ctx.fillStyle='#111';ctx.lineCap='round';ctx.lineJoin='round';
  for(const id of cl.strokeIds){const st=C.strokeById(id);if(!st)continue;
    const p=st.pts;for(let i=3;i<p.length;i+=3){ctx.beginPath();ctx.moveTo(p[i-3],p[i-2]);ctx.lineTo(p[i],p[i+1]);ctx.lineWidth=st.w*(.55+.9*p[i+2]);ctx.stroke();}
    if(p.length<6){ctx.beginPath();ctx.arc(p[0],p[1],st.w*.6,0,Math.PI*2);ctx.fill();}
  }
  return cv;
}
function temporalGlyphBundles(cl){
  const strokes=cl.strokeIds.map(id=>C.strokeById(id)).filter(Boolean).slice().sort((a,b)=>(a.t0||0)-(b.t0||0));
  if(strokes.length<2)return strokes.map(st=>({strokes:[st],bbox:st.bbox.slice(),t0:st.t0||0,t1:st.t1||st.t0||0}));
  const gaps=[];
  for(let i=1;i<strokes.length;i++)gaps.push(Math.max(0,(strokes[i].t0||0)-(strokes[i-1].t1||strokes[i-1].t0||0)));
  const sorted=gaps.filter(Number.isFinite).sort((a,b)=>a-b);let joinGap=35,bestRatio=1;
  for(let i=1;i<sorted.length;i++){
    const lo=Math.max(1,sorted[i-1]),hi=sorted[i],ratio=hi/lo;
    if(hi>=25&&ratio>bestRatio&&ratio>=1.8){bestRatio=ratio;joinGap=(lo+hi)/2;}
  }
  const boxesNear=(a,b)=>{
    const am=boxMetrics(a),bm=boxMetrics(b),xo=overlap(a[0],a[2],b[0],b[2]),yo=overlap(a[1],a[3],b[1],b[3]);
    if(xo>0&&yo>0)return true;
    const verticalGap=Math.max(a[1]-b[3],b[1]-a[3],0),horizontalGap=Math.max(a[0]-b[2],b[0]-a[2],0);
    const alignedX=xo>=Math.min(am.w,bm.w)*.55;
    const tiny=Math.min(am.w,am.h,bm.w,bm.h)<=4;
    if(alignedX&&verticalGap<=Math.max(14,Math.max(am.h,bm.h)*.7))return true; // = bars or i dot/stem
    return horizontalGap<=3&&verticalGap<=3;
  };
  const bundles=[];
  for(const st of strokes){
    const last=bundles[bundles.length-1],start=st.t0||0;
    if(last){
      const timeGap=Math.max(0,start-last.t1);
      if(timeGap<=joinGap&&boxesNear(last.bbox,st.bbox)){
        last.strokes.push(st);last.bbox=boxOf(last.strokes);last.t1=Math.max(last.t1,st.t1||start);continue;
      }
    }
    bundles.push({strokes:[st],bbox:st.bbox.slice(),t0:start,t1:st.t1||start});
  }
  return bundles;
}
function linearizedCrop(cl){
  const bundles=temporalGlyphBundles(cl);
  if(bundles.length<3)return null;
  const dims=bundles.map(b=>boxMetrics(b.bbox)),heights=dims.map(m=>m.h).filter(h=>h>4),typH=Math.max(12,typicalHeight(heights.length?heights:dims.map(m=>m.h)));
  const body=bundles.filter((b,i)=>dims[i].h>=typH*.45);
  if(body.length>=2){
    const bottoms=body.map(b=>b.bbox[3]),centers=body.map(b=>(b.bbox[1]+b.bbox[3])/2);
    if(Math.max(...bottoms)-Math.min(...bottoms)>Math.max(8,typH*.32)||Math.max(...centers)-Math.min(...centers)>Math.max(10,typH*.5))return null;
  }
  const ordered=bundles.slice().sort((a,b)=>a.bbox[0]-b.bbox[0]||a.t0-b.t0),minGap=Math.max(6,typH*.18),offsets=new Map();
  let cursor=ordered[0].bbox[0],added=0;
  for(const bundle of ordered){
    const shift=Math.max(0,cursor-bundle.bbox[0]);
    for(const st of bundle.strokes)offsets.set(st.id,shift);
    added=Math.max(added,shift);cursor=bundle.bbox[2]+shift+minGap;
  }
  // Do not perturb normally spaced handwriting. This path is for genuinely
  // compressed online ink where multiple glyph boxes overlap or nearly touch.
  if(added<typH*.2)return null;
  const minX=Math.min(...ordered.flatMap(b=>b.strokes.map(st=>st.bbox[0]+(offsets.get(st.id)||0)))),
    maxX=Math.max(...ordered.flatMap(b=>b.strokes.map(st=>st.bbox[2]+(offsets.get(st.id)||0)))),pad=12,
    minY=cl.bbox[1],maxY=cl.bbox[3],w=Math.max(12,maxX-minX)+pad*2,h=Math.max(12,maxY-minY)+pad*2,
    scale=Math.min(2,1000/w,500/h),cv=document.createElement('canvas');
  cv.width=Math.ceil(w*scale);cv.height=Math.ceil(h*scale);
  const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,cv.width,cv.height);
  ctx.scale(scale,scale);ctx.translate(-minX+pad,-minY+pad);ctx.strokeStyle='#111';ctx.fillStyle='#111';ctx.lineCap='round';ctx.lineJoin='round';
  for(const bundle of ordered)for(const st of bundle.strokes){
    const dx=offsets.get(st.id)||0,p=st.pts;
    for(let i=3;i<p.length;i+=3){ctx.beginPath();ctx.moveTo(p[i-3]+dx,p[i-2]);ctx.lineTo(p[i]+dx,p[i+1]);ctx.lineWidth=st.w*(.55+.9*p[i+2]);ctx.stroke();}
    if(p.length<6){ctx.beginPath();ctx.arc(p[0]+dx,p[1],st.w*.6,0,Math.PI*2);ctx.fill();}
  }
  cv._notasGlyphCount=bundles.length;
  return cv;
}
function textCrop(group,byId){
  byId=byId||C.strokeById;
  const inkH=Math.max(8,group.bbox[3]-group.bbox[1]);
  const pad=Math.max(4,Math.min(10,Math.round(inkH*.16)));
  const w=Math.max(12,group.bbox[2]-group.bbox[0])+pad*2;
  const h=Math.max(12,group.bbox[3]-group.bbox[1])+pad*2;
  const scale=Math.min(2,1800/w,500/h);
  const cv=document.createElement('canvas');cv.width=Math.ceil(w*scale);cv.height=Math.ceil(h*scale);
  const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,cv.width,cv.height);
  ctx.scale(scale,scale);ctx.translate(-group.bbox[0]+pad,-group.bbox[1]+pad);
  ctx.strokeStyle='#111';ctx.fillStyle='#111';ctx.lineCap='round';ctx.lineJoin='round';
  for(const id of group.strokeIds){
    const st=byId(id);if(!st)continue;
    const p=st.pts;
    for(let i=3;i<p.length;i+=3){
      ctx.beginPath();ctx.moveTo(p[i-3],p[i-2]);ctx.lineTo(p[i],p[i+1]);
      ctx.lineWidth=st.w*(.55+.9*p[i+2]);ctx.stroke();
    }
    if(p.length<6){ctx.beginPath();ctx.arc(p[0],p[1],st.w*.6,0,Math.PI*2);ctx.fill();}
  }
  return cv;
}
function textInfer(canvas,valid){
  const task=textQueue.catch(()=>{}).then(async()=>{
      const restart=textRestartSeq;
      for(let attempt=0;attempt<2;attempt++){
        if(!valid())throw new DOMException('Writing changed','AbortError');
        try{
          await setupText();
          if(!valid())throw new DOMException('Writing changed','AbortError');
          const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
          return await textSend({type:'recognize',width:canvas.width,height:canvas.height,buffer:pixels.data.buffer},[pixels.data.buffer],45000);
        }catch(error){
          if(error.name==='AbortError'||restart!==textRestartSeq)throw new DOMException('Handwriting search restarted','AbortError');
          textBroke(error);stopText(readerError(error).message);
          if(attempt||!(error.memory||memoryFailure(error)))throw readerError(error);
          release();healText();
        }
      }
  });
  textQueue=task;return task;
}
// Whether the lassoed ink has a reading the page can use: none of its
// clusters read (never, or not yet), one that failed, one the reader is
// unsure of (prose comes out this way: "hello" read as helL_0 and marked
// to be checked), or one the calculator could make nothing of. The
// selection bar offers nota then.
function selectionUnread(ids){
  const set=new Set(ids),mine=S.clusters.filter(c=>c.strokeIds.some(id=>set.has(id)));
  if(!mine.length)return true;
  if(mine.some(c=>c.review||c.error||(!c.confirmed&&c.needsConfirmation)||(!c.pending&&!String(c.latex||c.ascii||'').trim())))return true;
  return (S.nodes||[]).some(n=>n.kind==='cluster'&&n.ref&&mine.includes(n.ref)&&n.error);
}
// One reading of the chosen strokes as a line of text, for a question
// nota is asked outright. What the maths reader made of them, if
// anything, goes along as a second opinion. Asking is explicit, so it
// reads even with handwriting reading turned off in settings.
async function readStrokesText(ids){
  const strokes=ids.map(id=>C.strokeById(id)).filter(Boolean);
  if(!strokes.length)return {text:'',confidence:0,maths:''};
  const set=new Set(ids),maths=S.clusters.filter(c=>c.strokeIds.some(id=>set.has(id))).map(c=>String(c.ascii||c.latex||'').trim()).filter(Boolean).join(' ');
  const group={hash:'ask:'+hashOf(strokes),strokeIds:strokes.map(s=>s.id),bbox:boxOf(strokes)};
  const generation=epoch,note=S.id,valid=()=>generation===epoch&&S.id===note;
  if(textState.broken)healText();
  let text='',confidence=0,error='';
  try{const out=await textInfer(textCrop(group),valid);text=String(out.text||'').trim();confidence=Number(out.confidence)||0;}
  catch(e){if(e.name!=='AbortError')error=String(e.message||e);}
  return {text,confidence,maths,error,bbox:group.bbox};
}
async function recognizeText(group){
  const generation=epoch,note=S.id,hash=group.hash;
  const valid=()=>generation===epoch&&S.id===note&&enabled()&&textGroups().some(g=>g.hash===hash);
  if(!valid())return;
  textAttempted.add(hash);
  try{
    const out=await textInfer(textCrop(group),valid);if(!valid())return;
    const text=String(out.text||'').trim(),confidence=Number(out.confidence)||0;
    // "hey nota," is a question to the page. Nota sees every reading, quiet
    // ones included, and applies its own floor; the reading itself stays
    // search metadata and never feeds the maths evaluator.
    if(N.nota&&text)try{N.nota.onTranscript({hash,text,confidence},group);}catch(e){}
    // Blank/noise-only and low-confidence readings add more search noise than
    // value. Fuzzy matching still recovers small mistakes above the calibrated
    // confidence floor.
    if(!validText(text,confidence))return;
    const item={hash,text,confidence,modelVersion:TEXT_VERSION};
    if(!Array.isArray(S.textTranscripts))S.textTranscripts=[];
    const at=S.textTranscripts.findIndex(t=>t.hash===hash);
    if(at<0)S.textTranscripts.push(item);else S.textTranscripts[at]=item;
    C.markDirty();
  }catch(e){
    if(e.name!=='AbortError')textAttempted.delete(hash);
  }
}

/* ---- the other notes, read in the background ----
   Search finds handwriting through the transcripts saved beside each note,
   and a note only got them while it was open and the pen had paused: a
   note from before the text reader arrived, or read under an older model,
   was invisible to search until it was opened again. So while the page is
   quiet the other notes are read here, a line at a time, and their
   transcripts written back beside them. The open note comes first: a line
   of it waiting to be read makes this stand aside. A note is written back
   under the same lock the saves take and with its revision untouched, so a
   tab that has it open sees no conflict, and the note's own reading, when
   it is next opened, simply finds the work done. What has been read is
   remembered per note against its last change, so a launch costs nothing
   when nothing is new. */
const INDEX_KEY='notas.textindex';
let indexTimer=null,indexing=false,indexEpoch=0;
function scheduleIndex(delay){
  clearTimeout(indexTimer);
  if(memoryPaused||!enabled()||document.hidden||textState.broken||!textSupported())return;
  indexTimer=setTimeout(()=>{indexOthers().catch(()=>{});},delay==null?6000:delay);
}
function textSupported(){return !!(window.Worker&&window.OffscreenCanvas&&/^https?:$/.test(location.protocol));}
async function indexDone(){
  try{const d=await C.Store.get(INDEX_KEY);return d&&d.version===TEXT_VERSION&&d.notes&&typeof d.notes==='object'?d.notes:{};}
  catch(e){return {};}
}
// the open note has a line waiting for the reader: it goes first
function openNoteBusy(){
  const saved=new Set((S.textTranscripts||[]).map(t=>t.hash));
  return textGroups().some(g=>!saved.has(g.hash)&&!textAttempted.has(g.hash));
}
const idle=()=>new Promise(r=>window.requestIdleCallback?requestIdleCallback(r,{timeout:4000}):setTimeout(r,300));
function textGroupsOfDoc(doc){
  const strokes=(doc.strokes||[]).filter(s=>s&&s.author==='user'&&Array.isArray(s.pts)&&s.pts.length>=3&&Array.isArray(s.bbox)&&s.bbox.length===4);
  if(!strokes.length)return {groups:[],byId:()=>null};
  const map=new Map(strokes.map(s=>[s.id,s])),byId=id=>map.get(id)||null;
  const {frames,ink}=inkOf(strokes);
  const clusters=splitAtBoxes(mathStrokeGroups(ink),frames.boxes).map(list=>({source:'ink',strokeIds:list.map(s=>s.id),bbox:boxOf(list)}));
  return {groups:textGroups(clusters,byId,frames),byId};
}
async function indexOthers(){
  if(indexing)return;
  const generation=++indexEpoch;
  const live=()=>generation===indexEpoch&&enabled()&&!document.hidden&&!textState.broken;
  if(!live())return;
  indexing=true;
  try{
    const done=await indexDone(),rows=await C.Store.index();
    const keep={};for(const row of rows)if(done[row.id]!==undefined)keep[row.id]=done[row.id];
    let dirty=Object.keys(keep).length!==Object.keys(done).length;   /* a deleted note leaves the record */
    for(const row of rows){
      if(!live())break;
      if(!row||!row.id||row.id===S.id||keep[row.id]===(row.updated||0))continue;
      if(openNoteBusy()){scheduleIndex(8000);break;}
      await idle();if(!live())break;
      const key='notas.note.'+row.id,doc=await C.Store.get(key);
      if(!doc||row.id===S.id){continue;}
      const {groups,byId}=textGroupsOfDoc(doc);
      const have=new Map((doc.textTranscripts||[]).filter(t=>t&&t.hash&&t.modelVersion===TEXT_VERSION&&validText(t.text,t.confidence)).map(t=>[t.hash,t]));
      const todo=groups.filter(g=>!have.has(g.hash));
      const read=new Map();
      let complete=true;
      for(const group of todo){
        if(!live()||openNoteBusy()){complete=false;break;}
        await idle();if(!live()){complete=false;break;}
        try{
          const out=await textInfer(textCrop(group,byId),live);
          const text=String(out.text||'').trim(),confidence=Number(out.confidence)||0;
          if(validText(text,confidence))read.set(group.hash,{hash:group.hash,text,confidence,modelVersion:TEXT_VERSION});
        }catch(e){
          if(e.name==='AbortError'||!live()){complete=false;break;}
        }
      }
      if(read.size){
        await C.withNoteLock(row.id,async()=>{
          const fresh=await C.Store.get(key);if(!fresh)return;
          fresh.textTranscripts=(fresh.textTranscripts||[]).filter(t=>t&&t.hash&&!read.has(t.hash)).concat([...read.values()]);
          await C.Store.set(key,fresh);
        });
      }
      if(!complete){if(live())scheduleIndex(8000);break;}
      keep[row.id]=row.updated||0;dirty=false;
      await C.Store.set(INDEX_KEY,{version:TEXT_VERSION,notes:keep});
    }
    if(dirty)await C.Store.set(INDEX_KEY,{version:TEXT_VERSION,notes:keep});
  }finally{indexing=false;}
}
function inferInk(cl,valid){
  const task=queue.catch(()=>{}).then(async()=>{
    if(!valid())throw new DOMException('Writing changed','AbortError');
    const e=state('ink');
    if(e.broken)throw new Error(inkError||'handwriting unavailable. tap retry.');
    const strokes=cl.strokeIds.map(id=>C.strokeById(id)).filter(Boolean).map(st=>({t0:st.t0,t1:st.t1,pts:st.pts,
      ...(Array.isArray(st.times)&&st.times.length===st.pts.length/3?{times:st.times}: {})}));
    if(!strokes.length)return null;
    const at=restartSeq;
    try{
      // the stroke reader loads on first use; the waiting chip says so at once
      for(let attempt=0;attempt<2;attempt++){
      try{
      const loading=setup('ink');
      if(!e.ready&&N.mathcore.refreshWaiting)N.mathcore.refreshWaiting();
      await loading;if(!valid())throw new DOMException('Writing changed','AbortError');
      active=valid;
      try{return {...await send('ink',{type:'recognize',strokes},[],ENGINES.ink.run),engine:'ink'};}
      finally{active=null;}
      }catch(error){
        if(attempt||error.name==='AbortError'||!valid()||at!==restartSeq||!(error.memory||memoryFailure(error)))throw error;
        stop('Restarting handwriting recognition','ink');release();
        report('restarting handwriting recognition.',false,true);
      }
      }
    }catch(error){
      if(error.name==='AbortError'||!valid()||at!==restartSeq)throw new DOMException('Writing changed','AbortError');
      e.broken=true;stop('handwriting unavailable','ink');
      error=readerError(error);
      inkError=error?.message||'handwriting could not run.';
      status.title=inkError;
      report('handwriting unavailable, retry.',true,true);
      if(!warned){warned=true;C.toast('handwriting unavailable, '+inkError);}
      throw error;
    }
  });
  queue=task;return task;
}
function usableInk(out){
  return !!out&&out.engine==='ink'&&out.truncated!==true&&out.terminated!==false&&
    Number(out.confidence)>=INK_CONFIDENCE_MIN&&!!String(out.latex||'').trim();
}
function inkTextAlternatives(out){
  if(!out||out.engine!=='ink'||out.terminated!==true||out.truncated)return [];
  const compact=s=>N.mathcore.latexToMath(String(s||'')).replace(/\s+/g,'');
  const primary=compact(out.latex),flat=/^(?:\d+(?:\.\d+)?|[A-Za-z])[+*/-](?:\d+(?:\.\d+)?|[A-Za-z])=?$/;
  if(!flat.test(primary))return [];
  return (out.alternatives||[]).filter(candidate=>{
    const next=compact(candidate);if(!flat.test(next)||next.length!==primary.length)return false;
    let differences=0;
    for(let i=0;i<next.length;i++)if(next[i]!==primary[i]){
      if(!/[A-Za-z0-9]/.test(next[i])||!/[A-Za-z0-9]/.test(primary[i])||++differences>1)return false;
    }
    return differences===1;
  });
}
function textSupportedInk(out,text){
  if(!(Number(text?.confidence)>=.97))return out;
  const compact=s=>N.mathcore.latexToMath(String(s||'')).replace(/\s+/g,'');
  const latex=inkTextAlternatives(out).find(candidate=>compact(candidate)===compact(text.text));
  if(!latex)return out;
  // Independent text evidence selects an existing complete math hypothesis.
  // Keep the original uncertainty and require review; never infer a digit from
  // whether it makes an expression solvable or from a personal example lookup.
  return {...out,latex,wordSource:'text-and-ink-alternative',
    alternatives:[out.latex,...(out.alternatives||[])].filter((s,i,a)=>s!==latex&&a.indexOf(s)===i).slice(0,4)};
}
// A low-confidence number can be a split letter in a short variable equation.
// Select only a unique, already-completed ink hypothesis corroborated by the
// independent text reader. Keep it unconfirmed; this is not an accuracy claim.
function textSupportedEquation(out,text){
  if(out?.engine!=='ink'||out.terminated!==true||out.truncated||!(out.confidence>=.70&&out.confidence<.85)||!(text?.confidence>=.80))return out;
  const compact=s=>N.mathcore.latexToMath(String(s||'')).replace(/\s+/g,'');
  const primary=compact(out.latex).match(/^(\d{1,3})=([A-Za-z])$/);
  if(!primary)return out;
  const reading=compact(text.text);
  const candidates=[...new Set(out.alternatives||[])].filter(candidate=>{
    const next=compact(candidate),match=next.match(/^([A-Za-z])=([A-Za-z])$/);
    return match&&match[2]===primary[2]&&next.toLowerCase()===reading.toLowerCase();
  });
  // Case alone is not decided by text OCR. Multiple case variants must abstain.
  if(candidates.length!==1)return out;
  const latex=candidates[0];
  return {...out,latex,wordSource:'text-and-ink-alternative',alternatives:[out.latex,...out.alternatives].filter((s,i,a)=>s!==latex&&a.indexOf(s)===i).slice(0,4)};
}
// These are decoder likelihoods, not probabilities that a formula is correct.
// The acceptance floor is selected on development expressions and evaluated
// separately from transcription accuracy. A reading under the floor stays
// editable and requires an explicit Solve.
function ambiguousGrouping(cl){
  if(!cl?.strokeIds?.length)return false;
  const ids=new Set(cl.strokeIds),inside=S.strokes.filter(s=>ids.has(s.id));
  const h=Math.max(12,typicalHeight(inside.map(s=>s.bbox[3]-s.bbox[1])));
  return S.clusters.some(other=>{
    if(other===cl||!other.strokeIds?.length||!other.bbox)return false;
    // The scale below is at most twice h: a cluster further off than that
    // can never count, and is passed over before its strokes are looked up.
    const g=gap(cl.bbox,other.bbox);
    if(g.dx>h*3||g.dy>h*2.4)return false;
    if(other.strokeIds.some(id=>ids.has(id)))return false;
    const outside=other.strokeIds.map(id=>C.strokeById(id)).filter(Boolean);
    if(!outside.length)return false;
    const a=inside.map(st=>({st})),b=outside.map(st=>({st}));
    if(temporalGap(a,b)>8000)return false;
    const scale=Math.max(h,Math.min(h*2,typicalHeight(outside.map(s=>s.bbox[3]-s.bbox[1]))));
    return g.dx<=scale*1.5&&g.dy<=scale*1.2;
  });
}
function needsConfirmation(out,cl){
  return !usableInk(out)||Number(out.confidence)<.92||
    !(Number(out.minTokenConfidence)>=.9)||!!out.wordSource||!!out.geometryRepair||ambiguousGrouping(cl);
}
const RESERVED_WORD=/^(?:sin|cos|tan|log|ln|exp|lim|sqrt|pi)$/i;
function editDistanceAtMostOne(a,b){
  if(a===b)return true;
  if(Math.abs(a.length-b.length)>1)return false;
  if(a.length===b.length){let misses=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i]&&++misses>1)return false;return true;}
  if(a.length>b.length)[a,b]=[b,a];
  let i=0,j=0,misses=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;}else{if(++misses>1)return false;j++;}}
  return true;
}
function identifierRepairCompatible(a,b){
  const x=String(a),y=String(b);
  if(x.toLowerCase()===y.toLowerCase())return false; // preserve case-only identity
  if(x.length!==y.length)return editDistanceAtMostOne(x.toLowerCase(),y.toLowerCase());
  let misses=0;
  for(let i=0;i<x.length;i++)if(x[i].toLowerCase()!==y[i].toLowerCase()){
    // Do not silently turn a letter into a digit or vice versa.
    if(/[A-Za-z]/.test(x[i])!==/[A-Za-z]/.test(y[i])||/[0-9]/.test(x[i])!==/[0-9]/.test(y[i]))return false;
    if(++misses>1)return false;
  }
  return misses===1;
}
function identifierEvidence(src,name,mathOut,textConfidence=0){
  const token=String(src||'').trim();
  // Internal whitespace, punctuation and math operators are meaningful math.
  // Never collapse x y, h*i, h:i or h.i into a single identifier.
  if(!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(token)||RESERVED_WORD.test(token))return false;
  if(token===name)return true;
  // A confident formula reading owns symbol identity, including case and
  // letter-vs-digit distinctions. Very strong text may repair one letter when
  // the formula beam is itself uncertain, which is useful for image-only names.
  const mathConfidence=Number(mathOut?.confidence)||0,margin=Number(mathOut?.margin??Infinity);
  if(mathConfidence<.8)return editDistanceAtMostOne(token,name);
  const uncertain=mathConfidence<.9&&Number(textConfidence)>=.97&&margin<.75;
  return uncertain&&identifierRepairCompatible(token,name);
}
function fusedMultiplyEvidence(src,named,geometry,mathOut){
  if(!named||named[2]!=='*'||geometry?.name!==named[1]||geometry.operator!=='*')return false;
  const confidence=Number(mathOut?.confidence)||0,margin=Number(mathOut?.margin??Infinity);
  if(confidence>=.8||margin>=.45)return false;
  const compact=String(src||'').replace(/\s+/g,''),tail=named[3].replace(/\s+/g,'');
  // A common low-confidence sequence failure is one identifier character read
  // as punctuation and the multiplication cross read as terminal x/X. Only
  // repair that shape when stroke geometry independently finds the cross and
  // the numeric tail agrees. Explicit h*i, h:i, h.i and x y structures do not
  // match this terminal-cross form and remain untouched.
  const m=compact.match(/^(.+?)[xX](\d+(?:\.\d+)?=?$)/);
  if(!m||m[2]!==tail||m[1].length!==named[1].length)return false;
  let misses=0;
  for(let i=0;i<m[1].length;i++){
    const a=m[1][i],b=named[1][i];
    if(a===b)continue;
    if(++misses>1)return false;
    if(/[=+*/]/.test(a))return false;
    if(/[A-Za-z0-9]/.test(a)&&/[A-Za-z0-9]/.test(b)&&
       (/[A-Za-z]/.test(a)!==/[A-Za-z]/.test(b)||/[0-9]/.test(a)!==/[0-9]/.test(b)))return false;
  }
  return misses===1;
}
// A text recognizer supplies word identity, while the formula recognizer keeps
// the mathematical structure. Never choose a spelling merely because it is a
// known variable, or repair digits/operators to make an equation solvable.
function wordReading(mathOut,textOut,geometry=null){
  if(!textOut||!mathOut?.latex)return mathOut;
  const raw=String(mathOut.latex),text=String(textOut.text||'').trim()
    .replace(/[×✕✖]/g,'*').replace(/÷/g,'/').replace(/[−–—]/g,'-');
  // The text model contributes identifier identity only. Accept any ordinary
  // Latin identifier, including a single letter or digit suffix, without a
  // vocabulary of known variable names.
  const named=text.match(/^([A-Za-z][A-Za-z0-9]{0,31})\s*([=+*/-])\s*(\d+(?:\.\d+)?\s*=?\s*)$/);
  const confidence=Number(textOut.confidence)||0;
  const knownName=!!(named&&S.scope&&Object.prototype.hasOwnProperty.call(S.scope,named[1]));
  const geometryAgrees=!!(named&&geometry?.name===named[1]&&geometry.operator===named[2]);
  // Repeated variables get a small consistency boost from an earlier
  // assignment, but scope membership never creates a reading by itself. There
  // must still be fairly strong text evidence, or independent stroke geometry.
  if(confidence<.9&&!(confidence>=.84&&(knownName||geometryAgrees)))return mathOut;
  const src=N.mathcore.latexToMath(raw);
  const functionPrefix=src.match(/^\s*(sin|cos|tan|log|ln|exp|lim)\s+([A-Za-z]+)\s*[=+*/-]/i);
  const joinedFunction=named&&functionPrefix&&(functionPrefix[1]+functionPrefix[2]).toLowerCase()===named[1].toLowerCase();
  const script=raw.match(/^([A-Za-z])_\{?([A-Za-z])\}?\s*(?:[=+*/-]|\\(?:times|cdot)\b)/);
  const simpleGeometry=!/[\^]|\\(?:frac|dfrac|tfrac|sqrt|begin|sum|int|prod|lim)\b/.test(raw)&&
    (!raw.includes('_')||(script&&named&&script[1]+script[2]===named[1]&&raw.split('_').length===2));
  if(simpleGeometry&&!joinedFunction&&named&&!RESERVED_WORD.test(named[1])&&
     fusedMultiplyEvidence(src,named,geometry,mathOut)){
    const latex=named[1]+' * '+named[3].trim();
    return {...mathOut,latex,wordSource:'text-and-geometry',alternatives:[raw,...(mathOut.alternatives||[])].filter((v,i,a)=>v!==latex&&a.indexOf(v)===i).slice(0,4)};
  }
  // For a simple named quantity, ink geometry can independently corroborate
  // baseline letters and the operator. This recovers a baseline i that the
  // formula decoder called a subscript or a colon, without flattening real
  // scripts. A matching numeric tail is still required from both models.
  if(simpleGeometry&&!joinedFunction&&named&&geometry?.name===named[1]&&geometry.operator===named[2]&&
     !RESERVED_WORD.test(named[1])){
    const structure=src.match(/^\s*(.*?)\s*([=+*/-])\s*(\d+(?:\.\d+)?\s*=?\s*)$/),
      lhs=structure?.[1]||'',numericTail=structure?.[3]||'';
    const baselineScript=!!(script&&script[1]+script[2]===named[1]);
    const knownReservedRepair=knownName&&confidence>=.97&&RESERVED_WORD.test(lhs.trim())&&Number(mathOut.margin??Infinity)<1;
    if(structure?.[2]===named[2]&&(identifierEvidence(lhs,named[1],mathOut,confidence)||baselineScript||knownReservedRepair)&&
       numericTail.replace(/\s/g,'')===named[3].replace(/\s/g,'')){
      const latex=named[1]+' '+named[2]+' '+named[3].trim();
      return {...mathOut,latex,wordSource:'text-and-geometry',alternatives:[raw,...(mathOut.alternatives||[])].filter((v,i,a)=>v!==latex&&a.indexOf(v)===i).slice(0,4)};
    }
  }
  // The text model is not a 2-D math recognizer. Preserve scripts, fractions,
  // roots, matrices and explicit function arguments exactly as math read them.
  if(/[{}^_]/.test(raw)||/\\(?!sin\b|cos\b|tan\b|log\b|ln\b|times\b|cdot\b|div\b)[A-Za-z]+/.test(raw))return mathOut;
  const m=src.match(/^\s*([A-Za-z][A-Za-z0-9]{0,31})\s*([=+*/-])\s*(.*?)\s*$/);
  const t=text.match(/^([A-Za-z][A-Za-z0-9]{0,31})\s*([=+*/-])\s*(.*?)\s*$/);
  if(!m||!t||RESERVED_WORD.test(t[1])||RESERVED_WORD.test(m[1]))return mathOut;
  // A text model often collapses '=' into '-'. Only borrow the word in that
  // case; the independent formula reading still determines the operator.
  if(m[2]!==t[2]&&!(m[2]==='='&&t[2]==='-'))return mathOut;
  const compact=s=>s.replace(/\s+/g,'');
  if(!m[3]||compact(m[3])!==compact(t[3])||!/[0-9]/.test(m[3]))return mathOut;
  // Do not turn a correctly recognized function into a joined identifier.
  if(/^(sin|cos|tan|log|ln|exp|lim)\s+[A-Za-z]/i.test(m[1].trim())&&
     compact(m[1]).toLowerCase()===t[1].toLowerCase())return mathOut;
  if(!identifierEvidence(m[1],t[1],mathOut,confidence))return mathOut;
  const latex=t[1]+' '+m[2]+' '+m[3];
  if(compact(src)===compact(latex)&&!/[A-Za-z]\s+[A-Za-z]/.test(m[1]))return mathOut;
  return {...mathOut,latex,wordSource:'text',alternatives:[raw,...(mathOut.alternatives||[])].filter((v,i,a)=>v!==latex&&a.indexOf(v)===i).slice(0,4)};
}
function strokeWordGeometry(text,source){
  if(!source?.strokeIds?.length)return null;
  const match=String(text||'').trim().replace(/[×✕✖]/g,'*').replace(/[−–—]/g,'-')
    .match(/^([A-Za-z][A-Za-z0-9]{0,31})\s*([=+*-])\s*\d+(?:\.\d+)?\s*=?$/);
  if(!match)return null;
  const strokes=source.strokeIds.map(id=>C.strokeById(id)).filter(Boolean);
  if(strokes.length<3)return null;
  const si=strokes.map(st=>{
    const m=boxMetrics(st.bbox),p=st.pts||[],dx=p.length>=6?p[p.length-3]-p[0]:0,dy=p.length>=6?p[p.length-2]-p[1]:0;
    return {st,...m,horizontal:m.w>Math.max(8,m.h*2.3),vertical:m.h>Math.max(8,m.w*2.3),
      diagonal:Math.abs(dx)>5&&Math.abs(dy)>5&&Math.abs(dx/dy)>.35&&Math.abs(dx/dy)<2.8};
  });
  const bboxFor=set=>boxOf(set.map(x=>x.st));
  const candidateScore=(set,bbox)=>{
    const ids=new Set(set.map(x=>x.st.id)),m=boxMetrics(bbox),left=si.filter(x=>!ids.has(x.st.id)&&x.cx<m.cx),right=si.filter(x=>!ids.has(x.st.id)&&x.cx>m.cx);
    if(!left.length||!right.length)return Infinity;
    // Prefer a compact local operator with ink on both sides. This is spatial
    // evidence only; the formula/text agreement still decides the characters.
    const leftEdge=Math.max(...left.map(x=>x.st.bbox[2])),rightEdge=Math.min(...right.map(x=>x.st.bbox[0]));
    return Math.max(0,bbox[0]-leftEdge)+Math.max(0,rightEdge-bbox[2])+m.w*.02;
  };
  const candidates=[];
  if(match[2]==='='){
    const bars=si.filter(x=>x.horizontal);
    for(let i=0;i<bars.length;i++)for(let j=i+1;j<bars.length;j++){
      const a=bars[i],b=bars[j],xo=overlap(a.st.bbox[0],a.st.bbox[2],b.st.bbox[0],b.st.bbox[2]);
      if(xo<Math.min(a.w,b.w)*.55||Math.abs(a.cy-b.cy)>Math.max(16,Math.min(a.w,b.w)*.55))continue;
      const set=[a,b],bbox=bboxFor(set);candidates.push({set,bbox,score:candidateScore(set,bbox)});
    }
  }else if(match[2]==='-'){
    for(const a of si.filter(x=>x.horizontal)){const set=[a],bbox=a.st.bbox;candidates.push({set,bbox,score:candidateScore(set,bbox)});}
  }else{
    const first=match[2]==='+'?si.filter(x=>x.horizontal):si.filter(x=>x.diagonal);
    const second=match[2]==='+'?si.filter(x=>x.vertical):si.filter(x=>x.diagonal);
    for(const a of first)for(const b of second){
      if(a===b)continue;
      const crossX=overlap(a.st.bbox[0],a.st.bbox[2],b.st.bbox[0],b.st.bbox[2]),crossY=overlap(a.st.bbox[1],a.st.bbox[3],b.st.bbox[1],b.st.bbox[3]);
      if(crossX<=0||crossY<=0)continue;
      const set=[a,b],bbox=bboxFor(set);candidates.push({set,bbox,score:candidateScore(set,bbox)});
    }
  }
  const op=candidates.filter(x=>Number.isFinite(x.score)).sort((a,b)=>a.score-b.score)[0];
  if(!op)return null;
  const opIds=new Set(op.set.map(x=>x.st.id)),opMid=(op.bbox[0]+op.bbox[2])/2;
  const lhs=si.filter(x=>!opIds.has(x.st.id)&&x.cx<opMid),rhs=si.filter(x=>!opIds.has(x.st.id)&&x.cx>opMid);
  if(!lhs.length||!rhs.length)return null;
  const body=lhs.filter(x=>Math.max(x.w,x.h)>=10);
  if(!body.length)return null;
  const bodyH=typicalHeight(body.map(x=>x.h)),bottoms=body.map(x=>x.st.bbox[3]);
  // Baseline corroboration is intentionally conservative. It is only used to
  // undo a formula-model subscript reading; a real shifted glyph must abstain.
  if(body.length>1&&Math.max(...bottoms)-Math.min(...bottoms)>Math.max(5,bodyH*.24))return null;
  return {name:match[1],operator:match[2]};
}
// A handwritten equals sign is two stacked bars. The stroke decoder sometimes
// reads it as one minus, or as two ("p--3"), when the bars differ in length or
// slant. The ink can count real equals signs on its own: two horizontal
// strokes of comparable span, strongly overlapping in x, one just above the
// other, with no other ink between them. Consumed at most once each.
function stackedBarPairs(strokes){
  const si=strokes.map(st=>({st,...boxMetrics(st.bbox)})),bars=si.filter(x=>x.w>Math.max(8,x.h*2.3));
  const body=si.filter(x=>x.w<=Math.max(8,x.h*2.3)&&Math.max(x.w,x.h)>=8);
  const rowH=Math.max(14,typicalHeight(body.map(x=>x.h))),pairs=[];
  for(let i=0;i<bars.length;i++)for(let j=i+1;j<bars.length;j++){
    const a=bars[i],b=bars[j],minW=Math.min(a.w,b.w),xo=overlap(a.st.bbox[0],a.st.bbox[2],b.st.bbox[0],b.st.bbox[2]),dy=Math.abs(a.cy-b.cy);
    if(minW<Math.max(a.w,b.w)*.5||xo<minW*.6||dy<2||dy>Math.max(10,Math.min(rowH*.55,minW*.7))||Math.abs(a.cx-b.cx)>minW*.35)continue;
    const top=Math.min(a.cy,b.cy),bottom=Math.max(a.cy,b.cy),left=Math.min(a.st.bbox[0],b.st.bbox[0]),right=Math.max(a.st.bbox[2],b.st.bbox[2]);
    if(si.some(x=>x!==a&&x!==b&&x.cy>top&&x.cy<bottom&&overlap(x.st.bbox[0],x.st.bbox[2],left,right)>Math.min(x.w,minW)*.3))continue;
    pairs.push({a,b,score:dy/minW+Math.abs(a.cx-b.cx)/minW});
  }
  pairs.sort((x,y)=>x.score-y.score);
  const used=new Set(),out=[];
  for(const pair of pairs){if(used.has(pair.a)||used.has(pair.b))continue;used.add(pair.a);used.add(pair.b);out.push(pair);}
  return out;
}
const RELATION=/=|\\(?:ne|neq|equiv|approx|le|ge|leq|geq|sim|simeq|cong)\b/g;
// When the reading has fewer relation signs than the ink has stacked bar pairs
// and a minus (or a double minus) stands where one belongs, restore the '='.
// Only that operator changes; with several candidate minuses the model's own
// completed alternatives must resolve which one, or nothing changes. The
// repaired reading always asks for confirmation.
function equalsGeometryRepair(out,cl){
  const latex=String(out?.latex||'');
  if(!latex||!cl?.strokeIds?.length||out.wordSource==='text-and-ink-alternative')return out;
  const strokes=cl.strokeIds.map(id=>C.strokeById(id)).filter(Boolean);
  if(strokes.length<3)return out;
  const need=stackedBarPairs(strokes).length-(latex.match(RELATION)||[]).length;
  if(need<=0)return out;
    const runs=[...latex.matchAll(/(?<!-)-{1,2}(?!-)/g)];
  if(!runs.length||runs.length>16||need>runs.length)return out;
  const rewrite=chosen=>{let text=latex;for(const run of chosen.slice().sort((x,y)=>y.index-x.index))text=text.slice(0,run.index)+'='+text.slice(run.index+run[0].length);return text;};
  let repaired=null;
  if(runs.length===need)repaired=rewrite(runs);
  else{
    const choices=[];
    const pick=(start,taken)=>{if(choices.length>=256)return;if(taken.length===need){choices.push(rewrite(taken));return;}for(let i=start;i<runs.length;i++)pick(i+1,[...taken,runs[i]]);};
    pick(0,[]);
    const compact=v=>String(v||'').replace(/\s+/g,'');
    const matches=choices.filter(text=>(out.alternatives||[]).some(alt=>compact(alt)===compact(text)));
    if(matches.length===1)repaired=matches[0];
  }
  if(!repaired||repaired===latex)return out;
  return {...out,latex:repaired,geometryRepair:'equals',alternatives:[latex,...(out.alternatives||[])].filter((v,i,a)=>v!==repaired&&a.indexOf(v)===i).slice(0,4)};
}
function wordGeometry(canvas,text,source=null){
  const strokeGeometry=strokeWordGeometry(text,source);
  if(strokeGeometry)return strokeGeometry;
  const match=String(text||'').trim().replace(/[×✕✖]/g,'*').match(/^([A-Za-z][A-Za-z0-9]{0,31})\s*([=+*-])\s*\d+(?:\.\d+)?\s*=?$/);
  if(!match)return null;
  const {width:w,height:h}=canvas,rgba=canvas.getContext('2d').getImageData(0,0,w,h).data;
  const dark=(x,y)=>{const i=(y*w+x)*4,a=rgba[i+3]/255;return ((rgba[i]+rgba[i+1]+rgba[i+2])/3)*a+255*(1-a)<150;};
  const groups=[];let group=null;
  for(let x=0;x<w;x++){
    let top=h,bottom=-1;
    for(let y=0;y<h;y++)if(dark(x,y)){top=Math.min(top,y);bottom=y;}
    if(bottom<0){group=null;continue;}
    if(!group){group={x,x2:x,y:top,y2:bottom};groups.push(group);}
    group.x2=x;group.y=Math.min(group.y,top);group.y2=Math.max(group.y2,bottom);
  }
  const letters=groups.slice(0,match[1].length),op=groups[match[1].length];
  // Joined ink cannot independently establish character baselines, so abstain.
  if(letters.length!==match[1].length||!op||groups.length<letters.length+2)return null;
  const height=Math.max(...letters.map(g=>g.y2-g.y+1));
  if(Math.max(...letters.map(g=>g.y2))-Math.min(...letters.map(g=>g.y2))>height*.2)return null;
  if(letters.some(g=>g.y2-g.y+1<height*.4))return null;
  const ow=op.x2-op.x+1,oh=op.y2-op.y+1,operator=match[2];
  if(operator==='='||operator==='-'){
    let bands=0,on=false;
    for(let y=op.y;y<=op.y2;y++){
      let count=0;for(let x=op.x;x<=op.x2;x++)if(dark(x,y))count++;
      const ink=count>ow*.5;if(ink&&!on)bands++;on=ink;
    }
    if(bands!==(operator==='='?2:1)||ow<oh*(operator==='='?1.1:3.5))return null;
  }else{
    if(Math.min(ow,oh)<Math.max(ow,oh)*.45)return null;
    let count=0,fit=0;const quadrants=[0,0,0,0];
    for(let y=op.y;y<=op.y2;y++)for(let x=op.x;x<=op.x2;x++)if(dark(x,y)){
      const nx=(x-op.x)/Math.max(1,ow-1)-.5,ny=(y-op.y)/Math.max(1,oh-1)-.5;
      count++;quadrants[(nx>0?1:0)+(ny>0?2:0)]++;
      if((operator==='*'?Math.min(Math.abs(nx-ny),Math.abs(nx+ny)):Math.min(Math.abs(nx),Math.abs(ny)))<.18)fit++;
    }
    if(!count||fit/count<.8||quadrants.some(n=>n/count<.1))return null;
  }
  return {name:match[1],operator};
}
async function readWords(out,canvas,valid,source=null){
  // Only a possible leading word plus an operator warrants a second model.
  // This includes bare uses such as hi*4, without requiring a trailing equals.
  if(!/^[A-Za-z]/.test(N.mathcore.latexToMath(out?.latex||'').trim()))return out;
  try{
    let text=await textInfer(canvas,valid),geometry=wordGeometry(canvas,text.text,source);
    // Text OCR commonly writes a handwritten multiplication cross as the
    // letter x. Reinterpret only when the formula model independently says the
    // structure is multiplication and stroke geometry confirms that exact
    // operator position. This keeps ordinary identifiers containing x intact.
    if(!geometry&&/\\(?:times|cdot)\b|\*/.test(out?.latex||'')){
      const x=String(text.text||'').trim().match(/^([A-Za-z][A-Za-z0-9]{0,30})[xX](\d+(?:\.\d+)?)$/);
      if(x){
        const candidate=x[1]+'*'+x[2],candidateGeometry=wordGeometry(canvas,candidate,source);
        if(candidateGeometry?.name===x[1]&&candidateGeometry.operator==='*'){
          text={...text,text:candidate};geometry=candidateGeometry;
        }
      }
    }
    return wordReading(out,text,geometry);
  }
  catch(e){if(e.name==='AbortError')throw e;return out;}
}
// Retained for old callers/settings migrations. Re-running the only math engine
// invalidates every unconfirmed reading; confirmed corrections are kept.
function switchEngine(name){
  S.settings.recognizer='ink';
  C.savePrefs();
  epoch++;clearTimeout(timer);
  restart();
  for(const cl of S.clusters)if(!cl.confirmed){
    cl.latex='';cl.ascii='';cl.alternatives=[];cl.pending=false;cl.error='';cache.delete(cl.hash);
  }
  C.markDirty();N.mathcore.run();
  boot().then(schedule).catch(e=>C.toast(e.message));
}
// explicit: asked for from the selection bar, so read even with handwriting
// reading turned off in settings
async function recognize(cl,explicit){
  if(!explicit&&!enabled())return;
  if(cl.pending){if(explicit)cl._explicitRetry=true;return;}
  const generation=epoch,note=S.id,hash=cl.hash;
  const valid=()=>generation===epoch&&S.id===note&&(explicit||enabled())&&S.clusters.some(c=>c.hash===hash&&!c.confirmed);
  if(!valid())return;
  attempted.add(hash);cl.pending=true;N.mathcore.run();
  try{
    const linear=linearizedCrop(cl);
    let out=await inferInk(cl,valid);if(!valid())return;
    const completedInk=out?.terminated===true&&!out.truncated&&!!String(out.latex||'').trim()?out:null;
    if(!usableInk(out)&&inkTextAlternatives(out).length){
      try{out=textSupportedInk(out,await textInfer(textCrop(cl),valid));}
      catch(e){if(e.name==='AbortError'||!valid())throw e;}
    }
    // A completed reading under the confidence floor is still shown, marked
    // to be checked before solving: there is no second model to ask.
    if(!usableInk(out)&&out?.wordSource!=='text-and-ink-alternative'&&completedInk)out=completedInk;
    if(!valid())return;
    if(!usableInk(out)&&out?.wordSource!=='text-and-ink-alternative'&&(!completedInk||out!==completedInk))throw new Error('could not finish reading this expression. select a smaller expression or correct it manually.');
    if(out?.confidence>=.70&&out.confidence<.85&&/^\d{1,3}\s*=\s*[A-Za-z]$/.test(N.mathcore.latexToMath(out.latex||'').trim())&&(out.alternatives||[]).length){
      try{out=textSupportedEquation(out,await textInfer(textCrop(cl),valid));}
      catch(e){if(e.name==='AbortError'||!valid())throw e;}
    }
    out=await readWords(out,linear||textCrop(cl),valid,cl);
    out=equalsGeometryRepair(out,cl);
    if(!valid())return;
    const live=S.clusters.find(c=>c.hash===hash);
    if(!live)return;
    const resultVersion=RESULT_VERSION.ink;
    // Uncertain readings remain visible for correction or an explicit Solve.
    // A later model version may refresh them until the user confirms the text.
    Object.assign(live,{modelVersion:resultVersion,latex:out.latex,ascii:N.mathcore.latexToMath(out.latex),alternatives:out.alternatives||[],confidence:out.confidence,needsConfirmation:needsConfirmation(out,live),review:false,confirmed:false,pending:false});
    cache.set(hash,{modelVersion:resultVersion,latex:live.latex,ascii:live.ascii,alternatives:live.alternatives,kind:live.kind,confidence:live.confidence,needsConfirmation:live.needsConfirmation,confirmed:false,asked:!!live.asked});
    C.markDirty();
  }catch(e){
    if(valid()&&e.name!=='AbortError'){
      const live=S.clusters.find(c=>c.hash===hash);Object.assign(live,{review:true,error:e.message,pending:false});
    }
  }finally{const live=generation===epoch&&S.id===note?S.clusters.find(c=>c.hash===hash):null;if(live){live.pending=false;const retry=live._explicitRetry;delete live._explicitRetry;if(retry&&(!live.ascii&&!live.latex||live.review))await recognize(live,true);}N.mathcore.run();}
}
function confirm(cl,text){
  if(!S.clusters.includes(cl))return;
  text=text.trim();if(!text)return;
  cl.ascii=text;cl.latex='';cl.alternatives=[];cl.confirmed=true;cl.needsConfirmation=false;cl.review=false;cl.pending=false;cl.error='';
  cache.set(cl.hash,{latex:'',ascii:text,kind:'expression',confirmed:true,asked:!!cl.asked});
  attempted.add(cl.hash);
  if(cl.imageId){const im=S.images.find(i=>i.id===cl.imageId);if(im)Object.assign(im,{ascii:text,latex:'',confirmed:true,review:false});}
  C.markDirty();N.mathcore.run();
}
function solveSelection(){
  const cl=S.clusters.find(c=>c.strokeIds.some(id=>S.selection.includes(id)));
  if(!cl)return C.toast('select one expression with the lasso first.');
  // Asking to solve a selection is an explicit request, so this reading is
  // shown and calculated even without an equals sign.
  cl.latex='';cl.ascii='';cl.confirmed=false;cl.review=false;cl.asked=true;cache.delete(cl.hash);attempted.delete(cl.hash);
  C.markDirty();recognize(cl,true);N.ink.clearSelection();
}
function reset(){
  epoch++;indexEpoch++;clearTimeout(timer);clearTimeout(textTimer);clearTimeout(indexTimer);
  attempted.clear();textAttempted.clear();cache.clear();hashMemo.clear();grouped=null;
}
// Re-reads the page with the readers restarted. The model files stay where
// they are (IndexedDB, the service worker's cache): a refresh is about the
// readings, and a stored model is only ever replaced by a newer version.
async function refreshModels(){
  epoch++;indexEpoch++;clearTimeout(timer);clearTimeout(textTimer);clearTimeout(indexTimer);
  stop('Refreshing handwriting models');stopText('Refreshing handwriting search');
  clearUnconfirmedReadings();
  textState.broken=false;warned=false;inkError='';
  try{
    const registration=await navigator.serviceWorker?.getRegistration?.();
    if(registration)await registration.update().catch(()=>{});
  }catch(error){}
  C.markDirty();rebuild();N.mathcore.run();
  if(enabled()){
    await boot();
    schedule();scheduleText();
  }
  return {ok:true};
}
function toggle(){
  if(enabled()){
    attempted.clear();textAttempted.clear();textState.broken=false;
    boot().then(schedule).catch(()=>{});scheduleText();
  }else{
    epoch++;indexEpoch++;clearTimeout(timer);clearTimeout(textTimer);clearTimeout(indexTimer);stop();stopText();
    for(const c of S.clusters)c.pending=false;report('handwriting off.');N.mathcore.run();
  }
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){clearTimeout(timer);clearTimeout(textTimer);clearTimeout(indexTimer);}else{schedule();scheduleText();}
});
// Lets go of both readers while nothing is being read, for something that
// needs the memory more (the background remover, which failed to start
// beside them on a tablet). Each starts again the next time it is needed,
// from the copy kept on this device. One still starting, or reading, is
// left alone.
function release(){
  const ink=state('ink');
  if(ink.ready&&!ink.requests.size&&!active){stop('handwriting paused to free memory','ink');ink.broken=false;}
  if(textState.ready&&!textState.requests.size)stopText('Handwriting search paused to free memory');
}
function retry(){restart();boot().then(schedule).catch(()=>{});}
function retryText(){textRestartSeq++;stopText('Restarting handwriting search');healText();textAttempted.clear();return setupText().then(()=>scheduleText()).catch(()=>{});}
N.pauseRecognitionForImage=pauseForImage;
N.ai={enabled,setup:boot,setupText,retry,retryText,toggle,watch,watchText,setupState,textSetupState,get ready(){return state(preferred()).ready;}};
N.recog={resultVersion:RESULT_VERSION.ink,rebuild,penResting,frames:()=>pageFrames,frameInfo,release,selectionUnread,readStrokesText,mathStrokeGroups,equalsGeometryRepair,stackedBarPairs,schedule,scheduleText,scheduleIndex,indexOthers,textGroupsOfDoc,recognize,recognizeText,solveSelection,crop,linearizedCrop,textCrop,textGroups,cache,confirm,reset,refreshModels,engine:preferred,switchEngine,validText,wordReading,wordGeometry,needsConfirmation,inkTextAlternatives,textSupportedInk,textSupportedEquation,
  get inkError(){return inkError;},get textReady(){return textState.ready;},get textVersion(){return TEXT_VERSION;},get textConfidenceMin(){return TEXT_CONFIDENCE_MIN;}};
})();
