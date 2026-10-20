import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
import {writing} from './fixtures/math-notes.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:false}));
   window.__readerStarts=0;window.Worker=new Proxy(Worker,{construct(target,args){window.__readerStarts++;return Reflect.construct(target,args);}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.mathcore?.harden()&&document.querySelector('#preparing').classList.contains('done'));
  await page.evaluate(()=>{N.tutorial.finish(false);N.core.S.settings.aiOn=false;N.ai.toggle();N.core.S.settings.handwritingRecognitionOn=true;N.ink.setTool('select');});
  const seed=async(expressions,confirmed=true)=>page.evaluate(({expressions,confirmed,strokes})=>{
   const S=N.core.S;N.recog.reset();S.lines=[];S.strokes=strokes;S.clusters=[];S.textTranscripts=[];N.recog.rebuild();
   const clusters=S.clusters.slice().sort((a,b)=>a.bbox[1]-b.bbox[1]);
   if(clusters.length!==expressions.length)throw Error('fixture grouping');
   for(let i=0;i<clusters.length;i++){
    const cl=clusters[i],src=expressions[i];
    Object.assign(cl,{ascii:src,latex:'',confidence:.99,confirmed,asked:false,review:false,pending:false,modelVersion:N.recog.resultVersion});
    N.recog.cache.set(cl.hash,{ascii:src,latex:'',confidence:.99,confirmed,asked:false,modelVersion:N.recog.resultVersion});
   }
   S.textTranscripts=N.recog.textGroups().map((g,i)=>({hash:g.hash,bbox:g.bbox,text:expressions[i],confidence:.99,modelVersion:N.recog.textVersion}));
   N.text.render();N.ink.render();N.mathcore.run();N.ink.clearSelection();
   return clusters.map(c=>({id:c.id,bbox:c.bbox,hash:c.hash}));
  },{expressions,confirmed,strokes:expressions.flatMap((_,i)=>writing('61+1=',40,160+i*130,'lasso-'+i,.8))});
  const lasso=async boxes=>{
   const box=[Math.min(...boxes.map(b=>b[0]))-12,Math.min(...boxes.map(b=>b[1]))-12,Math.max(...boxes.map(b=>b[2]))+12,Math.max(...boxes.map(b=>b[3]))+12];
   const points=await page.evaluate(b=>{N.ink.setTool('select');const sc=document.querySelector('#scroller'),M=N.core.M;sc.scrollTo({top:Math.max(0,b[1]*M.zoom-100),behavior:'instant'});const r=sc.getBoundingClientRect();return [[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]].map(([x,y])=>({x:r.left+M.colLeft+x*M.zoom-sc.scrollLeft,y:r.top+y*M.zoom-sc.scrollTop}));},box);
   await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();
   for(const p of points.slice(1))await page.mouse.move(p.x,p.y,{steps:8});
   await page.mouse.up();await page.locator('#selbar').waitFor({state:'visible'});
  };
  const solve=async()=>{await page.locator('#selbar button').filter({hasText:'solve this'}).click();};
  for(const confirmed of [true,false]){
   const [a,b]=await seed(['pens = 3','pens x 4 ='],confirmed);
   await lasso([a.bbox]);await solve();
   assert.ok(await page.evaluate(id=>N.core.S.nodes.some(n=>n.id===id&&n.provides==='pens'&&n.result==='3'),a.id),'lasso Solve defines pens without discarding its reading');
   await lasso([b.bbox]);await solve();
   assert.equal(await page.locator(`#margin .chip[data-node="${b.id}"]`).textContent(),'12','lasso Solve writes 12 next to the handwritten use');
   assert.equal(await page.evaluate(()=>N.core.S.clusters.find(c=>c.ascii==='pens x 4 =')?.confirmed),confirmed,'a manual correction is preserved');
   assert.equal(await page.evaluate(hash=>N.recog.cache.get(hash).asked,b.hash),true,'Solve is retained in the saved reading');
   await page.evaluate(()=>N.recog.rebuild());await page.evaluate(()=>N.mathcore.run());
   assert.equal(await page.locator(`#margin .chip[data-node="${b.id}"]`).textContent(),'12','rebuilding handwriting keeps the solved answer');
  }
  const both=await seed(['pens = 3','pens x 4 =']);await lasso(both.map(c=>c.bbox));await solve();
  assert.ok(await page.evaluate(()=>N.core.S.nodes.some(n=>n.result==='12')),'one selection solves both rows in reading order');
  const [unknown]=await seed(['pens x 4 =']);await lasso([unknown.bbox]);await solve();
  assert.equal(await page.locator('#toast').textContent(),'pens has no value yet','an unavailable definition gives feedback after an explicit Solve');
  // The grouped calculation must unlock the tutorial through lasso Solve too.
  await page.evaluate(()=>N.tutorial.start(true));await page.locator('.tut-next').click();
  const [first]=await seed(['12 x 7']);await lasso([first.bbox]);await solve();
  await page.locator('.tut-next').click();
  assert.equal(await page.locator('.tut').getAttribute('data-step'),'1');
  const [grouped]=await seed(['(12 / 2) + 6 * 4 =']);
  assert.equal(await page.locator('.tut-next').isDisabled(),true,'the grouped expression needs Solve');
  await lasso([grouped.bbox]);await solve();
  assert.equal(await page.locator(`#margin .chip[data-node="${grouped.id}"]`).textContent(),'30');
  assert.equal(await page.locator('.tut-next').isDisabled(),false,'lasso Solve unlocks the grouped calculation lesson');
  await page.locator('.tut-next').click();
  assert.equal(await page.locator('.tut').getAttribute('data-step'),'2','the tutorial reaches Hey Nota');
  assert.equal(await page.evaluate(()=>window.__readerStarts),0,'existing readings never restart either handwriting model');
  assert.deepEqual(errors,[]);
  console.log(`Lasso Solve: named definitions, trailing equals, corrections, multiple rows and saved readings pass at ${width}px`);
  await context.close();
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
