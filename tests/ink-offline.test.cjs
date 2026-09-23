const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('an offline cache upgrade retains only the current ink model version',async()=>{
  const stores=new Map(),events={};
  const key=request=>typeof request==='string'?request:request.url;
  const caches={
    async open(name){
      if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);
      return {async keys(){return [...data.keys()].map(url=>({url}));},async match(req){return data.get(key(req))?.clone();},async put(req,response){data.set(key(req),response.clone());}};
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
  for(const url of keep)await old.put(url,new Response('cached model'));
  const stale=base+'assets/ink/encoder.onnx?v=obsolete';await old.put(stale,new Response('old model'));
  // the retired 80 MB Smart model is not carried into the new cache
  const retired=base+'assets/smart/recognizer.onnx?v=862f82a4';await old.put(retired,new Response('retired model'));
  let claimed=false;
  const self={location:new URL(base),clients:{async claim(){claimed=true;}},addEventListener(name,fn){events[name]=fn;}};
  vm.runInNewContext(source,{self,caches,URL,Set,console});
  let done;events.activate({waitUntil(promise){done=promise;}});await done;
  for(const url of keep)assert.ok(await current.match(url),'preserved '+url);
  assert.equal(await current.match(stale),undefined);
  assert.equal(await current.match(retired),undefined);
  assert.equal(stores.has('notas-local-before'),false);assert.equal(claimed,true);
});
