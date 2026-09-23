const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function worker(){
  const live=new Set();
  class Tensor{
    constructor(type,data,dims){Object.assign(this,{type,data,dims});live.add(this);}
    dispose(){assert.ok(live.delete(this),'tensor disposed exactly once');}
  }
  const ctx={self:{location:{href:'http://localhost/ink-worker.js'},NOTAS_INK_FEATURES:{features:()=>({data:new Float32Array(12),points:1}),resample:s=>s}},
    ort:{env:{wasm:{}},Tensor},navigator:{hardwareConcurrency:1},URL,importScripts(){}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('ink-worker.js','utf8'),ctx);
  vm.runInContext("vocab=['<PAD>','<SOS>','<EOS>','<UNK>','x','y','+','1','{','}'];pad=0;sos=1;eos=2;",ctx);
  return {ctx,live,Tensor};
}
test('ink decoding excludes special tokens and unfinished TeX groups',()=>{
  const {ctx}=worker();
  const ids=vm.runInContext('inkTokens([100,99,98,97,5,4,3,2,1,96],[],10).map(t=>t.id)',ctx);
  assert.deepEqual(Array.from(ids),[4,5,6,7,8]);
  assert.equal(vm.runInContext('inkTokens([0,0,20,0,0,0,0,0,0,10],[8,4],10).some(t=>t.id===2)',ctx),false);
  assert.equal(vm.runInContext('inkTokens([0,0,20,0,0,0,0,0,0,10],[8,4,9],10)[0].id',ctx),2);
});

test('sampling agreement can correct one variable and keeps the original alternative',()=>{
  const {ctx}=worker();
  ctx.primary={latex:'x+y',confidence:.9,terminated:true,alternatives:['z+y']};
  ctx.views=[{latex:'x+r',confidence:.91,terminated:true},{latex:'x + r',confidence:.85,terminated:true}];
  const out=vm.runInContext('reconcileInkViews(primary,views)',ctx);
  assert.equal(out.latex,'x+r');assert.equal(out.confidence,.85);assert.equal(out.samplingConsensus,true);
  assert.ok(out.alternatives.includes('x+y'));
  assert.equal(vm.runInContext("singleSymbolDisagreement('x+\\\\mu','x+r')",ctx),true);
});

test('sampling consensus protects numbers, signs, layout, constants and functions',()=>{
  const {ctx}=worker();
  for(const [a,b] of [['x+1','x+2'],['x-1','x+1'],['x^2','x_2'],['x+y','r+s'],['x+\\pi','x+r'],['sin(x)','sin(y)+1'],['sin(x)','sinx'],['cos(x)','cot(x)']]){
    ctx.a=a;ctx.b=b;assert.equal(vm.runInContext('singleSymbolDisagreement(a,b)',ctx),false,`${a} -> ${b}`);
  }
  ctx.primary={latex:'x+y',confidence:.9,terminated:true};
  for(const views of [
    [{latex:'x+r',confidence:.9,terminated:true},{latex:'x+s',confidence:.9,terminated:true}],
    [{latex:'x+r',confidence:.9,terminated:true},{latex:'x+r',confidence:.69,terminated:true}],
    [{latex:'x+r',confidence:.9,terminated:true},{latex:'x+r',confidence:.9,terminated:false}],
  ]){ctx.views=views;assert.equal(vm.runInContext('reconcileInkViews(primary,views)',ctx),ctx.primary);}
});

test('optional sampling failure keeps a completed reading; low confidence skips extra inference',async()=>{
  for(const confidence of [.9,.6]){
    const {ctx}=worker();ctx.primary={latex:'x+y',confidence,terminated:true,decoderCalls:3};ctx.calls=0;
    vm.runInContext("recognize=async()=>{if(++calls>1)throw Error('optional view failed');return primary;};",ctx);
    assert.equal(await vm.runInContext('recognizeInk([])',ctx),ctx.primary);
    assert.equal(ctx.calls,confidence<.7?1:2);
  }
});

test('an agreeing first sampling view skips the redundant third decode',async()=>{
  const {ctx}=worker();ctx.primary={latex:'x+y',confidence:.9,terminated:true,decoderCalls:3};ctx.calls=0;
  vm.runInContext('recognize=async()=>{calls++;return primary;};',ctx);
  const out=await vm.runInContext('recognizeInk([])',ctx);
  assert.equal(ctx.calls,2);assert.equal(out.latex,'x+y');assert.equal(out.samplingViews,2);
});
test('beam preserves the primary reading, offers alternatives, and releases caches',async()=>{
  for(const fail of [false,true]){
    const {ctx,live,Tensor}=worker();
    ctx.enc={run:async()=>({memory:new Tensor('float32',[],[1]),mem_k:new Tensor('float32',[],[1,1,1,1,1]),mem_v:new Tensor('float32',[],[1]),mem_mask:new Tensor('bool',[],[1])})};
    let calls=0;
    ctx.dec={run:async feeds=>{
      if(fail&&++calls===2)throw Error('decode failure');
      const token=Number(feeds.tgt_last.data[0]),values=new Float32Array(10).fill(-20);
      if(token===1){values[4]=2;values[5]=1.9;} // greedy chooses x
      else if(token===5){values[2]=8;} // y is a much better completed reading
      else if(token===4){values[2]=0;values[6]=0;values[7]=0;values[5]=0;}
      else values[2]=8;
      return {logits:new Tensor('float32',values,[1,10]),self_k_out:new Tensor('float32',[],[1]),self_v_out:new Tensor('float32',[],[1])};
    }};
    vm.runInContext('encoder=enc;decoder=dec;',ctx);
    if(fail)await assert.rejects(vm.runInContext('recognize([])',ctx),/decode failure/);
    else{const result=await vm.runInContext('recognize([])',ctx);assert.equal(result.latex,'x');assert.equal(result.terminated,true);assert.ok(result.alternatives.includes('y'));}
    assert.equal(live.size,0,'all inference tensors released');
  }
});
