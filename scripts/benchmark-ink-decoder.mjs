import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startServer} from './serve.mjs';

const split=process.env.SPLIT||'valid',limit=Number(process.env.LIMIT||100);
if(!['valid','test'].includes(split))throw Error('SPLIT must be valid or test');
const dir=process.env.INPUT_DIR||`.dataset/mathwriting-2024-excerpt/${split}`;
const files=(await readdir(dir)).filter(f=>f.endsWith('.inkml')).sort().slice(0,limit);
const inputs=await Promise.all(files.map(async name=>({id:name.slice(0,-6),xml:await readFile(`${dir}/${name}`,'utf8')})));
const provenance={};
for(const file of ['ink-worker.js','ink-features.js','assets/ink/encoder.onnx','assets/ink/decoder_step.onnx','assets/ink/vocab.json','assets/smart/ort.wasm.min.js','assets/smart/ort-wasm-simd-threaded.js','assets/smart/ort-wasm-simd-threaded.wasm'])provenance[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const workerSource=await readFile(process.env.WORKER_SOURCE||'ink-worker.js','utf8');
provenance['ink-worker.js']=createHash('sha256').update(workerSource).digest('hex');
const modelOverrides=[];
for(const [key,file] of [['ENCODER_SOURCE','encoder.onnx'],['DECODER_SOURCE','decoder_step.onnx']])if(process.env[key]){
  const bytes=await readFile(process.env[key]);modelOverrides.push({file,bytes});
  provenance['assets/ink/'+file]=createHash('sha256').update(bytes).digest('hex');
}
provenance['experiments/ink-beam-decoder/resample.js']=createHash('sha256').update(await readFile('experiments/ink-beam-decoder/resample.js')).digest('hex');
const server=await startServer(0),browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();
  await page.route('**/ink-worker.js',route=>route.fulfill({contentType:'text/javascript',body:workerSource}));
  for(const {file,bytes} of modelOverrides)await page.route('**/assets/ink/'+file+'?*',route=>route.fulfill({contentType:'application/octet-stream',body:bytes}));
  await page.goto(`http://127.0.0.1:${server.address().port}/experiments/hand-to-tex/browser-probe.html`);
  await page.addScriptTag({url:'/experiments/ink-beam-decoder/resample.js'});
  const factors=(process.env.VIEWS||'1').split(',').map(Number);
  if(factors.some(f=>!Number.isFinite(f)||f<.25||f>2))throw Error('VIEWS must contain sampling factors between .25 and 2');
  const result=await page.evaluate(async ({inputs,factors})=>{
    const worker=new Worker('/ink-worker.js');let serial=0;
    const call=payload=>new Promise((resolve,reject)=>{
      const id=++serial,timer=setTimeout(()=>reject(Error('Ink worker timed out')),30000);
      worker.onmessage=({data})=>{if(data.id!==id||data.progress)return;clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data);};
      worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.postMessage({id,...payload});
    });
    const start=performance.now();await call({type:'setup'});const setup_ms=performance.now()-start,rows=[];
    try{for(const input of inputs){
      const doc=new DOMParser().parseFromString(input.xml,'application/xml');
      const expected=[...doc.getElementsByTagName('annotation')].find(n=>n.getAttribute('type')==='normalizedLabel')?.textContent;
      if(!expected)throw Error('Missing normalized label');
      const strokes=[...doc.getElementsByTagName('trace')].map(n=>{
        const points=n.textContent.split(',').map(s=>s.trim().split(/\s+/).map(Number));
        const t0=points[0][2];return {t0,t1:points.at(-1)[2],pts:points.flatMap(p=>[p[0],p[1],.5]),times:points.map(p=>p[2]-t0)};
      });
      const at=performance.now();
      try{
        const views=[];
        for(const factor of factors){const out=await call({type:'recognize',strokes:resampleInk(strokes,factor)});views.push({...out,factor});}
        rows.push({...views[0],views,id:input.id,expected,ms:performance.now()-at});
      }
      catch(e){rows.push({id:input.id,expected,error:e.message,ms:performance.now()-at});}
    }}finally{worker.terminate();}
    return {setup_ms,rows,userAgent:navigator.userAgent};
  },{inputs,factors});
  const times=result.rows.map(r=>r.ms).sort((a,b)=>a-b);
  const out={split,development:true,createdAt:new Date().toISOString(),provenance,inputHash:createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),...result,median_ms:times[Math.floor(times.length/2)],p95_ms:times[Math.ceil(times.length*.95)-1]};
  await mkdir('test-results',{recursive:true});const dest=process.env.OUT||`test-results/ink-${split}.json`;
  await writeFile(dest,JSON.stringify(out,null,2));console.log(JSON.stringify({file:dest,count:result.rows.length,median_ms:out.median_ms,p95_ms:out.p95_ms}));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
