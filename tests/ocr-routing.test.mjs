import test from 'node:test';
import assert from 'node:assert/strict';
import {likelyChinese,recognizeText} from '../experiments/ocr-upgrade/router.mjs';
test('uncertain, mixed-script, English and math never select the specialist',()=>{
  for(const text of ['hello world','学习English','学习日本かな','学习123','中文','中文数学=答案'])assert.equal(likelyChinese({text,confidence:.99}),false,text);
  assert.equal(likelyChinese({text:'今天学习中文',confidence:.89}),false);
  assert.equal(likelyChinese({text:'今天学习中文',confidence:.99},{kind:'math'}),false);
  assert.equal(likelyChinese({text:'今天学习中文',confidence:.99}),true);
});
test('specialist is opt-in and workers never overlap; failure preserves general result',async()=>{
  for(const second of [{error:'out of memory'},{text:'',confidence:1},{text:'中文',confidence:.99},{text:'今天学习中文',confidence:.99}]){
    let resident=0,max=0,calls=0;
    const workerFactory=()=>{resident++;max=Math.max(max,resident);const result=calls++?second:{text:'今天学习中文',confidence:.99};return {postMessage(){queueMicrotask(()=>this.onmessage({data:result}));},terminate(){resident--;}};};
    const out=await recognizeText({width:1,height:1,buffer:new ArrayBuffer(4)},{specialist:true,workerFactory});
    assert.equal(max,1);assert.equal(resident,0);assert.equal(calls,2);assert.equal(out.text,'今天学习中文');
    assert.equal(out.model,second.text==='今天学习中文'?'pylaia-experimental':'small');
  }
  let calls=0;
  await recognizeText({buffer:new ArrayBuffer(4)},{workerFactory:()=>({postMessage(){calls++;queueMicrotask(()=>this.onmessage({data:{text:'今天学习中文',confidence:1}}));},terminate(){}})});
  assert.equal(calls,1);
});
