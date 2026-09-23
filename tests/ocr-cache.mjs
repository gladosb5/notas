import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const context=await browser.newContext(),page=await context.newPage(),remote=[];
  context.on('request',r=>{if(!r.url().startsWith(base))remote.push(r.url());});
  await page.goto(base+'/notas.html');
  await page.locator('#offline-status').filter({hasText:'available offline.'}).waitFor({state:'attached'});
  await page.goto(base+'/experiments/ocr-upgrade/blank.html');
  for(const asset of ['assets/text/ppocrv6-small.onnx?v=5435fd74','assets/text/ppocrv6_dict.txt?v=b5f2bfe2']){
    const result=await page.evaluate(async asset=>{
      const key=(await caches.keys()).find(k=>k.startsWith('notas-local-')),cache=await caches.open(key);
      await cache.put('/'+asset,new Response('partial download'));
      const worker=new Worker('/text-worker.js');
      try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Cache retry timeout')),60000);worker.onmessage=e=>{if(e.data.progress)return;clearTimeout(timer);resolve(e.data);};worker.postMessage({id:1,type:'setup'});});}finally{worker.terminate();}
    },asset);
    assert.equal(result.ready,true,`Corrupt ${asset} self-evicts and retries`);
  }
  // Exercise shipped workers only; experimental model files are not part of
  // the offline app and may be absent from an installation.
  const setupInk=async()=>page.evaluate(async()=>{
    const worker=new Worker('/ink-worker.js');
    try{return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Offline ink setup timeout')),60000);
      worker.onmessage=({data})=>{if(data.progress)return;clearTimeout(timer);resolve(data);};
      worker.postMessage({id:1,type:'setup'});
    });}finally{worker.terminate();}
  });
  assert.equal((await setupInk()).ready,true);
  await context.setOffline(true);await page.reload();
  assert.equal((await setupInk()).ready,true,'Shipped ink model initializes from its exact offline cache keys');
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.ui?.searchHit);
  const hit=await page.evaluate(()=>N.ui.searchHit({title:'Chinese test',lines:[],transcripts:[],textTranscripts:[{text:'厄里斯'}]},'厄里斯'));
  assert.equal(hit?.kind,'handwriting','Saved Chinese transcripts remain searchable offline');
  assert.deepEqual(remote,[]);
  console.log('Corrupt Small/dictionary recovery, shipped ink offline setup and saved transcript search passed; zero external requests.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
