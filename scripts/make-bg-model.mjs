// Splits the background remover's weights into the chunks the site serves,
// and writes the manifest the worker checks them against.
//
//   node scripts/make-bg-model.mjs path/to/onnx/model.onnx path/to/ort-wasm-simd-threaded.asyncify.wasm
//
// The second file is the WebAssembly binary of the ONNX Runtime Web 1.24.3
// WebGPU build (onnxruntime-web/dist/). It is 27 MB, over the same limit, so it is
// cut the same way and the worker joins it. The build's script beside it,
// ort-wasm-simd-threaded.asyncify.mjs, is copied to assets/smart/ as .js.
//
// The weights are the fp32 export of studioludens/birefnet-lite-512 (MIT) at
// the revision pinned below, which is the file to download from
// https://huggingface.co/studioludens/birefnet-lite-512/resolve/<revision>/onnx/model.onnx.
// Static hosts cap a file at 25 MiB, so the model is cut into 20 MiB parts;
// each part and the assembled model carry a SHA-256.
import {readFileSync,writeFileSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

const REVISION='962e67969ec6acec9c19fab76acee4f5e22e990c';
const UPSTREAM_SHA='1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2';
const PART=20*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

const [source,runtimeSource]=process.argv.slice(2);
if(!source||!runtimeSource)throw Error('usage: node scripts/make-bg-model.mjs path/to/model.onnx path/to/ort-wasm-simd-threaded.asyncify.wasm');
const model=readFileSync(source),digest=sha(model);
if(digest!==UPSTREAM_SHA)throw Error('that is not the pinned fp32 model (sha256 '+digest+')');

const dir=path.resolve('assets/bg');
mkdirSync(dir,{recursive:true});
for(const name of readdirSync(dir))if(name.endsWith('.bin'))rmSync(path.join(dir,name));
const tag=digest.slice(0,12),parts=[];
for(let at=0,i=0;at<model.length;at+=PART,i++){
  const chunk=model.subarray(at,at+PART),file='birefnet-'+tag+'.'+i+'.bin';
  writeFileSync(path.join(dir,file),chunk);
  parts.push({file,bytes:chunk.length,sha256:sha(chunk)});
}
const manifest={version:1,sha:digest,sha256:digest,url:'./assets/bg/model.json?v='+tag,bytes:model.length,parts,
  input_size:512,input:'input_image',output:'output_image',weights:'fp32',
  source:'https://huggingface.co/studioludens/birefnet-lite-512',revision:REVISION};
writeFileSync(path.join(dir,'model.json'),JSON.stringify(manifest,null,2)+'\n');

// the runtime binary, in assets/smart/ beside the rest of the runtime
const wasm=readFileSync(runtimeSource),wasmSha=sha(wasm),smart=path.resolve('assets/smart'),wasmTag=wasmSha.slice(0,8),wasmParts=[];
for(const name of readdirSync(smart))if(/^ort-wasm-simd-threaded\.asyncify\.[0-9a-f]+\.\d+\.bin$/.test(name))rmSync(path.join(smart,name));
const half=Math.ceil(wasm.length/2);
for(let at=0,i=0;at<wasm.length;at+=half,i++){
  const chunk=wasm.subarray(at,at+half),file='ort-wasm-simd-threaded.asyncify.'+wasmTag+'.'+i+'.bin';
  writeFileSync(path.join(smart,file),chunk);
  wasmParts.push({file,bytes:chunk.length,sha256:sha(chunk)});
}
const runtime={version:'1.24.3',sha256:wasmSha,bytes:wasm.length,parts:wasmParts};
writeFileSync(path.join(dir,'model.js'),'self.NOTAS_BG_MODEL='+JSON.stringify(manifest)+';\nself.NOTAS_BG_RUNTIME='+JSON.stringify(runtime)+';');
console.log(parts.length+' parts, '+model.length+' bytes, '+tag+'; runtime '+wasmParts.length+' parts, '+wasmTag);
