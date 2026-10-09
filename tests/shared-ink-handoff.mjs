import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const deploy=path.join(root,'deploy','cloudflare');
const port=8799,base=`http://127.0.0.1:${port}`;
const sync=spawn(process.execPath,['sync.mjs'],{cwd:deploy,stdio:'inherit'});
assert.equal(await new Promise(resolve=>sync.on('exit',resolve)),0);
const dev=spawn(process.execPath,[path.join(deploy,'node_modules','wrangler','bin','wrangler.js'),'dev','--port',String(port)],{cwd:deploy,stdio:'ignore'});
let browser;
try{
  let ready=false;
  for(let i=0;i<60;i++){
    try{ready=(await fetch(base+'/')).ok;if(ready)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(ready,'local Cloudflare worker started');
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
  const a=await browser.newContext({viewport:{width:900,height:700}});
  const b=await browser.newContext({viewport:{width:900,height:700}});
  const sender=await a.newPage(),receiver=await b.newPage();
  for(const page of [sender,receiver])page.on('pageerror',e=>{throw e;});
  await sender.goto(base+'/');
  await sender.waitForFunction(()=>N?.ink?.render&&document.querySelector('#preparing').classList.contains('done'),null,{timeout:120000});
  await sender.evaluate(()=>{
    N.tutorial.finish(false);
    const S=N.core.S;
    for(let i=0;i<300;i++){
      const x=20+(i%20)*28,y=150+Math.floor(i/20)*22,id='background-'+i;
      S.strokes.push({id,author:'user',w:2.8,t0:i,t1:i+1,pts:[x,y,.5,x+12,y+8,.5],bbox:[x,y,x+12,y+8]});
    }
    N.core.markDirty();N.ink.render();
  });
  await sender.click('#btn-share');
  await sender.fill('#collab-name','sender');await sender.click('#collab-name-ok');
  const link=await sender.inputValue('#share-link');
  await receiver.goto(link.replace(/^https?:\/\/[^/]+/,base));
  await receiver.waitForFunction(()=>N?.collab?.room&&N.core.S.strokes.length===300,null,{timeout:120000});
  await receiver.fill('#collab-name','receiver');await receiver.click('#collab-name-ok');
  await sender.waitForFunction(()=>N.collab.room.peers.length===1);
  const reply=('This is the earlier shared explanation. '+ 'More detail for a follow-up question. '.repeat(8)).trim();
  await sender.evaluate(text=>{
    const writer=N.nota.Writer({x:10,y:900,rowH:24,instant:true});
    writer.feed(text);writer.finish();
  },reply);
  await receiver.waitForFunction(text=>N.core.S.strokes.some(st=>st.notaText===text),reply,{timeout:20000});
  assert.ok((await receiver.evaluate(()=>N.nota.context({x:0,y:900}))).includes(reply),'another person receives the complete handwritten reply as follow-up context');
  await sender.keyboard.press('Escape');
  await sender.evaluate(()=>N.ink.setTool('pen'));

  const box=await sender.locator('#c-ink').boundingBox(),x=box.x+180,y=box.y+500;
  await sender.mouse.move(x,y);await sender.mouse.down();
  for(let i=1;i<=8;i++){
    await sender.mouse.move(x+i*10,y+(i%2)*5);
    await sender.waitForTimeout(22);
  }
  await receiver.waitForFunction(()=>N.collab.room.peers[0]?.live?.pts?.length>=6,null,{timeout:5000});
  await receiver.evaluate(()=>{
    window.inkGap=false;
    window.inkWasLive=true;
    window.inkSample=setInterval(()=>{
      const p=N.collab.room.peers[0];
      const id=window.inkId;
      if(id&&!p?.live&&!N.core.S.strokes.some(st=>st.id===id))window.inkGap=true;
    },5);
  });
  const id=await sender.evaluate(()=>N.ink.live().id);
  await receiver.evaluate(id=>window.inkId=id,id);
  await sender.mouse.up();
  assert.equal(await sender.evaluate(()=>N.collab.room.provider.batch.length),0,'pen lift bypasses the document batch');
  await receiver.waitForFunction(id=>N.core.S.strokes.some(st=>st.id===id),id,{timeout:5000});
  await receiver.waitForTimeout(80);
  assert.equal(await receiver.evaluate(()=>{clearInterval(window.inkSample);return window.inkGap;}),false,
    'the live stroke stays until committed ink reaches the note');
  assert.equal(await receiver.evaluate(id=>N.collab.room.peers[0]?.live?.id===id,id),false,
    'the live preview clears after the committed stroke paints');
  console.log('A dense shared note publishes pen ink immediately without a live-ink gap.');
}finally{
  if(browser)await browser.close();
  dev.kill();
}
