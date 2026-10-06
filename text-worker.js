// PP-OCRv6 small text recognition for hidden handwriting-search transcripts.
// The model is separate from the maths recognisers: its output is never used
// to calculate an expression or replace what the student wrote.
importScripts('./assets/smart/ort.wasm.min.js?v=4043d2de');

const ORT_ROOT=new URL('./assets/smart/',self.location.href).href;
ort.env.wasm.wasmPaths={
  wasm:ORT_ROOT+'ort-wasm-simd-threaded.wasm?v=be0e1299',
  mjs:ORT_ROOT+'ort-wasm-simd-threaded.js?v=5687566b'
};
ort.env.wasm.numThreads=self.crossOriginIsolated?Math.max(1,Math.min(4,navigator.hardwareConcurrency||1)):1;
ort.env.wasm.proxy=false;

const HEIGHT=48,BASE_WIDTH=320,MAX_WIDTH=3200,CLASSES=18710;
const MODEL={url:'./assets/text/ppocrv6-small.onnx?v=5435fd74',sha:'5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634'};
let session,loading,chars;

// The page counts this download in beside the stroke reader's, so the
// model is read as a stream and its progress announced the same way.
function announce(id,status,extra){self.postMessage({id,progress:true,status,...extra});}
const mb=n=>Math.round(n/1048576);
async function fetchModel(url,id){
  const r=await fetch(url);if(!r.ok)throw Error('Handwriting search model could not load.');
  const total=Number(r.headers.get('content-length'))||0;
  if(!r.body)return new Uint8Array(await r.arrayBuffer());
  const reader=r.body.getReader(),chunks=[];let loaded=0,last=0;
  for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    chunks.push(value);loaded+=value.length;
    const now=Date.now();if(now-last<200)continue;last=now;
    announce(id,total?`Text reading: downloading ${mb(loaded)} of ${mb(total)} MB`:`Text reading: downloading ${mb(loaded)} MB`,{loaded,total});
  }
  const bytes=new Uint8Array(loaded);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return bytes;
}

async function evictTextModel(){
  try{
    if(!self.caches)return;
    const paths=[MODEL.url,'./assets/text/ppocrv6_dict.txt'].map(p=>new URL(p,self.location.href).pathname);
    for(const key of await caches.keys()){
      const cache=await caches.open(key);
      for(const request of await cache.keys())if(paths.includes(new URL(request.url).pathname))await cache.delete(request);
    }
  }catch(e){}
}

async function setup(retry=true,id){
  if(!loading)loading=(async()=>{
    announce(id,'Text reading: fetching…');
    const [bytes,dictRes]=await Promise.all([
      fetchModel(MODEL.url,id),
      fetch('./assets/text/ppocrv6_dict.txt?v=b5f2bfe2')
    ]);
    if(!dictRes.ok)throw Error('Handwriting search model could not load.');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==MODEL.sha){
      await evictTextModel();
      throw Error('Handwriting search model failed integrity validation and was cleared. Retry to download it again.');
    }
    const dictionary=await dictRes.arrayBuffer();
    const dictionaryHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',dictionary)),b=>b.toString(16).padStart(2,'0')).join('');
    if(dictionaryHash!=='b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d'){
      await evictTextModel();throw Error('Handwriting dictionary integrity validation failed and was cleared.');
    }
    const dict=new TextDecoder().decode(dictionary).replace(/\r/g,'').split('\n');
    if(dict.at(-1)==='')dict.pop();
    // Paddle's config sets use_space_char=true. CTCLabelDecode prepends the
    // blank class and appends one literal space after the dictionary.
    chars=['blank',...dict,' '];
    if(chars.length!==CLASSES)throw Error('Handwriting search dictionary does not match the model.');
    announce(id,'Text reading: starting the model…');
    // The bytes were just checked against their hash, so a model that does
    // not start is kept: the failure is the runtime's or the device's, and a
    // retry starts again from the stored copy rather than downloading 20 MB.
    try{
      session=await ort.InferenceSession.create(bytes,{
        executionProviders:['wasm'],graphOptimizationLevel:'all',enableCpuMemArena:true,
        enableMemPattern:false,intraOpNumThreads:1,interOpNumThreads:1
      });
    }catch(e){
      throw Error('The handwriting search model could not start ('+((e&&e.message)||e)+'). Retry; the model is kept on this device.');
    }
  })().catch(e=>{loading=null;throw e;});
  try{return await loading;}catch(e){
    if(retry&&/integrity/i.test(e.message))return setup(false,id);
    throw e;
  }
}

