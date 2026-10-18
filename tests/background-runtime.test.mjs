import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('background runtime parts pass service-worker verification, survive upgrades and work offline',async()=>{
  const base='https://notas.test/',events={},stores=new Map();
  const key=r=>typeof r==='string'?r:r.url;
  const caches={
    async open(name){
      if(!stores.has(name))stores.set(name,new Map());
      const data=stores.get(name);
      return {
        async keys(){return [...data.keys()].map(url=>({url}));},
        async match(r){return data.get(key(r))?.clone();},
        async put(r,v){data.set(key(r),v.clone());},
        async delete(r){return data.delete(key(r));}
      };
    },
    async keys(){return [...stores.keys()];},
    async delete(name){return stores.delete(name);}
  };
  let offline=false,corrupt=false,downloads=0;
  const self={location:new URL(base),addEventListener(name,fn){events[name]=fn;}};
  vm.runInNewContext(read('sw.js'),{self,caches,URL,Set,Request,Response,crypto:webcrypto,
    async fetch(r){
      if(offline)throw Error('offline');
      downloads++;
      return new Response(corrupt?'damaged':readFileSync(new URL('../'+new URL(key(r)).pathname.slice(1),import.meta.url)));
    }
  });
  const version=/const CACHE='([^']+)'/.exec(read('sw.js'))[1];
  const workerSelf={location:new URL(base+'bg-worker.js'),postMessage(){}};
  const worker=vm.createContext({self:workerSelf,navigator:{},URL,Uint8Array,console,
    importScripts(){},ort:{env:{wasm:{}}}});
  vm.runInContext(read('assets/bg/model.js'),worker);
  workerSelf.NOTAS_MODEL_STORE={sha256:async bytes=>Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex')};
  const urls=[];
  worker.fetch=async url=>{
    urls.push(url);
    let result;const pending=[];
    events.fetch({request:new Request(url),respondWith(p){result=p;},waitUntil(p){pending.push(p);}});
    const response=await result;await Promise.all(pending);return response;
  };
  vm.runInContext(read('bg-worker.js'),worker);
  const bytes=await vm.runInContext('fetchRuntime()',worker);
  assert.equal(bytes.length,workerSelf.NOTAS_BG_RUNTIME.bytes);
  assert.equal(downloads,2);
  for(const part of workerSelf.NOTAS_BG_RUNTIME.parts){
    const url=base+'assets/smart/'+part.file+'?v='+part.sha256.slice(0,8);
    assert.ok(urls.includes(url),'uses the individual part hash');
    assert.ok(await (await caches.open(version)).match(url));
  }
  const current=await caches.open(version),old=await caches.open('notas-local-v1');
  for(const url of urls){await old.put(url,await current.match(url));await current.delete(url);}
  let activated;events.activate({waitUntil(p){activated=p;}});await activated;
  for(const url of urls)assert.ok(await current.match(url),'upgrade preserves '+url);
  await caches.delete('notas-local-v1');offline=true;
  vm.runInContext('runtimeReady=null',worker);
  assert.equal((await vm.runInContext('fetchRuntime()',worker)).length,bytes.length);
  assert.equal(downloads,2,'unloading and offline reload use the disk cache');
  offline=false;corrupt=true;
  await current.delete(urls[0]);
  assert.equal((await worker.fetch(urls[0])).status,502,'genuinely corrupt parts are still rejected');
  assert.equal(await current.match(urls[0]),undefined);
});

for(const failure of [null,'readback','inference','nonfinite'])test(`background session and tensors release before reply (${failure||'success'})`,async()=>{
  const events=[],messages=[];let loads=0,creates=0;
  const context=vm.createContext({URL,ArrayBuffer,Uint8Array,Uint8ClampedArray,Float32Array,console,
    navigator:{},importScripts(){},
    self:{location:new URL('https://notas.test/bg-worker.js'),
      NOTAS_BG_MODEL:{input:'input',output:'output',url:'cached-model',sha:'cached-hash'},
      NOTAS_MODEL_STORE:{async load(){loads++;return {bytes:new Uint8Array(4),saved:false};}},
      postMessage(m){events.push('reply');messages.push(m);}},
    ort:{env:{wasm:{}},Tensor:class{dispose(){events.push('input disposed');}},
      InferenceSession:{async create(){
        creates++;
        return {
          async run(){
            if(failure==='inference')throw Error('inference failed');
            return {output:{
              async getData(){if(failure==='readback')throw Error('readback failed');return new Float32Array(512*512).fill(failure==='nonfinite'?NaN:1);},
              dispose(){events.push('output disposed');}
            }};
          },
          async release(){await Promise.resolve();events.push('released');}
        };
      }}}
  });
  vm.runInContext(read('bg-worker.js'),context);
  vm.runInContext('fetchRuntime=async()=>new Uint8Array(4)',context);
  for(let id=1;id<=2;id++){
    events.length=0;
    await vm.runInContext(`handleMessage({id:${id},rgba:new ArrayBuffer(512*512*4)})`,context);
    assert.ok(events.includes('input disposed'));
    if(failure!=='inference')assert.ok(events.includes('output disposed'));
    assert.ok(events.includes('released'));
    assert.ok(events.indexOf('released')<events.lastIndexOf('reply'),'session release finishes before result delivery');
    assert.equal(vm.runInContext('session===null&&loading===null&&fetching===null&&runtimeReady===null&&ort.env.wasm.wasmBinary===null',context),true);
    assert.equal(!!messages.at(-1).error,!!failure);
  }
  assert.equal(loads,2,'next picture reads the cached model again');
  assert.equal(creates,2,'next picture starts a fresh session');
});

test('desktop worker terminates immediately after its queue drains and restarts on next use',async()=>{
  const workers=[],timers=new Map();let serial=0;
  class Worker{
    constructor(){workers.push(this);this.messages=[];}
    postMessage(m){this.messages.push(m);}
    terminate(){this.terminated=true;}
  }
  const html=read('notas.html');
  const context=vm.createContext({Worker,N:{},navigator:{userAgent:'desktop'},Error,
    setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext(html.slice(html.indexOf('const CUTOUT_SIZE='),html.indexOf('/* The model is downloaded in the background')),context);
  const first=vm.runInContext('cutoutAsk({prefetch:true})',context);
  const second=vm.runInContext('cutoutAsk({})',context);
  const w=workers[0];
  w.onmessage({data:{id:w.messages[0].id,done:'stored'}});await first;
  assert.equal(w.terminated,undefined,'queued inference is not cancelled by prefetch completion');
  w.onmessage({data:{id:w.messages[1].id,alpha:new Uint8ClampedArray(1)}});await second;
  assert.equal(w.terminated,true);
  assert.equal(timers.size,0,'no idle timer keeps the runtime alive');
  const next=vm.runInContext('cutoutAsk({})',context);
  assert.equal(workers.length,2);
  workers[1].onmessage({data:{id:workers[1].messages[0].id,done:true}});await next;
  assert.equal(workers[1].terminated,true);
});
