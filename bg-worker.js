// Background removal for pictures in a note: BiRefNet lite, re-exported at
// 512x512 so it fits the browser runtime (studioludens/birefnet-lite-512,
// MIT, fp16 weights with float32 input and output). At 94 MB it is larger
// than the site may serve one file, so it comes from Hugging Face at a
// pinned revision, is checked against its hash and is kept in the model
// store: downloaded once, the first time a background is removed.
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
let session,loading;

function announce(id,phase,extra){self.postMessage({id,progress:true,phase,...extra});}
async function download(url,id){
  const r=await fetch(url);if(!r.ok)throw Error('the background remover could not download. check the connection and try again.');
  const total=Number(r.headers.get('content-length'))||0;
  if(!r.body)return new Uint8Array(await r.arrayBuffer());
  const reader=r.body.getReader(),chunks=[];let loaded=0,last=0;
  for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    chunks.push(value);loaded+=value.length;
    const now=Date.now();if(now-last<200)continue;last=now;
    announce(id,'download',{loaded,total});
  }
  const bytes=new Uint8Array(loaded);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return bytes;
}

async function setup(id){
  if(!loading)loading=(async()=>{
    const {bytes}=await self.NOTAS_MODEL_STORE.load({
      url:MODEL.url,sha:MODEL.sha,label:'background remover',
      download:url=>download(url,id)
    });
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
  try{
    const alpha=await matte(id,rgba);
    self.postMessage({id,alpha},[alpha.buffer]);
  }catch(err){
    self.postMessage({id,error:(err&&err.message)||String(err)});
  }
};
