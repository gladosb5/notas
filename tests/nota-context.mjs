// What nota is told about the page: a reading the student dismissed is not
// on it; notes in two columns are read a column at a time; working with a
// reason written beside each step stays read across.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('notas.tut','done'));
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.nota?.context&&window.math&&document.getElementById('preparing').classList.contains('done'));
 const context=setup=>page.evaluate(setup=>{
  const S=N.core.S;S.lines=[];S.strokes=[];S.clusters=[];S.textTranscripts=[];
  const frames=N.recog.frames;N.recog.frames=()=>({ids:new Set(setup.divider?['divider']:[]),boxes:[]});
  for(const [x,y,text] of setup.typed||[]){const ln=N.text.add(y,false);ln.x=x;ln.text=text;}
  for(const c of setup.clusters||[])S.clusters.push({id:c.id,hash:c.id,source:'ink',bbox:c.bbox,ascii:c.ascii,strokeIds:[],confirmed:true,...(c.dismissed?{dismissed:true}:{})});
  if(setup.divider){const pts=[];for(let y=setup.divider[1];y<=setup.divider[2];y+=6)pts.push(setup.divider[0],y,.5);S.strokes.push({id:'divider',author:'user',w:2,t0:1,t1:2,pts,bbox:N.ink.bboxOf(pts)});}
  N.text.render();N.mathcore.run();
  const out=N.nota.context();N.recog.frames=frames;return out;
 },setup);

 /* a reading the student dismissed with the x is not on the page */
 let c=await context({clusters:[{id:'kept',bbox:[20,100,120,130],ascii:'2+2='},{id:'gone',bbox:[20,200,140,230],ascii:'zz9*q',dismissed:true}]});
 assert.match(c,/2\+2=/,'a reading stays');
 assert.doesNotMatch(c,/zz9/,'a dismissed reading is left out');

 /* two columns of notes, words beside words: a column at a time */
 const left=['plants make food','they need light','and water too'],right=['animals eat plants','some eat animals','all need water'];
 c=await context({typed:[...left.map((t,i)=>[0,100+i*30,t]),...right.map((t,i)=>[420,100+i*30,t])]});
 const lines=c.split('\n');
 const at=t=>lines.findIndex(l=>l.includes(t));
 assert.ok(lines.includes('[column]')&&lines.includes('[end of column]'),'columns are marked:\n'+c);
 assert.ok(at('plants make food')<at('they need light')&&at('they need light')<at('and water too'),'the left column reads down');
 assert.ok(at('and water too')<at('animals eat plants'),'then the right column:\n'+c);
 assert.ok(at('animals eat plants')<at('some eat animals')&&at('some eat animals')<at('all need water'),'the right column reads down');

 /* working with a reason beside each step: read across, step by step */
 c=await context({typed:[[0,100,'2x + 3 = 11'],[0,130,'2x = 8'],[0,160,'x = 4'],[300,100,'subtract three'],[300,130,'divide by two'],[300,160,'that is the answer']]});
 assert.ok(!c.includes('[column]'),'working and its reasons are not columns:\n'+c);
 const l2=c.split('\n'),at2=t=>l2.findIndex(l=>l.includes(t));
 assert.ok(at2('2x + 3 = 11')<at2('subtract three')&&at2('subtract three')<at2('2x = 8'),'each reason stays with its step:\n'+c);

 /* a line drawn down the page splits columns whatever is in them */
 c=await context({typed:[[0,100,'2x + 3 = 11'],[0,130,'2x = 8'],[420,100,'my reading notes'],[420,130,'for tomorrow']],divider:[380,90,190]});
 const l3=c.split('\n'),at3=t=>l3.findIndex(l=>l.includes(t));
 assert.ok(l3.includes('[column]'),'the drawn line makes columns:\n'+c);
 assert.ok(at3('2x = 8')<at3('my reading notes'),'the left side first:\n'+c);

 /* nota is told what the markers and the calculator notation are */
 const system=await page.evaluate(async()=>{let body=null;const f=window.fetch;window.fetch=async(u,o)=>{body=JSON.parse(o.body);throw new Error('stop');};try{await N.nota.askText?.('hi','test',new AbortController().signal,()=>{});}catch{}window.fetch=f;return body?.messages?.[0]?.content||'';});
 if(system){assert.match(system,/\[column\]/);assert.match(system,/calculator notation/);}

 assert.deepEqual(errors,[]);
 console.log('nota context: dismissed readings out, columns read down, working read across: ok');
}finally{await browser.close();server.close();}
