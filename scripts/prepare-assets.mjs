// Reproducible, build-time downloads only. The running app uses same-origin files.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const files = [];
async function download(url, target) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(path.join(root, target)), { recursive: true });
  await writeFile(path.join(root, target), bytes);
  files.push(target);
  return bytes.toString();
}
const libs = {
  'idb.js': 'https://cdn.jsdelivr.net/npm/idb-keyval@6.2.1/dist/umd.js',
  'math.js': 'https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.2/math.min.js',
  'katex.js': 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js',
  'rough.js': 'https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js',
  'nerdamer.js': 'https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/nerdamer.core.js',
  'algebra.js': 'https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/Algebra.js',
  'calculus.js': 'https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/Calculus.js',
  'solve.js': 'https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/Solve.js'
};
for (const [name, url] of Object.entries(libs)) await download(url, `assets/${name}`);
// The collaboration bundle is built from npm packages rather than fetched,
// so it is rebuilt here and listed with the other vendored libraries.
await import('./build-collab.mjs');
files.push('assets/collab.js');
for (const [name, url] of Object.entries({
  'katex.css': 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
  'icons.css': 'https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/regular/style.css',
  'fonts.css': 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Caveat:wght@600&display=swap'
})) {
  let css = await download(url, `assets/${name}`);
  const urls = [...new Set([...css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map(m => m[1]))];
  for (const ref of urls) {
    if (ref.startsWith('data:')) continue;
    const remote = new URL(ref, url);
    const local = `assets/fonts/${name.replace('.css','')}-${path.basename(remote.pathname)}`;
    await download(remote.href, local);
    css = css.split(ref).join(`./fonts/${path.basename(local)}`);
  }
  await writeFile(path.join(root, 'assets', name), css);
}
// The ONNX runtime the recognition workers share still lives in assets/smart/
// (the Smart maths model that named the folder is gone). It is deliberately
// absent from this manifest: sw.js stores it the first time it is used.
// Presence is still checked so a rebuild cannot quietly leave the app without it.
for (const name of ['ort.wasm.min.js','ort-wasm-simd-threaded.js','ort-wasm-simd-threaded.wasm']) {
  await readFile(path.join(root,'assets','smart',name));
}
// Handwritten-text search uses PP-OCRv6 small. Its ~20 MB model is precached
// by sw.js so search is available once the app reports "Available offline".
// Keep these checked-in assets intact when rebuilding third-party libraries.
for (const name of ['ppocrv6-small.onnx','ppocrv6_dict.txt']) {
  await readFile(path.join(root,'assets','text',name));
}
// Pen ink is read by the small MIT-licensed Hand-to-TeX encoder/decoder, the
// one maths engine. These models are lazy-cached by the service worker, so
// verify they exist without adding ~18 MB to install.
for (const name of ['encoder.onnx','decoder_step.onnx','vocab.json','HAND-TO-TEX-LICENSE.txt']) {
  await readFile(path.join(root,'assets','ink',name));
}
// Every browser that runs the service worker reads woff2, so the woff, ttf
// and svg fallbacks the icon and KaTeX stylesheets list are never requested.
// Precaching them made "Preparing offline access" carry about 6 MB of fonts
// nobody would load, and the Phosphor svg alone is 3 MB.
const offline = files.filter(f => !/^assets\/fonts\/(?:icons|katex)-.*\.(?:woff|ttf|svg)$/.test(f));
await writeFile(path.join(root, 'asset-manifest.json'), JSON.stringify(offline, null, 2));
console.log(`Prepared ${files.length} assets, retaining the trained CNN.`);
await import('./model-contract.mjs');
