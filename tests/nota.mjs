// "hey nota," on the page: typed lines get the reply as red lines of the note,
// written as they arrive; handwriting gets red strokes under the question that save, erase
// and undo like any ink. The model is a mock SSE stream, so this runs offline.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true,serviceWorkers:'block'});
const page=await context.newPage();
page.on('pageerror',e=>{throw e;});

const REPLY='The square root of 144 is 12, because 12 x 12 = 144.';
const calls=[];
// a question's words, whether it went as text alone or as text and a picture of the page
const said=c=>typeof c==='string'?c:c.filter(p=>p.type==='text').map(p=>p.text).join('\n');
const sse=(text)=>text.split(/(?<= )/).map(piece=>`data: ${JSON.stringify({choices:[{delta:{content:piece}}]})}\n\n`).join('')+'data: [DONE]\n\n';
await context.route(/recognizer\.onnx/,route=>route.fulfill({status:200,contentType:'application/octet-stream',body:Buffer.alloc(3*1048576)}));
let holdMs=900;
await context.route(/\/nota\/chat$|api\.cerebras\.ai/,async route=>{
  const body=JSON.parse(route.request().postData()||'{}');
  calls.push({auth:route.request().headers()['authorization'],body});
  await new Promise(r=>setTimeout(r,holdMs));
  route.fulfill({status:200,contentType:'text/event-stream',body:sse(REPLY)});
});
try{
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.ui?.importNoteFile);
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'),null,{timeout:30000});
  await page.evaluate(()=>{N.tutorial?.finish(false);localStorage.setItem('notas.nota.key','csk-test-0123456789');});

  // the call is recognised leniently, and only at the start of a line
  const parsed=await page.evaluate(()=>[
    N.nota.parseCall('hey nota, what is the square root of this?')?.question,
    N.nota.parseCall('Hey Nota what is 2+2')?.question,
    N.nota.parseCall('hcy nofa: why?')?.question,
    N.nota.parseCall('hey note, remember this')?.question,
    N.nota.parseCall('so hey nota what')?.question,
    N.nota.parseCall('homework 12 sep')?.question,
  ]);
  assert.deepEqual(parsed,['what is the square root of this?','what is 2+2','why?','remember this',undefined,undefined],'call parsing: '+JSON.stringify(parsed));

  // ---- typed: the reply is written straight into the note as red lines ----
  await page.evaluate(()=>{N.ink.setTool('text');N.text.add(120,true);});
  // lines are focused the way the app does it (their focus() lands in the
  // editing host): on a touch screen a line has no tabindex, so Playwright's
  // native focus inside fill/type would not reach it
  const fillLine=async(loc,text)=>{await loc.evaluate(el=>{el.focus();el.select();});if(text)await page.keyboard.insertText(text);else await page.keyboard.press('Backspace');};
  const input=page.locator('.line .txt').last();
  await fillLine(input,'12 x 12 = 144');
  await page.keyboard.press('Enter');
  const q=page.locator('.line .txt').last();
  await q.evaluate(el=>el.focus());
  await page.keyboard.type('hey not');
  assert.equal(await page.evaluate(()=>document.querySelector('.line.call')),null,'a half-typed call is not blue yet');
  await page.keyboard.type('a, what is the square root of this?');
  const blue=await page.evaluate(()=>{
    const d=[...document.querySelectorAll('.line')].find(d=>d.classList.contains('call'));
    if(!d)return null;
    const call=d.querySelector('.ghost-layer .call');
    return {text:call.textContent,color:getComputedStyle(call).color,textarea:getComputedStyle(d.querySelector('.txt')).color,rest:[...d.querySelector('.ghost-layer').childNodes].find(n=>n.nodeType===3).nodeValue};
  });
  assert.ok(blue,'a complete "hey nota," marks the line');
  assert.equal(blue.text,'hey nota, ','the call is the blue span: '+JSON.stringify(blue));
  assert.equal(blue.rest,'what is the square root of this?','the question stays in ink');
  assert.equal(blue.textarea,'rgba(0, 0, 0, 0)','the line text is transparent under the mirror');
  assert.notEqual(blue.color,blue.textarea,'the call has a colour');
  /* a red line, the paper turning in it, stands in until the first word */
  await page.waitForFunction(()=>[...document.querySelectorAll('.line.tutor.wait .txt')].some(t=>t.value==='…'),null,{timeout:2000});
  assert.equal(await page.locator('#nota-receipt').isVisible(),true,'receipt visible before first token');
  assert.match(await page.locator('#nota-receipt').textContent(),/got it/);
  const waitLine=await page.evaluate(()=>N.core.S.lines.filter(l=>l.tutor).map(l=>({text:l.text,wait:!!l.wait})));
  assert.deepEqual(waitLine,[{text:'…',wait:true}],'the placeholder is a tutor line: '+JSON.stringify(waitLine));
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.line.tutor.wait'),'::before').animationName),'notaThink','the waiting line plays the paper');
  assert.equal(await page.evaluate(()=>{const m=document.querySelector('#nota-receipt .nota-think'),cs=getComputedStyle(m);return cs.display!=='none'&&cs.animationName;}),'notaThink','the receipt plays the paper too');
  await page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&l.text.includes('144.')),null,{timeout:5000});
  /* the paper stays under the reply until its last word, then goes */
  await page.waitForFunction(()=>!N.core.S.lines.some(l=>l.wait),null,{timeout:5000});
  assert.equal(calls.length,1,'one request for one question');
  assert.equal(calls[0].auth,undefined,'the private key is never sent to the proxy');
  assert.equal(calls[0].body.model,'qwen-3.8-27b','the model that reads pictures is asked');
  assert.equal(typeof calls[0].body.messages[1].content,'string','a page with no ink or pictures sends words alone');
  assert.match(said(calls[0].body.messages[1].content),/12 x 12 = 144/,'the page is the context');
  assert.match(said(calls[0].body.messages[1].content),/Question: what is the square root of this\?/,'the question is sent without the call');
  assert.doesNotMatch(said(calls[0].body.messages[1].content),/hey nota/,'the call word is not part of the question');
  const typed=await page.evaluate(()=>N.core.S.lines.slice().sort((a,b)=>a.y-b.y).map(l=>({text:l.text,tutor:!!l.tutor,wait:!!l.wait,y:l.y})).filter(l=>l.y>=150));
  assert.equal(typed.length,3,'the note holds the sum, the question and the reply: '+JSON.stringify(typed));
  assert.equal(typed[1].text,'hey nota, what is the square root of this?','the question is untouched');
  assert.equal(typed[2].text,REPLY,'the reply is a line of the note');
  assert.equal(typed[2].tutor,true,'the reply is a tutor line');
  assert.equal(typed[2].wait,false,'the dots are gone once words arrive');
  assert.equal(await page.evaluate(()=>document.querySelector('.line.tutor.wait')),null,'no line breathes any more');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.line.tutor .txt')).color),await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--red').trim()).then(c=>{const m=c.match(/^#([0-9a-f]{6})$/i);return m?`rgb(${parseInt(m[1].slice(0,2),16)}, ${parseInt(m[1].slice(2,4),16)}, ${parseInt(m[1].slice(4,6),16)})`:c;}),'the line is drawn in the tutor red');
  assert.equal(await page.evaluate(()=>N.core.S.nodes.some(n=>n.kind==='line'&&n.ref.tutor)),false,'the calculator never reads nota\'s lines');

  /* the caret still sits on the question; the arrow reaches the reply */
  assert.equal(await page.evaluate(()=>N.text.focusedLine()?.text),'hey nota, what is the square root of this?','the caret stayed on the question');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(()=>N.text.focusedLine()?.text),REPLY,'the down arrow lands on the reply');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const below=await page.evaluate(()=>{const f=N.text.focusedLine();return {text:f?.text,tutor:!!f?.tutor};});
  assert.deepEqual(below,{text:'',tutor:false},'Enter at the end of the reply starts an ordinary line');
  await page.evaluate(()=>N.core.undo());

  /* the reply survives a tap elsewhere, a calculator run and a scroll */
  await page.evaluate(()=>{N.mathcore.run();document.getElementById('scroller').scrollTop=40;});
  await page.mouse.click(900,700);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>N.core.S.lines.filter(l=>l.tutor).length),1,'the reply is still there after interacting with the page');

  // undo takes the reply out again, redo puts it back with its final words
  await page.evaluate(()=>N.core.undo());
  assert.equal(await page.evaluate(()=>N.core.S.lines.some(l=>l.tutor)),false,'undo removes the reply lines');
  await page.evaluate(()=>N.core.redo());
  assert.deepEqual(await page.evaluate(()=>N.core.S.lines.filter(l=>l.tutor).map(l=>l.text)),[REPLY],'redo restores the finished reply');

  // the same question is not asked twice
  await page.evaluate(()=>N.nota.onTyped(N.core.S.lines.find(l=>/hey nota/.test(l.text))));
  await page.waitForTimeout(900);
  assert.equal(calls.length,1,'the same typed question is not asked twice');

  // ---- handwriting: the reply is red ink under the question ----
  const ink=await page.evaluate(()=>{
    const S=N.core.S;
    N.ink.setTool('pen');
    const pts=[];for(let x=100;x<=400;x+=6)pts.push(x,420+Math.sin(x/9)*10,.5);
    const st={id:'q1',author:'user',w:2.4,t0:1,t1:2,pts,bbox:N.ink.bboxOf(pts)};
    S.strokes.push(st);
    N.recog.rebuild();
    const group=N.recog.textGroups().find(g=>g.strokeIds.includes('q1'));
    N.nota.onTranscript({hash:group.hash,text:'hey nota, what is the square root of this?',confidence:.71},group);
    return {group:!!group,hash:group.hash};
  });
  assert.equal(ink.group,true,'the handwriting forms a text group');
  assert.equal(await page.evaluate(()=>N.nota.isCallStroke('q1')),true,'a recognized handwritten call is known as one');
  assert.equal(await page.evaluate(()=>N.nota.isAskedStroke('q1')),false,'it is not blue while it may still be being written');
  for(let i=0;i<60&&calls.length<2;i++)await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>N.nota.isAskedStroke('q1')),true,'once nota takes the question, all of it is blue');
  await page.waitForTimeout(250);
  const dots=await page.evaluate(()=>{
    const c=document.getElementById('c-ai'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let red=0;for(let i=0;i<d.length;i+=4)if(d[i]>150&&d[i+1]<110&&d[i+2]<110&&d[i+3]>40)red++;
    return red;
  });
  assert.ok(dots>10,'the paper turns under the handwritten question before the first word: '+dots);
  const aiRed=()=>page.evaluate(()=>{
    const c=document.getElementById('c-ai'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let red=0;for(let i=0;i<d.length;i+=4)if(d[i]>150&&d[i+1]<110&&d[i+2]<110&&d[i+3]>40)red++;
    return red;
  });
  await page.waitForFunction(()=>N.core.S.strokes.some(s=>s.author==='ai'&&s._show>0),null,{timeout:8000});
  assert.ok(await aiRed()>10,'the paper keeps turning under the answer while the pen writes it');
  await page.waitForFunction(()=>!N.core.S.strokes.some(s=>s._show!==undefined),null,{timeout:60000});
  await page.waitForTimeout(150);
  assert.ok(await aiRed()>0,'the paper fades out after the last stroke rather than vanishing');
  await page.waitForTimeout(600);
  assert.equal(await aiRed(),0,'the paper is gone once it has faded');
  const red=await page.evaluate(()=>{
    const S=N.core.S,ai=S.strokes.filter(s=>s.author==='ai');
    const top=Math.min(...ai.map(s=>s.bbox[1])),left=Math.min(...ai.map(s=>s.bbox[0])),right=Math.max(...ai.map(s=>s.bbox[2]));
    return {count:ai.length,top,left,right,questionBottom:S.strokes.find(s=>s.id==='q1').bbox[3],clusters:S.clusters.filter(c=>c.strokeIds.some(id=>ai.some(s=>s.id===id))).length};
  });
  assert.equal(calls.length,2,'the handwritten question made one request');
  assert.match(said(calls[1].body.messages[1].content),/Question: what is the square root of this\?/,'the handwritten question was sent');
  const shot=calls[1].body.messages[1].content.find?.(p=>p.type==='image_url');
  assert.ok(shot&&/^data:image\/jpeg;base64,/.test(shot.image_url.url),'a handwritten question goes with a picture of the page round it');
  assert.ok(red.count>40,'the reply was written as strokes: '+red.count);
  assert.ok(red.top>red.questionBottom,'the reply sits under the question');
  assert.ok(red.left>=100-1&&red.right<=N_CONTENT_W(),'the reply stays within the column');
  assert.equal(red.clusters,0,'the recogniser never reads the red ink');

  // the red ink is drawn on the committed canvas
  const painted=await page.evaluate(()=>{
    const c=document.getElementById('c-commit')||document.querySelector('#canvaswrap canvas');
    const ctx=c.getContext('2d'),d=ctx.getImageData(0,0,c.width,c.height).data;
    let red=0;for(let i=0;i<d.length;i+=4)if(d[i]>150&&d[i+1]<110&&d[i+2]<110&&d[i+3]>100)red++;
    return red;
  });
  assert.ok(painted>200,'red pixels are on the canvas: '+painted);

  // it saves like ink and comes back after a reload
  await page.evaluate(()=>N.core.save());
  await page.waitForFunction(()=>!N.core.S.dirty);
  const id=await page.evaluate(()=>N.core.S.id);
  await page.reload();
  await page.waitForFunction(()=>window.N?.ui?.importNoteFile);
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'),null,{timeout:30000});
  await page.waitForFunction(id=>N.core.S.id===id&&N.core.S.strokes.length>0,id);
  const back=await page.evaluate(()=>({ai:N.core.S.strokes.filter(s=>s.author==='ai').length,shown:N.core.S.strokes.some(s=>s._show!==undefined),tutorLines:N.core.S.lines.filter(l=>l.tutor).length}));
  assert.equal(back.ai,red.count,'every red stroke is back after reload');
  assert.equal(back.shown,false,'no stroke came back half written');
  assert.equal(back.tutorLines,1,'the typed reply line is back and still red');
  await page.waitForTimeout(4500);
  assert.equal(calls.length,2,'the answered question is not asked again after a reload');
  assert.equal(await page.evaluate(()=>document.querySelector('.line.call')!==null),true,'the call is still blue after a reload');

  // the eraser and undo treat it like any other ink
  const erased=await page.evaluate(()=>{
    const S=N.core.S,before=S.strokes.length,ai=S.strokes.filter(s=>s.author==='ai');
    const target=ai[0];
    const cx=(target.bbox[0]+target.bbox[2])/2,cy=(target.bbox[1]+target.bbox[3])/2;
    N.ink.setTool('eraser');
    return {before,x:cx,y:cy,id:target.id};
  });
  const rect=await page.evaluate(()=>{const r=document.getElementById('scroller').getBoundingClientRect();return {left:r.left,top:r.top,colLeft:N.core.M.colLeft,zoom:N.core.M.zoom,scrollTop:document.getElementById('scroller').scrollTop};});
  const sx=rect.left+rect.colLeft+erased.x*rect.zoom,sy=rect.top+(erased.y-rect.scrollTop)*rect.zoom;
  await page.mouse.move(sx-4,sy);await page.mouse.down();await page.mouse.move(sx,sy,{steps:3});await page.mouse.move(sx+4,sy,{steps:3});await page.mouse.up();
  const afterErase=await page.evaluate(id=>({gone:!N.core.S.strokes.some(s=>s.id===id),count:N.core.S.strokes.length}),erased.id);
  assert.equal(afterErase.gone,true,'the eraser removes a red stroke');
  await page.evaluate(()=>N.core.undo());
  assert.equal(await page.evaluate(id=>N.core.S.strokes.some(s=>s.id===id),erased.id),true,'undo brings it back');

  await page.evaluate(()=>N.ink.setTool('text'));
  const replyId=await page.locator('.line.tutor .txt').first().getAttribute('data-id');
  const replyInput=page.locator('.txt[data-id="'+replyId+'"]');
  await fillLine(replyInput,'');
  assert.equal(await page.evaluate(()=>N.core.S.lines.some(l=>l.tutor)),false,'clearing reply restores user ownership');
  const beforeRetry=calls.length;
  await fillLine(replyInput,'hey nota, can you answer again?');
  await page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&l.text.includes('144.')));
  assert.equal(calls.length,beforeRetry+1,'cleared reply can summon nota again');
  assert.equal(await page.locator('#nota-receipt').isVisible(),false,'receipt clears after response');
  // ---- handwriting over two rows, the second written after a long pause ----
  /* the recogniser reads these synthetic strokes too, a second or so later:
     its reading of each row is replaced with the mock text so the story holds */
  const n1=calls.length;
  await page.evaluate(()=>{
    const real=N.nota.onTranscript,mock=window.__mockText={};
    N.nota.onTranscript=(item,group)=>real(mock[item.hash]?{...item,text:mock[item.hash],confidence:.7}:item,group);
    N.ink.setTool('pen');
    window.__row=(id,y,text)=>{
      const S=N.core.S,pts=[];for(let x=100;x<=380;x+=6)pts.push(x,y+Math.sin(x/9)*10,.5);
      S.strokes.push({id,author:'user',w:2.4,t0:1,t1:2,pts,bbox:N.ink.bboxOf(pts)});
      N.recog.rebuild();
      const g=N.recog.textGroups().find(g=>g.strokeIds.includes(id));
      mock[g.hash]=text;N.nota.onTranscript({hash:g.hash,text,confidence:.7},g);
      return !!g;
    };
  });
  assert.equal(await page.evaluate(()=>window.__row('m1',1300,'hey nota what is the')),true,'the first row forms a text group');
  await page.waitForTimeout(2800);
  assert.equal(await page.evaluate(()=>window.__row('m2',1340,'square root of 144')),true,'the second row forms a text group');
  await page.waitForTimeout(1500);
  assert.equal(calls.length,n1,'the second row started the wait over');
  for(let i=0;i<60&&calls.length<n1+1;i++)await page.waitForTimeout(100);
  assert.equal(calls.length,n1+1,'the two rows are one handwritten question');
  assert.match(said(calls[n1].body.messages[1].content),/Question: what is the square root of 144/,'the second row is part of the question');

  console.log('nota: blue call, red reply lines, red ink, the waiting paper, save, erase, undo and a handwritten question over two rows all pass');
}finally{
  await browser.close();server.close();
}
function N_CONTENT_W(){return 720+1;}
