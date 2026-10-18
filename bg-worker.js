// Background removal for pictures in a note: BiRefNet lite at 512x512 (MIT),
// studioludens/birefnet-lite-512, the fp32 weights. It runs on WebGPU where
// the browser has it and falls back to WebAssembly where it does not, or
// where the GPU cannot take the model. Served from this site in chunks under
// the per-file limit, each checked against its hash, and kept in the model
// store. The page asks for it in the background once the notebook has
// started (prefetch below), so the first picture does not wait.
importScripts('./assets/smart/ort.webgpu.min.js?v=ed951b6e','./model-store.js','./assets/bg/model.js');

// The WebGPU build's own WebAssembly is 27 MB, over a static host's file
// limit, so it is served in two parts that setup joins and hands over as the
// binary (wasmBinary); only its script is loaded by address.
const ORT_ROOT=new URL('./assets/smart/',self.location.href).href;
ort.env.wasm.wasmPaths={mjs:ORT_ROOT+'ort-wasm-simd-threaded.asyncify.js?v=dee69056'};
// A phone or tablet runs this in the little memory the browser leaves a
// tab, beside the two handwriting readers. Every extra thread is another
// worker with its own stack and scratch space, so there it runs on one.
const MOBILE=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'')||
  (/Macintosh/.test(navigator.userAgent||'')&&(navigator.maxTouchPoints||0)>1);
function threads(lean){
  return lean||MOBILE||!self.crossOriginIsolated?1:Math.max(1,Math.min(4,navigator.hardwareConcurrency||1));
}
ort.env.wasm.numThreads=threads(false);
ort.env.wasm.proxy=false;
// the graph has shape arithmetic ORT cannot fold ahead of time; it says so
// once per node at warning level, which is noise in the console
ort.env.logLevel='error';

const SIZE=512,MEAN=[.485,.456,.406],STD=[.229,.224,.225];
const MODEL=self.NOTAS_BG_MODEL,RUNTIME=self.NOTAS_BG_RUNTIME;
// Earlier builds kept other models in the store: the fine-tuned slide model
// under assets/slide/ and the general one from Hugging Face. Once this one
// is stored they are only taking up the device's space.
const SUPERSEDED=['/assets/slide/','/birefnet-lite-512/'];
let session,backend,loading,fetching,started=false,wasmOnly=false;

function announce(id,phase,extra){self.postMessage({id,progress:true,phase,...extra});}
async function download(url,id,offset=0,overall=0){
  const r=await fetch(url);if(!r.ok)throw Error('the background remover could not download. check the connection and try again.');
  const total=Number(r.headers.get('content-length'))||0;
  if(!r.body)return new Uint8Array(await r.arrayBuffer());
  // Written straight into one buffer when the length is known: gathering
  // the chunks and then joining them held the model twice at once, on a
  // tablet already running the notebook.
  const reader=r.body.getReader();let chunks=null,loaded=0,last=0;
  let bytes=total?new Uint8Array(total):null;
  if(!bytes)chunks=[];
  for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    if(bytes&&loaded+value.length>bytes.length){chunks=[bytes.subarray(0,loaded)];bytes=null;}
    if(bytes)bytes.set(value,loaded);else chunks.push(value);
    loaded+=value.length;
    const now=Date.now();if(now-last<200)continue;last=now;
    if(id!=null)announce(id,'download',{loaded:offset+loaded,total:overall||total});
  }
  if(bytes)return loaded===bytes.length?bytes:bytes.slice(0,loaded);
  bytes=new Uint8Array(loaded);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return bytes;
}

