import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({serviceWorkers:'block'});
const page=await context.newPage();
try{
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.recog?.textConfidenceMin);
  const threshold=await page.evaluate(()=>N.recog.textConfidenceMin);
  const rows=await page.evaluate(async()=>{
    const worker=new Worker('./text-worker.js');let seq=0;
    const send=(payload,transfer=[])=>new Promise((resolve,reject)=>{
      const id=++seq;
      const on=e=>{if(e.data.id!==id)return;worker.removeEventListener('message',on);e.data.error?reject(new Error(e.data.error)):resolve(e.data);};
      worker.addEventListener('message',on);worker.postMessage({...payload,id},transfer);
    });
    await send({type:'setup'});
    const make=draw=>{
      const cv=document.createElement('canvas');cv.width=360;cv.height=96;
      const x=cv.getContext('2d');x.fillStyle='white';x.fillRect(0,0,cv.width,cv.height);x.strokeStyle='#111';x.fillStyle='#111';x.lineWidth=4;x.lineCap='round';x.lineJoin='round';draw(x,cv);
      return cv;
    };
    const fixtures={
      plus:x=>{x.beginPath();x.moveTo(120,48);x.lineTo(200,48);x.moveTo(160,15);x.lineTo(160,81);x.stroke();},
      equals:x=>{x.beginPath();x.moveTo(100,35);x.lineTo(220,35);x.moveTo(100,61);x.lineTo(220,61);x.stroke();},
      axes:x=>{x.beginPath();x.moveTo(20,48);x.lineTo(340,48);x.moveTo(180,8);x.lineTo(180,88);x.stroke();},
      arrow:x=>{x.beginPath();x.moveTo(50,48);x.lineTo(300,48);x.lineTo(270,25);x.moveTo(300,48);x.lineTo(270,71);x.stroke();},
      circle:x=>{x.beginPath();x.arc(180,48,35,0,Math.PI*2);x.stroke();},
      grid:x=>{x.beginPath();for(let a=60;a<=300;a+=60){x.moveTo(a,8);x.lineTo(a,88);}for(let b=20;b<=80;b+=20){x.moveTo(20,b);x.lineTo(340,b);}x.stroke();},
      scribble:x=>{x.beginPath();x.moveTo(35,70);for(let i=0;i<18;i++)x.lineTo(45+i*16,i%2?18:76);x.stroke();},
      math:x=>{x.beginPath();x.moveTo(40,25);x.lineTo(80,70);x.moveTo(80,25);x.lineTo(40,70);x.moveTo(110,48);x.lineTo(155,48);x.moveTo(132,25);x.lineTo(132,72);x.moveTo(190,36);x.lineTo(250,36);x.moveTo(190,60);x.lineTo(250,60);x.stroke();}
    };
    const out=[];
    for(const [name,draw] of Object.entries(fixtures)){
      const cv=make(draw),pixels=cv.getContext('2d').getImageData(0,0,cv.width,cv.height);
      const row=await send({type:'recognize',width:cv.width,height:cv.height,buffer:pixels.data.buffer},[pixels.data.buffer]);
      out.push({name,text:row.text,confidence:row.confidence});
    }
    worker.terminate();return out;
  });
  console.log(JSON.stringify(rows,null,2));
  const iam=JSON.parse(await readFile(new URL('../experiments/ocrv6-small/results-iam100.json',import.meta.url),'utf8'));
  const retention=iam.rows.filter(r=>r.confidence>=threshold).length;
  const falsePositives=rows.filter(r=>Number(r.confidence)>=threshold&&/[\p{L}\p{N}]/u.test(String(r.text||'')));
  assert.ok(retention>=90,`OCR noise floor keeps at least 90/100 IAM handwriting lines, got ${retention}`);
  assert.deepEqual(falsePositives,[],`Noise fixtures must not become searchable text at threshold ${threshold}`);
  console.log(`OCR noise calibration passed at ${threshold}: IAM ${retention}/100 retained, 0/${rows.length} negative text false positives`);
}finally{
  await context.close();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
