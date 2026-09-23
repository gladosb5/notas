import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function staleDependency(root,result,data,dependencies){
  const resultTime=fs.statSync(path.join(root,result)).mtimeMs;
  return dependencies.find(file=>{
    const full=path.join(root,file);
    return !fs.existsSync(full)||resultTime<fs.statSync(full).mtimeMs||data.provenance?.[file]!==createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  });
}
