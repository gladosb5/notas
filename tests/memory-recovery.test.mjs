import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('background memory recovery is bounded, uses lean mode and always resumes handwriting',async()=>{
  for(const succeeds of [true,false]){
    let attempts=0,paused=0,resumed=0,stops=0;const modes=[];
    const html=readFileSync(new URL('../notas.html',import.meta.url),'utf8');
    const context=vm.createContext({CUTOUT_LEAN:false,cutoutLowMemory:false,
      N:{pauseRecognitionForImage(){paused++;return ()=>resumed++;}},
      cutoutStop(){stops++;},setTimeout(fn){queueMicrotask(fn);},
      async cutoutAsk(msg){modes.push(msg.lean);if(++attempts===1||!succeeds)throw Object.assign(new Error('OOM'),{memory:true});return {alpha:'ok'};}});
    vm.runInContext(html.slice(html.indexOf('async function cutoutMatte('),html.indexOf('function loadPicture(')),context);
    const pending=vm.runInContext('cutoutMatte(new Uint8ClampedArray(4))',context);
    if(succeeds)assert.equal((await pending).alpha,'ok');
    else await assert.rejects(pending,/Not enough available memory/);
    assert.equal(attempts,2);assert.deepEqual(modes,[false,true]);
    assert.equal(paused,1);assert.equal(resumed,1);assert.ok(stops>=2);
  }
});

function readers(reply){
  const workers=[],timers=new Map();let serial=0;
  class Worker{
    constructor(url){this.url=url;workers.push(this);}
    postMessage(data){queueMicrotask(()=>{const result=reply(this,data,workers);if(result)this.onmessage({data:{id:data.id,...result}});});}
    terminate(){this.terminated=true;}
  }
  const S={id:'note',settings:{},clusters:[],strokes:[{id:'s',pts:[0,0,.5,10,10,.5]}]};
  const N={core:{S,toast(){},strokeById:id=>S.strokes.find(s=>s.id===id)},mathcore:{run(){}}};
  const context=vm.createContext({N,Worker,DOMException,Uint8ClampedArray,
    NOTAS_MODEL_CONTRACT:{math:{id:'test'},text:{id:'test'}},
    window:{Worker,OffscreenCanvas:class{},addEventListener(){}},location:{protocol:'http:'},
    document:{hidden:false,createElement:()=>({dataset:{},setAttribute(){}}),body:{appendChild(){}},addEventListener(){}},
    setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);}});
  const source=readFileSync(new URL('../local-recognition.js',import.meta.url),'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/,'N.testing={textInfer,inferInk,state,textState};})();'),context);
  return {N,workers,timers};
}
const canvas=()=>({width:2,height:2,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(16)})})});

test('text inference recovers using a fresh worker and fresh pixels',async()=>{
  const {N,workers}=readers((w,d)=>d.type==='setup'?{ready:true}:w===workers[0]?{error:'Aborted(OOM)'}:{text:'hello'});
  const result=await N.testing.textInfer(canvas(),()=>true);
  assert.equal(result.text,'hello');assert.equal(workers.length,2);assert.ok(workers[0].terminated);
});
test('repeated text memory failure stops automatic retries; explicit retry replaces runtime',async()=>{
  let failing=true;
  const {N,workers}=readers((w,d)=>d.type==='setup'?{ready:true}:failing?{error:'out of memory'}:{text:'hello'});
  await assert.rejects(N.testing.textInfer(canvas(),()=>true),/Not enough available memory/);
  assert.equal(workers.length,2);assert.ok(workers.every(w=>w.terminated));
  assert.equal(N.testing.textState.memoryBlocked,true);
  failing=false;await N.ai.retryText();
  assert.equal((await N.testing.textInfer(canvas(),()=>true)).text,'hello');
});
test('math inference replaces failed worker once and leaves subsequent retry usable',async()=>{
  let failing=true;
  const {N,workers}=readers((w,d)=>d.type==='setup'?{ready:true}:failing?{error:'memory access out of bounds'}:{latex:'2'});
  const cl={strokeIds:['s']};
  await assert.rejects(N.testing.inferInk(cl,()=>true),/Not enough available memory/);
  assert.equal(workers.length,2);assert.ok(workers.every(w=>w.terminated));
  failing=false;N.ai.retry();await N.ai.setup();
  assert.equal((await N.testing.inferInk(cl,()=>true)).latex,'2');
});
test('startup memory failure retries once without reloading',async()=>{
  const {N,workers}=readers(w=>w===workers[0]?{error:'out of memory'}:{ready:true});
  await N.ai.setup();assert.equal(N.ai.ready,true);assert.equal(workers.length,2);assert.ok(workers[0].terminated);
});
test('image processing releases readers and cancellation does not mark them broken',async()=>{
  const {N,workers}=readers((w,d)=>d.type==='setup'?{ready:true}:null);
  await N.ai.setup();await N.ai.setupText();
  const pending=N.testing.textInfer(canvas(),()=>true);
  await Promise.resolve();await Promise.resolve();
  const resume=N.pauseRecognitionForImage();
  await assert.rejects(pending,{name:'AbortError'});
  assert.ok(workers.every(w=>w.terminated));
  await assert.rejects(N.ai.setupText(),{name:'AbortError'});
  assert.equal(N.testing.textState.broken,false);
  resume();resume();await N.ai.setupText();assert.equal(N.testing.textState.ready,true);
});

test('retry during a pending text request cannot tear down its replacement',async()=>{
  const {N,workers}=readers((w,d)=>d.type==='setup'?{ready:true}:null);
  await N.ai.setupText();
  const pending=N.testing.textInfer(canvas(),()=>true);
  await new Promise(resolve=>setImmediate(resolve));
  const rejected=assert.rejects(pending,{name:'AbortError'});
  await N.ai.retryText();await rejected;
  assert.equal(workers.length,2);assert.ok(workers[0].terminated);
  assert.ok(!workers[1].terminated);assert.equal(N.testing.textState.ready,true);
});

test('silent background worker is terminated at deadline and next request succeeds',async()=>{
  const workers=[],timers=new Map();let id=0;
  class Worker{constructor(){workers.push(this);}postMessage(data){this.data=data;}terminate(){this.terminated=true;}}
  const html=readFileSync(new URL('../notas.html',import.meta.url),'utf8');
  const context=vm.createContext({Worker,N:{},navigator:{userAgent:''},Error,
    setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext(html.slice(html.indexOf('const CUTOUT_SIZE='),html.indexOf('/* The model is downloaded in the background')),context);
  const first=vm.runInContext('cutoutAsk({})',context);
  const rejected=assert.rejects(first,/stopped responding/);
  [...timers.values()][0]();await rejected;
  assert.ok(workers[0].terminated);assert.equal(timers.size,0);
  const second=vm.runInContext('cutoutAsk({})',context);
  workers[1].onmessage({data:{id:workers[1].data.id,done:true}});
  assert.equal((await second).done,true);
});
