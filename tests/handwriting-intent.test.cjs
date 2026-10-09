const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function notebook(text,confidence=.99,extra=''){
  const S={id:'intent',settings:{aiOn:true},strokes:[],clusters:[],textTranscripts:[],images:[]};
  const N={core:{S,strokeById:id=>S.strokes.find(s=>s.id===id),markDirty(){}},mathcore:{run(){},latexToMath:s=>s}};
  const source=fs.readFileSync(path.join(__dirname,'../local-recognition.js'),'utf8');
  const injection=`
    textGroups=()=>[{hash:'line:'+S.clusters.map(c=>c.hash).join('|'),strokeIds:S.clusters.flatMap(c=>c.strokeIds),bbox:[0,0,200,40]}];
    textCrop=group=>group;linearizedCrop=()=>null;readWords=async out=>out;
    N.textCalls=0;N.inkCalls=0;N.readTextNow=readText;
    textInfer=async()=>{N.textCalls++;return {text:${JSON.stringify(text)},confidence:${confidence}};};
    inferInk=async()=>{N.inkCalls++;return {engine:'ink',latex:'2+3=',confidence:.999,minTokenConfidence:.999,terminated:true,truncated:false};};
    ${extra}
  `;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../model-contract.js'),'utf8')+'\n'+source.replace('N.ai={',injection+'\nN.ai={'),{
    N,window:{addEventListener(){}},document:{createElement:()=>({dataset:{},setAttribute(){}}),body:{appendChild(){}},addEventListener(){}},
    setTimeout:()=>0,clearTimeout(){},DOMException
  });
  S.clusters=[{id:'c',hash:'ink',strokeIds:['s'],bbox:[0,0,100,40],source:'ink'}];
  return N;
}

test('English, short words, numbered notes and dates skip formula decoding',async()=>{
  for(const text of ['hello','hi','to do','remember to revise chapter four','Homework 3','2026-10-09','学习中文']){
    const N=notebook(text),cl=N.core.S.clusters[0];await N.recog.recognize(cl);
    assert.equal(N.recog.handwritingKind(cl),'text',text);
    assert.equal(N.inkCalls,0,text);assert.equal(cl.pending,false);assert.ok(!cl.review);
    await N.recog.recognizeText(N.recog.textGroups()[0]);
    assert.equal(N.textCalls,1,'classification and search share the same reading');
    assert.equal(N.core.S.textTranscripts[0].text,text,'prose remains searchable');
  }
});

test('high formula confidence cannot promote weak, blank or failed text evidence',async()=>{
  for(const [text,confidence,extra] of [['hello',.4,''],['',1,''],['2+3=',.4,''],['2+3=',1,"textInfer=async()=>{throw new Error('text reader unavailable');};"]]){
    const N=notebook(text,confidence,extra),cl=N.core.S.clusters[0];await N.recog.recognize(cl);
    assert.equal(cl.ascii,'2+3=');assert.equal(cl.needsConfirmation,false);
    assert.equal(N.recog.handwritingKind(cl),'uncertain');
  }
});

test('math, named quantities, fractions, functions and Greek algebra retain math classification',async()=>{
  for(const text of ['2+3=','x-y','Pens=3','hi*4','1/2','sin(x)','x^2=9','α+β=3']){
    const N=notebook(text),cl=N.core.S.clusters[0];await N.recog.recognize(cl);
    assert.equal(N.recog.handwritingKind(cl),'math',text);assert.equal(N.inkCalls,1,text);
  }
});

test('a mixed line requires independent evidence for each distinct equation',async()=>{
  const N=notebook('homework 2+3=',.99,`textInfer=async group=>({text:group.hash==='word'?'homework':group.strokeIds.length===1?'2+3=':'homework 2+3=',confidence:.99});`);
  const S=N.core.S,math=S.clusters[0];
  S.clusters.push({id:'word',hash:'word',strokeIds:['w'],bbox:[110,0,200,40],source:'ink'});
  await N.recog.recognize(math);assert.equal(N.recog.handwritingKind(math),'math');
  await N.recog.recognize(S.clusters[1]);assert.equal(N.recog.handwritingKind(S.clusters[1]),'text');
  assert.ok(!S.clusters[1].ascii,'the neighboring word does not inherit equation classification');
  const single=notebook('homework 2+3='),cl=single.core.S.clusters[0];await single.recog.recognize(cl);
  assert.equal(single.recog.handwritingKind(cl),'uncertain','joined prose and math do not auto-promote');
});

