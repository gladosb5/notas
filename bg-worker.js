// Background removal for pictures in a note: BiRefNet lite, re-exported at
// 512x512 so it fits the browser runtime (studioludens/birefnet-lite-512,
// MIT, fp16 weights with float32 input and output). At 94 MB it is larger
// than the site may serve one file, so it comes from Hugging Face at a
// pinned revision, is checked against its hash and is kept in the model
// store. The page asks for it in the background once the notebook has
// started (prefetch below), so the first picture does not wait for it.
importScripts('./assets/smart/ort.wasm.min.js?v=4043d2de','./model-store.js');

const ORT_ROOT=new URL('./assets/smart/',self.location.href).href;
ort.env.wasm.wasmPaths={
  wasm:ORT_ROOT+'ort-wasm-simd-threaded.wasm?v=be0e1299',
  mjs:ORT_ROOT+'ort-wasm-simd-threaded.js?v=5687566b'
};
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
const SLIDE=new URLSearchParams(self.location.search).has('slide');
if(SLIDE)importScripts('./assets/slide/model.js','./slide-surface.js');
const MODEL=SLIDE?self.NOTAS_SLIDE_MODEL:{
  url:'https://huggingface.co/studioludens/birefnet-lite-512/resolve/4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7/onnx/model_fp16.onnx',
  sha:'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516'
};
let session,loading,fetching,started=false;

function announce(id,phase,extra){self.postMessage({id,progress:true,phase,...extra});}
async function download(url,id,offset=0,overall=0){
  const r=await fetch(url);if(!r.ok)throw Error('the background remover could not download. check the connection and try again.');
  const total=Number(r.headers.get('content-length'))||0;
  if(!r.body)return new Uint8Array(await r.arrayBuffer());
  // Written straight into one buffer when the length is known: gathering
  // the chunks and then joining them held the 94 MB twice at once, on a
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
    announce(id,'download',{loaded:offset+loaded,total:overall||total});
  }
  if(bytes)return loaded===bytes.length?bytes:bytes.slice(0,loaded);
  bytes=new Uint8Array(loaded);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return bytes;
}

// one download however it is asked for: a picture arriving while the
// prefetch is still downloading waits for that rather than starting another
async function downloadSlide(id){
  // Static hosts cap individual files at 25 MB. Assemble verified chunks,
  // then let the model store verify the complete model before caching it.
  const bytes=new Uint8Array(MODEL.bytes);let at=0;
  for(const part of MODEL.parts){
    const chunk=await download('./assets/slide/'+part.file,id,at,MODEL.bytes);
    if(chunk.length!==part.bytes||await self.NOTAS_MODEL_STORE.sha256(chunk)!==part.sha256)throw Error('the slide model arrived damaged. try again.');
    bytes.set(chunk,at);at+=chunk.length;
  }
  if(at!==bytes.length)throw Error('the slide model is incomplete.');
  return bytes;
}
function fetchModel(id){
  if(!fetching)fetching=self.NOTAS_MODEL_STORE.load({
    url:MODEL.url,sha:MODEL.sha,label:'background remover',
    download:url=>SLIDE?downloadSlide(id):download(url,id)
  }).catch(e=>{fetching=null;throw e;});
  return fetching;
}
// download, check and store the model without starting it: starting takes
// about 2 GB, which only a picture is worth
async function prefetch(id){
  const store=self.NOTAS_MODEL_STORE;
  let have=[];try{have=await store.keys();}catch(e){}
  if(have.includes(store.keyOf(MODEL.url)))return 'stored';
  await fetchModel(id);
  // stored now: the bytes are let go, and a picture later reads them back
  fetching=null;
  return 'downloaded';
}

