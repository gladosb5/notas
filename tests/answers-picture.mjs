// The calculator's answers reach nota in the picture of the page, where the
// student sees them, and not pasted into the words as "[= 84]", which nota
// took for something the student wrote.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const base=`http://127.0.0.1:${server.address().port}`;
await mkdir('test-results',{recursive:true});
const said=c=>typeof c==='string'?c:c.filter(p=>p.type==='text').map(p=>p.text).join('\n');
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
 const page=await context.newPage(),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('notas.tut','done');localStorage.setItem('notas.nota.key','csk-test-0123456789');});
 await context.route(/\/nota\/chat$|api\.cerebras\.ai|oxionai\.com/,route=>{
  calls.push(JSON.parse(route.request().postData()||'{}'));
  route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'7 x 8 is 56.'}}]})+'\n\ndata: [DONE]\n\n'});
 });
 await page.goto(base+'/notas.html');
 await page.waitForFunction(()=>window.N?.nota?.askBlocked&&window.math&&document.getElementById('preparing').classList.contains('done'));

 /* typed maths only, no ink: one answer beside it, one wrong answer corrected */
 await page.evaluate(()=>{
  const S=N.core.S;S.lines=[];S.strokes=[];
  const a=N.text.add(120,false);a.text='12 x 7';
  const b=N.text.add(150,false);b.text='7 x 8 = 54';
  N.text.render();N.mathcore.run();
 });
 await page.waitForFunction(()=>[...document.querySelectorAll('#margin .chip')].map(c=>c.textContent.trim()).sort().join()==='56,84',null,{timeout:10000});

 await page.evaluate(()=>{const q=N.text.add(240,false);q.text='hey nota, is my maths right?';N.text.render();N.nota.onTyped(q);});
 for(let i=0;i<80&&!calls.length;i++)await page.waitForTimeout(100);
 assert.equal(calls.length,1,'nota was asked');
 const user=calls[0].messages.find(m=>m.role==='user');
 const words=said(user.content);
 assert.match(words,/12 x 7/,'the working still goes as words');
 assert.match(words,/7 x 8 = 54/,'as the student wrote it');
 assert.doesNotMatch(words,/\[=/,'no answers pasted into the words');
 assert.doesNotMatch(words,/\b84\b|\b56\b/,'the answers are not in the words at all');

 /* the picture carries them, in the machine's blue */
 assert.ok(Array.isArray(user.content),'a picture goes with the question, though the page has no ink');
 const picture=user.content.find(p=>p.type==='image_url');
 assert.ok(picture,'the page picture is sent');
 await writeFile('test-results/answers-picture.jpg',Buffer.from(picture.image_url.url.split(',')[1],'base64'));
 const blue=await page.evaluate(url=>new Promise(r=>{const i=new Image();i.onload=()=>{const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let n=0,dark=0;for(let k=0;k<d.length;k+=4){if(d[k+2]>140&&d[k+2]-d[k]>60)n++;if(d[k]<80&&d[k+1]<80&&d[k+2]<80)dark++;}r({blue:n,dark});};i.src=url;}),picture.image_url.url);
 assert.ok(blue.blue>40,'the answers are drawn in blue: '+blue.blue);
 assert.ok(blue.dark>40,'beside the typed working: '+blue.dark);

 assert.deepEqual(errors,[]);
 console.log('answers go in the picture, not the words: ok');
}finally{await browser.close();server.close();}
