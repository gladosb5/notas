// Promote an exported stroke model (encoder.onnx + decoder_step.onnx, the
// int8 pair export_candidate.py writes) into the app:
//   node scripts/promote-ink-model.mjs <dir-with-onnx> <recognition-version>
// Copies the files into assets/ink/, rewrites the content-addressed ?v= URLs
// in ink-worker.js, bumps MODEL_VERSION in local-recognition.js and the
// service-worker cache name, then restamps model-contract.js. Tests and the
// deploy are left to the caller.
import {copyFile, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !/^recognition-v\d+$/.test(version || '')) throw new Error('usage: node scripts/promote-ink-model.mjs <onnx dir> recognition-vN');
const root = path.resolve(import.meta.dirname, '..');
const short = async file => createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 8);

for (const name of ['encoder.onnx', 'decoder_step.onnx']) {
  await copyFile(path.join(dir, name), path.join(root, 'assets/ink', name));
}
let worker = await readFile(path.join(root, 'ink-worker.js'), 'utf8');
for (const name of ['encoder.onnx', 'decoder_step.onnx']) {
  const hash = await short(path.join(root, 'assets/ink', name));
  const re = new RegExp(`'${name.replace('.', '\\.')}\\?v=[0-9a-f]+'`);
  if (!re.test(worker)) throw new Error('ink-worker.js has no versioned URL for ' + name);
  worker = worker.replace(re, `'${name}?v=${hash}'`);
  console.log(name, '->', hash);
}
await writeFile(path.join(root, 'ink-worker.js'), worker);

const recog = path.join(root, 'local-recognition.js');
let source = await readFile(recog, 'utf8');
const versionRe = /const MODEL_VERSION='recognition-v\d+:'/;
if (!versionRe.test(source)) throw new Error('MODEL_VERSION not found');
source = source.replace(versionRe, `const MODEL_VERSION='${version}:'`);
await writeFile(recog, source);

const sw = path.join(root, 'sw.js');
let swSource = await readFile(sw, 'utf8');
swSource = swSource.replace(/const CACHE='notas-local-v(\d+)';/, (m, n) => `const CACHE='notas-local-v${Number(n) + 1}';`);
await writeFile(sw, swSource);
console.log('sw cache:', swSource.match(/const CACHE='([^']+)'/)[1], ' model version:', version);

execFileSync('node', [path.join(root, 'scripts/model-contract.mjs')], {stdio: 'inherit'});
console.log('model contract restamped');
