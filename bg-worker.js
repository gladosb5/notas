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
ort.env.wasm.numThreads=self.crossOriginIsolated?Math.max(1,Math.min(4,navigator.hardwareConcurrency||1)):1;
ort.env.wasm.proxy=false;
// the graph has shape arithmetic ORT cannot fold ahead of time; it says so
// once per node at warning level, which is noise in the console
ort.env.logLevel='error';

const SIZE=512,MEAN=[.485,.456,.406],STD=[.229,.224,.225];
const MODEL={
  url:'https://huggingface.co/studioludens/birefnet-lite-512/resolve/4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7/onnx/model_fp16.onnx',
  sha:'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516'
};
let session,loading,fetching;

function announce(id,phase,extra){self.postMessage({id,progress:true,phase,...extra});}
async function download(url,id){
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
    announce(id,'download',{loaded,total});
  }
  if(bytes)return loaded===bytes.length?bytes:bytes.slice(0,loaded);
  bytes=new Uint8Array(loaded);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return bytes;
}

// one download however it is asked for: a picture arriving while the
// prefetch is still downloading waits for that rather than starting another
function fetchModel(id){
  if(!fetching)fetching=self.NOTAS_MODEL_STORE.load({
    url:MODEL.url,sha:MODEL.sha,label:'background remover',
    download:url=>download(url,id)
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

async function setup(id){
  if(!loading)loading=(async()=>{
    const {bytes}=await fetchModel(id);
    announce(id,'starting');
    try{
      session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all',logSeverityLevel:3});
    }catch(e){
      throw Error('the background remover could not start on this device ('+((e&&e.message)||e)+').');
    }
  })().catch(e=>{loading=null;throw e;});
  return loading;
}

// rgba is the picture already scaled to 512x512; the answer is its alpha
// matte at the same size, which the page scales back up to the picture
async function matte(id,buffer){
  if(buffer.byteLength!==SIZE*SIZE*4)throw Error('that picture could not be prepared.');
  await setup(id);
  announce(id,'running');
  const rgba=new Uint8ClampedArray(buffer),plane=SIZE*SIZE,data=new Float32Array(3*plane);
  for(let i=0;i<plane;i++){
    // transparent pixels are read as white, as they show on the paper
    const a=rgba[i*4+3]/255;
    for(let c=0;c<3;c++)data[c*plane+i]=((rgba[i*4+c]*a+255*(1-a))/255-MEAN[c])/STD[c];
  }
  const out=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',data,[1,3,SIZE,SIZE])});
  const logits=out[session.outputNames.at(-1)].data,alpha=new Uint8ClampedArray(plane);
  for(let i=0;i<plane;i++)alpha[i]=255/(1+Math.exp(-logits[i]));
  return alpha;
}

self.onmessage=async e=>{
  const {id,rgba}=e.data||{};
  if(e.data&&e.data.prefetch){
    try{self.postMessage({id,done:await prefetch(id)});}
    catch(err){self.postMessage({id,error:(err&&err.message)||String(err)});}
    return;
  }
  try{
    const alpha=await matte(id,rgba);
    self.postMessage({id,alpha},[alpha.buffer]);
  }catch(err){
    self.postMessage({id,error:(err&&err.message)||String(err)});
  }
};
