const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const math=require('../assets/math.js');
const N={core:{S:{scope:{}}},mathcore:{normalize:s=>s,freeVars:s=>{const out=new Set();math.parse(s).traverse(n=>{if(n.isSymbolNode)out.add(n.name);});return [...out];},parseRaw:s=>math.parse(s),evalRaw:(s,scope)=>math.evaluate(s,scope),baseScope:()=>({}),fmt:String}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../local-math-help.js'),'utf8'),{N});
test('all inline scripts parse',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../notas.html'),'utf8');
  for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
  assert.doesNotMatch(html,/generativelanguage|Gemini|callAI|SpeechRecognition|https:\/\//);
});
test('linear steps accept scaling, reject wrong operations',()=>{
  assert.equal(N.localMath.verifyPair('2x+4=10','2x=6'),true);
  assert.equal(N.localMath.verifyPair('2x=6','x=3'),true);
  assert.equal(N.localMath.verifyPair('2x+4=10','2x=8'),false);
  assert.equal(N.localMath.verifyPair('x^2=9','x=3'),null);
  assert.equal(N.localMath.verifyPair('x/x=1','x=1'),null);
});
test('linear hints are based on parsed coefficients',()=>{
  const e=N.localMath.linear('3*(x+2)=18');
  assert.equal(e.root,4);
  assert.match(N.localMath.help('2x+3=11',3,[]).say,/x = 4/);
  assert.doesNotMatch(N.localMath.help('2x+3=11',0,[]).say,/x = 4/);
  assert.match(N.localMath.help('What is the capital of France?',0,[]).say,/not supported/);
  assert.equal(N.localMath.linear('sin(x)=0'),null);
});
test('bundled assets exist and CSS references stay local',()=>{
  const root=path.join(__dirname,'..');
  for(const name of JSON.parse(fs.readFileSync(path.join(root,'asset-manifest.json'))))assert.ok(fs.statSync(path.join(root,name)).size>0,name);
  for(const name of ['fonts.css','icons.css','katex.css']){
    const css=fs.readFileSync(path.join(root,'assets',name),'utf8');
    for(const m of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g))assert.ok(fs.existsSync(path.resolve(root,'assets',m[1])),m[1]);
  }
  for(const name of ['ink-worker.js','ink-features.js','text-worker.js','assets/ink/encoder.onnx','assets/ink/decoder_step.onnx','assets/ink/vocab.json','assets/text/ppocrv6-small.onnx','assets/text/ppocrv6_dict.txt','assets/smart/ort.wasm.min.js','assets/smart/ort-wasm-simd-threaded.wasm'])
    assert.ok(fs.statSync(path.join(root,name)).size>0,name);
});
test('a late recognition reply preserves a confirmed correction',async()=>{
  let worker,reply;
  let requested;const inFlight=new Promise(resolve=>{requested=resolve;});
  class Worker {
    constructor(){worker=this;}
    postMessage(data){
      if(data.type==='setup')queueMicrotask(()=>this.onmessage({data:{id:data.id}}));
      else {reply=()=>this.onmessage({data:{id:data.id,latex:'9',confidence:1}});requested();}
    }
    terminate(){}
  }
  const stroke={id:'s1',t0:0,t1:100,pts:[0,0,.5,20,20,.5],bbox:[0,0,20,20]};
  const cl={hash:'stroke',strokeIds:['s1'],bbox:[0,0,20,20],confirmed:false};
  const state={id:'note',settings:{},clusters:[cl],strokes:[stroke],images:[]};
  const app={core:{S:state,markDirty(){},toast(){},strokeById:id=>state.strokes.find(s=>s.id===id)},mathcore:{run(){},latexToMath:s=>s}};
  const ctx={fillRect(){},scale(){},translate(){},getImageData(){return {data:new Uint8ClampedArray(16)};}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../model-contract.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../local-recognition.js'),'utf8'),{
    N:app,Worker,window:{Worker,OffscreenCanvas:class{},addEventListener(){}},location:{protocol:'http:'},
    document:{createElement:()=>({dataset:{},setAttribute(){},getContext:()=>ctx}),body:{appendChild(){}},addEventListener(){}},
    setTimeout,clearTimeout,DOMException
  });
  const pending=app.recog.recognize(cl);
  await inFlight;
  assert.ok(worker&&reply,'Recognition request is in flight');
  app.recog.confirm(cl,'2+2');
  reply();await pending;
  assert.equal(cl.ascii,'2+2');
  assert.equal(cl.confirmed,true);
  assert.equal(cl.review,false);
});
