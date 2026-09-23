#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {staleDependency} from './evidence-provenance.mjs';

const ROOT=path.resolve(import.meta.dirname,'..');
const target=Number(process.env.NOTAS_ACCURACY_TARGET||0.99);
if(!Number.isFinite(target)||target<0.99||target>1)throw new Error('NOTAS_ACCURACY_TARGET must be in [0.99, 1].');

const readJson=rel=>JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));
const exists=rel=>fs.existsSync(path.join(ROOT,rel));
const mtime=rel=>exists(rel)?fs.statSync(path.join(ROOT,rel)).mtimeMs:0;
const pct=value=>value==null?'missing':`${(value*100).toFixed(2)}%`;
const asciiTokens=s=>JSON.stringify(String(s).match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\s]/g)||[]);
function latexTokens(s){
  let text=(String(s).match(/\\[A-Za-z]+|\\.|[^\s]/g)||[]).join(' '),prior;
  do{prior=text;text=text.replace(/([_^]) \{ ([^{} ]+) \}/g,'$1 $2');}while(text!==prior);
  return text;
}
const normalizedExpected=row=>(row.format==='latex'?latexTokens:asciiTokens)(row.expected);
const transcriptionExact=row=>!row.error&&normalizedExpected(row)===(row.format==='latex'?latexTokens:asciiTokens)(row.predicted);
const notebookEligible=row=>row.input_type==='strokes'&&row.segmentation_measured===true;
const notebookExact=row=>notebookEligible(row)&&row.segmentation_exact===true&&transcriptionExact(row);
function semantics(row){
  const s=String(row.expected||'').trim(),out=new Set();
  if(row.context?.isolated===true)out.add('isolated');
  if(row.context?.crowded===true)out.add('crowded');
  const plain=s.replace(/\\[A-Za-z]+/g,' '),withoutFunctions=plain.replace(/\b(?:sin|cos|tan|cot|sec|csc|log|ln|lg|exp|sqrt|pi)\b/gi,' ');
  if(/\b[A-Za-z_][A-Za-z0-9_]{1,31}\b/.test(withoutFunctions))out.add('named_variable');
  if(!/[A-Za-z\\]/.test(s)&&/\d/.test(s)&&/[=+*/-]/.test(s))out.add('arithmetic');
  if(/\^/.test(s))out.add('superscript');
  if(/\\(?:d?frac|tfrac)\b/.test(s)||/[A-Za-z0-9})]\s*\/\s*[A-Za-z0-9({]/.test(s))out.add('fraction');
  if(/(^|[=(,+*/])\s*-\s*[A-Za-z0-9]/.test(s))out.add('negative');
  return out;
}
function byBase(rows){
  const out=new Map();
  for(const row of rows){const list=out.get(row.base_id)||[];list.push(row);out.set(row.base_id,list);}
  return out;
}
function aggregate(rows,predicate){
  const groups=byBase(rows),exact=[...groups.values()].filter(group=>group.every(predicate)).length;
  return {n:groups.size,exact,exact_match:groups.size?exact/groups.size:null,attempts:rows.length};
}
function evidenceCounts(rows){
  return {
    base_samples:new Set(rows.map(row=>row.base_id)).size,
    sources:new Set(rows.map(row=>row.source).filter(Boolean)).size,
    writers:new Set(rows.filter(row=>row.writer_id).map(row=>`${row.source||''}\0${row.writer_id}`)).size,
    source_notes:new Set(rows.filter(row=>row.source_note_id).map(row=>`${row.source||''}\0${row.source_note_id}`)).size,
    independent_units:new Set(rows.filter(row=>row.source&&row.writer_id&&row.source_note_id).map(row=>`${row.source}\0${row.writer_id}\0${row.source_note_id}\0${row.base_id}`)).size
  };
}
function validateNotebookProvenance(rows){
  const seen=new Map();
  for(const row of rows){
    if(!row.base_id||!row.source||!row.writer_id||!row.source_note_id)return 'held-out notebook rows require base_id, source, writer_id, and source_note_id provenance';
    const signature=JSON.stringify([row.source,row.writer_id,row.source_note_id,row.format||'ascii',normalizedExpected(row)]),prior=seen.get(row.base_id);
    if(prior&&prior!==signature)return `base_id ${row.base_id} has conflicting source, writer, note, format, or expected transcription`;
    seen.set(row.base_id,signature);
  }
  return null;
}

function evidence({id,label,result,producer,value,metric}){
  if(!exists(result))return {id,label,metric,value:null,state:'MISSING',reason:`no ${result}`};
  const data=readJson(result);let v=value(data);
  if(data.heldOut?.verified!==true||!data.heldOut?.dataset||!data.heldOut?.split||!data.heldOut?.selection||!data.corpus_sha256||!data.sample_hashes||!Object.keys(data.sample_hashes).length)
    return {id,label,metric,value:null,state:'INVALID',reason:data.heldOut?.verified===false?'benchmark is not independent held-out evidence':'missing held-out split, selection, or corpus/sample hashes'};
  let notebookRows=null;
  if(id==='math-notebook'){
    if(data.pipeline!=='notebook-end-to-end'||!Array.isArray(data.rows)||!data.rows.length)
      return {id,label,metric,value:null,state:'INVALID',reason:'requires actual notebook pipeline rows, not isolated worker predictions'};
    if(data.rows.some(row=>row.input_type==='image'&&row.segmentation_measured===true))
      return {id,label,metric,value:null,state:'INVALID',reason:'image crops cannot claim notebook segmentation measurements'};
    notebookRows=data.rows.filter(notebookEligible);
    const provenanceError=validateNotebookProvenance(notebookRows);
    if(provenanceError)return {id,label,metric,value:null,state:'INVALID',reason:provenanceError};
    if(!notebookRows.length)return {id,label,metric,value:null,state:'INVALID',reason:'no stroke-based notebook evidence'};
  }
  if(producer&&mtime(result)<mtime(producer)){
    return {id,label,metric,value:null,state:'STALE',reason:`${result} predates ${producer}`};
  }
  const runtime=['assets/smart/ort.wasm.min.js','assets/smart/ort-wasm-simd-threaded.js','assets/smart/ort-wasm-simd-threaded.wasm'];
  const dependencies=['model-contract.js','notas.html',...(id==='math-notebook'
    ? ['local-recognition.js','ink-worker.js','ink-features.js','assets/ink/encoder.onnx','assets/ink/decoder_step.onnx','assets/ink/vocab.json','text-worker.js','assets/text/ppocrv6-small.onnx','assets/text/ppocrv6_dict.txt','scripts/benchmark-math-notes.mjs',...runtime]
    : id.startsWith('handwriting-')
      ? ['text-worker.js','assets/text/ppocrv6-small.onnx','assets/text/ppocrv6_dict.txt','local-recognition.js',...runtime]
      : ['ink-worker.js','ink-features.js','assets/ink/encoder.onnx','assets/ink/decoder_step.onnx','assets/ink/vocab.json','local-recognition.js',...runtime])];
  const stale=staleDependency(ROOT,result,data,dependencies);
  if(stale)return {id,label,metric,value:null,state:'STALE',reason:`missing or changed content provenance: ${stale}`};
  if(id==='math-notebook'){
    const overall=aggregate(notebookRows,notebookExact);
    v=overall.exact_match;
    const categoryEvidence={};
    for(const category of ['isolated','crowded','named_variable','arithmetic','superscript','fraction','negative']){
      const rows=notebookRows.filter(row=>semantics(row).has(category)),summary=aggregate(rows,notebookExact),counts=evidenceCounts(rows);
      categoryEvidence[category]={...summary,...counts};
      if(summary.n<30)return {id,label,metric,value:v,state:'INVALID',reason:`${category}: requires at least 30 independent base samples (got ${summary.n})`,evidence:categoryEvidence};
      if(summary.exact_match<target)return {id,label,metric,value:summary.exact_match,state:'FAIL',reason:`${category}: whole-expression accuracy below target`,evidence:categoryEvidence};
    }
    if(Number.isFinite(data?.overall?.exact_match)&&Math.abs(data.overall.exact_match-v)>1e-12)
      return {id,label,metric,value:v,state:'INVALID',reason:'reported notebook exact does not match independent base-level recomputation',evidence:categoryEvidence};
    return {id,label,metric,value:v,state:v>=target?'PASS':'FAIL',reason:result,evidence:{overall:{...overall,...evidenceCounts(notebookRows)},categories:categoryEvidence}};
  }
  if(!Number.isFinite(v)||v<0||v>1)return {id,label,metric,value:null,state:'INVALID',reason:`invalid metric in ${result}`};
  return {id,label,metric,value:v,state:v>=target?'PASS':'FAIL',reason:result};
}

function firstMetric(data){
  const candidates=[
    data?.overall?.exact_match,data?.summary?.exact_match,data?.summary?.normalized_match,
    data?.exact_rate,data?.character_accuracy,data?.accuracy,data?.score
  ];
  return candidates.find(Number.isFinite);
}

const chineseCandidates=[
  'experiments/ocr-upgrade/small-casia100.json',
  'test-results/chinese-handwriting-benchmark.json',
  'experiments/ocrv6-small/results-chinese.json',
  'experiments/ocr-quality/results/chinese-handwriting.json'
];
const chineseResult=chineseCandidates.find(exists);

const checks=[
  evidence({
    id:'math-notebook',label:'Math in actual notes',metric:'exact expression and grouping, in every required scenario',
    result:'test-results/math-notes-heldout.json',producer:'scripts/benchmark-math-notes.mjs',
    value:d=>d?.overall?.exact_match
  }),
  evidence({
    id:'handwriting-text-en-char',label:'English handwriting text',metric:'character accuracy (1 - CER)',
    result:'experiments/ocr-upgrade/small-iam-fresh100.json',producer:'text-worker.js',
    value:d=>Number.isFinite(d?.cer)?1-d.cer:null
  }),
  evidence({
    id:'handwriting-text-en-line',label:'English handwriting lines',metric:'full-line exact match',
    result:'experiments/ocr-upgrade/small-iam-fresh100.json',producer:'text-worker.js',
    value:d=>d?.exact_rate
  }),
  chineseResult?evidence({
    id:'handwriting-text-zh',label:'Chinese handwriting text',metric:'benchmark exact/accuracy metric',
    result:chineseResult,producer:'text-worker.js',value:firstMetric
  }):{id:'handwriting-text-zh',label:'Chinese handwriting text',metric:'benchmark exact/accuracy metric',value:null,state:'MISSING',reason:'add a held-out Chinese handwriting benchmark result'}
];

const report={
  target,
  generatedAt:new Date().toISOString(),
  policy:'Every required task must have fresh held-out evidence at or above target. Missing or stale evidence fails closed.',
  checks
};

if(process.argv.includes('--json')){
  console.log(JSON.stringify(report,null,2));
}else{
  console.log(`notas model quality gate: ${(target*100).toFixed(1)}% required for every task`);
  console.table(checks.map(c=>({task:c.label,metric:c.metric,accuracy:pct(c.value),status:c.state,evidence:c.reason})));
}

if(checks.some(c=>c.state!=='PASS'))process.exitCode=1;
