// Measures the production notebook pipeline, including grouping and routing.
// Pass a JSON corpus with {heldOut, samples} to evaluate captured user strokes.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';
import {startServer} from './serve.mjs';
import {samples as regressions} from '../tests/fixtures/math-notes.mjs';
const root=path.resolve(import.meta.dirname,'..');
const corpusDir=process.env.CORPUS?path.dirname(path.resolve(process.env.CORPUS)):root;
const hash=b=>createHash('sha256').update(b).digest('hex');
const corpus=process.env.CORPUS?JSON.parse(await readFile(process.env.CORPUS,'utf8')):
  {heldOut:{verified:false,dataset:'development regressions',split:'development',selection:'reported failure plus authored vector examples'},samples:regressions};
if(!Array.isArray(corpus.samples)||!corpus.samples.length)throw Error('Corpus must contain samples.');
if(new Set(corpus.samples.map(s=>s.id)).size!==corpus.samples.length)throw Error('Duplicate sample IDs.');
for(const sample of corpus.samples){
  if(Boolean(sample.strokes)===Boolean(sample.image))throw Error(`Sample ${sample.id} must contain exactly one of strokes or image.`);
  if(sample.strokes&&(!Array.isArray(sample.targetIds)||!sample.targetIds.length))throw Error(`Stroke sample ${sample.id} requires targetIds.`);
}
const corpus_sha256=hash(JSON.stringify(corpus)),sample_hashes={};
const inputs=[];
for(const s of corpus.samples){
  let data;
  if(s.image){const bytes=await readFile(path.resolve(corpusDir,s.image));data='data:image/png;base64,'+bytes.toString('base64');sample_hashes[s.id]=hash(Buffer.concat([Buffer.from(JSON.stringify(s)),bytes]));}
  else sample_hashes[s.id]=hash(JSON.stringify(s));
  inputs.push({...s,data});
}
const provenance={};
for(const file of ['scripts/benchmark-math-notes.mjs','tests/fixtures/math-notes.mjs','model-contract.js','local-recognition.js','notas.html','ink-worker.js','ink-features.js','text-worker.js','assets/ink/encoder.onnx','assets/ink/decoder_step.onnx','assets/ink/vocab.json','assets/text/ppocrv6-small.onnx','assets/text/ppocrv6_dict.txt','assets/smart/ort.wasm.min.js','assets/smart/ort-wasm-simd-threaded.js','assets/smart/ort-wasm-simd-threaded.wasm'])provenance[file]=hash(await readFile(path.join(root,file)));
const repeats=Number(process.env.REPEATS||1);
for(const file of ['ink-worker.js','ink-features.js','assets/ink/encoder.onnx','assets/ink/decoder_step.onnx','assets/ink/vocab.json'])provenance[file]=hash(await readFile(path.join(root,file)));
const overrides=new Map();
if(process.env.SOURCE_ROOT)for(const file of ['notas.html','model-contract.js','local-recognition.js','ink-worker.js','ink-features.js']){
  const source=path.resolve(process.env.SOURCE_ROOT,file);
  await access(source);const bytes=await readFile(source);overrides.set('/'+file,bytes);provenance[file]=hash(bytes);
}
if(!Number.isInteger(repeats)||repeats<1)throw Error('REPEATS must be a positive integer.');
const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const rows=[];
try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base)return route.abort();
    if(overrides.has(url.pathname))return route.fulfill({contentType:url.pathname.endsWith('.html')?'text/html':'text/javascript',body:overrides.get(url.pathname)});
    return route.continue();
  });
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.recog&&N.mathcore);
  await page.locator('#local-status').filter({hasText:/handwriting ready/i}).waitFor({state:'attached',timeout:180000});
  await page.evaluate(()=>{N.tutorial.finish(false);N.recog.reset();N.core.S.settings.aiOn=false;});
  for(let run=0;run<repeats;run++)for(const sample of inputs){
    const result=await page.evaluate(async sample=>{
      const S=N.core.S;
      let reportedError=null;const toast=N.core.toast;N.core.toast=message=>{reportedError=message;};
      S.settings.aiOn=false;N.recog.reset();S.strokes=[];S.images=[];S.clusters=[];S.lines=[];S.textTranscripts=[];
      S.settings.recognizer='ink';
      let cl,segmentationExact=null,context=null;
      if(sample.strokes){
        S.strokes=sample.strokes;N.recog.rebuild();
        const ids=new Set(sample.targetIds);
        cl=S.clusters.find(c=>c.strokeIds.some(id=>ids.has(id)));
        segmentationExact=!!cl&&cl.strokeIds.length===ids.size&&cl.strokeIds.every(id=>ids.has(id));
        const target=sample.strokes.filter(s=>ids.has(s.id)),other=sample.strokes.filter(s=>!ids.has(s.id));
        const box=list=>list.length?[Math.min(...list.map(s=>s.bbox[0])),Math.min(...list.map(s=>s.bbox[1])),Math.max(...list.map(s=>s.bbox[2])),Math.max(...list.map(s=>s.bbox[3]))]:null;
        const tb=box(target),gap=(a,b)=>{
          const dx=Math.max(a[0]-b[2],b[0]-a[2],0),dy=Math.max(a[1]-b[3],b[1]-a[3],0);
          return Math.hypot(dx,dy);
        };
        const nearest=tb&&other.length?Math.min(...other.map(s=>gap(tb,s.bbox))):Infinity;
        const h=tb?Math.max(1,tb[3]-tb[1]):1;
        context={page_stroke_count:sample.strokes.length,target_stroke_count:target.length,distractor_stroke_count:other.length,
          nearest_distractor_gap:Number.isFinite(nearest)?nearest:null,target_height:h,
          crowded:other.length>0&&nearest<=Math.max(24,h*1.5),isolated:other.length===0||nearest>=h*3};
      }
      S.settings.aiOn=true;
      const start=performance.now();
      if(sample.data){
        // pictures are no longer read: an image fixture records an empty
        // reading rather than a result from a model that does not ship
        cl={latex:'',ascii:'',error:'image reading removed',alternatives:[]};
      }else if(cl){const hash=cl.hash;await N.recog.recognize(cl);cl=S.clusters.find(c=>c.hash===hash);}
      const formal=sample.expected==null&&sample.latex!=null;
      const result={predicted:formal?(cl?.latex||''):(cl?.ascii||''),displayed:cl?.ascii||'',latex:cl?.latex||'',error:cl?.error||reportedError||null,
        expected:sample.expected??sample.latex,format:formal?'latex':'ascii',
        input_type:sample.strokes?'strokes':'image',segmentation_measured:!!sample.strokes,
        alternatives:cl?.alternatives||[],modelVersion:cl?.modelVersion||null,
        confidence:cl?.confidence??null,needsConfirmation:!!cl?.needsConfirmation,
        automatic_eligible:!!cl&&(cl.modelVersion!=null)&&!cl.review&&!cl.needsConfirmation,
        answer_produced:S.nodes.some(n=>n.ref===cl&&n.result!=null),
        segmentation_exact:segmentationExact,context,ms:performance.now()-start};
      S.settings.aiOn=false;N.recog.reset();N.core.toast=toast;return result;
    },sample);
    rows.push({id:sample.id,base_id:sample.base_id||sample.id,run,kind:sample.kind,categories:sample.categories,
      source:sample.source,writer_id:sample.writer_id||null,source_note_id:sample.source_note_id||null,
      source_expression_id:sample.source_expression_id||null,source_inkml_sha256:sample.source_inkml_sha256||null,
      composition:sample.composition||null,
      ...result});
    console.log(sample.id,JSON.stringify(result));
  }
}finally{await browser.close();server.close();}
// ASCII transcription: whitespace is insignificant, identifiers and operators
// are case-sensitive. No numerical simplification or target-aware correction.
const tokens=s=>JSON.stringify(String(s).match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\s]/g)||[]);
function latexTokens(s){
  let text=(String(s).match(/\\[A-Za-z]+|\\.|[^\s]/g)||[]).join(' '),prior;
  do{prior=text;text=text.replace(/([_^]) \{ ([^{} ]+) \}/g,'$1 $2');}while(text!==prior);
  return text;
}
const transcriptionExact=r=>{const normalize=r.format==='latex'?latexTokens:tokens;return !r.error&&normalize(r.expected)===normalize(r.predicted);};
const notebookEligible=r=>r.input_type==='strokes'&&r.segmentation_measured===true;
const segmentationExact=r=>notebookEligible(r)&&r.segmentation_exact===true;
const correct=r=>segmentationExact(r)&&transcriptionExact(r);
const semanticCategories=r=>{
  const s=String(r.expected||'').trim(),out=new Set();
  if(r.context?.isolated===true)out.add('isolated');
  if(r.context?.crowded===true)out.add('crowded');
  const plain=s.replace(/\\[A-Za-z]+/g,' '),withoutFunctions=plain.replace(/\b(?:sin|cos|tan|cot|sec|csc|log|ln|lg|exp|sqrt|pi)\b/gi,' ');
  if(/\b[A-Za-z_][A-Za-z0-9_]{1,31}\b/.test(withoutFunctions))out.add('named_variable');
  if(!/[A-Za-z\\]/.test(s)&&/\d/.test(s)&&/[=+*/-]/.test(s))out.add('arithmetic');
  if(/\^/.test(s))out.add('superscript');
  if(/\\(?:d?frac|tfrac)\b/.test(s)||/[A-Za-z0-9})]\s*\/\s*[A-Za-z0-9({]/.test(s))out.add('fraction');
  if(/(^|[=(,+*/])\s*-\s*[A-Za-z0-9]/.test(s))out.add('negative');
  return [...out];
};
for(const row of rows)row.semantic_categories=semanticCategories(row);
const baseSignatures=new Map();
for(const row of rows){
  const normalize=row.format==='latex'?latexTokens:tokens;
  const signature=JSON.stringify([row.source||null,row.writer_id||null,row.source_note_id||null,row.format,normalize(row.expected)]),prior=baseSignatures.get(row.base_id);
  if(prior&&prior!==signature)throw Error(`base_id ${row.base_id} has conflicting source, writer, note, format, or expected transcription.`);
  baseSignatures.set(row.base_id,signature);
}
const aggregate=(group,predicate)=>{
  const byBase=new Map();
  for(const row of group){const list=byBase.get(row.base_id)||[];list.push(row);byBase.set(row.base_id,list);}
  const exact=[...byBase.values()].filter(list=>list.every(predicate)).length;
  return {n:byBase.size,exact,exact_match:byBase.size?exact/byBase.size:null,attempts:group.length};
};
const evidence=group=>({
  base_samples:new Set(group.map(r=>r.base_id)).size,
  sources:new Set(group.filter(r=>r.source).map(r=>r.source)).size,
  writers:new Set(group.filter(r=>r.writer_id).map(r=>`${r.source||''}\0${r.writer_id}`)).size,
  source_notes:new Set(group.filter(r=>r.source_note_id).map(r=>`${r.source||''}\0${r.source_note_id}`)).size,
  independent_units:new Set(group.filter(r=>r.source&&r.writer_id&&r.source_note_id).map(r=>`${r.source}\0${r.writer_id}\0${r.source_note_id}\0${r.base_id}`)).size,
  complete_provenance_bases:new Set(group.filter(r=>r.source&&r.writer_id&&r.source_note_id).map(r=>r.base_id)).size
});
const by_category={};
for(const category of new Set(rows.flatMap(r=>r.semantic_categories))) {
  const group=rows.filter(r=>r.semantic_categories.includes(category)),notebook=group.filter(notebookEligible);
  const transcription=aggregate(group,transcriptionExact),segmentation=aggregate(notebook,segmentationExact),notebookExact=aggregate(notebook,correct);
  by_category[category]={...transcription,transcription_exact:transcription.exact,transcription_exact_match:transcription.exact_match,
    notebook_n:notebookExact.n,notebook_attempts:notebookExact.attempts,exact:notebookExact.exact,exact_match:notebookExact.exact_match,
    segmentation_exact:segmentation.exact,segmentation_exact_match:segmentation.exact_match,evidence:evidence(group)};
}
const notebookRows=rows.filter(notebookEligible),overall=aggregate(notebookRows,correct),segmentation=aggregate(notebookRows,segmentationExact),transcription=aggregate(rows,transcriptionExact);
const report={generatedAt:new Date().toISOString(),pipeline:'notebook-end-to-end',
  metric:'notebook exact is aggregated by independent base_id and requires exact transcription plus exact target stroke membership; repeated runs and augmentations cannot add evidence; crop-only images contribute only to transcription; semantic categories are derived from expected content and measured page context',
  heldOut:corpus.heldOut||{verified:false},corpus_sha256,sample_hashes,provenance,
  overall:{...overall,evidence:evidence(notebookRows)},
  segmentation:{...segmentation,evidence:evidence(notebookRows)},
  transcription:{...transcription,evidence:evidence(rows)},
  by_category,rows};
await mkdir('test-results',{recursive:true});
await writeFile(process.env.OUT||'test-results/math-notes.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({overall:report.overall,by_category},null,2));
if(rows.some(r=>!transcriptionExact(r)||(r.segmentation_measured===true&&!correct(r))))process.exitCode=1;
