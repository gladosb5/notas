const {test}=require('node:test');
const assert=require('node:assert/strict');
const {tracesFrom,features,resample}=require('../ink-features.js');

const pts=[0,0,.5,10,0,.5,20,0,.5,30,5,.5];

test('online ink preserves genuine point intervals',()=>{
  const [trace]=tracesFrom([{pts,t0:100,t1:400,times:[0,8,27,91]}]);
  assert.deepEqual(trace.map(p=>p[2]),[100,108,127,191]);
});

test('legacy ink deterministically interpolates stroke timing',()=>{
  const [trace]=tracesFrom([{pts,t0:100,t1:400}]);
  assert.deepEqual(trace.map(p=>p[2]),[100,200,300,400]);
});

test('real timing changes timing-derived model features without changing geometry',()=>{
  const real=features([{pts,t0:100,t1:400,times:[0,8,27,91]}]);
  const legacy=features([{pts,t0:100,t1:400}]);
  assert.equal(real.points,legacy.points);
  const a=[...real.data],b=[...legacy.data];
  for(let row=0;row<real.points;row++){
    assert.equal(a[row*12],b[row*12]);
    assert.equal(a[row*12+1],b[row*12+1]);
  }
  assert.ok(a.some((v,i)=>i%12>=2&&i%12<=8&&Math.abs(v-b[i])>1e-5),'timing-derived features must differ');
});

test('invalid point timing falls back rather than poisoning inference',()=>{
  const [trace]=tracesFrom([{pts,t0:10,t1:40,times:[0,20,10,30]}]);
  assert.deepEqual(trace.map(p=>p[2]),[10,20,30,40]);
});

test('sampling views preserve stroke endpoints and timing without mutating ink',()=>{
  const strokes=[{pts:pts.slice(),t0:100,t1:400,times:[0,8,27,91]}],snapshot=JSON.stringify(strokes);
  for(const factor of [.8,1.2]){
    const [out]=resample(strokes,factor),[trace]=tracesFrom([out]);
    assert.deepEqual(trace[0],[0,0,100]);assert.deepEqual(trace.at(-1),[30,5,191]);
    assert.ok(trace.every((p,i)=>!i||p[2]>=trace[i-1][2]));
    assert.equal(trace.length,Math.round(3*factor)+1);
  }
  assert.equal(JSON.stringify(strokes),snapshot);
  assert.deepEqual(tracesFrom(resample([{pts:[2,3,.2],t0:7}],1.2)),[[[2,3,7]]]);
  assert.throws(()=>resample(strokes,Infinity),/sampling factor/);
});

test('legacy strokes retain interpolated timing in a sampling view',()=>{
  const [out]=resample([{pts,t0:100,t1:400}],1.2);
  assert.equal(out.times[0],0);assert.equal(out.times.at(-1),300);
  assert.equal(out.t0,100);assert.equal(out.t1,400);
});
