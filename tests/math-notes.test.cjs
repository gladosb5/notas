const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function controller(injection=''){
  const S={id:'test',settings:{aiOn:false},strokes:[],clusters:[],images:[]};
  const N={core:{S,strokeById:id=>S.strokes.find(s=>s.id===id),markDirty(){}},mathcore:{
    latexToMath:s=>s.replace(/\\(sin|cos|tan|ln)/g,'$1').replace(/\\(times|cdot)/g,'*').replace(/\\div/g,'/'),run(){}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../model-contract.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../local-recognition.js'),'utf8').replace('N.ai={',injection+'\nN.ai={'),{
    N,window:{addEventListener(){}},document:{createElement:()=>({dataset:{},setAttribute(){}}),body:{appendChild(){}},addEventListener(){}},
    setTimeout:()=>0,clearTimeout(){},DOMException
  });
  return N;
}
test('independent text selects an existing uncertain ink alternative without increasing confidence',()=>{
  const {textSupportedInk,needsConfirmation}=controller().recog;
  const out={engine:'ink',latex:'6+q=',alternatives:['6+9=','\\sigma+q='],confidence:.62,minTokenConfidence:.37,terminated:true,truncated:false};
  const selected=textSupportedInk(out,{text:'6 + 9 =',confidence:.978});
  assert.equal(selected.latex,'6+9=');assert.equal(selected.confidence,out.confidence);
  assert.equal(selected.minTokenConfidence,out.minTokenConfidence);assert.equal(needsConfirmation(selected),true);
  assert.deepEqual([...selected.alternatives],['6+q=','\\sigma+q=']);assert.equal(out.latex,'6+q=');
  const letter={...out,latex:'6+9=',alternatives:['6+a=']};
  assert.equal(textSupportedInk(letter,{text:'6+a=',confidence:.99}).latex,'6+a=','letters receive the same evidence rule as digits');
});

test('text consensus cannot invent candidates or change operators and math structure',()=>{
  const {textSupportedInk}=controller().recog;
  const base={engine:'ink',latex:'6+q=',alternatives:['6+9='],confidence:.62,terminated:true,truncated:false};
  for(const [change,text] of [
    [{latex:'6+a='},'6+a='],
    [{latex:'6-q=',alternatives:['6-9=']},'6+9='],
    [{alternatives:[]},'6+9='],
    [{terminated:false},'6+9='],
    [{truncated:true},'6+9='],
    [{engine:'smart'},'6+9='],
    [{latex:'b+q=',alternatives:['6+9=']},'6+9='],
    [{latex:'6^{a}',alternatives:['6^{9}']},'6^{9}'],
    [{latex:'\\frac{6}{a}',alternatives:['\\frac{6}{9}']},'\\frac{6}{9}'],
    [{latex:'x_a',alternatives:['x_9']},'x_9'],
    [{latex:'\\begin{matrix}6&a\\end{matrix}',alternatives:['6+9=']},'6+9=']
  ]){
    const out={...base,...change};assert.equal(textSupportedInk(out,{text,confidence:.99}),out,JSON.stringify(change));
  }
  for(const confidence of [.969,0,NaN,undefined])assert.equal(textSupportedInk(base,{text:'6+9=',confidence}),base);
});

test('automatic calculation requires measured ink acceptance, not raw likelihood',()=>{
  const {needsConfirmation}=controller().recog;
  const ink={engine:'ink',latex:'1+2=',confidence:.93,minTokenConfidence:.91,terminated:true,truncated:false};
  assert.equal(needsConfirmation(ink),false);
  for(const out of [{...ink,confidence:.91},{...ink,confidence:NaN},
    {...ink,engine:'smart',confidence:.9999},{...ink,truncated:true},
    {...ink,terminated:false},{...ink,wordSource:'text'},{...ink,minTokenConfidence:.7},
    {...ink,minTokenConfidence:undefined},null])assert.equal(needsConfirmation(out),true);
});

test('confident fragments require confirmation when nearby ink may belong to them',()=>{
  const N=controller(),S=N.core.S;
  S.strokes=[{id:'a',bbox:[0,20,20,45],t0:0,t1:100},{id:'b',bbox:[24,0,40,19],t0:200,t1:300}];
  const a={strokeIds:['a'],bbox:S.strokes[0].bbox},b={strokeIds:['b'],bbox:S.strokes[1].bbox};
  S.clusters=[a,b];
  const out={engine:'ink',latex:'S',confidence:.99,minTokenConfidence:.98,terminated:true};
  assert.equal(N.recog.needsConfirmation(out,a),true);
  S.strokes[1].t0=20000;S.strokes[1].t1=20100;
  assert.equal(N.recog.needsConfirmation(out,a),false);
});
test('a completed low-confidence stroke reading is kept for checking; a truncated one is not',async()=>{
  for(const terminated of [true,false]){
    const N=controller(`linearizedCrop=()=>null;textCrop=()=>({});readWords=async out=>out;
      inferInk=async()=>({engine:'ink',latex:'2+3=',confidence:.6,terminated:${terminated},truncated:${!terminated}});`);
    const cl={hash:'low-confidence',strokeIds:[],bbox:[0,0,10,10],confirmed:false};
    N.core.S.settings.aiOn=true;N.core.S.clusters=[cl];
    await N.recog.recognize(cl);
    assert.equal(cl.pending,false);
    if(terminated){assert.equal(cl.ascii,'2+3=');assert.equal(cl.needsConfirmation,true);assert.equal(cl.review,false);}
    else {assert.equal(cl.review,true);assert.match(cl.error,/could not finish/);assert.ok(!cl.ascii);}
  }
});

test('optional text consensus failure keeps the completed stroke reading',async()=>{
  const N=controller(`linearizedCrop=()=>null;textCrop=()=>({});readWords=async out=>out;
    inferInk=async()=>({engine:'ink',latex:'6+q=',alternatives:['6+9='],confidence:.62,terminated:true,truncated:false});
    textInfer=async()=>{throw new Error('text worker unavailable');};`);
  const cl={hash:'text-failure',strokeIds:[],bbox:[0,0,10,10],confirmed:false};
  N.core.S.settings.aiOn=true;N.core.S.clusters=[cl];await N.recog.recognize(cl);
  assert.equal(cl.latex,'6+q=');assert.equal(cl.pending,false);assert.equal(cl.needsConfirmation,true);
});

test('uncertain reading survives grouping rebuild and correction clears it',()=>{
  const N=controller(),S=N.core.S;
  S.strokes=[{id:'s',author:'user',w:2,bbox:[0,0,10,10],pts:[0,0,.5,10,10,.5]}];
  N.recog.rebuild();const cl=S.clusters[0];
  // Confirmed readings are compatible independent of the current model stamp.
  N.recog.cache.set(cl.hash,{ascii:'2+3=',confirmed:true,needsConfirmation:true});
  N.recog.rebuild();assert.equal(S.clusters[0].needsConfirmation,true);
  N.recog.confirm(S.clusters[0],'2+3=');
  assert.equal(S.clusters[0].needsConfirmation,false);
  N.recog.rebuild();assert.equal(S.clusters[0].needsConfirmation,false);
});
test('independent text evidence preserves names and original alternatives',()=>{
  const {wordReading}=controller().recog;
  for(const [latex,text,expected] of [
    ['Rens = 3','Pens-3','Pens = 3'],['hin * 4','hi×4','hi * 4'],
    ['v = 7','x=7','x = 7'],['Al = 12','A1=12','A1 = 12'],
    ['Rete = 12','Rate=12','Rate = 12']
  ]){
    const result=wordReading({latex,engine:'smart'},{text,confidence:.99});
    assert.equal(result.latex,expected);assert.ok(result.alternatives.includes(latex));
  }
});
test('image word evidence can repair the identifier while preserving formula equals',()=>{
  const {wordReading}=controller().recog;
  const result=wordReading(
    {latex:'RenS=3',confidence:.8398480845145179,margin:.510228157043457,engine:'smart',alternatives:['Rens=3']},
    {text:'Pens-3',confidence:.9996525148550669}
  );
  assert.equal(result.latex,'Pens = 3');
  assert.ok(result.alternatives.includes('RenS=3'));
});
test('math cache version includes the text model now used for variable names',()=>{
  const context={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../model-contract.js'),'utf8'),context);
  for(const file of ['text-worker.js','assets/text/ppocrv6-small.onnx','assets/text/ppocrv6_dict.txt'])
    assert.ok(context.NOTAS_MODEL_CONTRACT.math.hashes[file],file);
});
test('name reconciliation abstains on numeric disagreement, functions, scripts and weak evidence',()=>{
  const {wordReading}=controller().recog;
  for(const [latex,text,confidence] of [
    ['\\sin x = 3','sinx=3',.99],['h i = 4','hi=9',.99],['h i + 4','hi=4',.99],
    ['h_i = 4','hi=4',.99],['h^{i} = 4','hi=4',.99],['\\frac{h}{i}=4','hi=4',.99],
    ['\\log y = 2','logy=2',.99],['\\sqrt{x}=4','x=4',.99],['x^{2}=4','x=4',.99],
    ['lim=4','Lim=4',.99],['EXP=4','exp=4',.99],
    ['h i = 4','hi=4',.6],['h i = 4','this is prose',.99]
  ])assert.equal(wordReading({latex},{text,confidence}).latex,latex);
  // Even positive baseline evidence cannot erase a power or fraction.
  const geometry={name:'hi',operator:'='};
  for(const latex of ['hi^2=4','\\frac{hi}{2}=4','h_{i_2}=4'])
    assert.equal(wordReading({latex},{text:'hi=4',confidence:.99},geometry).latex,latex);
  for(const [latex,name] of [['\\sin x = 3','sinx'],['\\cos t = 4','cost']])
    assert.equal(wordReading({latex},{text:name+latex.slice(latex.indexOf('=')),confidence:.99},{name,operator:'='}).latex,latex);
  // Positive baseline/operator geometry cannot erase valid LHS math.
  for(const latex of ['h*i=4','h\\cdot i=4','h:i=4','h.i=4','x y = 4'])
    assert.equal(wordReading({latex,confidence:.2},{text:'hi=4',confidence:.99},geometry).latex,latex);
});
test('an earlier variable definition is only a weak consistency signal',()=>{
  const N=controller(),{wordReading}=N.recog;
  N.core.S.scope={xy:3,sinx:3};
  assert.equal(wordReading({latex:'x y * 4'},{text:'xy*4',confidence:.86}).latex,'x y * 4');
  assert.equal(wordReading({latex:'x y * 4'},{text:'xy*4',confidence:.6}).latex,'x y * 4');
  assert.equal(wordReading({latex:'\\sin x = 3'},{text:'sinx=3',confidence:.86}).latex,'\\sin x = 3');
  assert.equal(wordReading({latex:'x y * 4'},null).latex,'x y * 4');
});
test('confident formula identity wins over text case and symbol substitutions',()=>{
  const {wordReading}=controller().recog;
  for(const [latex,text] of [['v=7','x=7'],['Al=12','A1=12'],['Rate=12','rate=12']])
    assert.equal(wordReading({latex,confidence:.95},{text,confidence:.99},{name:text.split('=')[0],operator:'='}).latex,latex);
});
test('low-confidence formula and strong independent word evidence can fuse identifier/operator errors',()=>{
  const {wordReading}=controller().recog;
  const multiply=wordReading({latex:'h:X4',confidence:.682437,margin:.170524,alternatives:['h:x4']},
    {text:'hi×4',confidence:.919119},{name:'hi',operator:'*'});
  assert.equal(multiply.latex,'hi * 4');assert.ok(multiply.alternatives.includes('h:X4'));
  const image=wordReading({latex:'RenS=3',confidence:.839848,margin:.510228,alternatives:['Rens=3']},
    {text:'Pens-3',confidence:.999653});
  assert.equal(image.latex,'Pens = 3');assert.ok(image.alternatives.includes('RenS=3'));
  for(const latex of ['h*i=4','h\\cdot i=4','h:i=4','h.i=4','x y = 4'])
    assert.equal(wordReading({latex,confidence:.2,margin:.1},{text:'hi×4',confidence:.99},{name:'hi',operator:'*'}).latex,latex);
});
test('local stroke grouping is invariant to unrelated large writing elsewhere',async()=>{
  const {samples,groupingSamples}=await import('./fixtures/math-notes.mjs');
  const N=controller(),S=N.core.S;
  for(const sample of [...samples,...groupingSamples].filter(s=>s.strokes)){
    N.recog.reset();S.strokes=sample.strokes;S.clusters=[];N.recog.rebuild();
    const cl=S.clusters.find(c=>c.strokeIds.includes(sample.targetIds[0]));
    assert.deepEqual([...cl.strokeIds].sort(),[...sample.targetIds].sort(),sample.id);
  }
});

test('scripts, equals spacing and overbars remain complete beside another expression',()=>{
  const {samples}=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/grouping-structures.json'),'utf8'));
  const N=controller();
  for(const sample of samples){
    const top=Math.min(...sample.strokes.map(s=>s.bbox[1])),bottom=Math.max(...sample.strokes.map(s=>s.bbox[3]));
    const offset=bottom-top+30;
    const neighbors=sample.strokes.map(s=>({...s,id:'neighbor-'+s.id,t0:s.t0+20000,t1:s.t1+20000,
      bbox:s.bbox.map((v,i)=>i%2?v+offset:v),pts:s.pts.map((v,i)=>i%3===1?v+offset:v)}));
    for(const strokes of [sample.strokes,[...sample.strokes,...neighbors]]){
      const groups=N.recog.mathStrokeGroups(strokes),ids=new Set(sample.targetIds);
      const matching=groups.filter(g=>g.some(s=>ids.has(s.id)));
      assert.equal(matching.length,1,sample.latex+' must not split');
      assert.deepEqual([...matching[0].map(s=>s.id)].sort(),[...sample.targetIds].sort(),sample.latex+' must not absorb neighbors');
    }
  }
});
test('contextless long bars cannot bridge notebook rows',async()=>{
  const {stroke}=await import('./fixtures/math-notes.mjs');
  const N=controller();
  const a=stroke('a',[[0,100],[100,100]],3,0),b=stroke('b',[[35,112],[135,112]],3,1);
  assert.equal(JSON.stringify(N.recog.mathStrokeGroups([a,b]).map(g=>g.map(s=>s.id).sort()).sort()),JSON.stringify([['a'],['b']]),
    'overlapping contextless bars with shifted centers are separate marks');
  const eq1=stroke('eq1',[[0,100],[100,100]],3,0),eq2=stroke('eq2',[[0,110],[100,110]],3,1),other=stroke('other',[[0,124],[100,124]],3,2);
  const groups=N.recog.mathStrokeGroups([eq1,eq2,other]).map(g=>g.map(s=>s.id).sort()).sort((x,y)=>x[0].localeCompare(y[0]));
  assert.equal(JSON.stringify(groups),JSON.stringify([['eq1','eq2'],['other']]),
    'a valid equals pair cannot transitively absorb a nearby third bar');
  const equals=N.recog.mathStrokeGroups([eq1,eq2]).map(g=>g.map(s=>s.id).sort());
  assert.equal(JSON.stringify(equals),JSON.stringify([['eq1','eq2']]),'a true contextless equals remains paired');
  const num=stroke('frac-num',[[76,118],[90,139]],2.8,0),bar=stroke('frac-bar',[[66,138],[101,138]],2.8,1),
    den=stroke('frac-den',[[76,137],[90,158]],2.8,2),stray=stroke('stray-bar',[[142,150],[177,150]],2.8,3);
  const fraction=N.recog.mathStrokeGroups([num,bar,den,stray]).map(g=>g.map(s=>s.id).sort()).sort((x,y)=>x[0].localeCompare(y[0]));
  assert.equal(JSON.stringify(fraction),JSON.stringify([['frac-bar','frac-den','frac-num'],['stray-bar']]),
    'a nearby contextless bar cannot attach through a fraction component expanded by the real fraction bar');
});
test('tall strokes do not set the baseline tolerance for a neighboring row',async()=>{
  const {stroke}=await import('./fixtures/math-notes.mjs');
  const N=controller(),top=stroke('top',[[0,0],[18,30]],2.8,0),
    tall=stroke('tall',[[30,-10],[28,25],[32,70],[29,120]],2.8,10000),
    bottom=stroke('bottom',[[38,45],[55,75]],2.8,10100);
  const groups=N.recog.mathStrokeGroups([top,tall,bottom]).map(g=>g.map(s=>s.id).sort()).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.equal(JSON.stringify(groups),JSON.stringify([['bottom','tall'],['top']]),
    'an integral-height stroke can overlap another row without merging its baseline');
});
test('late side annotations require strong spatial evidence to join a row',async()=>{
  const {stroke}=await import('./fixtures/math-notes.mjs');
  const N=controller(),a=stroke('base-a',[[0,100],[16,124]],2.8,0),b=stroke('base-b',[[23,100],[39,124]],2.8,120),
    note=stroke('side-note',[[55,101],[70,123]],2.8,10000),touch=stroke('touch-edit',[[39,100],[49,124]],2.8,20000);
  const separate=N.recog.mathStrokeGroups([a,b,note]).map(g=>g.map(s=>s.id).sort()).sort((x,y)=>x[0].localeCompare(y[0]));
  assert.equal(JSON.stringify(separate),JSON.stringify([['base-a','base-b'],['side-note']]),
    'nearby same-row ink written much later stays separate when a visible gap remains');
  const touching=N.recog.mathStrokeGroups([a,b,touch]).map(g=>g.map(s=>s.id).sort());
  assert.equal(JSON.stringify(touching),JSON.stringify([['base-a','base-b','touch-edit']]),
    'a later edit that touches the expression still joins it');
  const overlapA=stroke('overlap-note-a',[[30,101],[44,123]],2.8,10000),
    overlapB=stroke('overlap-note-b',[[47,101],[57,123]],2.8,10120),
    overlapC=stroke('overlap-note-c',[[60,101],[72,123]],2.8,10240);
  const overlapping=N.recog.mathStrokeGroups([a,b,overlapA,overlapB,overlapC]).map(g=>g.map(s=>s.id).sort()).sort((x,y)=>x[0].localeCompare(y[0]));
  assert.equal(JSON.stringify(overlapping),JSON.stringify([['base-a','base-b'],['overlap-note-a','overlap-note-b','overlap-note-c']]),
    'a complete later annotation stays separate even when its bbox overlaps the earlier expression');
});
test('tiny pen taps stay with the temporally local glyph that contains them',async()=>{
  const {stroke}=await import('./fixtures/math-notes.mjs');
  const N=controller(),body=stroke('body',[[100,80],[140,120]],2.8,100),
    tapA=stroke('tap-a',[[108,112],[108,112]],2.4,130),tapB=stroke('tap-b',[[112,114],[112,114]],2.4,150),
    lower=stroke('lower-row',[[100,126],[140,154]],2.8,10000);
  const groups=N.recog.mathStrokeGroups([body,tapA,tapB,lower]).map(g=>g.map(s=>s.id).sort()).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.equal(JSON.stringify(groups),JSON.stringify([['body','tap-a','tap-b'],['lower-row']]),
    'contained taps are not stolen by a nearby row');
});
test('note resets invalidate memoized coordinates even when stroke IDs are reused',()=>{
  const N=controller(),S=N.core.S;
  S.strokes=[{id:'same',author:'user',w:2,bbox:[0,0,10,10],pts:[0,0,.5,10,10,.5]}];
  N.recog.rebuild();const before=S.clusters[0].hash;
  N.recog.reset();S.strokes=[{...S.strokes[0],pts:[0,0,.5,20,20,.5]}];
  N.recog.rebuild();assert.notEqual(S.clusters[0].hash,before);
});
test('a binary operator at a fragment edge bridges a thinking pause or wide spacing on one row',async()=>{
  const {writing,stroke}=await import('./fixtures/math-notes.mjs');
  const N=controller(),ids=groups=>JSON.stringify(groups.map(g=>g.map(s=>s.id).sort()).sort((x,y)=>x[0].localeCompare(y[0])));
  const shift=(strokes,ms)=>strokes.map(s=>({...s,t0:s.t0+ms,t1:s.t1+ms}));
  // "12" written, a five second pause, then "×8" — the cross is the left edge of the later burst.
  const twelve=writing('61',40,140,'left'),timesEight=shift(writing('*4',130,140,'right'),5000);
  assert.equal(ids(N.recog.mathStrokeGroups([...twelve,...timesEight])),ids([[...twelve,...timesEight]]),'cross after a pause joins');
  // "12" pause "+8": the plus keeps its bar in the later burst and still joins.
  const plusEight=shift(writing('+4',130,140,'right'),5000);
  assert.equal(ids(N.recog.mathStrokeGroups([...twelve,...plusEight])),ids([[...twelve,...plusEight]]),'plus after a pause joins');
  // "12 ×" pause "8": the operator sits at the right edge of the earlier burst.
  const twelveTimes=writing('61*',40,140,'left'),eight=shift(writing('4',175,140,'right'),5000);
  assert.equal(ids(N.recog.mathStrokeGroups([...twelveTimes,...eight])),ids([[...twelveTimes,...eight]]),'trailing operator joins the later number');
  // A lone cross between two numbers, each side spaced by more than the row height.
  const a=writing('61',40,140,'a'),op=shift(writing('*',150,140,'op'),4000),b=shift(writing('4',230,140,'b'),8000);
  assert.equal(ids(N.recog.mathStrokeGroups([...a,...op,...b])),ids([[...a,...op,...b]]),'a spaced lone operator joins both sides');
  // A lone minus bar and an equals sign written after a pause also bridge.
  const minus=[stroke('minus',[[150,160],[174,160]],2.8,5000)],five=shift(writing('4',225,140,'five'),9000);
  assert.equal(ids(N.recog.mathStrokeGroups([...a,...minus,...five])),ids([[...a,...minus,...five]]),'minus joins');
  const equation=writing('61+1=',40,140,'eq'),answer=shift(writing('6',240,140,'ans'),6000);
  assert.equal(ids(N.recog.mathStrokeGroups([...equation,...answer])),ids([[...equation,...answer]]),'an answer written later joins its equals sign');
  // Without an operator at the edge, the pause still separates the fragments.
  const later=shift(writing('4',150,140,'later'),5000);
  assert.equal(ids(N.recog.mathStrokeGroups([...twelve,...later])),ids([twelve,later]),'plain digits after a pause stay separate');
  // A crossbar glyph such as 4 is not an operator: its strokes meet near an end.
  const four=writing('4',40,140,'four'),six=shift(writing('6',110,140,'six'),5000);
  assert.equal(ids(N.recog.mathStrokeGroups([...four,...six])),ids([four,six]),'a digit 4 does not bridge');
  // Two expressions side by side with a pause and no facing operator remain separate.
  const leftExpr=writing('6*4',40,140,'l'),rightExpr=shift(writing('1+6',215,140,'r'),6000);
  assert.equal(ids(N.recog.mathStrokeGroups([...leftExpr,...rightExpr])),ids([leftExpr,rightExpr]),'separate expressions stay separate');
  // Same-row ink beyond the short reach is not bridged even by an operator.
  const far=shift(writing('*4',180,140,'far'),5000);
  assert.equal(ids(N.recog.mathStrokeGroups([...twelve,...far])),ids([twelve,far]),'an operator well beyond the row height stays separate');
});
test('two stacked bars restore an equals sign the decoder read as a minus',async()=>{
  const {stroke}=await import('./fixtures/math-notes.mjs');
  const N=controller(),S=N.core.S;
  // p = 3 as in the reported screenshot: a stem, a loop, two bars of unequal length, a 3.
  const p=[stroke('p-stem',[[50,60],[52,150]],3,0),stroke('p-bowl',[[52,70],[80,72],[84,100],[54,105]],3,200)],
    bars=[stroke('bar-top',[[130,96],[190,92]],3,600),stroke('bar-bottom',[[128,120],[176,118]],3,900)],
    three=[stroke('three',[[220,66],[262,70],[240,100],[266,120],[230,150]],3,1300)];
  const use=strokes=>{S.strokes=strokes;return {strokeIds:strokes.map(s=>s.id)};};
  let cl=use([...p,...bars,...three]);
  assert.equal(N.recog.stackedBarPairs(S.strokes).length,1);
  const fromAlternative=N.recog.equalsGeometryRepair({engine:'ink',latex:'p-3',alternatives:['p=3','p-8'],confidence:.95,minTokenConfidence:.93,terminated:true,truncated:false},cl);
  assert.equal(fromAlternative.latex,'p=3');assert.equal(JSON.stringify(fromAlternative.alternatives),JSON.stringify(['p-3','p-8']));
  assert.equal(N.recog.needsConfirmation(fromAlternative,cl),true,'a repaired reading is checked before solving');
  assert.equal(N.recog.equalsGeometryRepair({latex:'p--3',alternatives:[]},cl).latex,'p=3','a double minus is one equals');
  assert.equal(N.recog.equalsGeometryRepair({latex:'p=3',alternatives:[]},cl).latex,'p=3','nothing to repair');
  assert.equal(N.recog.equalsGeometryRepair({latex:'p\ne3',alternatives:[]},cl).latex,'p\ne3','another relation already accounts for the bars');
  const ambiguous={latex:'a-b-c',alternatives:['a-b=c']},out=N.recog.equalsGeometryRepair(ambiguous,cl);
  assert.equal(out.latex,'a-b=c','the model\'s own alternative decides which minus was the equals');
  assert.equal(N.recog.equalsGeometryRepair({latex:'a-b-c',alternatives:['a=b=c']},cl).latex,'a-b-c','no matching alternative leaves an ambiguous reading alone');
  // One bar is a minus; bars far apart, or with ink between them, are not an equals sign.
  cl=use([...p,bars[0],...three]);
  assert.equal(N.recog.equalsGeometryRepair({latex:'p-3',alternatives:['p=3']},cl).latex,'p-3');
  cl=use([...p,bars[0],stroke('far',[[128,150],[176,148]],3,900),...three]);
  assert.equal(N.recog.stackedBarPairs(S.strokes).length,0,'bars more than half a row apart are separate');
  cl=use([stroke('num',[[140,70],[160,88]],3,0),stroke('rule',[[120,100],[200,100]],3,300),stroke('den',[[140,112],[160,130]],3,600),stroke('under',[[118,140],[202,140]],3,900)]);
  assert.equal(N.recog.stackedBarPairs(S.strokes).length,0,'a fraction rule and an underline with ink between are not an equals sign');
});

test('uncertain split-letter equations require an existing unique ink candidate and independent text',()=>{
  const {textSupportedEquation,needsConfirmation}=controller().recog;
  const out={engine:'ink',latex:'41=x',alternatives:['y=x','49=x'],confidence:.7736,minTokenConfidence:.4,terminated:true,truncated:false};
  const selected=textSupportedEquation(out,{text:'Y = X',confidence:.8433});
  assert.equal(selected.latex,'y=x');assert.equal(selected.confidence,out.confidence);
  assert.equal(needsConfirmation(selected),true);assert.ok(selected.alternatives.includes('41=x'));
  for(const change of [{confidence:.9},{confidence:.69},{terminated:false},{truncated:true},{engine:'smart'},
    {alternatives:[]},{alternatives:['y=X']},{alternatives:['y=x','Y=x']},{latex:'41+x'},
    {latex:'41=x^2'},{alternatives:['y=z']},{alternatives:['y=2*x']}]){
    const value={...out,...change};assert.equal(textSupportedEquation(value,{text:'Y=X',confidence:.99}),value);
  }
  for(const text of [{text:'41=x',confidence:.99},{text:'y=x',confidence:.79},{text:'z=x',confidence:.99}])assert.equal(textSupportedEquation(out,text),out);
  assert.equal(textSupportedEquation({...out,latex:'12=t',alternatives:['r=t']},{text:'R=T',confidence:.9}).latex,'r=t','rule is not a y=x replacement');
});
