// Two people on one note. Runs against the Cloudflare worker locally
// (deploy/cloudflare: sync, then wrangler dev), because the note's room is
// a Durable Object there; COLLAB_BASE=<url> points it at a running one
// instead, the deployed site included.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),deploy=path.join(root,'deploy','cloudflare');
const PORT=8798;
let dev=null,base=process.env.COLLAB_BASE;
const run=(cmd,args,cwd)=>new Promise((res,rej)=>{const p=spawn(cmd,args,{cwd,stdio:'inherit',windowsHide:true});p.on('exit',c=>c?rej(new Error(cmd+' failed')):res());});
if(!base){
  await run(process.execPath,['sync.mjs'],deploy);
  dev=spawn(process.execPath,[path.join(deploy,'node_modules/wrangler/bin/wrangler.js'),'dev','--port',String(PORT)],{cwd:deploy,stdio:process.env.COLLAB_DEBUG?'inherit':'ignore',windowsHide:true});
  base='http://127.0.0.1:'+PORT;
  for(let i=0;i<60;i++){ try{ if((await fetch(base+'/')).ok)break; }catch(e){} await new Promise(r=>setTimeout(r,1000)); }
}
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const errors=[];
async function person(name){
  const context=await browser.newContext({viewport:{width:900,height:1000}});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(name+': '+e.message));
  page.on('console',m=>{ if(m.type()==='error')errors.push(name+' console: '+m.text()); });
  return {name,context,page};
}
const ready=async page=>{ await page.locator('#local-status').filter({hasText:'handwriting ready.'}).waitFor({state:'attached',timeout:180000}); await page.evaluate(()=>N.tutorial.finish(false)); };
const stroke=(id,x,y)=>({id,author:'user',w:2.8,t0:1,t1:2,pts:[x,y,.5,x+30,y,.5,x+30,y+30,.5],bbox:[x,y,x+30,y+30]});
try{
  const a=await person('ana'),b=await person('ben');
  await a.page.goto(base+'/'); await ready(a.page);

  /* ana writes, then shares: the name sheet, then the share sheet with the link */
  await a.page.evaluate(()=>{ const st={id:'ana-1',author:'user',w:2.8,t0:1,t1:2,pts:[50,150,.5,80,150,.5,80,180,.5],bbox:[50,150,80,180]}; N.core.act('draw',()=>N.core.S.strokes.push(st),()=>{}); });
  await a.page.evaluate(()=>{ const ln=N.core.S.lines[0]; ln.text='hello'; N.text.render(); N.core.markDirty(); });
  await a.page.mouse.move(400,400);          /* typing fades the top bar back; a moved mouse brings it up */
  await a.page.click('#btn-share');
  await a.page.fill('#collab-name','ana');
  await a.page.click('#collab-name-ok');
  const link=await a.page.inputValue('#share-link');
  assert.match(link,/\?share=[a-z0-9]{8,}&gen=[a-z0-9]+$/,'share sheet shows a link: '+link);
  const noteId=await a.page.evaluate(()=>N.core.S.id);
  assert.equal(new URL(link).searchParams.get('share'),noteId,'the link names the note');
  await a.page.locator('#share-people').filter({hasText:'only you so far'}).waitFor({timeout:20000});
  await a.page.keyboard.press('Escape');
  assert.equal(await a.page.getAttribute('#btn-share','class'),'bar-btn on','button shows the note is shared');

  /* A solo idle editor keeps its socket: the text ping the runtime answers
     without waking the room stands in for the heartbeat y-websocket would
     otherwise miss, and replace the healthy socket over, after 30 seconds. */
  await a.page.evaluate(()=>{ window.idleCollabSocket=N.collab.room.provider.ws; });
  await a.page.waitForTimeout(35000);
  assert.equal(await a.page.evaluate(()=>N.collab.room.provider.ws===window.idleCollabSocket&&N.collab.room.provider.wsconnected),true,'idle heartbeat keeps the original connection alive');

  /* ben opens the link on another device: his name, then ana's page */
  await b.page.goto(link.replace(/^https?:\/\/[^/]+/,base));
  await ready(b.page);
  /* the note is already arriving while the name is asked */
  await b.page.fill('#collab-name','ben');
  await b.page.click('#collab-name-ok');
  await b.page.waitForFunction(()=>N.core.S.strokes.some(s=>s.id==='ana-1'),null,{timeout:30000});
  const benSees=await b.page.evaluate(()=>({id:N.core.S.id,lines:N.core.S.lines.map(l=>l.text),strokes:N.core.S.strokes.map(s=>s.id),url:location.search}));
  assert.equal(benSees.id,noteId,'ben is on the same note');
  assert.deepEqual(benSees.lines,['hello'],'ben has ana\'s typed line');
  assert.equal(benSees.url,'','the share parameter is dropped once joined');
  /* ben joins as "someone" and announces his name once he has typed it */
  await a.page.waitForFunction(()=>N.collab.room&&N.collab.room.peers.map(p=>p.name).join()==='ben',null,{timeout:20000});
  assert.equal(await a.page.textContent('#share-count'),'2','ana\'s count shows two here');

  /* ben draws and types; ana sees both */
  await b.page.evaluate(()=>{ const st={id:'ben-1',author:'user',w:2.8,t0:3,t1:4,pts:[150,150,.5,180,150,.5,180,180,.5],bbox:[150,150,180,180]}; N.core.act('draw',()=>N.core.S.strokes.push(st),()=>{}); });
  await b.page.evaluate(()=>{ const ln=N.core.S.lines[0]; ln.text='hello ben'; N.text.render(); N.core.markDirty(); });
  await a.page.waitForFunction(()=>N.core.S.strokes.some(s=>s.id==='ben-1')&&N.core.S.lines[0].text==='hello ben',null,{timeout:20000});
  const painted=await a.page.evaluate(()=>{ const i=document.querySelector('.line .txt'); return i&&i.value; });
  assert.equal(painted,'hello ben','ana\'s line on screen carries ben\'s text');

  /* both type in the same line at once: neither loses letters */
  await Promise.all([
    a.page.evaluate(()=>{ const ln=N.core.S.lines[0]; ln.text='A'+ln.text; N.text.render(); N.core.markDirty(); }),
    b.page.evaluate(()=>{ const ln=N.core.S.lines[0]; ln.text=ln.text+'B'; N.text.render(); N.core.markDirty(); })
  ]);
  await a.page.waitForFunction(()=>N.core.S.lines[0].text==='Ahello benB',null,{timeout:20000});
  await b.page.waitForFunction(()=>N.core.S.lines[0].text==='Ahello benB',null,{timeout:20000});

  /* ben's pen over the paper shows on ana's page, as a dot with his name */
  await b.page.mouse.move(300,500); await b.page.mouse.move(320,520); await b.page.mouse.move(340,540);
  await a.page.waitForFunction(()=>N.collab.room.peers[0]&&N.collab.room.peers[0].cursor,null,{timeout:20000});
  await a.page.waitForTimeout(200);
  const dot=await a.page.evaluate(()=>{
    const p=N.collab.room.peers[0].cursor,M=N.core.M,sc=document.querySelector('#scroller'),c=document.querySelector('#c-peers');
    const x=M.colLeft-sc.scrollLeft+p.x*M.zoom,y=-sc.scrollTop+p.y*M.zoom;
    const px=c.getContext('2d').getImageData(Math.round(x*M.dpr),Math.round(y*M.dpr),1,1).data;
    return {cursor:p,layer:!!c,alpha:px[3],onScreen:x>0&&y>0&&x<M.vw&&y<M.vh};
  });
  assert.ok(dot.layer&&dot.onScreen&&dot.alpha>0,"ben's cursor is painted on ana's page: "+JSON.stringify(dot));
  await b.page.mouse.move(5,5); await b.page.mouse.move(0,0);       /* off the paper: the dot goes */
  await a.page.waitForFunction(()=>!N.collab.room.peers[0].cursor,null,{timeout:20000});

  /* ben picks up the pen: ana's page says so; as he draws, the stroke forms
     on her page before it is done, and is ink there once it is */
  const strokesBefore=await a.page.evaluate(()=>N.core.S.strokes.length);
  await b.page.evaluate(()=>N.ink.setTool('pen'));
  await a.page.waitForFunction(()=>N.collab.room.peers[0].tool==='pen',null,{timeout:20000});
  const drag=async(x,y,n)=>{ await b.page.mouse.move(x,y); await b.page.mouse.down(); for(let i=1;i<=n;i++){ await b.page.mouse.move(x+i*8,y+i*3); await b.page.waitForTimeout(25); } };
  await drag(300,600,14);
  await a.page.waitForFunction(()=>{ const l=N.collab.room.peers[0].live; return l&&l.kind==='pen'&&l.pts.length>=15; },null,{timeout:20000});
  await a.page.waitForTimeout(150);
  const forming=await a.page.evaluate(()=>{
    const l=N.collab.room.peers[0].live,M=N.core.M,sc=document.querySelector('#scroller'),c=document.querySelector('#c-peers');
    const i=Math.floor(l.pts.length/6)*3,x=M.colLeft-sc.scrollLeft+l.pts[i]*M.zoom,y=-sc.scrollTop+l.pts[i+1]*M.zoom;
    return {alpha:c.getContext('2d').getImageData(Math.round(x*M.dpr),Math.round(y*M.dpr),1,1).data[3],n:l.pts.length/3};
  });
  assert.ok(forming.alpha>0,"ben's stroke is painted on ana's page while he draws it: "+JSON.stringify(forming));
  await b.page.mouse.up();
  await a.page.waitForFunction(n=>!N.collab.room.peers[0].live&&N.core.S.strokes.length===n+1,strokesBefore,{timeout:20000});

  /* his eraser pass shows as the band it clears, and the lasso as its loop */
  await b.page.evaluate(()=>N.ink.setTool('eraser'));
  await a.page.waitForFunction(()=>N.collab.room.peers[0].tool==='eraser',null,{timeout:20000});
  await drag(300,700,8);
  await a.page.waitForFunction(()=>{ const l=N.collab.room.peers[0].live; return l&&l.kind==='eraser'&&l.pts.length>=6; },null,{timeout:20000});
  await b.page.mouse.up();
  await a.page.waitForFunction(()=>!N.collab.room.peers[0].live,null,{timeout:20000});
  await b.page.evaluate(()=>N.ink.setTool('select'));
  await drag(300,760,8);
  await a.page.waitForFunction(()=>{ const p=N.collab.room.peers[0]; return p.tool==='select'&&p.live&&p.live.kind==='lasso'&&p.live.pts.length>=4; },null,{timeout:20000});
  await b.page.mouse.up();
  await a.page.waitForFunction(()=>!N.collab.room.peers[0].live,null,{timeout:20000});
  await b.page.evaluate(()=>{ N.ink.setTool('text'); N.core.S.selection=[]; N.ink.render(); });
  await b.page.mouse.move(5,5); await b.page.mouse.move(0,0);
  await a.page.waitForFunction(()=>!N.collab.room.peers[0].cursor&&N.collab.room.peers[0].tool==='text',null,{timeout:20000});
  /* the stroke he drew goes again, so the rest of the note is as before */
  await b.page.evaluate(()=>{ const keep=new Set(['ana-1','ben-1']); N.core.act('erase',()=>{ N.core.S.strokes=N.core.S.strokes.filter(s=>keep.has(s.id)); },()=>{}); });
  await a.page.waitForFunction(n=>N.core.S.strokes.length===n,strokesBefore,{timeout:20000});

  /* ben selects his stroke: ana sees a box around it in his colour */
  await b.page.evaluate(()=>{ N.core.S.selection=['ben-1']; N.ink.render(); });
  await a.page.waitForFunction(()=>{ const p=N.collab.room.peers[0]; return p.selection&&p.selection.ids.join()==='ben-1'; },null,{timeout:20000});
  await a.page.waitForTimeout(200);
  const box=await a.page.evaluate(()=>{
    const M=N.core.M,sc=document.querySelector('#scroller'),c=document.querySelector('#c-peers'),st=N.core.S.strokes.find(s=>s.id==='ben-1');
    const x=M.colLeft-sc.scrollLeft+st.bbox[0]*M.zoom-6,y=-sc.scrollTop+st.bbox[1]*M.zoom-6;
    return c.getContext('2d').getImageData(Math.round((x+8)*M.dpr),Math.round(y*M.dpr),1,1).data[3];
  });
  assert.ok(box>0,'the selection box is painted on ana\'s page');
  await b.page.evaluate(()=>{ N.core.S.selection=[]; N.ink.render(); });
  await a.page.waitForFunction(()=>!N.collab.room.peers[0].selection,null,{timeout:20000});

  /* ben highlights part of the typed line: ana sees which line, and what */
  await b.page.evaluate(()=>{ const el=document.querySelector('.line .txt'); el.focus(); el.setSelectionRange(1,4); });
  await a.page.waitForFunction(()=>{ const f=N.collab.room.peers[0].focus; return f&&f.line===N.core.S.lines[0].id&&f.start===1&&f.end===4; },null,{timeout:20000});
  await a.page.waitForTimeout(200);
  const band=await a.page.evaluate(()=>{
    const M=N.core.M,sc=document.querySelector('#scroller'),c=document.querySelector('#c-peers'),el=document.querySelector('.line .txt');
    const r=el.getBoundingClientRect(),o=sc.getBoundingClientRect();
    return c.getContext('2d').getImageData(Math.round((r.left-o.left+2)*M.dpr),Math.round((r.top-o.top+r.height/2)*M.dpr),1,1).data[3];
  });
  assert.ok(band>0,'the typing band is painted on ana\'s page');
  await b.page.evaluate(()=>document.activeElement.blur());
  await a.page.waitForFunction(()=>!N.collab.room.peers[0].focus,null,{timeout:20000});

  /* ana erases her stroke; it leaves ben's page too */
  await a.page.evaluate(()=>{ N.core.act('erase',()=>{N.core.S.strokes=N.core.S.strokes.filter(s=>s.id!=='ana-1');},()=>{}); });
  await b.page.waitForFunction(()=>!N.core.S.strokes.some(s=>s.id==='ana-1'),null,{timeout:20000});

  /* ben reopens while sharing is active and rejoins by itself */
  await b.page.reload(); await ready(b.page);
  await b.page.waitForFunction(()=>N.collab.room&&N.collab.room.status==='connected',null,{timeout:30000});
  const after=await b.page.evaluate(()=>({id:N.core.S.id,strokes:N.core.S.strokes.map(s=>s.id),text:N.core.S.lines[0].text}));
  assert.deepEqual(after,{id:noteId,strokes:['ben-1'],text:'Ahello benB'},'the reopened note is the shared one, current');

  /* a third arrival with nothing local gets the whole note from the room */
  const c=await person('cai');
  await c.page.goto(link.replace(/^https?:\/\/[^/]+/,base));
  await ready(c.page);
  await c.page.fill('#collab-name','cai'); await c.page.click('#collab-name-ok');
  await c.page.waitForFunction(()=>N.core.S.strokes.length===1&&N.core.S.lines[0]&&N.core.S.lines[0].text==='Ahello benB',null,{timeout:30000});
  await a.page.waitForFunction(()=>N.collab.room.peers.length===2,null,{timeout:20000});
  assert.equal(await a.page.textContent('#share-count'),'3');

  /* ana opens her own link in a second tab: same note, no conflict copy */
  const a2=await a.context.newPage();
  a2.on('pageerror',e=>errors.push('ana tab 2: '+e.message));
  await a2.goto(link.replace(/^https?:\/\/[^/]+/,base)); await ready(a2);
  assert.equal(await a2.evaluate(()=>N.core.S.id),noteId,'the second tab is on the same note');
  assert.equal(await a2.locator('#collab-name').count(),0,'the name is remembered on this device');
  await a2.evaluate(()=>{ const ln=N.core.S.lines[0]; ln.text+='2'; N.text.render(); N.core.markDirty(); });
  await a.page.waitForFunction(()=>N.core.S.lines[0].text==='Ahello benB2',null,{timeout:20000});
  await a.page.evaluate(()=>{ const ln=N.core.S.lines[0]; ln.text+='1'; N.text.render(); N.core.markDirty(); });
  await a2.waitForFunction(()=>N.core.S.lines[0].text==='Ahello benB21',null,{timeout:20000});
  await a.page.waitForTimeout(3000);                 /* both tabs' autosaves */
  await a.page.evaluate(()=>N.core.save()); await a2.evaluate(()=>N.core.save());
  const notes=await a.page.evaluate(async()=>(await N.core.Store.index()).map(r=>r.title));
  assert.deepEqual(notes.filter(t=>/conflict|recovered/.test(t)),[],'no conflict copy was made: '+JSON.stringify(notes));
  assert.equal(notes.filter(t=>!t.endsWith(" (before a big change)")).length,1,"one active note plus intentional safety snapshots");
  assert.equal(await a.page.evaluate(()=>N.core.S.id),noteId,'the first tab kept its note');
  /* Both editors ask the same question before either sees a reply. */
  let notaCalls=0;
  for(const person of [a,b])await person.page.route('**/nota/chat',async route=>{
    notaCalls++;
    await new Promise(resolve=>setTimeout(resolve,1600));
    await route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'The shared answer is 42.'}}]})+'\n\ndata: [DONE]\n\n'});
  });
  await a.page.evaluate(()=>{N.core.S.lines.push({id:'shared-question',y:420,text:'hey nota, what is six times seven?'});N.text.render();N.core.markDirty();});
  await b.page.waitForFunction(()=>N.core.S.lines.some(l=>l.id==='shared-question'));
  await Promise.all([a,b].map(p=>p.page.evaluate(()=>N.nota.onTyped(N.core.S.lines.find(l=>l.id==='shared-question')))));
  for(const person of [a,b])await person.page.waitForFunction(()=>N.core.S.lines.some(l=>l.tutor&&l.text==='The shared answer is 42.'),null,{timeout:20000});
  await a.page.waitForTimeout(2000);
  assert.equal(notaCalls,1,'one model request for simultaneous collaborators');
  for(const person of [a,b])assert.equal(await person.page.evaluate(()=>N.core.S.lines.filter(l=>l.tutor).length),1,'one shared reply');
  // A later attempt from another device must also reuse the completed answer.
  await b.page.evaluate(()=>N.nota.onTyped(N.core.S.lines.find(l=>l.id==='shared-question')));
  await b.page.waitForTimeout(1200);
  assert.equal(notaCalls,1,'completed question is deduplicated across devices');
  await a.page.evaluate(()=>{N.core.S.lines=N.core.S.lines.filter(l=>l.id!=='shared-question'&&!l.tutor);N.text.render();N.core.markDirty();});
  await b.page.waitForFunction(()=>!N.core.S.lines.some(l=>l.id==='shared-question'||l.tutor));

  /* The host ends sharing in either tab; each guest is offered a copy of
     the note as their own before it leaves their device. ben lets it go,
     cy keeps a copy; the shared note itself is gone from both. */
  await a2.mouse.move(400,420); await a2.click('#btn-share'); await a2.click('#share-stop');
  await a.page.waitForFunction(()=>!N.collab.room,null,{timeout:20000});
  for(const guest of [b,c]){
    await guest.page.waitForFunction(()=>!N.collab.room&&document.getElementById('leave-keep')&&document.getElementById('leave-go'),null,{timeout:20000});
    assert.equal(await guest.page.evaluate(()=>N.core.S.id),noteId,'the note is still on the page while the guest chooses');
  }
  /* the copy (or a blank note) is opened first and the shared note deleted
     after, so the index is what says the leaving is done */
  /* polled from here: waitForFunction takes an async predicate's promise as
     already truthy, so it used to return at once and race the leaving */
  const gone=async page=>{
    for(let i=0;i<200;i++){
      if(await page.evaluate(async id=>N.core.S.id!==id&&!(await N.core.Store.index()).some(n=>n.id===id),noteId))return;
      await page.waitForTimeout(100);
    }
    throw new Error('the shared note never left the guest');
  };
  await b.page.click('#leave-go');
  await gone(b.page);
  assert.equal(await b.page.evaluate(async()=>(await N.core.Store.index()).some(n=>/\(my copy\)$/.test(n.title))),false,'ben kept nothing');
  await c.page.click('#leave-keep');
  await gone(c.page);
  const cy=await c.page.evaluate(async()=>({id:N.core.S.id,title:N.core.S.title,room:!!N.collab.room,index:(await N.core.Store.index()).map(n=>n.id+':'+n.title)}));
  assert.match(cy.title,/\(my copy\)$/,'cy is on the copy: '+JSON.stringify(cy)+' errors: '+JSON.stringify(errors));
  assert.equal(await c.page.evaluate(()=>N.core.S.lines[0].text),'Ahello benB21','cy\'s copy holds what was on the page');
  assert.equal(await c.page.evaluate(()=>N.collab.isShared(N.core.S.id)),false,'the copy is an ordinary note');
  assert.equal(await a.page.evaluate(()=>N.core.S.lines[0].text),'Ahello benB21','host keeps the note');
  await a2.evaluate(()=>{ const ln=N.core.S.lines[0]; ln.text+='x'; N.text.render(); N.core.markDirty(); });
  await a2.waitForTimeout(2500);
  await a2.close();
  /* Re-sharing gets a new invitation; an old invitation stays revoked. */
  await a.page.evaluate(()=>{void N.collab.share();});
  await a.page.waitForSelector('#share-link');
  const renewed=await a.page.inputValue('#share-link');
  assert.notEqual(new URL(renewed).searchParams.get('gen'),new URL(link).searchParams.get('gen'));
  await a.page.keyboard.press('Escape');
  /* Following the old link cannot retrieve the reopened document. */
  await b.page.goto(link.replace(/^https?:\/\/[^/]+/,base)); await ready(b.page);
  await b.page.waitForFunction(()=>document.getElementById('leave-go'),null,{timeout:20000});
  assert.equal(await b.page.evaluate(()=>N.core.S.lines.some(l=>l.text.includes('Ahello'))),false);
  await b.page.click('#leave-go');

  await b.page.goto(renewed.replace(/^https?:\/\/[^/]+/,base));await ready(b.page);
  await b.page.waitForFunction(()=>N.core.S.lines.some(l=>l.text==='Ahello benB21'),null,{timeout:20000});
  assert.deepEqual(errors,[],'no page errors');
  console.log('collab: share link, join by link, ink and text both ways, strokes as they are drawn, eraser and lasso live, tool shown, same-line merge, erase, reopen, late arrival, stop sharing all pass');
}catch(error){
  console.error('collab browser errors:',errors);
  for(const c of browser.contexts())for(const p of c.pages())console.error('room:',await p.evaluate(()=>window.N?.collab?.room&&{status:N.collab.room.status,ready:N.collab.room.ready}).catch(()=>null));
  throw error;
}finally{
  await browser.close();
  if(dev){ try{ if(process.platform==='win32')spawn('taskkill',['/pid',String(dev.pid),'/t','/f'],{stdio:'ignore',windowsHide:true});else dev.kill(); }catch(e){} }
}
