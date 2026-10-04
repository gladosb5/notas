import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {startServer} from '../scripts/serve.mjs';
const source=readFileSync(new URL('./fixtures/projected-slide.png',import.meta.url));
const server=await startServer(0),browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
  const page=await browser.newPage({serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto((process.env.NOTAS_BASE_URL||`http://127.0.0.1:${server.address().port}`)+'/notas.html');
  await page.waitForFunction(()=>window.N?.ink?.removeBackground&&N.ui?.insertImages);
  const result=await page.evaluate(async src=>{
    const blob=new Blob([Uint8Array.from(atob(src.slice(src.indexOf(',')+1)),c=>c.charCodeAt(0))],{type:'image/png'});
    await N.ui.insertImages([new File([blob],'projected-slide.png',{type:'image/png'})]);
    const im=N.core.S.images.at(-1),ok=await N.ink.removeBackground(im.id);
    const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=im.full;});
    const c=document.createElement('canvas');c.width=c.height=512;
    const ctx=c.getContext('2d');ctx.drawImage(image,0,0,512,512);
    const rgba=ctx.getImageData(0,0,512,512).data;
    let intersection=0,union=0,marginPixels=0,marginOpaque=0,wallPixels=0,wallClear=0;
    for(let y=0;y<512;y++)for(let x=0;x<512;x++){
      // Approximate hand-reviewed outer projection, independent of the model.
      const expected=x>=6-y*.009&&x<=504+y*.01&&y>=26-x*.07&&y<=462-x*.01;
      const alpha=rgba[(y*512+x)*4+3],actual=alpha>=128;
      if(actual&&expected)intersection++;if(actual||expected)union++;
      if(x>20&&x<100&&y>45&&y<90){marginPixels++;if(alpha>250)marginOpaque++;}
      if(x>30&&x<480&&y>475){wallPixels++;if(alpha<5)wallClear++;}
    }
    return {ok,iou:intersection/union,margin:marginOpaque/marginPixels,wall:wallClear/wallPixels,crop:im.crop,src:im.src};
  },'data:image/png;base64,'+source.toString('base64'));
  assert.ok(result.ok);
  assert.ok(result.iou>.97,'retain the complete projected surface');
  assert.equal(result.margin,1,'no holes in the plain slide margin');
  assert.equal(result.wall,1,'remove the strip of wall below');
  assert.ok(result.crop.b<.93,'autocrop follows the slide bottom');
  assert.deepEqual(errors,[]);
  mkdirSync(new URL('../test-results/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../test-results/slide-surface-cutout.png',import.meta.url),Buffer.from(result.src.split(',')[1],'base64'));
  console.log({...result,src:'test-results/slide-surface-cutout.png'});
}finally{await browser.close();server.close();}
