// Pictures sit in the text the way they do in a document: a new one holds a
// place between the lines, Enter and Backspace above it move it with the
// lines under it, deleting it closes the gap, and only the lasso picks it.
// Moved with the lasso it leaves the text and stays where it was put.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
  const page=await browser.newPage({viewport:{width:1100,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N&&N.ui&&N.ink&&N.text&&N.core.S.id);
  await page.waitForTimeout(400);
  const id=await page.evaluate(async()=>{
    const S=N.core.S;
    N.tutorial?.finish?.(false);document.getElementById('preparing')?.classList.add('done');
    S.lines=[{id:'a',y:60,text:'first line',h:30},{id:'b',y:90,text:'second line',h:30},{id:'c',y:120,text:'third line',h:30}];
    N.text.render();
    const cv=document.createElement('canvas');cv.width=200;cv.height=100;const x=cv.getContext('2d');x.fillStyle='#48c';x.fillRect(0,0,200,100);
    const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
    for(let i=0;i<5&&!S.images.length;i++){await N.ui.insertImages([new File([blob],'p.png',{type:'image/png'})],null,S.lines.find(l=>l.id==='b'));if(!S.images.length)await new Promise(r=>setTimeout(r,300));}
    return S.images.at(-1).id;
  });
  const state=()=>page.evaluate(id=>{const S=N.core.S,im=S.images.find(i=>i.id===id);
    return {im:im&&{x:im.x,y:im.y,w:im.w,h:im.h,inline:!!im.inline},lines:Object.fromEntries(S.lines.map(l=>[l.id,l.y])),sel:S.imageSelection};},id);
  const screen=(wx,wy)=>page.evaluate(([wx,wy])=>{
    const sc=document.querySelector('#scroller'),r=sc.getBoundingClientRect(),M=N.core.M;
    return {x:wx*M.zoom+r.left+M.colLeft-sc.scrollLeft,y:wy*M.zoom+r.top-sc.scrollTop};
  },[wx,wy]);

  // 1. pasted under 'second line' it is in the text, and 'third line' moved under it
  let s0=await state();
  assert.ok(s0.im.inline,'a new picture sits in the text');
  assert.ok(s0.im.y>=s0.lines.b+30,'it sits under the line it was pasted on');
  assert.ok(s0.lines.c>=s0.im.y+s0.im.h,'the lines under it moved down to make room: '+JSON.stringify(s0));

  // 2. Enter at the end of the first line moves the picture down with the text
  await page.evaluate(()=>N.text.focusLine('a',true));
  await page.keyboard.press('Enter');
  let s1=await state();
  assert.equal(s1.im.y,s0.im.y+30,'Enter above the picture moves it down a line');
  assert.equal(s1.lines.c,s0.lines.c+30,'and the line under it');
  // Backspace on the new empty line takes it out again: the picture moves up
  await page.keyboard.press('Backspace');
  let s2=await state();
  assert.equal(s2.im.y,s0.im.y,'deleting the line above moves the picture back up');
  assert.equal(s2.lines.c,s0.lines.c,'and the line under it');
  // undo and redo carry the picture with the lines
  await page.evaluate(()=>N.core.undo());
  assert.equal((await state()).im.y,s0.im.y+30,'undo puts the line and the picture back down');
  await page.evaluate(()=>N.core.redo());
  assert.equal((await state()).im.y,s0.im.y,'redo takes them up again');
  // deleting a whole line above (Backspace at the start of 'second line' joins it up)
  await page.evaluate(()=>N.text.focusLine('b',false));
  await page.keyboard.press('Backspace');
  let s3=await state();
  assert.equal(s3.im.y,s0.im.y-30,'joining a line above into the one before it pulls the picture up');
  await page.evaluate(()=>N.core.undo());
  assert.equal((await state()).im.y,s0.im.y,'undo puts it back');
  await page.evaluate(()=>document.activeElement?.blur());

  // 3. the pen, the eraser and the text tool do not pick a picture
  const mid=await screen(s0.im.x+s0.im.w/2,s0.im.y+s0.im.h/2);
  for(const tool of ['pen','eraser','text']){
    await page.evaluate(t=>{N.ink.clearSelection();N.ink.setTool(t);},tool);
    await page.mouse.click(mid.x,mid.y);
    assert.equal((await state()).sel,null,tool+' does not select a picture');
  }
  await page.evaluate(()=>{const S=N.core.S;S.strokes=S.strokes.filter(s=>s.author!=='user');document.activeElement?.blur();});

  // 4. the lasso picks it with a click
  await page.evaluate(()=>N.ink.setTool('select'));
  await page.mouse.click(mid.x,mid.y);
  assert.equal((await state()).sel,id,'a lasso click selects the picture');

  // 5. a lasso drag takes it out of the text: the gap closes, the picture stays where it was put
  const sBefore=await state();
  await page.mouse.move(mid.x,mid.y);await page.mouse.down();await page.mouse.move(mid.x+300,mid.y+40,{steps:10});await page.mouse.up();
  let s4=await state();
  assert.ok(!s4.im.inline,'moved with the lasso, the picture leaves the text');
  assert.ok(Math.abs(s4.im.x-(sBefore.im.x+300))<3&&Math.abs(s4.im.y-(sBefore.im.y+40))<3,'it stays where it was dropped');
  assert.ok(s4.lines.c<sBefore.lines.c,'the line under it moved up into the gap: '+JSON.stringify([sBefore.lines,s4.lines]));
  // Enter above no longer moves it
  await page.evaluate(()=>{N.ink.clearSelection();N.ink.setTool('text');N.text.focusLine('a',true);});
  await page.keyboard.press('Enter');
  assert.equal((await state()).im.y,s4.im.y,'a picture out of the text stays put when the text moves');
  await page.evaluate(()=>{N.core.undo();N.core.undo();});
  let s5=await state();
  assert.ok(s5.im.inline&&s5.im.y===sBefore.im.y&&s5.lines.c===sBefore.lines.c,'undo puts it back in the text: '+JSON.stringify(s5));

  // 6. deleting a picture in the text closes the gap
  await page.evaluate(id=>N.ink.deleteImage(id),id);
  let s6=await state();
  assert.ok(!s6.im,'the picture is gone');
  assert.ok(s6.lines.c===s5.lines.c-(s5.lines.c-s5.lines.b-60),'the lines under it closed up: '+JSON.stringify(s6.lines));
  await page.evaluate(()=>N.core.undo());
  assert.equal((await state()).lines.c,s5.lines.c,'undo brings back the picture and its room');

  // 7. pictures are never grouped: a loop round two pictures and ink takes only the ink, round two pictures only one
  await page.evaluate(()=>{
    const S=N.core.S,png=S.images[0].src;
    S.images.push({id:'two',src:png,x:420,y:S.images[0].y+10,w:120,h:60,z:Date.now()+5});
    N.ink.setTool('select');N.ink.clearSelection();N.ink.render();
  });
  const all=await page.evaluate(()=>{const b=N.core.S.images.map(im=>N.core.imageBounds(im));return [Math.min(...b.map(x=>x[0]))-8,Math.min(...b.map(x=>x[1]))-6,Math.max(...b.map(x=>x[2]))+8,Math.max(...b.map(x=>x[3]))+6];});
  const loop=[[all[0],all[1]],[all[2],all[1]],[all[2],all[3]],[all[0],all[3]],[all[0],all[1]+5]];
  const p0=await screen(...loop[0]);await page.mouse.move(p0.x,p0.y);await page.mouse.down();
  for(const pt of loop.slice(1)){const p=await screen(...pt);await page.mouse.move(p.x,p.y,{steps:8});}
  await page.mouse.up();
  const picked=await page.evaluate(()=>({img:N.core.S.imageSelection,ink:N.core.S.selection.length}));
  assert.ok(picked.img&&picked.ink===0,'a loop round two pictures selects just one: '+JSON.stringify(picked));
  assert.deepEqual(errors,[]);
  console.log('image-inline: ok');
}finally{
  await browser.close();server.close();
}