test('classification and search share an in-flight line read',async()=>{
  const N=notebook('2+3='),cl=N.core.S.clusters[0],group=N.recog.textGroups()[0];
  await Promise.all([N.recog.recognize(cl),N.recog.recognizeText(group)]);
  assert.equal(N.textCalls,1);assert.equal(N.recog.handwritingKind(cl),'math');
  assert.equal(N.core.S.textTranscripts[0].text,'2+3=');
});

test('a reopened mixed transcript schedules separate equation evidence',async()=>{
  const N=notebook('homework 2+3=',.99,`textInfer=async group=>{N.textCalls++;return {text:group.hash==='word'?'homework':'2+3=',confidence:.99};};`);
  const S=N.core.S,math=S.clusters[0];
  math.ascii='2+3=';
  const word={hash:'word',strokeIds:['w'],bbox:[110,0,200,40],source:'ink'};S.clusters.push(word);
  const group=N.recog.textGroups()[0];
  S.textTranscripts=[{hash:group.hash,text:'homework 2+3=',confidence:.99,modelVersion:N.recog.textVersion}];
  assert.equal(N.recog.handwritingKind(math),'uncertain');
  await N.readTextNow();
  assert.equal(N.recog.handwritingKind(math),'math');assert.equal(N.recog.handwritingKind(word),'text');
  assert.equal(N.textCalls,2,'reuse the saved line and read only its distinct crops');
});

test('text evidence completing after navigation cannot classify ink in the next note',async()=>{
  const N=notebook('hello',.99,`textInfer=()=>new Promise(resolve=>{N.finishText=resolve;});`),cl=N.core.S.clusters[0];
  const pending=N.recog.recognize(cl);
  N.core.S.id='another-note';N.recog.reset();
  const fresh={hash:'fresh',strokeIds:['fresh'],bbox:[0,0,100,40],source:'ink'};
  N.core.S.clusters=[fresh];N.finishText({text:'hello',confidence:1});await pending;
  assert.equal(N.recog.handwritingKind(fresh),'uncertain');assert.ok(!fresh.ascii);
  assert.equal(N.inkCalls,0);
});

test('a changed surrounding line invalidates classification even if the formula hash stays the same',async()=>{
  const N=notebook('2+3='),S=N.core.S,cl=S.clusters[0];await N.recog.recognize(cl);
  assert.equal(N.recog.handwritingKind(cl),'math');
  S.clusters.push({hash:'new-word',strokeIds:['new'],bbox:[110,0,180,40]});
  assert.equal(N.recog.handwritingKind(cl),'uncertain');
});

test('explicit Solve reads ink even when the independent reader thinks it is prose',async()=>{
  const N=notebook('hello'),cl=N.core.S.clusters[0];cl.asked=true;
  await N.recog.recognize(cl,true);
  assert.equal(N.textCalls,0);assert.equal(N.inkCalls,1);assert.equal(cl.ascii,'2+3=');
});

test('a decoded equals requires real bars, including at the end for a trailing request',()=>{
  const N=notebook('2+3='),S=N.core.S,cl=S.clusters[0];
  const stroke=(id,bbox)=>({id,bbox,pts:[bbox[0],bbox[1],.5,bbox[2],bbox[3],.5]});
  S.strokes=[stroke('body',[0,0,25,40])];cl.strokeIds=['body'];
  assert.equal(N.recog.hasWrittenEquals(cl,'2+3='),false);
  S.strokes.push(stroke('top',[50,14,80,14]),stroke('bottom',[50,25,80,25]));cl.strokeIds=S.strokes.map(s=>s.id);
  assert.equal(N.recog.hasWrittenEquals(cl,'2+3='),true);
  assert.equal(N.recog.hasWrittenEquals(cl,'2=3='),false,'cannot invent another relation');
  S.strokes.push(stroke('rhs',[90,0,115,40]));cl.strokeIds=S.strokes.map(s=>s.id);
  assert.equal(N.recog.hasWrittenEquals(cl,'2+3='),false,'internal equals does not request a trailing answer');
  assert.equal(N.recog.hasWrittenEquals(cl,'x=3'),true,'written definitions remain supported');
});