// one download however it is asked for: a picture arriving while the
// prefetch is still downloading waits for that rather than starting another
async function downloadChunks(id){
  // Static hosts cap individual files at 25 MB. Assemble verified chunks,
  // then let the model store verify the complete model before caching it.
  const bytes=new Uint8Array(MODEL.bytes);let at=0;
  for(const part of MODEL.parts){
    const chunk=await download('./assets/bg/'+part.file,id,at,MODEL.bytes);
    if(chunk.length!==part.bytes||await self.NOTAS_MODEL_STORE.sha256(chunk)!==part.sha256)throw Error('the background remover arrived damaged. try again.');
    bytes.set(chunk,at);at+=chunk.length;
  }
  if(at!==bytes.length)throw Error('the background remover is incomplete.');
  return bytes;
}
// the runtime's binary, joined from its parts and checked. The service
// worker keeps the parts, so this is not downloaded again.
let runtimeReady;
function fetchRuntime(){
  if(!runtimeReady)runtimeReady=(async()=>{
    const bytes=new Uint8Array(RUNTIME.bytes);let at=0;
    for(const part of RUNTIME.parts){
      const chunk=await download(ORT_ROOT+part.file+'?v='+part.sha256.slice(0,8),null);
      if(chunk.length!==part.bytes||await self.NOTAS_MODEL_STORE.sha256(chunk)!==part.sha256)throw Error('the background remover arrived damaged. try again.');
      bytes.set(chunk,at);at+=chunk.length;
    }
    if(at!==bytes.length||await self.NOTAS_MODEL_STORE.sha256(bytes)!==RUNTIME.sha256)throw Error('the background remover is incomplete.');
    return bytes;
  })().catch(e=>{runtimeReady=null;throw e;});
  return runtimeReady;
}
function fetchModel(id){
  const store=self.NOTAS_MODEL_STORE;
  if(!fetching)fetching=store.load({
    url:MODEL.url,sha:MODEL.sha,label:'background remover',
    download:()=>downloadChunks(id)
  }).then(got=>{
    if(got.saved)for(const dir of SUPERSEDED)store.prune(dir,[MODEL.url]).catch(()=>{});
    return got;
  },e=>{fetching=null;throw e;});
  return fetching;
}
// download, check and store the model without starting it: starting takes
// a good deal of memory, which only a picture is worth. The runtime's parts
// come with it, for the service worker to keep, so the first picture works
// offline too.
async function prefetch(id){
  const store=self.NOTAS_MODEL_STORE;
  let have=[];try{have=await store.keys();}catch(e){}
  const stored=have.includes(store.keyOf(MODEL.url));
  if(!stored)await fetchModel(id);
  // stored now: the bytes are let go, and a picture later reads them back
  fetching=null;
  await fetchRuntime();runtimeReady=null;
  return stored?'stored':'downloaded';
}

// whether the browser has a WebGPU adapter to give this worker
async function gpuAvailable(){
  try{return !!(self.navigator&&navigator.gpu&&await navigator.gpu.requestAdapter());}
  catch(e){return false;}
}
function sessionOptions(provider){
  return {executionProviders:[provider],graphOptimizationLevel:'all',
    enableCpuMemArena:false,enableMemPattern:false,executionMode:'sequential',logSeverityLevel:3};
}

// On WebAssembly the model cannot be read from the disk as it runs: the
// runtime copies every weight into its own memory before the first picture.
// What can be done is to hold it only once. The stored copy is read, handed
// over and let go as soon as the runtime has its own, rather than kept
// beside it for as long as this worker lives; the runtime's pool, which
// grows to the largest step and never gives memory back, is turned off; and
// the memory plan made ahead of the run, one block for every step at once,
// is too. WebGPU is tried first; when it cannot start the model, the same
// bytes start on WebAssembly.
async function setup(id,lean){
  if(!loading)loading=(async()=>{
    if(!started)ort.env.wasm.numThreads=threads(lean);
    let {bytes}=await fetchModel(id);
    fetching=null;
    if(!started)ort.env.wasm.wasmBinary=await fetchRuntime();
    announce(id,'starting');
    started=true;
    try{
      let failure;
      for(const provider of (!wasmOnly&&await gpuAvailable())?['webgpu','wasm']:['wasm']){
        try{
          session=await ort.InferenceSession.create(bytes,sessionOptions(provider));
          backend=provider;failure=null;break;
        }catch(e){
          failure=e;
          if(provider==='webgpu')console.warn('background remover: webgpu could not start the model, using wasm ('+String((e&&e.message)||e)+')');
        }
      }
      if(failure){
        const why=String((failure&&failure.message)||failure);
        // Once the runtime has failed to start in this worker it stays failed
        // (it remembers that no backend could be found), so the page is told
        // to throw this worker away rather than ask it again.
        throw Object.assign(Error('the background remover could not start on this device ('+why+').'),
          {fatal:true,memory:/memory|allocat|no available backend|RangeError/i.test(why)});
      }
    }finally{bytes=null;runtimeReady=null;ort.env.wasm.wasmBinary=null;}
  })().catch(e=>{loading=null;throw e;});
  return loading;
}
// the GPU started the model and then failed it (a lost device, no memory for
// a buffer): start the model again on WebAssembly
async function useWasm(id,lean){
  wasmOnly=true;loading=null;
  const dead=session;session=null;
  try{await dead?.release();}catch(e){}
  await setup(id,lean);
}

