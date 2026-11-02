// Tables are the one piece of markdown nota writes. Handwritten, a table is
// held until it has all arrived, then drawn as a person would (frame, rules,
// then the cells) and laid out once, so it never moves; a wide one wraps its
// cells rather than spilling off. Typed, it is set out as aligned columns.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
await mkdir('test-results',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',reducedMotion:'reduce'});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('notas.tut','done');localStorage.setItem('notas.nota.key','csk-test-0123456789');});
 const reply=['Here they are:\n','| fruit | colour |\n','|---|---|\n','| apple | red |\n','| banana | yellow |\n','Both are sweet.'];
 await context.route(/\/nota\/chat$|api\.cerebras\.ai|oxionai\.com/,route=>route.fulfill({status:200,contentType:'text/event-stream',
  body:reply.map(p=>'data: '+JSON.stringify({choices:[{delta:{content:p}}]})+'\n\n').join('')+'data: [DONE]\n\n'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.nota?.Writer&&document.getElementById('preparing').classList.contains('done'));

 /* ---- handwritten ---- */
 const hand=await page.evaluate(reply=>{
  const S=N.core.S;S.lines=[];S.strokes=[];N.text.render();
  const w=N.nota.Writer({x:60,y:140,right:700,rowH:24,skip:new Set()});
  const isRule=st=>{const b=st.bbox,wd=b[2]-b[0],h=b[3]-b[1];return (wd>80&&h<10)||(h>40&&wd<10)||(wd>80&&h>40);};
  const rules=()=>S.strokes.filter(st=>st.author==='ai'&&isRule(st));
  const seen=[];
  for(const piece of reply.slice(0,5)){w.feed(piece);seen.push(rules().length);}
  w.feed(reply[5]);
  const drawn=rules().map(st=>({id:st.id,bbox:st.bbox.slice()}));
  w.finish();
  const after=rules().map(st=>({id:st.id,bbox:st.bbox.slice()}));
  const frame=S.strokes.find(st=>st.author==='ai'&&st.bbox[2]-st.bbox[0]>80&&st.bbox[3]-st.bbox[1]>40);
  const f=frame.bbox,inside=S.strokes.filter(st=>st.author==='ai'&&st!==frame&&!isRule(st)).filter(st=>{const cx=(st.bbox[0]+st.bbox[2])/2,cy=(st.bbox[1]+st.bbox[3])/2;return cx>f[0]&&cx<f[2]&&cy>f[1]&&cy<f[3];});
  const spill=inside.filter(st=>st.bbox[0]<f[0]-2||st.bbox[2]>f[2]+2||st.bbox[1]<f[1]-2||st.bbox[3]>f[3]+2).length;
  const prose=S.strokes.filter(st=>st.author==='ai'&&st.bbox[1]>f[3]).length;
  N.ink.render();
  return {seen,drawn:drawn.length,same:JSON.stringify(drawn)===JSON.stringify(after),cellStrokes:inside.length,spill,prose,frame:f};
 },reply);
 assert.deepEqual(hand.seen,[0,0,0,0,0],'nothing of the table is drawn while rows are still coming');
 assert.ok(hand.drawn>=3,'frame, header rule and the column rule: '+hand.drawn);
 assert.ok(hand.same,'once drawn, the table never moves');
 assert.ok(hand.cellStrokes>20,'the cells are written in: '+hand.cellStrokes);
 assert.equal(hand.spill,0,'every cell stays inside the frame');
 assert.ok(hand.prose>0,'the words after the table come under it');
 await page.screenshot({path:'test-results/nota-table-hand.png'});

 /* a table that arrives in the same piece as the words before it is still a table */
 const together=await page.evaluate(()=>{
  const S=N.core.S;S.strokes=[];
  const w=N.nota.Writer({x:60,y:140,right:700,rowH:24,skip:new Set()});
  w.feed('Here they are:\n| fruit | colour |\n|---|---|\n| apple | red |\nThat is all.');w.finish();
  return S.strokes.filter(st=>{const b=st.bbox,wd=b[2]-b[0],h=b[3]-b[1];return (wd>80&&h<10)||(h>40&&wd<10)||(wd>80&&h>40);}).length;
 });
 assert.ok(together>=3,'a table in one piece with the words before it is drawn as a table: '+together);

 /* a wide table in a narrow space wraps its cells and keeps inside */
 const narrow=await page.evaluate(()=>{
  const S=N.core.S;S.strokes=[];
  const w=N.nota.Writer({x:60,y:140,right:360,rowH:24,skip:new Set()});
  w.feed('| planet | what it is like | what we have learned |\n|---|---|---|\n| Mars | a cold red desert with dust storms that can cover the whole planet for weeks | it once had rivers and lakes, and robots still drive across it today |\n| Venus | very hot under thick yellow clouds of acid that trap the heat of the sun | its day is longer than its year, and it spins the other way round |\n');
  w.finish();N.ink.render();
  const frame=S.strokes.find(st=>st.bbox[2]-st.bbox[0]>80&&st.bbox[3]-st.bbox[1]>40).bbox;
  /* the writer has the column, from where it starts to the column's edge */
  const room=Math.max(160,N.core.M.contentW-10-60);
  return {width:frame[2]-frame[0],room,out:S.strokes.filter(st=>st.bbox[2]>frame[2]+2).length};
 });
 assert.ok(narrow.width<=narrow.room+4,'the table keeps to the space it has: '+narrow.width+' of '+narrow.room);
 assert.equal(narrow.out,0,'and wraps its words inside it');
 await page.screenshot({path:'test-results/nota-table-wrap.png'});

 /* ---- typed: aligned columns ---- */
 await page.evaluate(()=>{const S=N.core.S;S.strokes=[];S.lines=[];const q=N.text.add(120,false);q.text='hey nota, what colour are apples and bananas?';N.text.render();N.nota.onTyped(q);});
 await page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&/Both are sweet/.test(l.text))&&!N.core.S.lines.some(l=>l.tutor&&l.wait),null,{timeout:10000});
 const typed=await page.evaluate(()=>{
  const red=N.core.S.lines.filter(l=>l.tutor).sort((a,b)=>a.y-b.y).map(l=>l.text);
  const c=document.createElement('canvas').getContext('2d');c.font='400 16px '+getComputedStyle(document.documentElement).getPropertyValue('--type');
  const at=(line,word)=>c.measureText(line.slice(0,line.indexOf(word))).width;
  return {red,cols:[at(red.find(l=>l.includes('colour')),'colour'),at(red.find(l=>l.includes('red')),'red'),at(red.find(l=>l.includes('yellow')),'yellow')]};
 });
 assert.ok(typed.red.some(l=>/^─+\s+─+$/.test(l)),'a rule under the header:\n'+typed.red.join('\n'));
 assert.ok(!typed.red.some(l=>l.includes('|')),'no pipes or dashes from the markdown');
 const [c1,c2,c3]=typed.cols;
 assert.ok(Math.abs(c1-c2)<2&&Math.abs(c2-c3)<2,'the second column starts at the same place on every line: '+typed.cols);
 await page.screenshot({path:'test-results/nota-table-typed.png'});

 assert.deepEqual(errors,[]);
 console.log('nota tables: held until whole, drawn once, cells inside, wrapped when narrow, typed columns aligned: ok');
}finally{await browser.close();server.close();}
