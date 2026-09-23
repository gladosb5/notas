// Stroke-native handwritten-math recognizer, derived from Hand-to-TeX (MIT).
// It consumes notas's original online pen strokes instead of a raster crop.
try{importScripts('./assets/smart/ort.wasm.min.js?v=4043d2de');}
catch(e){throw new Error('Could not start the stroke handwriting runtime.');}

const ORT=new URL('./assets/smart/',self.location.href).href;
ort.env.wasm.wasmPaths={
  wasm:ORT+'ort-wasm-simd-threaded.wasm?v=be0e1299',
  mjs:ORT+'ort-wasm-simd-threaded.js?v=5687566b'
};
ort.env.wasm.numThreads=self.crossOriginIsolated?Math.max(1,Math.min(4,navigator.hardwareConcurrency||1)):1;
ort.env.wasm.proxy=false;

const ROOT=new URL('./assets/ink/',self.location.href).href;
const URLS={
  encoder:ROOT+'encoder.onnx?v=6450d48d',
  decoder:ROOT+'decoder_step.onnx?v=f1e83d45',
  vocab:ROOT+'vocab.json?v=c3983a1c'
};
importScripts('./ink-features.js','./model-contract.js','./model-store.js');
const {features,resample}=self.NOTAS_INK_FEATURES,MAX_TOKENS=150;
let encoder,decoder,vocab,pad,sos,eos,loading,busy=false;

function announce(id,status,extra){self.postMessage({id,progress:true,status,...extra});}
// The two model files are read as streams so the page can count the
// download in ("downloading 7 of 18 MB") the first time; both are summed
// into one figure, and the byte counts go along for the models panel. A
// response without a length is counted without a total.
const mb=n=>Math.round(n/1048576);
function downloadReporter(id){
  const files=new Map();let last=0;
  return (url,loaded,total,done)=>{
    files.set(url,{loaded,total});
    const now=Date.now();if(!done&&now-last<200)return;last=now;
    let l=0,t=0,known=true;
    for(const f of files.values()){l+=f.loaded;if(f.total)t+=f.total;else known=false;}
    const whole=known&&files.size===2;
    announce(id,whole?`Stroke reading: downloading ${mb(l)} of ${mb(t)} MB`:`Stroke reading: downloading ${mb(l)} MB`,{loaded:l,total:whole?t:0});
  };
}
async function fetchBytes(url,label,report){
  const r=await fetch(url);if(!r.ok)throw new Error(`Could not load the ${label} (${r.status}).`);
  const total=Number(r.headers.get('content-length'))||0;
  if(!r.body)return new Uint8Array(await r.arrayBuffer());
  const reader=r.body.getReader(),chunks=[];let loaded=0;
  for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    chunks.push(value);loaded+=value.length;report(url,loaded,total,false);
  }
  report(url,loaded,total,true);
  const bytes=new Uint8Array(loaded);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return bytes;
}
// The model files live in IndexedDB (model-store.js): read from there when
// present, otherwise downloaded, checked against the contract's SHA-256 and
// stored. A model that then fails to start is not thrown away: it is the
// same bytes that were verified, so the failure is the runtime's or the
// device's, and a retry starts again from the stored copy instead of
// downloading 44 MB. Only a newer model replaces it.
const STORE=()=>self.NOTAS_MODEL_STORE;
const HASHES=()=>(self.NOTAS_MODEL_CONTRACT&&self.NOTAS_MODEL_CONTRACT.math&&self.NOTAS_MODEL_CONTRACT.math.hashes)||{};
async function loadModelFile(url,file,label,report,id){
  const store=STORE();
  if(!store)return {bytes:await fetchBytes(url,label,report),saved:false};
  return store.load({url,sha:HASHES()['assets/ink/'+file],label,
    download:u=>fetchBytes(u,label,report),
    announce:()=>announce(id,'Stroke reading: loading the stored model…')});
}
// The service worker used to keep these files as well; once the store
// holds them that copy is redundant, so it goes (one copy on the device).
async function dropCachedCopies(urls){
  try{
    if(!self.caches||!urls.length)return;
    for(const key of await caches.keys()){
      const cache=await caches.open(key);
      for(const url of urls)await cache.delete(url);
    }
  }catch(e){}
}
async function setup(id){
  if(!loading)loading=(async()=>{
    announce(id,'Stroke reading: fetching…');
    const report=downloadReporter(id);
    const [enc,dec,vocabRes]=await Promise.all([
      loadModelFile(URLS.encoder,'encoder.onnx','stroke encoder',report,id),
      loadModelFile(URLS.decoder,'decoder_step.onnx','stroke decoder',report,id),
      fetch(URLS.vocab)
    ]);
    if(!vocabRes.ok)throw new Error(`Could not load the stroke vocabulary (${vocabRes.status}).`);
    const groups=await vocabRes.json(),tokens=[];
    for(const value of Object.values(groups))tokens.push(...(Array.isArray(value)?value:[value]));
    vocab=tokens;pad=tokens.indexOf('<PAD>');sos=tokens.indexOf('<SOS>');eos=tokens.indexOf('<EOS>');
    if(tokens.length!==258||pad<0||sos<0||eos<0)throw new Error('Stroke handwriting vocabulary does not match its model.');
    announce(id,'Stroke reading: starting the model…');
    const options={executionProviders:['wasm'],graphOptimizationLevel:'all',enableCpuMemArena:true,enableMemPattern:false,intraOpNumThreads:1,interOpNumThreads:1};
    // Both halves start together; when one fails (out of memory, on a
    // tablet) the one that started is released, or every retry would leave
    // another session behind in this worker and fail sooner.
    const started=await Promise.allSettled([
      ort.InferenceSession.create(enc.bytes,options),ort.InferenceSession.create(dec.bytes,options)
    ]);
    const failed=started.find(r=>r.status==='rejected');
    if(failed){
      for(const r of started)if(r.status==='fulfilled')r.value.release?.().catch?.(()=>{});
      const e=failed.reason;
      throw new Error('The stroke model could not start ('+(e?.message||e)+'). Tap retry; the model is kept on this device.');
    }
    [encoder,decoder]=started.map(r=>r.value);
    // housekeeping after the model is up, so it never delays the first reading
    const store=STORE();
    if(store){
      dropCachedCopies([enc.saved&&URLS.encoder,dec.saved&&URLS.decoder].filter(Boolean));
      store.prune('/assets/ink/',[URLS.encoder,URLS.decoder]).catch(()=>{});
    }
  })().catch(e=>{loading=null;throw e;});
  await loading;
}

