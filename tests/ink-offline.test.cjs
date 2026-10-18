const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('an offline cache upgrade retains current assets and one previous build without taking over open tabs',async()=>{
  const stores=new Map(),events={};
  const key=request=>typeof request==='string'?request:request.url;
  const caches={
    async open(name){
      if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);
      return {async delete(req){return data.delete(key(req));},async keys(){return [...data.keys()].map(url=>({url}));},async match(req){return data.get(key(req))?.clone();},async put(req,response){data.set(key(req),response.clone());}};
    },
    async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}
  };
  const source=fs.readFileSync('sw.js','utf8'),version=source.match(/const CACHE='([^']+)'/)[1];
  const base='https://notas.test/';
  const current=await caches.open(version),old=await caches.open('notas-local-before');
  await current.put(base+'ink-worker.js',new Response(fs.readFileSync('ink-worker.js','utf8')));
  const ink=fs.readFileSync('ink-worker.js','utf8');
  const files=['encoder.onnx','decoder_step.onnx','vocab.json'];
  const keep=files.map(file=>base+'assets/ink/'+file+'?v='+ink.match(new RegExp(file.replaceAll('.','\\.')+'\\?v=([a-f0-9]+)'))[1]);
  for(const url of keep)await old.put(url,new Response(fs.readFileSync(new URL(url).pathname.slice(1))));
  const stale=base+'assets/ink/encoder.onnx?v=obsolete';await old.put(stale,new Response('old model'));
  // the retired 80 MB Smart model is not carried into the new cache
  const retired=base+'assets/smart/recognizer.onnx?v=862f82a4';await old.put(retired,new Response('retired model'));
  let claimed=false;
  const self={location:new URL(base),clients:{async claim(){claimed=true;}},addEventListener(name,fn){events[name]=fn;}};
  vm.runInNewContext(source,{self,caches,URL,Set,console,crypto:require('node:crypto').webcrypto});
  let done;events.activate({waitUntil(promise){done=promise;}});await done;
  for(const url of keep)assert.ok(await current.match(url),'preserved '+url);
  assert.equal(await current.match(stale),undefined);
  assert.equal(await current.match(retired),undefined);
  assert.equal(stores.has('notas-local-before'),true);assert.equal(claimed,false);
});

test('F35/F36: corrupt runtime hits are evicted, downloads verified, and update probes are never cached',async()=>{
  const crypto=require('node:crypto').webcrypto,good='verified runtime',file='assets/smart/ort.wasm.min.js';
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',Buffer.from(good))).toString('hex');
  let source=fs.readFileSync('sw.js','utf8').replace(/const ASSET_HASHES=.*?;/,'const ASSET_HASHES='+JSON.stringify({[file]:digest})+';');
  const version=source.match(/const CACHE='([^']+)'/)[1],base='https://notas.test/',url=base+file+'?v='+digest.slice(0,8),stores=new Map(),events={};
  const key=r=>typeof r==='string'?r:r.url;
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return {
    async keys(){return [...data.keys()].map(url=>({url}));},async match(r){return data.get(key(r))?.clone();},
    async put(r,v){data.set(key(r),v.clone());},async delete(r){return data.delete(key(r));}
  };},async keys(){return [...stores.keys()];}};
  const current=await caches.open(version),old=await caches.open('notas-local-v1');await current.put(url,new Response('<html>bad</html>'));await old.put(url,new Response(good));
  let fetched=0,corrupt=false;
  const fetch=async req=>{fetched++;return new Response(corrupt?'bad bytes':key(req).includes('?update=')?'fresh page':good);};
  const self={location:new URL(base),addEventListener(name,fn){events[name]=fn;}};
  vm.runInNewContext(source,{self,caches,URL,Set,console,crypto,fetch,Request,Response});
  const request=async url=>{let result;const pending=[];events.fetch({request:new Request(url),respondWith(p){result=p;},waitUntil(p){pending.push(p);}});const response=await result;await Promise.all(pending);return response;};
  assert.equal(await (await request(url)).text(),good);assert.equal(await current.match(url),undefined);assert.equal(fetched,0);
  await old.delete(url);assert.equal(await (await request(url)).text(),good);assert.equal(await (await current.match(url)).text(),good);
  await current.delete(url);corrupt=true;assert.equal((await request(url)).status,502);assert.equal(await current.match(url),undefined);
  for(let i=0;i<10;i++)assert.equal((await request(base+'notas.html?update='+i)).status,200);
  assert.equal((await current.keys()).length,0);
});
