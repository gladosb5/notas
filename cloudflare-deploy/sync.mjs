// Copies the files the deployed notebook needs from the project root into
// public/, and nothing else: no datasets, experiments, tests or tools. The
// set is what sw.js caches (its SHELL list plus asset-manifest.json) and
// the model directories the workers fetch lazily: the stroke reader, the
// text reader and the ONNX runtime (still under assets/smart/, named for
// the 80 MB image model that used to live there and no longer ships).
// Static assets are limited to 25 MiB a file, which everything now fits.
// Files copied by an earlier run that are no longer wanted are removed, so
// public/ always mirrors the current app.
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cspFor,ASSET_CSP} from './csp.mjs';

const here=path.resolve(import.meta.dirname);
const root=path.resolve(here,'..');
const out=path.join(here,'public');

const SHELL=['notas.html','sw.js','model-contract.js','local-recognition.js','ink-worker.js',
  'ink-features.js','model-store.js','text-worker.js','bg-worker.js','local-math-help.js','diagram.js','nota.js','manifest.webmanifest','asset-manifest.json',
  'assets/icon-16.png','assets/icon-32.png','assets/icon-192.png','assets/icon-512.png',
  'assets/icon-maskable-512.png','assets/apple-touch-icon.png','assets/logo.png'];
const MODEL_DIRS=['assets/smart','assets/ink','assets/text','assets/slide'];
const ASSET_LIMIT=25*1024*1024;

// The page is part of the recognition fingerprint. Stamp it as part of each
// deployment so running npm run deploy cannot publish a stale contract.
execFileSync(process.execPath,['scripts/model-contract.mjs'],{cwd:root,stdio:'inherit'});
const slide=JSON.parse(await readFile(path.join(root,'assets/slide/model.json'),'utf8'));
const whole=createHash('sha256');let modelBytes=0;
for(const part of slide.parts){
  if(path.basename(part.file)!==part.file||!part.file.endsWith('.bin'))throw Error('invalid slide model chunk path');
  const bytes=await readFile(path.join(root,'assets/slide',part.file));
  if(bytes.length!==part.bytes||createHash('sha256').update(bytes).digest('hex')!==part.sha256)throw Error('damaged slide model chunk: '+part.file);
  whole.update(bytes);modelBytes+=bytes.length;
}
if(modelBytes!==slide.bytes||whole.digest('hex')!==slide.sha)throw Error('incomplete slide model');


const manifest=JSON.parse(await readFile(path.join(root,'asset-manifest.json'),'utf8'));
const wanted=new Set([...SHELL,...manifest]);
for(const dir of MODEL_DIRS)for(const name of await readdir(path.join(root,dir)))wanted.add(dir+'/'+name);

// sw.js caches only these, but the page and workers are scanned too so a
// new reference cannot ship without its file.
const sources=await Promise.all(['notas.html','sw.js','local-recognition.js','ink-worker.js','text-worker.js','bg-worker.js','nota.js']
  .map(f=>readFile(path.join(root,f),'utf8')));
