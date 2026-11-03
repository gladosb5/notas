const test=require('node:test');
const assert=require('node:assert/strict');
const {refineLine,splitWords,wordMetrics,smoothPts}=require('../ink-refine.js');
const {writing}=require('./fixtures/ink-refine.cjs');
const ids=words=>new Set(words.flat().map(st=>st.id));
const apply=(words,map)=>words.map(word=>word.map(st=>({...st,pts:map?.get(st.id)||st.pts})));
const spread=a=>Math.max(...a)-Math.min(...a);
const metrics=words=>words.map(word=>wordMetrics(word));
const tilt=words=>{
  const m=metrics(words),x=m.map(w=>w.cx),y=m.map(w=>w.baseline),mx=x.reduce((a,b)=>a+b)/x.length,my=y.reduce((a,b)=>a+b)/y.length;
  return Math.atan(x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0)/x.reduce((s,v)=>s+(v-mx)**2,0))*180/Math.PI;
};

test('recognised words are levelled, aligned and sized without changing samples',()=>{
  const words=writing(['the','quick','fox','again'],{tilt:6,wobble:[-3,4,-4,3],scales:[.88,1.12,.96,1.08],jitter:1});
  const before=JSON.stringify(words),map=refineLine(words,ids(words)),after=apply(words,map);
  assert.ok(map);assert.ok(Math.abs(tilt(after))<1,'tilt: '+tilt(after));
  assert.ok(spread(metrics(after).map(m=>m.baseline))<spread(metrics(words).map(m=>m.baseline))*.4);
  assert.ok(spread(metrics(after).map(m=>m.core))<spread(metrics(words).map(m=>m.core)));
  for(const st of after.flat()){const old=words.flat().find(s=>s.id===st.id);assert.equal(st.pts.length,old.pts.length);assert.equal(st.w,old.w);}
  assert.equal(JSON.stringify(words),before,'inputs stay untouched');
  assert.deepEqual(refineLine(words,ids(words)),map,'deterministic output');
});

test('a flat line is levelled using the original word boundaries as ground truth',()=>{
  const words=writing(['the','quick','fox','again'],{tilt:6,wobble:[-3,4,-4,3],scales:[.88,1.12,.96,1.08],jitter:1});
  const map=refineLine(words.flat(),ids(words)),after=apply(words,map);
  assert.ok(map);assert.ok(Math.abs(tilt(after))<1,'tilt: '+tilt(after));
  assert.ok(spread(metrics(after).map(m=>m.baseline))<spread(metrics(words).map(m=>m.baseline))*.4);
});

test('printed words split at spaces, retaining dots and crossbars',()=>{
  const words=writing(['little','time','is','fine']);
  assert.deepEqual(splitWords(words.flat()),words);
  assert.deepEqual(splitWords(words.flat().slice().reverse()).map(word=>word.map(st=>st.id).sort()),words.map(word=>word.map(st=>st.id).sort()),'drawing order does not decide spaces');
});

test('normal letter gaps in a long word are not spaces',()=>{
  for(const text of ['minimum','oooooo']){
    const words=writing([text]);assert.deepEqual(splitWords(words.flat()),words);
  }
});

test('tilted words still split at spaces',()=>{
  const words=writing(['little','time','is','fine'],{tilt:8,wobble:[-3,4,-4,3],scales:[.88,1.12,.96,1.08],jitter:1});
  assert.deepEqual(splitWords(words.flat()),words);
});

test('joined word strokes still split at spaces',()=>{
  const words=writing(['little','time','is','fine'],{tilt:8,gap:8}).map((word,i)=>[
    {id:'joined-'+i,pts:word.flatMap(st=>st.pts)}
  ]);
  assert.deepEqual(splitWords(words.flat()),words);
});

test('a word with any settled stroke stays put after splitting',()=>{
  const words=writing(['little','time','is','fine'],{wobble:[0,0,8,-4]}),fresh=ids(words);
  fresh.delete(words[2][0].id);
  const map=refineLine(words.flat(),fresh);assert.ok(map);
  for(const st of words[2])assert.ok(!map.has(st.id),'the whole mixed word stays put');
});

test('settled words anchor the line and are never changed',()=>{
  const words=writing(['the','quick','fox'],{wobble:[0,0,10]});
  const fresh=new Set(words[2].map(st=>st.id)),map=refineLine(words,fresh),after=apply(words,map);
  assert.ok(map);for(const word of words.slice(0,2))for(const st of word)assert.ok(!map.has(st.id));
  assert.ok(Math.abs(wordMetrics(after[2]).baseline-wordMetrics(words[0]).baseline)<3);
});

test('deliberate tilt and superscripts survive',()=>{
  const words=writing(['the','quick','fox'],{tilt:20,jitter:1});
  const after=apply(words,refineLine(words,ids(words)));
  assert.ok(Math.abs(tilt(after)-20)<2,'tilt: '+tilt(after));
  const sup=writing(['the','quick','fox','tiny'],{wobble:[0,0,0,-65],scales:[1,1,1,.6],jitter:1});
  const map=refineLine(sup,ids(sup));for(const st of sup[3])assert.ok(!map?.has(st.id),'superscript stays put');
});

test('neat words need no change and short strokes keep their samples',()=>{
  const words=writing(['the','quick','fox']);assert.equal(refineLine(words,ids(words)),null);
  const pts=[0,0,.5,5,10,.6,10,0,.5];assert.deepEqual(smoothPts(pts),pts);
});

test('smoothing quiets jitter while keeping endpoints and v/z corners',()=>{
  const noisy=Array.from({length:25},(_,i)=>[i*2,i%2?.9:-.9,.5]).flat(),smoothed=smoothPts(noisy);
  assert.ok(spread(smoothed.filter((_,i)=>i%3===1).slice(1,-1))<1.8);
  for(const text of ['v','z']){
    // Join the glyph's pen lifts to exercise a corner inside one stroke.
    const paths=writing([text])[0].map(st=>Array.from({length:st.pts.length/3},(_,i)=>st.pts.slice(i*3,i*3+3)));
    const ends=paths.flatMap(p=>[p[0],p.at(-1)]).sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
    let at=ends[0],joined=[at];const corners=[];
    while(paths.length){
      const same=p=>p[0]===at[0]&&p[1]===at[1],i=paths.findIndex(p=>same(p[0])||same(p.at(-1)));
      assert.ok(i>=0,'glyph paths connect');
      const [path]=paths.splice(i,1);if(!same(path[0]))path.reverse();
      joined.push(...path.slice(1));at=path.at(-1);if(paths.length)corners.push(joined.length-1);
    }
    const pts=joined.flat(),out=smoothPts(pts);
    assert.deepEqual(out.slice(0,3),pts.slice(0,3));assert.deepEqual(out.slice(-3),pts.slice(-3));
    assert.equal(corners.length,text==='v'?1:2);
    for(const i of corners)assert.ok(Math.hypot(out[i*3]-pts[i*3],out[i*3+1]-pts[i*3+1])<.2,'sharp '+text+' corner');
  }
});
