// Pinned npm packages, copied locally so PDF notebooks also work offline.
import {cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'assets/pdf');
await mkdir(out,{recursive:true});
for(const [from,to] of [
  ['pdfjs-dist/build/pdf.min.mjs','pdf.mjs'],['pdfjs-dist/build/pdf.worker.min.mjs','pdf.worker.mjs'],
  ['pdfjs-dist/LICENSE','PDFJS-LICENSE.txt'],['pdf-lib/dist/pdf-lib.min.js','pdf-lib.js'],['pdf-lib/LICENSE.md','PDFLIB-LICENSE.txt']
])await cp(path.join(root,'node_modules',from),path.join(out,to));
for(const dir of ['cmaps','standard_fonts','wasm','iccs'])await cp(path.join(root,'node_modules/pdfjs-dist',dir),path.join(out,dir),{recursive:true});
// qpdf unlocks encrypted PDFs (restricted, or opened with their password) so
// pdf-lib can write the annotated copy. Its notice comes from the build itself,
// with the Apache 2.0 text that also covers PDF.js.
await mkdir(path.join(out,'qpdf'),{recursive:true});
for(const name of ['qpdf.js','qpdf.wasm'])await cp(path.join(root,'node_modules/@neslinesli93/qpdf-wasm/dist',name),path.join(out,'qpdf',name));
const {default:qpdf}=await import(pathToFileURL(path.join(root,'node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.js')).href);
const notice=[],log=console.log;console.log=s=>notice.push(String(s));try{(await qpdf({})).callMain(['--copyright']);}finally{console.log=log;}
await writeFile(path.join(out,'QPDF-LICENSE.txt'),'qpdf 12, compiled to WebAssembly by @neslinesli93/qpdf-wasm 0.3.0 (ISC).\n\n'+notice.join('\n').replace(/^\S+ version /,'qpdf version ')+'\n\n'+await readFile(path.join(root,'node_modules/pdfjs-dist/LICENSE'),'utf8'));
async function files(dir){const list=[];for(const e of await readdir(path.join(root,dir),{withFileTypes:true}))list.push(...(e.isDirectory()?await files(dir+'/'+e.name):[dir+'/'+e.name]));return list;}
const manifest=JSON.parse(await readFile(path.join(root,'asset-manifest.json'),'utf8'));
await writeFile(path.join(root,'asset-manifest.json'),JSON.stringify([...new Set([...manifest.filter(f=>!f.startsWith('assets/pdf/')),...await files('assets/pdf')])],null,2)+'\n');
console.log('Prepared offline PDF assets.');
