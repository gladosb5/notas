'use strict';
const CACHE='notas-local-v121';
self.addEventListener('message',event=>{
  if(event.data?.type==='GET_VERSION')event.ports[0]?.postMessage({version:CACHE.replace('notas-local-','')});
});
const RECOGNITION_ASSET=/\/assets\/(?:text|smart|ink)\//;
const INK_MODEL=/\/assets\/ink\/[^?]*\.onnx$/;
const SHELL=['./notas.html','./model-contract.js','./local-recognition.js','./ink-worker.js','./ink-features.js','./model-store.js','./text-worker.js','./bg-worker.js','./slide-surface.js','./assets/slide/model.js',
  // Workers request content-addressed model URLs. Cache those exact keys during
  // install so a newly activated build cannot pair fresh worker code with stale
  // weights, and text recognition still works on the first offline reopen.
  './assets/text/ppocrv6-small.onnx?v=5435fd74','./assets/text/ppocrv6_dict.txt?v=b5f2bfe2','./assets/ink/HAND-TO-TEX-LICENSE.txt',
  // The ONNX runtime both readers load. Left to the lazy cache below it was
  // never stored on a first visit, whose workers start before this worker
  // controls the page, so "available offline" came with neither reader
  // able to start offline. scripts/model-contract.mjs checks these hashes.
  './assets/smart/ort.wasm.min.js?v=4043d2de','./assets/smart/ort-wasm-simd-threaded.js?v=5687566b','./assets/smart/ort-wasm-simd-threaded.wasm?v=be0e1299',
  './local-math-help.js','./diagram.js','./nota.js','./collab.js','./manifest.webmanifest','./asset-manifest.json',
  './assets/icon-16.png','./assets/icon-32.png','./assets/icon-192.png','./assets/icon-512.png',
  './assets/icon-maskable-512.png','./assets/apple-touch-icon.png',
  // the wordmark is drawn through a CSS mask on the launch screen and top bar
  './assets/logo.png'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const response=await fetch('./asset-manifest.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Offline asset list unavailable');
  const assets=await response.json(),cache=await caches.open(CACHE);
  // A few at a time: strictly one after another made offline setup take
  // minutes on a slow link, while all at once could exhaust memory on a
  // tablet with the 20 MB text model in the list.
  const queue=[...SHELL,...assets];
  const worker=async()=>{
    for(let url=queue.shift();url!==undefined;url=queue.shift()){
      const request=new Request(new URL(url,self.location),{cache:'reload'});
      // A model file is content-addressed (?v=<hash>), so a copy any build
      // already holds is the copy: carried over rather than downloaded again
      // on every version of this file, or after the app is reloaded from
      // the menu.
      if(RECOGNITION_ASSET.test(request.url)){
        const kept=await caches.match(request);
        if(kept){await cache.put(request,kept);continue;}
      }
      const result=await fetch(request);
      if(!result.ok)throw new Error('Offline asset unavailable: '+url);
      await cache.put(request,result);
    }
  };
  await Promise.all([worker(),worker(),worker(),worker()]);
  // Activate after existing tabs close, so their code and cached assets stay together.
})()));
// The stroke reader (18 MB) and the ONNX runtime are lazy-cached on first
// use rather than during install, so deleting the previous build's cache
// outright threw them away on every version bump. Entries the new
// ink-worker.js still names are content-addressed, so they are carried over
// as they are; superseded versions (and the retired 80 MB Smart model) are
// dropped with the old cache.
async function keepRecognitionAssets(cache){
  const wanted=new Set();
  try{
    const source=await (await cache.match(new URL('./ink-worker.js',self.location).href))?.text();
    // The model files are written with their directory ('./assets/ink/…?v=…')
    // and the runtime files without it (ORT+'ort-wasm….wasm?v=…'), so match on
    // the versioned file name alone; the runtime lives in assets/smart/.
    for(const m of (source||'').matchAll(/([\w.-]+\.(?:onnx|json|js|mjs|wasm))\?v=([0-9a-f]+)/g))
      wanted.add(new URL('./assets/'+(m[1].startsWith('ort')?'smart':'ink')+'/'+m[1]+'?v='+m[2],self.location).href);
  }catch(e){}
  for(const key of await caches.keys()){
    if(!key.startsWith('notas-local-')||key===CACHE)continue;
    const old=await caches.open(key);
    for(const request of await old.keys()){
      if(!/\/assets\/(?:smart|ink)\//.test(new URL(request.url).pathname))continue;
      if(!wanted.has(request.url))continue;
      if(await cache.match(request))continue;
      const response=await old.match(request);
      if(response)try{await cache.put(request,response);}catch(e){}
    }
  }
}
// The build before this one is kept one version longer: a tab still open on
// it keeps asking for its own content-addressed files (a model it had not
// loaded yet), which a new deploy may no longer serve. Anything older goes.
const version=key=>+(/^notas-local-v(\d+)$/.exec(key)||[])[1]||0;
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  try{await keepRecognitionAssets(await caches.open(CACHE));}catch(e){}
  const old=(await caches.keys()).filter(k=>k.startsWith('notas-local-')&&k!==CACHE).sort((a,b)=>version(b)-version(a));
  for(const key of old.slice(1))await caches.delete(key);
  // Existing tabs keep their current controller until they close.
})()));
// an exact request any kept build holds: the current one first
async function held(request){
  const cache=await caches.open(CACHE);
  const own=await cache.match(request);
  if(own)return own;
  for(const key of await caches.keys()){
    if(!key.startsWith('notas-local-')||key===CACHE)continue;
    const hit=await (await caches.open(key)).match(request);
    if(hit)return hit;
  }
  return null;
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=='GET')return;
  // the room and its status check are live answers, never a cached one
  if(url.pathname.includes('/collab/'))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // The stroke reader and the ONNX runtime are lazy-cached on first use.
    // The PP-OCRv6 search model is part of SHELL above so "Available
    // offline" also means handwritten-text search is available offline.
    if(url.pathname.includes('/assets/smart/')||url.pathname.includes('/assets/ink/')){
      const stored=await held(event.request);
      if(stored)return stored;
      const response=await fetch(new Request(event.request,{cache:'reload'}));
      // Stored in the background: awaiting the put here held every byte back
      // until the whole file had landed, so the worker's progress sat at
      // zero and then jumped to done. A failed store must not fail recognition
      // this session either; the asset simply downloads again next time.
      // The stroke model's own files are not stored here: ink-worker.js
      // keeps them in IndexedDB (model-store.js), one copy on the device.
      if(response.ok&&!INK_MODEL.test(url.pathname))event.waitUntil(cache.put(event.request,response.clone()).catch(()=>{}));
      return response;
    }
    const key=event.request.mode==='navigate'?new URL('./notas.html',self.location).href:event.request;
    /* the page itself always comes from this build; a versioned file an
       older tab still asks for may come from the build before */
    const stored=event.request.mode==='navigate'||!url.search?await cache.match(key):await held(key);
    if(stored)return stored;
    // A missing entry means it was either explicitly invalidated or never
    // cached. Revalidate past the browser HTTP cache before using it again.
    const response=await fetch(new Request(event.request,{cache:'reload'}));
    if(response.ok)try{await cache.put(event.request,response.clone());}catch(e){}
    return response;
  })());
});
