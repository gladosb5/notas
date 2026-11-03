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

// Boundaries and straight stem endpoints come from the fixture's glyph paths.
const {letterGroups}=require('./fixtures/ink-refine.cjs');
const bodyStats=(word,text)=>letterGroups(word,text).map(letter=>{
  const ys=letter.flatMap(st=>st.pts.filter((_,i)=>i%3===1));
  return {baseline:Math.max(...ys),core:Math.max(...ys)-Math.min(...ys)};
});
const stemSlants=(words,angle=0)=>words.map(word=>{
  const slope=Math.tan(angle*Math.PI/180);
  return word.reduce((sum,st)=>{
    const dx=st.pts.at(-3)-st.pts[0],dy=st.pts.at(-2)-st.pts[1];
    return sum+Math.atan((dx+slope*dy)/(dy-slope*dx))*180/Math.PI;
  },0)/word.length;
});
const endpointGap=st=>Math.hypot(st.pts[0]-st.pts.at(-3),st.pts[1]-st.pts.at(-2));

test('letter bodies settle their baselines and heights within a word',()=>{
  const text='nnnnnn',words=writing([text],{letterWobble:[[-3,3,-2,2,-3,3]],letterScales:[[.85,1.15,.94,1.06,.9,1.1]]});
  const before=bodyStats(words[0],text),map=refineLine(words,ids(words)),after=bodyStats(apply(words,map)[0],text);
  const baselineBefore=spread(before.map(m=>m.baseline)),baselineAfter=spread(after.map(m=>m.baseline));
  const coreBefore=spread(before.map(m=>m.core)),coreAfter=spread(after.map(m=>m.core));
  console.log('Letter spreads:',JSON.stringify({baselineBefore,baselineAfter,coreBefore,coreAfter}));
  assert.ok(baselineAfter<baselineBefore*.6,'letter baselines improve by more than 40%');
  assert.ok(coreAfter<coreBefore,'letter core heights converge');
  assert.deepEqual(refineLine(words,ids(words)),map);
  for(const st of words.flat())assert.equal(map.get(st.id).length,st.pts.length);
});

test('word slants converge toward the writer median within the eight-degree clamp',()=>{
  const words=writing(['llll','llll','llll','llll'],{shears:[-14,4,18,8]});
  const before=stemSlants(words),map=refineLine(words,ids(words)),after=stemSlants(apply(words,map));
  console.log('Word slants:',JSON.stringify({before,after,spreadBefore:spread(before),spreadAfter:spread(after)}));
  assert.ok(spread(after)<spread(before)*.6);
  for(let i=0;i<before.length;i++)assert.ok(Math.abs(after[i]-before[i])<8.5,'bounded shear change');
  const fresh=new Set(words[0].map(st=>st.id)),partial=refineLine(words,fresh);
  for(const st of words.slice(1).flat())assert.ok(!partial?.has(st.id),'settled slants stay untouched');
});

test('uniform lean survives on horizontal and deliberately tilted lines',()=>{
  for(const angle of [0,20]){
    const words=writing(['llll','llll','llll'],{shears:[14,14,14],wobble:[-2,3,-2]}),c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180);
    for(const st of words.flat())for(let i=0;i<st.pts.length;i+=3){
      const x=st.pts[i],y=st.pts[i+1]-180;st.pts[i]=x*c-y*s;st.pts[i+1]=180+x*s+y*c;
    }
    const map=refineLine(words,ids(words));assert.ok(map,'alignment runs while the lean stays intact');
    const before=stemSlants(words,angle),after=stemSlants(apply(words,map),angle);
    console.log('Uniform lean:',JSON.stringify({lineAngle:angle,before,after}));
    for(let i=0;i<before.length;i++)assert.ok(Math.abs(after[i]-before[i])<1,'uniform lean stays within one degree');
  }
});

test('tiny returning loop gaps close while open letters and larger gaps stay open',()=>{
  const words=writing(['o']);words[0][0].pts.splice(-3);
  const before=endpointGap(words[0][0]),map=refineLine(words,ids(words)),after=endpointGap(apply(words,map)[0][0]);
  console.log('Loop gap:',JSON.stringify({before,after}));
  assert.ok(after<before*.3,'tiny gap closes by more than 70%');
  for(const text of ['c','u','n']){
    const open=writing([text]),out=apply(open,refineLine(open,ids(open)));
    for(let i=0;i<open[0].length;i++)assert.ok(Math.abs(endpointGap(open[0][i])-endpointGap(out[0][i]))<.15,text+' stays open');
  }
  const open=writing(['o']);open[0][0].pts.splice(-18);
  assert.ok(endpointGap(open[0][0])>4);
  assert.ok(Math.abs(endpointGap(apply(open,refineLine(open,ids(open)))[0][0])-endpointGap(open[0][0]))<.15,'a larger opening stays open');
  const closed=writing(['o']);assert.equal(endpointGap(apply(closed,refineLine(closed,ids(closed)))[0][0]),0,'closed loops stay closed');
});

