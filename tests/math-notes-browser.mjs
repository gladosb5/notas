import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
import {writing,stroke} from './fixtures/math-notes.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
  const page=await browser.newPage({serviceWorkers:'block'});
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>window.N?.recog);
  await page.locator('#local-status').filter({hasText:'handwriting ready.'}).waitFor({state:'attached',timeout:180000});
  const result=await page.evaluate(({normal,touching,colonTouching})=>{
    N.tutorial.finish(false);const S=N.core.S;S.settings.aiOn=false;N.recog.reset();
    const out={};
    for(const [kind,offset] of [['baseline',0],['subscript',16],['superscript',-24]]){
      S.strokes=structuredClone(normal);S.clusters=[];
      // The two i strokes are independent of h and the equals sign.
      for(const st of S.strokes.slice(1,3)){
        for(let i=1;i<st.pts.length;i+=3)st.pts[i]+=offset;
        st.bbox[1]+=offset;st.bbox[3]+=offset;
      }
      const bbox=[Math.min(...S.strokes.map(s=>s.bbox[0])),Math.min(...S.strokes.map(s=>s.bbox[1])),Math.max(...S.strokes.map(s=>s.bbox[2])),Math.max(...S.strokes.map(s=>s.bbox[3]))];
      const canvas=N.recog.textCrop({bbox,strokeIds:S.strokes.map(s=>s.id)});
      out[kind]=N.recog.wordGeometry(canvas,'hi=4');
    }
    // Touching ink has no blank projection column between h/i/operator. Stroke
    // geometry must still corroborate a true baseline while rejecting a shifted
    // i that is genuinely subscript or superscript.
    for(const [kind,offset] of [['touchingBaseline',0],['touchingSubscript',16],['touchingSuperscript',-24]]){
      S.strokes=structuredClone(touching);S.clusters=[];
      for(const st of S.strokes.slice(1,3)){
        for(let i=1;i<st.pts.length;i+=3)st.pts[i]+=offset;
        st.bbox[1]+=offset;st.bbox[3]+=offset;
      }
      const group={strokeIds:S.strokes.map(s=>s.id),bbox:[Math.min(...S.strokes.map(s=>s.bbox[0])),Math.min(...S.strokes.map(s=>s.bbox[1])),Math.max(...S.strokes.map(s=>s.bbox[2])),Math.max(...S.strokes.map(s=>s.bbox[3]))]};
      out[kind]=N.recog.wordGeometry(N.recog.textCrop(group),'hi=4',group);
    }
    // A pair of colon dots may be physically close to the baseline letters.
    // Even if the independent stroke geometry still corroborates hi and '=',
    // reconciliation must preserve a formula decoder's explicit h:i LHS.
    S.strokes=structuredClone(colonTouching);S.clusters=[];
    const colonGroup={strokeIds:S.strokes.map(s=>s.id),bbox:[Math.min(...S.strokes.map(s=>s.bbox[0])),Math.min(...S.strokes.map(s=>s.bbox[1])),Math.max(...S.strokes.map(s=>s.bbox[2])),Math.max(...S.strokes.map(s=>s.bbox[3]))]};
    out.colonGeometry=N.recog.wordGeometry(N.recog.textCrop(colonGroup),'hi=4',colonGroup);
    out.colonReading=N.recog.wordReading({latex:'h:i=4',confidence:.2},{text:'hi=4',confidence:.99},out.colonGeometry).latex;
    out.prose=['Pens=3','Pens*4','hello there','today is lesson 3'].map(s=>N.mathcore.readsAsProse(s));
    S.strokes=[];S.lines=[];S.images=[];
    S.clusters=[
      {id:'define',source:'ink',strokeIds:[],bbox:[40,100,200,140],ascii:'xy=3'},
      {id:'use',source:'ink',strokeIds:[],bbox:[40,200,200,240],ascii:'xy*4='}
    ];
    N.mathcore.run();out.scope=S.scope.xy;out.answer=S.nodes.find(n=>n.ref?.id==='use')?.result;
    return out;
  },{normal:writing('hi=4'),touching:writing('hi=4',40,140,'touch',1,.32),
    colonTouching:[...writing('hi=4',40,140,'colon',1,.32),stroke('colon-top',[[58,151],[58,152]],2.8,20),stroke('colon-bottom',[[58,166],[58,167]],2.8,21)]});
  assert.deepEqual(result.baseline,{name:'hi',operator:'='});
  assert.equal(result.subscript,null);assert.equal(result.superscript,null);
  assert.deepEqual(result.touchingBaseline,{name:'hi',operator:'='});
  assert.equal(result.touchingSubscript,null);assert.equal(result.touchingSuperscript,null);
  assert.deepEqual(result.colonGeometry,{name:'hi',operator:'='});assert.equal(result.colonReading,'h:i=4');
  assert.deepEqual(result.prose,[false,false,true,true]);
  assert.equal(result.scope,3);assert.equal(result.answer,'12');
  console.log('Real canvas baseline, touching-script checks and automatic named-variable calculation passed.');
}finally{await browser.close();server.close();}