// rgba is the picture already scaled to 512x512; the answer is its alpha
// matte at the same size, which the page scales back up to the picture.
async function infer(rgba){
  const plane=SIZE*SIZE,data=new Float32Array(3*plane);
  for(let i=0;i<plane;i++){
    // transparent pixels are read as white, as they show on the paper
    const a=rgba[i*4+3]/255;
    for(let c=0;c<3;c++)data[c*plane+i]=((rgba[i*4+c]*a+255*(1-a))/255-MEAN[c])/STD[c];
  }
  const input=new ort.Tensor('float32',data,[1,3,SIZE,SIZE]);
  try{return await session.run({[MODEL.input]:input});}
  finally{input.dispose();}
}
async function matte(id,buffer,lean){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==SIZE*SIZE*4)throw Error('that picture could not be prepared.');
  await setup(id,lean);
  announce(id,'running',{backend});
  const rgba=new Uint8ClampedArray(buffer),plane=SIZE*SIZE;
  let out;
  try{out=await infer(rgba);}
  catch(e){
    if(backend==='webgpu'){
      console.warn('background remover: the GPU stopped partway, using wasm ('+String((e&&e.message)||e)+')');
      try{await useWasm(id,lean);announce(id,'running',{backend});out=await infer(rgba);}catch(e2){e=e2;}
    }
    if(!out){
      const why=String((e&&e.message)||e);
      throw Object.assign(Error('the background remover stopped partway ('+why+').'),{fatal:true,memory:/memory|allocat|RangeError/i.test(why)});
    }
  }
  try{
    const logits=await out[MODEL.output].getData();
    // the output is logits: the sigmoid is the alpha
    const alpha=new Uint8ClampedArray(plane);
    // A run that overflows gives NaN, which comes out as a fully transparent
    // picture: that is a failure, not a matte.
    let bad=0;
    for(let i=0;i<plane;i++){
      const v=logits[i];
      if(!Number.isFinite(v)){bad++;continue;}
      alpha[i]=255/(1+Math.exp(-v));
    }
    if(bad>plane*.01)throw Error('the background remover could not make sense of this picture.');
    return {alpha,backend};
  }finally{for(const t of Object.values(out))t.dispose?.();}
}

async function handleMessage(data){
  const {id,rgba,lean}=data;
  if(data.prefetch){
    try{self.postMessage({id,done:await prefetch(id)});}
    catch(err){self.postMessage({id,error:(err&&err.message)||String(err)});}
    return;
  }
  try{
    let result;
    try{result=await matte(id,rgba,lean);}
    finally{
      // Keep the verified disk cache, but release weights and GPU resources
      // before replying, including on failure. The page terminates the worker
      // when the queue drains to reclaim the runtime's WASM heap too.
      const dead=session;session=null;loading=null;fetching=null;runtimeReady=null;
      ort.env.wasm.wasmBinary=null;
      try{await dead?.release();}catch(e){}
    }
    self.postMessage({id,...result},[result.alpha.buffer]);
  }catch(err){
    const memory=!!err?.memory||/out of memory|\boom\b|memory access out of bounds|allocat|memory.*(?:grow|limit)/i.test(String(err?.message||err));
    self.postMessage({id,error:memory?'Not enough available memory to remove the background. Close a few apps or tabs, then try again. Your original image is unchanged.':(err&&err.message)||String(err),fatal:memory||!!err?.fatal,memory});
  }
};

// Serialize inference, setup and disposal: runtime sessions cannot overlap.
let requestQueue=Promise.resolve(),queued=0;
self.onmessage=({data})=>{
  if(!data||typeof data!=='object'||Array.isArray(data)){
    self.postMessage({error:'Invalid worker request.'});return;
  }
  if(queued>=32){self.postMessage({id:data.id,error:'Too many queued worker requests.'});return;}
  queued++;
  requestQueue=requestQueue.then(()=>handleMessage(data)).catch(e=>{
    self.postMessage({id:data.id,error:e?.message||String(e)});
  }).finally(()=>{queued--;});
};