test('a loop may return to an interior point after a lead-in',()=>{
  const words=writing(['o']),st=words[0][0];st.pts.splice(-3);
  st.pts.unshift(st.pts[0]-5,st.pts[1]-4,.5);
  const map=refineLine(words,ids(words),{strength:0}),out=apply(words,map)[0][0];
  assert.ok(Math.hypot(out.pts[3]-out.pts.at(-3),out.pts[4]-out.pts.at(-2))<.2);
  assert.ok(endpointGap(out)>5,'the lead-in is not pulled into the loop');
  assert.equal(out.pts.length,st.pts.length);
});

function curvatureVariance(pts){
  const values=[];
  for(let i=3;i<pts.length-3;i+=3){
    const ux=pts[i]-pts[i-3],uy=pts[i+1]-pts[i-2],vx=pts[i+3]-pts[i],vy=pts[i+4]-pts[i+1];
    values.push(Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy)/((Math.hypot(ux,uy)+Math.hypot(vx,vy))/2||1));
  }
  const mean=values.reduce((sum,v)=>sum+v,0)/values.length;
  return values.reduce((sum,v)=>sum+(v-mean)**2,0)/values.length;
}

test('curved handwriting loses curvature noise without losing its outline',()=>{
  const pts=writing(['o'],{jitter:.7})[0][0].pts,out=smoothPts(pts),before=curvatureVariance(pts),after=curvatureVariance(out);
  console.log('Curve variance:',JSON.stringify({before,after}));
  assert.ok(after<before*.5,'curvature noise falls by more than half');
  for(let i=0;i<pts.length;i+=3)assert.ok(Math.hypot(out[i]-pts[i],out[i+1]-pts[i+1])<.7,'subtle point movement');
  assert.deepEqual(out.slice(0,3),pts.slice(0,3));assert.deepEqual(out.slice(-3),pts.slice(-3));
});

function affinePoint(source,target,triangle,point){
  const [a,b,c]=triangle,ux=source[b]-source[a],uy=source[b+1]-source[a+1],vx=source[c]-source[a],vy=source[c+1]-source[a+1];
  const x=source[point]-source[a],y=source[point+1]-source[a+1],det=ux*vy-uy*vx,u=(x*vy-y*vx)/det,v=(ux*y-uy*x)/det;
  return [target[a]+u*(target[b]-target[a])+v*(target[c]-target[a]),target[a+1]+u*(target[b+1]-target[a+1])+v*(target[c+1]-target[a+1])];
}

test('joined cursive blobs keep one word transform instead of stretching individual letters',()=>{
  const word=writing(['nnnnnn'],{letterWobble:[[-3,3,-2,2,-3,3]],letterScales:[[.85,1.15,.94,1.06,.9,1.1]]})[0];
  const pts=word.flatMap(st=>st.pts),words=[[{id:'joined',pts,w:2}]],out=apply(words,refineLine(words,ids(words),{strength:0}))[0][0].pts;
  const triangle=[0,word[0].pts.length-3,pts.length-3];
  for(let i=0;i<pts.length;i+=3){
    const [x,y]=affinePoint(pts,out,triangle,i);
    assert.ok(Math.hypot(out[i]-x,out[i+1]-y)<.25,'one affine transform across the joined word');
  }
});

test('detached dots follow their letter body instead of becoming short letters',()=>{
  const words=writing(['nnnnnn'],{letterWobble:[[-3,3,-2,2,-3,3]],letterScales:[[.85,1.15,.94,1.06,.9,1.1]]});
  const letter=letterGroups(words[0],'nnnnnn')[0],body=letter.flatMap(st=>st.pts),dot=[body[0]+4,Math.min(...body.filter((_,i)=>i%3===1))-5,.5];
  words[0].push({id:'dot',w:2,pts:dot});
  const map=refineLine(words,ids(words),{strength:0}),out=apply(words,map)[0],target=out.slice(0,2).flatMap(st=>st.pts);
  const [x,y]=affinePoint([...body,...dot],[...target,...out.at(-1).pts],[0,letter[0].pts.length-3,body.length-3],body.length);
  assert.ok(Math.hypot(out.at(-1).pts[0]-x,out.at(-1).pts[1]-y)<.25,'dot shares the body transform');
  assert.ok(Math.abs(out.at(-1).pts[1]-dot[1])>.6,'the perturbed letter and dot actually move');
});
