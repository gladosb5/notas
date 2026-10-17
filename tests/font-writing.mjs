import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({serviceWorkers:'block'});
  await page.addInitScript(()=>localStorage.setItem('notas.prefs',JSON.stringify({animations:false})));
  await page.route(/\/assets\/(?:ink|text|smart)\//,route=>route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
  await page.waitForFunction(()=>N?.core?.S.id&&document.querySelector('#preparing').classList.contains('done'));
  await page.evaluate(()=>{N.tutorial.finish(false);N.core.S.settings.aiOn=false;N.ai.toggle();});
  const samples=await page.evaluate(async()=>{
    const out=[],S=N.core.S;
    const bytes=await (await fetch('./assets/fonts/katex-KaTeX_Main-Bold.ttf')).arrayBuffer();
    const imported=await N.notaFonts.importFont(new File([bytes],'imported-bold.ttf'));
    for(const text of ['The page writes back.','The same paragraph should write at the same pace in every font. '.repeat(8),'Working: $x=2$ and $y=3$.'])
    for(const font of ['','caveat','plex','serif','sans',imported.id]){
      await N.notaFonts.select(font);
      S.strokes=[];S.lines=[];S.images=[];S.settings.animations=true;
      const frames=[],raf=window.requestAnimationFrame,render=N.ink.render;
      let clock=performance.now(),paints=0;
      window.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
      N.ink.render=()=>{paints++;};
      const w=N.nota.Writer({x:20,y:100,rowH:30});
      const start=clock;
      try{
        for(const chunk of text.match(/.{1,7}/gs)||[])w.feed(chunk);
        w.finish();
        while(w.drawing&&clock-start<120000){
          clock+=1000/60;
          const work=frames.splice(0);for(const fn of work)fn(clock);
        }
        let distance=0,points=0;
        for(const st of S.strokes){points+=st.pts.length/3;for(let i=3;i<st.pts.length;i+=3)distance+=Math.hypot(st.pts[i]-st.pts[i-3],st.pts[i+1]-st.pts[i-2]);}
        const geometry=S.strokes.map(st=>({pts:st.pts,w:st.w,bbox:st.bbox}));
        for(const st of S.strokes)if('pace' in st)throw Error('animation pacing leaked into saved ink');
        const framesUsed=paints;
        S.strokes=[];
        const instant=N.nota.Writer({x:20,y:100,rowH:30,instant:true});instant.feed(text);instant.finish();
        const unchanged=JSON.stringify(geometry)===JSON.stringify(S.strokes.map(st=>({pts:st.pts,w:st.w,bbox:st.bbox})));
        out.push({sample:text.length,font:font===imported.id?'imported bold':font||'original',ms:Math.round(clock-start),distance:Math.round(distance),points,strokes:S.strokes.length,paints:framesUsed,finished:!w.drawing,unchanged});
      }finally{window.requestAnimationFrame=raf;N.ink.render=render;}
    }
    return out;
  });
  console.table(samples);
  for(const sample of samples){
    const original=samples.find(s=>s.sample===sample.sample&&s.font==='original');
    assert.equal(sample.finished,true,sample.font+' finishes writing');
    assert.equal(sample.unchanged,true,sample.font+' retains the exact saved ink geometry');
    assert.ok(sample.ms<=original.ms*1.15+50,sample.font+' stays within the original hand’s writing budget');
  }
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