function preprocess(width,height,buffer){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
     width>2048||height>1024||width*height>900000||!(buffer instanceof ArrayBuffer)||buffer.byteLength!==width*height*4)
    throw Error('Handwriting search crop is too large.');
  const rgba=new Uint8ClampedArray(buffer);
  const src=new OffscreenCanvas(width,height),sx=src.getContext('2d');
  const image=sx.createImageData(width,height);image.data.set(rgba);sx.putImageData(image,0,0);

  // PP-OCRv6 grows recognition width with the line's aspect ratio. Squeezing a
  // long line into 320px destroys character detail, while the exported model
  // supports dynamic widths up to 3200px.
  const resizedW=Math.max(1,Math.min(MAX_WIDTH,Math.ceil(HEIGHT*width/height)));
  const inputW=Math.max(BASE_WIDTH,resizedW);
  const cv=new OffscreenCanvas(resizedW,HEIGHT),x=cv.getContext('2d',{willReadFrequently:true});
  x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';x.drawImage(src,0,0,resizedW,HEIGHT);
  const out=x.getImageData(0,0,resizedW,HEIGHT).data;
  const plane=HEIGHT*inputW,data=new Float32Array(3*plane);
  for(let y=0;y<HEIGHT;y++)for(let xx=0;xx<resizedW;xx++){
    const si=(y*resizedW+xx)*4,di=y*inputW+xx,a=out[si+3]/255;
    // Compose any transparency onto white, then convert RGB -> BGR and map
    // [0,255] to [-1,1], matching Paddle's RecResizeImg preprocessing.
    const r=out[si]*a+255*(1-a),g=out[si+1]*a+255*(1-a),b=out[si+2]*a+255*(1-a);
    data[di]=b/127.5-1;data[plane+di]=g/127.5-1;data[2*plane+di]=r/127.5-1;
  }
  return {data,inputW,resizedW};
}

function decode(tensor){
  const d=tensor.data,shape=tensor.dims,steps=shape[1],classesN=shape[2];
  if(classesN!==chars.length)throw Error('Handwriting search output does not match its dictionary.');
  let prev=-1,text='',sum=0,count=0;
  for(let t=0;t<steps;t++){
    const off=t*classesN;let best=0,bp=d[off];
    for(let j=1;j<classesN;j++)if(d[off+j]>bp){bp=d[off+j];best=j;}
    if(best!==0&&best!==prev){text+=chars[best];sum+=bp;count++;}
    prev=best;
  }
  return {text:text.trim(),confidence:count?sum/count:0};
}

async function recognize(width,height,buffer){
  const p=preprocess(width,height,buffer);
  await setup();
  const input=new ort.Tensor('float32',p.data,[1,3,HEIGHT,p.inputW]);
  let out;
  try{
    out=await session.run({[session.inputNames[0]]:input});
    return {...decode(out[session.outputNames[0]]),inputWidth:p.inputW};
  }finally{
    input.dispose();if(out)for(const value of Object.values(out))value.dispose();
  }
}

async function handleMessage(data){
  const {id,type}=data;
  try{
    if(type==='setup'){await setup(true,id);self.postMessage({id,ready:true});return;}
    if(type==='dispose'){if(session)await session.release();session=null;loading=null;chars=null;self.postMessage({id,disposed:true});return;}
    if(type!=='recognize')throw Error('Unknown handwriting search request.');
    self.postMessage({id,...await recognize(data.width,data.height,data.buffer)});
  }catch(e){self.postMessage({id,error:e&&e.message?e.message:String(e)});}
}

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
