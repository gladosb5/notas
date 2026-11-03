import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {startServer} from '../scripts/serve.mjs';
import fixtures from './fixtures/ink-refine.cjs';
import refine from '../ink-refine.js';

const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const errors=[],words=fixtures.writing(['the','quick','fox'],{x:45,y:230,tilt:6,wobble:[-3,5,-3],scales:[.9,1.12,.95],jitter:1,letterWobble:[[-1,1,0],[1,-1,1,-1,0],[-1,1,-1]],letterScales:[[.96,1.04,1],[1.04,.96,1.03,.97,1],[.96,1.04,1]]});
const points=page=>page.evaluate(()=>N.core.S.strokes.map(st=>({id:st.id,pts:st.pts})));
function baselineStats(strokes,wordIds){
  const byId=new Map(strokes.map(st=>[st.id,st]));
  const metrics=wordIds.map(ids=>refine.wordMetrics(ids.map(id=>{assert.ok(byId.has(id));return byId.get(id);})));
  const xs=metrics.map(m=>m.cx),ys=metrics.map(m=>m.baseline),mx=xs.reduce((a,b)=>a+b)/xs.length,my=ys.reduce((a,b)=>a+b)/ys.length;
  const slope=xs.reduce((sum,x,i)=>sum+(x-mx)*(ys[i]-my),0)/xs.reduce((sum,x)=>sum+(x-mx)**2,0);
  return {spread:Math.max(...ys)-Math.min(...ys),tilt:Math.atan(slope)*180/Math.PI};
}
async function open(refineInk=true){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1100,height:850}});
  await context.addInitScript(refineInk=>localStorage.setItem('notas.prefs',JSON.stringify({refineInk,handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:false})),refineInk);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.recog&&document.querySelector('#preparing').classList.contains('done'));
  await page.evaluate(()=>{N.tutorial.finish(false);N.ink.setTool('pen');});
  return page;
}
async function draw(page){
  for(const st of words.flat()){
    const path=await page.evaluate(pts=>{
      const sc=document.querySelector('#scroller'),r=sc.getBoundingClientRect(),M=N.core.M,out=[];
      for(let i=0;i<pts.length;i+=3)out.push([r.left+M.colLeft+pts[i]*M.zoom-sc.scrollLeft,r.top+pts[i+1]*M.zoom-sc.scrollTop]);
      return out;
    },st.pts);
    await page.mouse.move(...path[0]);await page.mouse.down();
    for(const p of path.slice(1))await page.mouse.move(...p);
    await page.mouse.up();
  }
  await page.evaluate(()=>{N.ink.flush();N.recog.rebuild();});
  assert.equal((await points(page)).length,words.flat().length,'real pointer events commit every glyph stroke');
}
async function transcript(page,text='the quick fox'){
  return page.evaluate(text=>{
    const S=N.core.S,groups=N.recog.textGroups();
    if(groups.length!==1)throw Error('Expected one text line: '+JSON.stringify(groups));
    const group=groups[0];
    S.textTranscripts=[{hash:group.hash,text,confidence:.99,bbox:group.bbox,modelVersion:N.recog.textVersion}];
    return group.hash;
  },text);
}
try{
  const page=await open();await draw(page);
  const before=await points(page),drawSteps=await page.evaluate(()=>N.core.Undo.back.length);
  // Pointer strokes commit in fixture order; keep those word boundaries after moving.
  let at=0;const wordIds=words.map(word=>{const ids=before.slice(at,at+word.length).map(st=>st.id);at+=word.length;return ids;});
  assert.equal(at,before.length);
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('../test-results/ink-refine-before.png',import.meta.url))});
  await page.evaluate(()=>{N.core.S.selection=[N.core.S.strokes[0].id];});
  await page.evaluate(()=>{
    const spinner=document.createElement('span');spinner.id='refine-spinner';spinner.className='dl-spin';document.body.append(spinner);
  });
  await page.waitForFunction(()=>document.querySelector('#refine-spinner').getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations===Infinity));
  const hash=await transcript(page);
  await page.waitForTimeout(900);assert.deepEqual(await points(page),before,'selected lines wait');
  await page.evaluate(()=>{N.core.S.selection=[];});
  await page.waitForFunction(steps=>N.core.Undo.back.length===steps+1,drawSteps,{timeout:6000});
  const after=await points(page);assert.notDeepEqual(after,before,'recognised fresh ink changes');
  const baselineBefore=baselineStats(before,wordIds),baselineAfter=baselineStats(after,wordIds);
  console.log('Ground-truth word baselines:',JSON.stringify({before:baselineBefore,after:baselineAfter}));
  assert.ok(baselineAfter.spread<baselineBefore.spread*.4,'word baseline spread falls by more than 60%');
  assert.ok(Math.abs(baselineAfter.tilt)<1,'line tilt is below one degree');
  assert.ok(await page.evaluate(()=>document.querySelector('#refine-spinner').getAnimations().some(a=>a.playState==='running')),'unrelated infinite animation does not stall refinement');
  await page.locator('#refine-spinner').evaluate(el=>el.remove());
  assert.equal(await page.evaluate(()=>N.core.Undo.back.at(-1).label),'neaten handwriting');
  assert.ok(await page.evaluate(old=>{
    const group=N.recog.textGroups()[0];return group.hash!==old&&N.core.S.textTranscripts.some(t=>t.hash===group.hash&&t.text==='the quick fox');
  },hash),'transcript follows the new group hash');
  await page.screenshot({path:fileURLToPath(new URL('../test-results/ink-refine-after.png',import.meta.url))});
  await page.evaluate(()=>N.core.undo());assert.deepEqual(await points(page),before,'one undo restores every original sample');
  assert.ok(await page.evaluate(()=>N.core.S.textTranscripts.some(t=>t.hash===N.recog.textGroups()[0].hash)),'undo retains searchable text');
  await page.waitForTimeout(1500);assert.deepEqual(await points(page),before,'undo is not refined again');
  await page.evaluate(()=>N.core.redo());assert.deepEqual(await points(page),after,'redo reapplies exactly');
  assert.ok(await page.evaluate(()=>N.core.S.textTranscripts.some(t=>t.hash===N.recog.textGroups()[0].hash)),'redo retains searchable text');
  await page.locator('#btn-menu').click();
  for(const width of [1100,390]){
    await page.setViewportSize({width,height:850});
    const row=page.locator('#seg-refine');await row.scrollIntoViewIfNeeded();
    assert.equal(await row.locator('[data-v="1"]').getAttribute('aria-pressed'),'true');
    const bounds=await row.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,'setting fits the viewport');
    await page.screenshot({path:fileURLToPath(new URL(`../test-results/ink-refine-settings-${width}.png`,import.meta.url))});
  }
  await page.locator('#seg-refine [data-v="0"]').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('notas.prefs')).refineInk),false,'setting saves as a device preference');
  await page.context().close();

  for(const [enabled,text] of [[false,'the quick fox'],[true,'2+3=']]){
    const page=await open(enabled);await draw(page);const before=await points(page);
    await transcript(page,text);await page.waitForTimeout(1500);
    assert.deepEqual(await points(page),before,enabled?'maths stays as drawn':'disabled neatening leaves ink alone');
    await page.context().close();
  }
  assert.deepEqual(errors,[]);
  console.log('Ink refine: level word baselines, real mouse ink, unrelated infinite animation, transcript carryover, one-step undo/redo, no repeat after undo, disabled preference and maths exclusion pass; no page errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
