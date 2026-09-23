import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const productionFiles=[
  'local-recognition.js',
  'notas.html',
  'sw.js',
  'scripts/model-contract.mjs',
  'package.json',
];

test('retired per-symbol math recognizer cannot re-enter production',async()=>{
  const forbidden=[
    /recognition-worker\.js/i,
    /cnn-runtime\.js/i,
    /symbols-cnn\.(?:json|f32)/i,
    /recognizer\s*[:=]\s*['"]fast['"]/i,
  ];
  for(const file of productionFiles){
    const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
    for(const pattern of forbidden)
      assert.equal(pattern.test(source),false,`${file} still references production Fast OCR via ${pattern}`);
  }
});
