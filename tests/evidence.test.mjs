import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {staleDependency} from '../scripts/evidence-provenance.mjs';
test('timestamps cannot launder missing or changed content provenance',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'notas-evidence-'));
  try{
    fs.writeFileSync(path.join(root,'worker'),'a');fs.writeFileSync(path.join(root,'result'),'{}');
    const data={provenance:{worker:createHash('sha256').update('a').digest('hex')}};
    const old=new Date(1000),fresh=new Date(2000);
    fs.utimesSync(path.join(root,'worker'),old,old);fs.utimesSync(path.join(root,'result'),fresh,fresh);
    assert.equal(staleDependency(root,'result',data,['worker']),undefined);
    assert.equal(staleDependency(root,'result',{},['worker']),'worker');
    fs.writeFileSync(path.join(root,'worker'),'b');fs.utimesSync(path.join(root,'worker'),old,old);
    assert.equal(staleDependency(root,'result',data,['worker']),'worker');
    fs.writeFileSync(path.join(root,'worker'),'a');fs.utimesSync(path.join(root,'worker'),new Date(3000),new Date(3000));
    assert.equal(staleDependency(root,'result',data,['worker']),'worker');
    assert.equal(staleDependency(root,'result',data,['missing']),'missing');
  }finally{for(const file of ['worker','result'])fs.unlinkSync(path.join(root,file));fs.rmdirSync(root);}
});
