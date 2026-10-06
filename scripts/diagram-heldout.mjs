// How often real handwritten maths is mistaken for a drawing. Every held-out
// expression (CROHME 2011/12/14, MathWriting, arith14; never trained on, and
// with no drawings in them) is scaled to an ordinary hand on the page and
// given to the diagram reader on its own, the hardest case: no other writing
// to set the hand's size. Anything it finds is a false drawing, which would
// put a [diagram] block into nota's context.
//   node scripts/diagram-heldout.mjs [stroke height px, default 22] [--show N]
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const D=require('../diagram.js');

const root=path.resolve(import.meta.dirname,'..','experiments','hand-to-tex','data','heldout');
const args=process.argv.slice(2),show=args.includes('--show')?+args[args.indexOf('--show')+1]||10:0;
const target=+(args.find(a=>/^\d+$/.test(a)&&args[args.indexOf(a)-1]!=='--show')||22);
function npy(file){
  const b=readFileSync(file),major=b[6],hl=major===1?b.readUInt16LE(8):b.readUInt32LE(8),start=(major===1?10:12)+hl;
  const header=b.subarray(major===1?10:12,start).toString('latin1');
  if(!/'descr':\s*'<i8'/.test(header))throw Error(file+': expected int64');
  return new BigInt64Array(b.buffer.slice(b.byteOffset+start,b.byteOffset+b.length));
}
if(!existsSync(root)){console.log('SKIPPED: '+root+' is not present (gitignored held-out data).');process.exit(0);}
let total=0,flagged=0;const examples=[];
for(const set of ['crohme11','crohme12','crohme14','mwtest_nb','arith14_test']){
  const dir=path.join(root,set);if(!existsSync(path.join(dir,'samples.npy')))continue;
  const meta=JSON.parse(readFileSync(path.join(dir,'meta.json'),'utf8'));
  const samples=npy(path.join(dir,'samples.npy')),strokes=npy(path.join(dir,'strokes.npy'));
  const raw=readFileSync(path.join(dir,'points.f32')),pts=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length));
  let n=0,f=0;
  for(let i=0;i+1<samples.length;i++){
    const ink=[];
    for(let k=Number(samples[i]);k<Number(samples[i+1]);k++){
      const s=[];for(let p=Number(strokes[k]);p<Number(strokes[k+1]);p++)s.push([pts[p*3],pts[p*3+1]]);
      if(s.length)ink.push(s);
    }
    const hs=ink.map(s=>{const ys=s.map(p=>p[1]);return Math.max(...ys)-Math.min(...ys);}).filter(h=>h>0).sort((a,b)=>a-b);
    const scale=target/(hs[Math.floor(hs.length/2)]||1);
    let x0=Infinity,y0=Infinity;for(const s of ink)for(const p of s){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);}
    const page=ink.map((s,j)=>{
      const q=s.map(p=>[40+(p[0]-x0)*scale,100+(p[1]-y0)*scale]),xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);
      return {id:'s'+j,pts:q.flatMap(p=>[p[0],p[1],.5]),bbox:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
    });
    const found=D.find(page);n++;
    if(found.diagrams.length){f++;if(examples.length<show)examples.push(set+' '+meta.ids[i]+' '+JSON.stringify(meta.labels[i])+'\n   '+D.describe(found.diagrams[0],()=>'w').join('\n   '));}
  }
  console.log(set.padEnd(12),String(f).padStart(4)+' / '+n);
  total+=n;flagged+=f;
}
console.log('false drawings: '+flagged+' / '+total+' ('+(100*flagged/total).toFixed(2)+'%) at '+target+' px strokes');
if(examples.length)console.log(examples.join('\n'));