function logSumExp(values){let m=-Infinity;for(const v of values)m=Math.max(m,v);let s=0;for(const v of values)s+=Math.exp(v-m);return m+Math.log(s);}

// Keep a few complete expression hypotheses: a locally plausible letter may
// become unlikely once its following tokens are considered. Decoder caches are
// shared by siblings and released once no surviving hypothesis needs them.
const BEAM_WIDTH=3;
function beamScore(h){return h.score/Math.pow((5+h.logps.length)/6,.6);}
function inkTokens(values,ids,k){
  const z=logSumExp(values),best=[];
  let depth=0;for(const id of ids){if(vocab[id]==='{')depth++;else if(vocab[id]==='}')depth--;}
  for(let id=0;id<values.length;id++){
    if(id===pad||id===sos||vocab[id]==='<UNK>'||!Number.isFinite(values[id]))continue;
    if(id===eos&&(!ids.length||depth!==0))continue;
    if(vocab[id]==='}'&&depth<=0)continue;
    best.push({id,logp:values[id]-z});
  }
  return best.sort((a,b)=>b.logp-a.logp).slice(0,k);
}
async function recognize(strokes,beamWidth=BEAM_WIDTH){
  const f=features(strokes),src=new ort.Tensor('float32',f.data,[1,f.points,12]),lengths=new ort.Tensor('int64',BigInt64Array.from([BigInt(f.points)]),[1]);
  let enc;
  try{enc=await encoder.run({src,src_lengths:lengths});}finally{src.dispose();lengths.dispose();}
  const memK=enc.mem_k,memV=enc.mem_v,mask=enc.mem_mask;
  enc.memory.dispose();
  const [layers,batch,heads,,dim]=memK.dims;
  const caches=new Set();
  const cache=(k,v)=>{const c={k,v};caches.add(c);return c;};
  let beams=[{token:sos,ids:[],logps:[],score:0,done:false,greedy:true,cache:cache(
    new ort.Tensor('float32',new Float32Array(0),[layers,batch,heads,0,dim]),
    new ort.Tensor('float32',new Float32Array(0),[layers,batch,heads,0,dim]))}];
  let calls=0;
  try{
    for(let i=0;i<MAX_TOKENS;i++){
      const candidates=[];
      for(const h of beams){
        if(h.done){candidates.push(h);continue;}
        const last=new ort.Tensor('int64',BigInt64Array.from([BigInt(h.token)]),[1,1]),step=new ort.Tensor('int64',BigInt64Array.from([BigInt(i)]),[1]);let out;
        try{out=await decoder.run({tgt_last:last,step,self_k:h.cache.k,self_v:h.cache.v,mem_k:memK,mem_v:memV,memory_key_padding_mask:mask});calls++;}
        finally{last.dispose();step.dispose();}
        const next=cache(out.self_k_out,out.self_v_out);
        try{const tokens=inkTokens(out.logits.data,h.ids,beamWidth);for(const [index,t] of tokens.entries()){
          const done=t.id===eos;
          candidates.push({token:t.id,ids:done?h.ids:[...h.ids,t.id],logps:[...h.logps,t.logp],score:h.score+t.logp,done,greedy:h.greedy&&index===0,cache:done?null:next});
        }}finally{out.logits.dispose();}
      }
      beams=candidates.sort((a,b)=>beamScore(b)-beamScore(a)).slice(0,beamWidth);
      // Validation did not justify overriding the greedy primary reading.
      // Retain that path even when beam scoring prefers another expression;
      // the completed competing readings are offered for user correction.
      const primary=candidates.find(h=>h.greedy);
      if(primary&&!beams.includes(primary))beams[beams.length-1]=primary;
      const keep=new Set(beams.map(h=>h.cache));
      for(const c of caches)if(!keep.has(c)){c.k.dispose();c.v.dispose();caches.delete(c);}
      if(!beams.length)throw Error('Could not decode the pen strokes.');
      if(beams.every(h=>h.done))break;
    }
  }finally{for(const c of caches){c.k.dispose();c.v.dispose();}memK.dispose();memV.dispose();mask.dispose();}
  const winner=beams.find(h=>h.greedy)||beams[0],terminated=winner.done;
  const count=Math.max(1,winner.logps.length-(terminated?1:0)),avg=winner.logps.slice(0,count).reduce((a,b)=>a+b,0)/count;
  const latex=winner.ids.map(id=>vocab[id]).join('');
  const alternatives=[...new Set(beams.filter(h=>h.done).map(h=>h.ids.map(id=>vocab[id]).join('')))].filter(s=>s!==latex);
  return {latex,alternatives,confidence:Math.max(0,Math.min(1,Math.exp(avg))),
    minTokenConfidence:Math.exp(Math.min(...winner.logps.slice(0,count))),tokenCount:count,
    terminated,truncated:!terminated,maxTokens:MAX_TOKENS,decoderCalls:calls};
}