for(const m of sources.join('\n').matchAll(/['"]\.\/((?:assets\/)?[\w./-]+\.(?:js|css|json|png|woff2|ttf|txt|onnx|wasm|webmanifest))['"]/g))wanted.add(m[1]);

let bytes=0,copied=0;
for(const rel of [...wanted].sort()){
  const from=path.join(root,rel),to=path.join(out,rel);
  let info;
  try{info=await stat(from);}catch{throw new Error('missing from the project: '+rel);}
  if(info.size>ASSET_LIMIT)throw new Error(rel+' is '+(info.size/1048576).toFixed(1)+' MB, over the 25 MiB static asset limit');
  await mkdir(path.dirname(to),{recursive:true});
  await cp(from,to,{force:true});
  bytes+=info.size;copied++;
}

// Headers for the assets. Worker responses (the forward) set their own. Cross-origin isolation lets the recognition workers run
// multi-threaded; the shell is revalidated on every load so a new build is
// picked up; the model files are content-addressed (?v=<hash>) so they
// may be cached for good.
const noCache=['/','/notas.html','/sw.js','/model-contract.js','/asset-manifest.json','/manifest.webmanifest',
  '/local-recognition.js','/ink-worker.js','/ink-features.js','/model-store.js','/text-worker.js','/bg-worker.js','/slide-surface.js','/local-math-help.js','/nota.js'];
const onnx=[...wanted].filter(f=>f.endsWith('.onnx')).map(f=>'/'+f);
// The policy is per path, never under /*: two matching rules would send two
// policies, and a browser enforces both.
const pageCsp=cspFor(await readFile(path.join(root,'notas.html'),'utf8'));
const headers=[
  '/*','  Cross-Origin-Opener-Policy: same-origin','  Cross-Origin-Embedder-Policy: require-corp','  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  ...['/','/notas.html'].flatMap(p=>[p,'  Content-Security-Policy: '+pageCsp,'  X-Frame-Options: DENY']),
  ...['/ink-worker.js','/text-worker.js','/bg-worker.js','/sw.js'].flatMap(p=>[p,'  Content-Security-Policy: '+ASSET_CSP]),
  ...noCache.flatMap(p=>[p,'  Cache-Control: no-cache']),
  ...MODEL_DIRS.filter(d=>d!=='assets/slide').flatMap(d=>['/'+d+'/*','  Cache-Control: public, max-age=31536000, immutable']),
  '/assets/slide/*.bin','  Cache-Control: public, max-age=31536000, immutable','  Content-Type: application/octet-stream',
  '/assets/slide/model.js','  Cache-Control: no-cache',
  '/assets/slide/model.json','  Cache-Control: no-cache',
  ...onnx.flatMap(p=>[p,'  Content-Type: application/octet-stream']),
  '/manifest.webmanifest','  Content-Type: application/manifest+json',
  ''].join('\n');
await writeFile(path.join(out,'_headers'),headers);
// / is the page, served by the assets themselves (a 200 rewrite, not a
// redirect: sw.js and the manifest name /notas.html) so opening the
// notebook does not run worker.js at all. worker.js keeps the same rule
// for a deployment made before this file existed.
await writeFile(path.join(out,'_redirects'),'/ /notas.html 200\n');
// Any path that is neither an asset nor one of worker.js's routes gets this
// from the assets (not_found_handling in wrangler.jsonc), so a stray URL
// never runs the worker or counts as one of its requests.
// In the notebook's own paper and graphite, light and dark, and its
// interface typeface, so a wrong turn still looks like the same place.
await writeFile(path.join(out,'404.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>notas: not found</title>'+
  '<style>:root{--paper:#F5F5F7;--graphite:#1C1C1E;--ink-2:rgba(60,60,67,.62);--blue:#3670B2}'+
  '@media(prefers-color-scheme:dark){:root{--paper:#151517;--graphite:#F2F2F4;--ink-2:rgba(235,235,245,.6);--blue:#7FB0E8}}'+
  'html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--paper);color:var(--graphite);'+
  'font:400 16px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}'+
  'main{text-align:center;padding:24px}h1{font-size:22px;font-weight:600;line-height:1.3;margin:0 0 8px;letter-spacing:-.01em}p{margin:0;color:var(--ink-2)}'+
  'a{color:var(--blue);text-decoration:none;border-bottom:1px solid currentColor}a:hover{opacity:.8}</style>'+
  '<main><h1>nothing here.</h1><p>that page does not exist. <a href="/">back to the notebook</a></p></main></html>\n');

// remove stale copies
async function walk(dir){
  const list=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())list.push(...await walk(full));else list.push(full);
  }
  return list;
}
let removed=0;
for(const file of await walk(out)){
  const rel=path.relative(out,file).split(path.sep).join('/');
  if(rel==='_headers'||rel==='_redirects'||rel==='404.html'||wanted.has(rel))continue;
  // Older open pages may first request a model long after a deploy. Keep
  // immutable model/font payloads; mutable manifests still follow this build.
  if(/^assets\//.test(rel)&&/\.(?:onnx|bin|wasm|woff2?|ttf)$/.test(rel))continue;
  await rm(file);removed++;
}

console.log(`synced ${copied} files, ${(bytes/1048576).toFixed(1)} MB into public/${removed?`, removed ${removed} stale`:''}`);
