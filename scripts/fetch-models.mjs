// Downloads the model binaries that are too large to keep in git, and checks
// each against the sha256 pinned in model-contract.js. Files already present
// with the right hash are left alone, so this is cheap to run before start/test.
// Set NOTAS_MODELS_URL to fetch from a mirror (e.g. a GitHub release) instead.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const base = (process.env.NOTAS_MODELS_URL || 'https://notas.glados.pro/').replace(/\/?$/, '/');
const models = [
  'assets/ink/encoder.onnx',
  'assets/ink/decoder_step.onnx',
  'assets/text/ppocrv6-small.onnx',
  'assets/smart/ort-wasm-simd-threaded.wasm'
];
const src = await readFile(path.join(root, 'model-contract.js'), 'utf8');
const contract = JSON.parse(src.slice(src.indexOf('=') + 1, src.lastIndexOf(';')));
const pinned = Object.assign({}, ...Object.values(contract).map(c => c.hashes));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of models) {
  const target = path.join(root, file);
  const have = await readFile(target).catch(() => null);
  if (have && sha(have) === pinned[file]) continue;
  // the release upload flattens folders, so a mirror is tried by basename too
  const urls = process.env.NOTAS_MODELS_URL ? [base + path.basename(file), base + file] : [base + file];
  let bytes = null;
  for (const url of urls) {
    process.stdout.write(`fetching ${url} ... `);
    const res = await fetch(url);
    if (res.ok) { bytes = Buffer.from(await res.arrayBuffer()); console.log(`${(bytes.length / 1048576).toFixed(1)} MB`); break; }
    console.log(res.status);
  }
  if (!bytes) throw new Error(`could not download ${file}`);
  if (sha(bytes) !== pinned[file]) throw new Error(`${file}: sha256 does not match model-contract.js (the source may be serving a newer model)`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target + '.part', bytes);
  await rename(target + '.part', target);
}
console.log('models ready');