function inkReadingTokens(latex){return String(latex||'').match(/\\[A-Za-z]+|\\.|[^\s]/g)||[];}
function singleSymbolDisagreement(a,b){
  const left=inkReadingTokens(a),right=inkReadingTokens(b);
  if(left.length!==right.length)return false;
  // Only variable-like identities may change. Numbers, signs, commands,
  // constants, grouping, and the number of written symbols stay fixed.
  const letter=/^(?:[A-Za-z]|\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Sigma|Upsilon|Phi|Psi|Omega))$/;
  // Plain function spellings also carry mathematical meaning.
  const funcs=/\b(?:sin|cos|tan|cot|sec|csc|log|ln|exp|sqrt|lim)\b/g;
  if(JSON.stringify(String(a).match(funcs))!==JSON.stringify(String(b).match(funcs)))return false;
  let changed=0;
  for(let i=0;i<left.length;i++)if(left[i]!==right[i]){
    if(!letter.test(left[i])||!letter.test(right[i])||++changed>1)return false;
  }
  return changed===1;
}
function reconcileInkViews(primary,views){
  const eligible=v=>v?.terminated===true&&!v.truncated&&Number.isFinite(v.confidence)&&v.confidence>=.70&&!!v.latex;
  if(!eligible(primary)||views.length!==2||!views.every(eligible))return primary;
  const key=v=>JSON.stringify(inkReadingTokens(v.latex));
  if(key(views[0])!==key(views[1])||!singleSymbolDisagreement(primary.latex,views[0].latex))return primary;
  const winner=views[0];
  return {...winner,confidence:Math.min(...views.map(v=>v.confidence)),
    alternatives:[...new Set([primary.latex,...(primary.alternatives||[])])].filter(s=>key({latex:s})!==key(winner)).slice(0,3),
    samplingConsensus:true};
}
async function recognizeInk(strokes){
  const primary=await recognize(strokes);
  // Low-confidence ink already takes the independent image-model fallback.
  // Do not multiply that work, or enlarge selections beyond the feature limit.
  if(!primary.terminated||primary.truncated||primary.confidence<.70||strokes.reduce((n,s)=>n+(Array.isArray(s.pts)?s.pts.length/3:0),0)>10000)return primary;
  const views=[];let calls=primary.decoderCalls;
  try{
    for(const factor of [.8,1.2]){
      const out=await recognize(resample(strokes,factor),1);views.push(out);calls+=out.decoderCalls;
      // A second view can only help if the first proposes an eligible change.
      if(!out.terminated||out.truncated||out.confidence<.70||!singleSymbolDisagreement(primary.latex,out.latex))
        return {...primary,decoderCalls:calls,samplingViews:views.length+1};
    }
  }catch(e){return primary;} // optional evidence cannot discard a completed reading
  return {...reconcileInkViews(primary,views),decoderCalls:calls,samplingViews:3};
}

self.onmessage=async({data})=>{
  const {id,type}=data;
  if(busy){self.postMessage({id,error:'Stroke handwriting worker is busy.'});return;}
  busy=true;
  try{
    await setup(id);
    if(type==='setup')self.postMessage({id,ready:true});
    else if(type==='recognize')self.postMessage({id,...await recognizeInk(data.strokes)});
    else throw new Error('Unknown stroke handwriting request.');
  }catch(e){self.postMessage({id,error:e?.message||String(e)});}finally{busy=false;}
};
