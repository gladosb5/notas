// "ask nota" on circled ink opens a box under the lasso: the student writes
// their own question (up to 100 words), enter or the Enter key sends it with
// a picture of what is circled, Escape brings the bar back.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const base=`http://127.0.0.1:${server.address().port}`;
await mkdir('test-results',{recursive:true});
const said=c=>typeof c==='string'?c:c.filter(p=>p.type==='text').map(p=>p.text).join('\n');
try{
 for(const [width,height,touch] of [[1280,900,false],[390,844,true]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('notas.tut','done');localStorage.setItem('notas.nota.key','csk-test-0123456789');});
  await context.route(/\/nota\/chat$|api\.cerebras\.ai|oxionai\.com/,route=>{
   calls.push(JSON.parse(route.request().postData()||'{}'));
   route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'a spiral.'}}]})+'\n\ndata: [DONE]\n\n'});
  });
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.nota?.askBlocked&&document.getElementById('preparing').classList.contains('done'));
  /* a scribble the readers make nothing of, circled with the lasso */
  const circle=async()=>page.evaluate(()=>{
   const S=N.core.S;S.settings.aiOn=false;N.ai.toggle();
   const flat=[];for(let i=0;i<=80;i++){const a=i/8,r=6+i*.6;flat.push(160+Math.cos(a)*r,260+Math.sin(a)*r,.5);}
   const id='spiral'+Date.now();S.strokes.push({id,author:'user',w:2.4,t0:1,t1:2,pts:flat,bbox:N.ink.bboxOf(flat)});
   N.ink.setTool('select');S.selection=[id];N.ink.showSelBar(true);N.ink.render();
  });
  await circle();
  const ask=page.locator('#selbar button',{hasText:'ask nota'});
  assert.equal(await ask.count(),1,'circled unread ink offers to ask nota');
  if(touch)await ask.tap();else await ask.click();

  /* the box, under the circle, ready to type in */
  const panel=page.locator('#askpanel');
  await panel.waitFor({state:'visible'});
  assert.equal(await page.locator('#selbar').isHidden(),true,'the box stands in for the bar');
  assert.equal(await page.locator('#askpanel label').textContent(),'what would you like to ask nota?');
  assert.equal(await page.locator('#askpanel-count').textContent(),'0 / 100 words');
  assert.equal(await page.locator('#askpanel-go').isDisabled(),true,'nothing to send yet');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'askpanel-in','the box is ready to type in');
  const where=await page.evaluate(()=>{const p=document.getElementById('askpanel').getBoundingClientRect();const s=N.core.S.strokes.at(-1).bbox,r=document.getElementById('scroller').getBoundingClientRect();return {top:p.top,left:p.left,right:p.right,inkBottom:r.top+s[3]*N.layout?.zoom||0};});
  assert.ok(where.left>=0&&where.right<=width,'the box fits the screen');
  await page.screenshot({path:`test-results/ask-panel-${width}.png`});

  /* typing is words, not shortcuts */
  await page.locator('#askpanel-in').pressSequentially('pe');
  assert.equal(await page.evaluate(()=>N.core.S.tool),'select','P typed in the box does not pick the pen');
  assert.equal(await page.locator('#askpanel-count').textContent(),'1 / 100 words');

  /* no more than 100 words go in */
  await page.locator('#askpanel-in').fill(Array.from({length:130},(_,i)=>'word'+i).join(' '));
  assert.equal(await page.locator('#askpanel-count').textContent(),'100 / 100 words');
  assert.equal((await page.locator('#askpanel-in').inputValue()).split(/\s+/).length,100,'the extra words do not go in');

  /* Escape closes it and the bar comes back */
  await page.locator('#askpanel-in').press('Escape');
  assert.equal(await panel.isHidden(),true);
  assert.equal(await page.locator('#selbar').isVisible(),true,'the bar is back');

  /* Shift+Enter is a new line; Enter sends, with a picture of the circled ink */
  if(touch)await ask.tap();else await ask.click();
  await panel.waitFor({state:'visible'});
  assert.equal(await page.locator('#askpanel-in').inputValue(),'','a fresh box each time');
  await page.locator('#askpanel-in').pressSequentially('what is this?');
  await page.locator('#askpanel-in').press('Shift+Enter');
  assert.equal(await panel.isVisible(),true,'shift+enter does not send');
  await page.locator('#askpanel-in').pressSequentially('is it a spiral?');
  await page.locator('#askpanel-in').press('Enter');
  for(let i=0;i<80&&!calls.length;i++)await page.waitForTimeout(100);
  assert.equal(calls.length,1,'the question was sent');
  const user=calls[0].messages.find(m=>m.role==='user');
  assert.match(said(user.content),/asked: "what is this\?\nis it a spiral\?"/,'their own words are the question');
  assert.ok(Array.isArray(user.content)&&user.content.some(p=>p.type==='image_url'),'with a picture of what is circled');
  assert.equal(await panel.isHidden(),true,'the box closes once sent');
  await page.waitForFunction(()=>N.core.S.strokes.some(s=>s.author==='ai'),null,{timeout:8000});

  /* the box goes when the circle does */
  await circle();
  if(touch)await ask.tap();else await ask.click();
  await panel.waitFor({state:'visible'});
  await page.evaluate(()=>{N.ink.clearSelection();N.ink.showSelBar();});
  assert.equal(await panel.isHidden(),true,'clearing the selection closes the box');

  assert.deepEqual(errors,[]);
  await context.close();
  console.log('ok',width);
 }
}finally{await browser.close();server.close();}
