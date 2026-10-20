// Pinned npm packages, copied locally so PDF notebooks also work offline.
import {cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'assets/pdf');
await mkdir(out,{recursive:true});
for(const [from,to] of [
  ['pdfjs-dist/build/pdf.min.mjs','pdf.mjs'],['pdfjs-dist/build/pdf.worker.min.mjs','pdf.worker.mjs'],
  ['pdfjs-dist/LICENSE','PDFJS-LICENSE.txt'],['pdf-lib/dist/pdf-lib.min.js','pdf-lib.js'],['pdf-lib/LICENSE.md','PDFLIB-LICENSE.txt']
])await cp(path.join(root,'node_modules',from),path.join(out,to));
for(const dir of ['cmaps','standard_fonts','wasm','iccs'])await cp(path.join(root,'node_modules/pdfjs-dist',dir),path.join(out,dir),{recursive:true});
async function files(dir){const list=[];for(const e of await readdir(path.join(root,dir),{withFileTypes:true}))list.push(...(e.isDirectory()?await files(dir+'/'+e.name):[dir+'/'+e.name]));return list;}
const manifest=JSON.parse(await readFile(path.join(root,'asset-manifest.json'),'utf8'));
await writeFile(path.join(root,'asset-manifest.json'),JSON.stringify([...new Set([...manifest.filter(f=>!f.startsWith('assets/pdf/')),...await files('assets/pdf')])],null,2)+'\n');
console.log('Prepared offline PDF assets.');
