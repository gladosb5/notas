import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block'});
 await page.goto(`http://127.0.0.1:${server.address().port}/manifest.webmanifest`);
 const results=await page.evaluate(async()=>{
   const w=new Worker('./ink-worker.js');let id=0;
   const ask=strokes=>new Promise((resolve,reject)=>{
     const request=++id,timer=setTimeout(()=>reject(Error('worker timeout')),60000);
     w.onmessage=({data})=>{if(data.id===request&&!data.progress){clearTimeout(timer);resolve(data);}};
     w.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};
     w.postMessage({id:request,type:'recognize',strokes});
   });
   try{return [await ask([{pts:[10,20,.5]}]),await ask([{pts:[10,20,.5,40,20,.5]}]),await ask([{pts:[10,20,.5,25,20,.5,40,20,.5]}])];}finally{w.terminate();}
 });
 assert.equal(results[0].error,undefined);assert.equal(results[0].latex,'');
 assert.equal(results[1].error,undefined,JSON.stringify(results[1]));
 assert.equal(results[1].latex,'');assert.equal(results[2].error,undefined,JSON.stringify(results[2]));
 console.log('Actual ONNX runtime: one/two-point taps skipped; the same worker reads a three-point stroke.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
