// Keeps the recognition model files in IndexedDB, in the recognition
// workers, keyed by their content-addressed path. A file is written only
// once its SHA-256 matches the model contract, so what is stored is never a
// short or damaged download; and a stored model that fails to start is kept
// as it is rather than thrown away and downloaded again (starting fails
// for reasons that are not the file's: memory, the runtime, a killed
// worker). It leaves this store only with its version - a newer model
// replaces it - or through "refresh handwriting models" in settings. The
// page asks the browser for persistent storage so the browser's own
// pressure eviction leaves it alone as well (local-recognition.js).
'use strict';
(()=>{
const DB='notas-models',STORE='files';
let opening=null;
function open(){
  if(!opening)opening=new Promise((resolve,reject)=>{
    let request;
    try{request=indexedDB.open(DB,1);}catch(e){reject(e);return;}
    request.onupgradeneeded=()=>{request.result.createObjectStore(STORE);};
    request.onsuccess=()=>{
      const db=request.result;
      // the page deletes the database on an explicit refresh; let it
      db.onversionchange=()=>{db.close();opening=null;};
      resolve(db);
    };
    request.onerror=()=>reject(request.error||new Error('model storage unavailable'));
    request.onblocked=()=>reject(new Error('model storage is busy'));
  }).catch(e=>{opening=null;throw e;});
  return opening;
}
function run(mode,work){
  return open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode),request=work(tx.objectStore(STORE));
    tx.oncomplete=()=>resolve(request&&request.result);
    tx.onerror=tx.onabort=()=>reject(tx.error||new Error('model storage failed'));
  }));
}
const get=key=>run('readonly',s=>s.get(key));
const keys=()=>run('readonly',s=>s.getAllKeys());
const put=(key,bytes)=>run('readwrite',s=>s.put(bytes,key));
const remove=key=>run('readwrite',s=>s.delete(key));
async function sha256(bytes){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
// the key is the path with its ?v= hash, so a new model is a new entry
const keyOf=url=>{const u=new URL(url,self.location.href);return u.pathname+u.search;};
const asBytes=value=>value instanceof ArrayBuffer?new Uint8Array(value):ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):null;

// The stored copy, or else the download - checked against its hash, then
// stored for next time. `saved` says the store now holds the file, so a
// copy kept elsewhere (the service worker's cache from an earlier build)
// is redundant. A store that cannot take it (quota, private mode) still
// returns the bytes: recognition runs this session and the file is fetched
// again next time.
async function load({url,sha,label,download,announce}){
  const key=keyOf(url);
  let stored=null;
  try{stored=asBytes(await get(key));}catch(e){}
  if(stored&&stored.byteLength){
    if(announce)announce();
    return {bytes:stored,saved:true};
  }
  const bytes=await download(url);
  if(sha){
    const digest=await sha256(bytes);
    if(digest!==sha)throw new Error(`The ${label} arrived damaged (${bytes.byteLength} bytes). Tap retry to download it again.`);
  }
  let saved=false;
  try{await put(key,bytes);saved=true;}catch(e){}
  return {bytes,saved};
}
// entries under a directory that a newer model has superseded
async function prune(dir,keep){
  const wanted=new Set(keep.map(keyOf));
  let all=[];
  try{all=await keys();}catch(e){return;}
  for(const key of all){
    if(typeof key!=='string'||!key.includes(dir)||wanted.has(key))continue;
    try{await remove(key);}catch(e){}
  }
}
self.NOTAS_MODEL_STORE={load,prune,get,put,remove,keys,keyOf,sha256,DB,STORE};
})();