// The model cannot be read from the disk as it runs: the runtime copies
// every weight into its own memory before the first picture. What can be
// done is to hold it only once. The stored copy is read, handed over and
// let go as soon as the runtime has its own, rather than kept beside it for
// as long as this worker lives; the runtime's pool, which grows to the
// largest step and never gives memory back, is turned off; and the memory
// plan made ahead of the run, one block for every step at once, is too.
async function setup(id,lean){
  if(!loading)loading=(async()=>{
    if(!started)ort.env.wasm.numThreads=threads(lean);
    let {bytes}=await fetchModel(id);
    fetching=null;
    announce(id,'starting');
    started=true;
    try{
      session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all',
        enableCpuMemArena:false,enableMemPattern:false,executionMode:'sequential',logSeverityLevel:3});
    }catch(e){
      const why=String((e&&e.message)||e);
      // Once the runtime has failed to start in this worker it stays failed
      // (it remembers that no backend could be found), so the page is told
      // to throw this worker away rather than ask it again.
      throw Object.assign(Error('the background remover could not start on this device ('+why+').'),
        {fatal:true,memory:/memory|allocat|no available backend|RangeError/i.test(why)});
    }finally{bytes=null;}
  })().catch(e=>{loading=null;throw e;});
  return loading;
}

// rgba is the picture already scaled to 512x512; the answer is its alpha
// matte at the same size, which the page scales back up to the picture
async function matte(id,buffer,lean){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==SIZE*SIZE*4)throw Error('that picture could not be prepared.');
  await setup(id,lean);
  announce(id,'running');
  const rgba=new Uint8ClampedArray(buffer),plane=SIZE*SIZE,data=new Float32Array(3*plane);
  for(let i=0;i<plane;i++){
    // transparent pixels are read as white, as they show on the paper
    const a=rgba[i*4+3]/255;
    for(let c=0;c<3;c++)data[c*plane+i]=((rgba[i*4+c]*a+255*(1-a))/255-MEAN[c])/STD[c];
  }
  let out;
  const input=new ort.Tensor('float32',data,[1,3,SIZE,SIZE]);
  try{out=await session.run({[session.inputNames[0]]:input});}
  catch(e){
    const why=String((e&&e.message)||e);
    throw Object.assign(Error('the background remover stopped partway ('+why+').'),{fatal:true,memory:/memory|allocat|RangeError/i.test(why)});
  }
  finally{input.dispose();}
  const logits=out[session.outputNames.at(-1)].data;
  let alpha=new Uint8ClampedArray(plane);
  // A run that overflowed in half precision gives NaN, which comes out as a
  // fully transparent picture: that is a failure, not a matte.
  let bad=0,kept=0,strong=0,left=SIZE,top=SIZE,right=0,bottom=0;
  for(let i=0;i<plane;i++){
    const v=logits[i];if(!Number.isFinite(v)){bad++;continue;}
    const p=1/(1+Math.exp(-v));
    alpha[i]=SLIDE?255*Math.max(0,Math.min(1,(p-.4)/.2)):255*p;
    if(SLIDE&&p>=.5){
      kept++;if(p>=.9)strong++;
      const x=i%SIZE,y=Math.floor(i/SIZE);
      left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);
    }
  }
  for(const t of Object.values(out))t.dispose?.();
  if(bad>plane*.01)throw Error('the background remover could not make sense of this picture.');
  // A slide must have a confident, substantial region, rather than a few
  // scattered foreground specks. Partial slides may touch any image edge.
  const slideDetected=SLIDE&&kept>=plane*.004&&strong>=kept*.9&&kept>=Math.max(1,(right-left)*(bottom-top))*.55;
  if(slideDetected)alpha=self.NOTAS_SLIDE_SURFACE(rgba,alpha,SIZE);
  return {alpha,slideDetected};
}

async function handleMessage(data){
  const {id,rgba,lean}=data;
  if(data.prefetch){
    try{self.postMessage({id,done:await prefetch(id)});}
    catch(err){self.postMessage({id,error:(err&&err.message)||String(err)});}
    return;
  }
  try{
    const result=await matte(id,rgba,lean);
    self.postMessage({id,...result},[result.alpha.buffer]);
  }catch(err){
    self.postMessage({id,error:(err&&err.message)||String(err),fatal:!!(err&&err.fatal),memory:!!(err&&err.memory)});
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
