// nota understands drawings: a flowchart and a food chain drawn on the page
// reach the model as words, where they are on the page, with their labels;
// a circled drawing is offered to nota and asked about as the drawing. The
// model is a mock SSE stream and the label reader a stub that returns the
// word each stroke group was drawn for, so this runs offline.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
const page=await context.newPage();
page.on('pageerror',e=>{throw e;});
const calls=[];
// a question's words, whether it went as text alone or as text and a picture of the page
const said=c=>typeof c==='string'?c:c.filter(p=>p.type==='text').map(p=>p.text).join('\n');
const sse=text=>text.split(/(?<= )/).map(piece=>`data: ${JSON.stringify({choices:[{delta:{content:piece}}]})}\n\n`).join('')+'data: [DONE]\n\n';
await context.route(/\/nota\/chat$|api\.cerebras\.ai/,route=>{
  calls.push(JSON.parse(route.request().postData()||'{}'));
  route.fulfill({status:200,contentType:'text/event-stream',body:sse('It starts, checks x and prints it.')});
});
try{
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.ui?.importNoteFile&&window.NOTAS_DIAGRAM);
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'),null,{timeout:30000});
  await page.evaluate(()=>{
    N.tutorial?.finish(false);localStorage.setItem('notas.nota.key','csk-test-0123456789');
    /* the background readers stay off: the labels are read by the stub */
    const S=N.core.S;S.settings.aiOn=false;N.ai.toggle();S.lines=[];S.strokes=[];N.text.render();
    const H=20,words={};
    const stroke=(id,pts)=>{
      const flat=[];
      pts.forEach((p,i)=>{if(!i){flat.push(p[0],p[1],.5);return;}const a=pts[i-1],n=Math.max(1,Math.ceil(Math.hypot(p[0]-a[0],p[1]-a[1])/3));for(let k=1;k<=n;k++)flat.push(a[0]+(p[0]-a[0])*k/n,a[1]+(p[1]-a[1])*k/n,.5);});
      return {id,author:'user',w:2.4,t0:1,t1:2,pts:flat,bbox:N.ink.bboxOf(flat)};
    };
    const word=(name,x,y,text)=>{words[name]=text;return [...text].map((ch,i)=>{const l=x+i*.75*H;return stroke(name+':'+i,[[l,y-.8*H],[l+.15*H,y],[l+.3*H,y-.6*H],[l+.45*H,y],[l+.55*H,y-.5*H]]);});};
    S.strokes=[
      stroke('box1',[[100,40],[240,40],[240,90],[100,90],[100,40]]),...word('start',125,75,'Start'),
      stroke('dia',[[170,150],[250,200],[170,250],[90,200],[170,150]]),...word('q',140,210,'x>5'),
      stroke('box2',[[300,175],[440,175],[440,225],[300,225],[300,175]]),...word('print',320,210,'print'),
      stroke('a1',[[170,92],[170,146]]),stroke('a1h',[[160,134],[170,147],[180,134]]),
      stroke('a2',[[252,200],[296,200],[284,190],[296,200],[284,210]]),...word('yes',260,190,'yes'),
      /* a food chain further down */
      ...word('grass',40,400,'grass'),stroke('c1',[[120,392],[200,392],[188,382],[200,392],[188,402]]),
      ...word('rabbit',215,400,'rabbit'),stroke('c2',[[335,392],[440,392],[428,382],[440,392],[428,402]]),
      ...word('fox',455,400,'fox'),
    ];
    N.recog.rebuild();N.ink.render();
    window.__reads=[];
    N.recog.readStrokesText=async ids=>{
      window.__reads.push(ids.slice());
      const names=[...new Set(ids.map(id=>id.split(':')[0]))].filter(n=>n in words);
      return {text:names.map(n=>words[n]).join(' '),confidence:.92,maths:'',bbox:N.ink.bboxOf(ids.flatMap(id=>N.core.strokeById(id).pts))};
    };
  });

  // ---- a typed question below the drawings ----
  await page.evaluate(()=>{N.ink.setTool('text');N.text.add(560,true);});
  const line=page.locator('.line .txt').last();
  await line.evaluate(el=>el.focus());
  await page.keyboard.insertText('hey nota, what does the flowchart do?');
  await page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&/prints/.test(l.text)),null,{timeout:15000});
  assert.equal(calls.length,1,'one question, one request');
  const sent=said(calls[0].messages[1].content),system=calls[0].messages[0].content;
  assert.match(system,/\[diagram\] and \[end of diagram\]/,'nota is told how drawings are described');
  const picture=calls[0].messages[1].content.find(p=>p.type==='image_url');
  assert.ok(picture&&/^data:image\/jpeg;base64,/.test(picture.image_url.url),'the drawings go as a picture too');
  const size=await page.evaluate(url=>new Promise(r=>{const i=new Image();i.onload=()=>r([i.naturalWidth,i.naturalHeight]);i.src=url;}),picture.image_url.url);
  assert.ok(Math.max(...size)<=1280&&Math.min(...size)>50,'the picture is a sensible size: '+size);
  assert.match(sent,/\[diagram: 3 shapes, 2 arrows/,'the flowchart is in the context: '+sent);
  assert.match(sent,/arrow from rectangle 1 "Start" to diamond 2 "x>5"/,'its first arrow, between its boxes');
  assert.match(sent,/arrow from diamond 2 "x>5" to rectangle 3 "print", labelled "yes"/,'its second arrow, with its label');
  assert.match(sent,/arrow from "grass" \(\d+, \d+\) to "rabbit"/,'the food chain is in the context');
  assert.match(sent,/arrow from "rabbit" \(\d+, \d+\) to "fox"/);
  const order=['rectangle 1 "Start"','"grass"','>>> the question is written here'].map(t=>sent.indexOf(t));
  assert.ok(order.every((v,i)=>v>=0&&(!i||v>order[i-1])),'the drawings stand in the page\'s order, above the question: '+order);
  assert.doesNotMatch(sent,/^\[box\]/m,'the flowchart\'s boxes are not also sent as boxes of notes');
  const reads=await page.evaluate(()=>window.__reads.length);
  assert.ok(reads>=7,'each label was read on its own: '+reads);

  // the labels are remembered: the context helper says the same, at once
  const live=await page.evaluate(()=>N.nota.context());
  assert.match(live,/arrow from diamond 2 "x>5" to rectangle 3 "print", labelled "yes"/,'the context helper shows the drawing');
  assert.equal(await page.evaluate(()=>window.__reads.length),reads,'and reads nothing again');

  // ---- the flowchart circled with the lasso ----
  await page.evaluate(()=>{
    const S=N.core.S;N.ink.setTool('select');
    S.selection=S.strokes.filter(st=>st.author==='user'&&st.bbox[3]<300).map(st=>st.id);
    N.ink.showSelBar();N.ink.render();
  });
  const ask=page.locator('#selbar button',{hasText:'ask nota'});
  assert.equal(await ask.count(),1,'a circled drawing is offered to nota');
  await ask.click();
  for(let i=0;i<80&&calls.length<2;i++)await page.waitForTimeout(100);
  assert.equal(calls.length,2,'asking about the circled drawing makes a request');
  const q=said(calls[1].messages[1].content);
  assert.match(q,/Question: the person circled this drawing/,'the question is about the drawing');
  const circled=calls[1].messages[1].content.find(p=>p.type==='image_url');
  const circledSize=await page.evaluate(url=>new Promise(r=>{const i=new Image();i.onload=()=>r([i.naturalWidth,i.naturalHeight]);i.src=url;}),circled.image_url.url);
  assert.ok(circledSize[1]<size[1],'the circled drawing is sent on its own, not the whole page: '+circledSize+' vs '+size);
  assert.match(q,/arrow from rectangle 1 "Start" to diamond 2 "x>5"/,'the circled drawing is described in the question');
  assert.doesNotMatch(q.slice(0,q.indexOf('Question:')),/rectangle 1 "Start"/,'and is not repeated as the page around it');
  await page.waitForFunction(()=>N.core.S.strokes.some(s=>s.author==='ai'),null,{timeout:8000});

  console.log('nota drawings: a flowchart and a food chain in the context, labels read once, a circled drawing asked about, all pass');
}finally{
  await browser.close();server.close();
}
