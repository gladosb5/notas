import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block'});
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.nota?.Writer);
 await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'));
 await page.evaluate(()=>N.tutorial?.finish(false));
 const dollars=await page.evaluate(()=>({
   literal:N.nota.tidy('costs $5 and $10'),escaped:N.nota.tidy('pay \\$5'),
   matches:N.nota.mathMatches('costs $5 and $10; $x+2$ and \\(y=3\\)').map(m=>m[2]??m[3]),
   math:N.nota.tidy('The value is $x+2$.',true)
 }));
 assert.deepEqual(dollars,{literal:'costs $5 and $10',escaped:'pay $5',matches:['x+2','y=3'],math:'The value is $x+2$.'});
 const layout=await page.evaluate(()=>{
   const S=N.core.S;S.strokes=[];S.images=[];S.lines=[];
   const w=N.nota.Writer({x:30,y:120,rowH:30,instant:true});
   w.feed('costs $5 and ');const currency=w.count;
   w.feed('a very long '+ 'W'.repeat(180)+' ');w.finish();
   const overflow=S.strokes.some(s=>s.bbox[2]>N.core.M.contentW+4);
   S.strokes=[];
   const next=N.nota.Writer({x:30,y:120,rowH:30,instant:true});
   const origin=next.origin;
   S.images.push({id:'new-picture',x:0,y:origin.y-30,w:10000,h:80});
   next.feed('after the picture ');next.finish();
   return {currency,overflow,top:Math.min(...S.strokes.map(s=>s.bbox[1])),bottom:origin.y+50};
 });
 assert.ok(layout.currency>0,'unclosed currency does not stall streaming');
 assert.equal(layout.overflow,false,'long words wrap within the column');
 assert.ok(layout.top>layout.bottom,'new obstacles are respected before more ink is placed');
 const result=await page.evaluate(()=>{
   const S=N.core.S;S.strokes=[];S.images=[];S.lines=[];
   const writer=N.nota.Writer({x:30,y:120,rowH:30,instant:true});
   writer.feed('$\\frac{1+');const partial=writer.count;
   writer.feed('\\sqrt{9}}{x^{2}}$');const equation=writer.count;
   writer.feed(' equals four.');writer.finish();const all=writer.count;
   const strokes=S.strokes.map(s=>JSON.parse(JSON.stringify(s)));
   N.core.undo();const undo=S.strokes.length;N.core.redo();
   return {partial,equation,all,undo,redo:S.strokes.length,strokes};
 });
 assert.equal(result.partial,0,'incomplete equations wait for the closing delimiter');
 assert.ok(result.equation>0&&result.all>result.equation);assert.equal(result.undo,0);assert.equal(result.redo,result.all);
 assert.ok(result.strokes.every(s=>s.author==='ai'&&s.pts.every(Number.isFinite)));
 const bars=result.strokes.filter(s=>s.pts.length===6&&Math.abs(s.pts[1]-s.pts[4])<.01&&s.pts[3]-s.pts[0]>25);
 assert.ok(bars.length,'a fraction is a real horizontal pen stroke');
 await page.waitForTimeout(700);
 await page.screenshot({path:'test-results/nota-latex.png'});
 const typed=await page.evaluate(()=>{
   const text=N.nota.tidy('A fraction: $\\frac{1}{2}$',true);
   const ln={id:'latex-reply',text,y:400,h:40,tutor:true};N.core.S.lines.push(ln);N.text.render();
   const d=document.querySelector('[data-id="latex-reply"]').parentNode;
   const shown=!!d.querySelector('.katex .mfrac');
   N.ink.setTool('text');N.text.focusLine(ln.id);
   const source=d.firstChild.value,editing=!d.classList.contains('latex');
   d.firstChild.blur();return {shown,source,editing};
 });
 assert.equal(typed.shown,true);assert.equal(typed.source,'A fraction: $\\frac{1}{2}$');assert.equal(typed.editing,true);
 console.log('streamed nested LaTeX becomes editable pen strokes, with undo/redo: ok');
}finally{await browser.close();server.close();}
