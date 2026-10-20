import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const base=`http://127.0.0.1:${server.address().port}`;
 const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:false})));
 await page.goto(base+'/notas.html');
 await page.waitForFunction(()=>N.ui?.transferImages&&document.querySelector('#preparing').classList.contains('done'));
 await page.evaluate(()=>{N.tutorial.finish(false);N.ink.setTool('pen');});
 const transfer=await page.evaluate(()=>{
  const file=(text,name='image.png',lastModified=1)=>new File([text],name,{type:'image/png',lastModified});
  const a=file('first'),alias=file('first','clipboard.png',2),b=file('other');
  const data=files=>files.map(f=>({kind:'file',getAsFile:()=>f}));
  return {
   mirrored:N.ui.transferImages({items:data([a]),files:[alias]}).length,
   multiple:N.ui.transferImages({items:data([a,b]),files:[alias,b]}).map(f=>f===a?'a':f===b?'b':'alias'),
   filesOnly:N.ui.transferImages({files:[a,b]}).length,
   unreadableItems:N.ui.transferImages({items:[{kind:'file',getAsFile:()=>null}],files:[a]}).length,
   textOnly:N.ui.transferImages({items:[{kind:'string'}],files:[]}).length
  };
 });
 assert.equal(transfer.mirrored,1,'the same clipboard image in items and files is inserted once even when browser metadata differs');
 assert.deepEqual(transfer.multiple,['a','b'],'distinct images with identical file metadata both survive');
 assert.equal(transfer.filesOnly,2,'files are a fallback when items are unavailable');
 assert.equal(transfer.unreadableItems,1,'files are a fallback when items cannot provide images');
 assert.equal(transfer.textOnly,0);
 await page.evaluate(async()=>{
  const cv=document.createElement('canvas');cv.width=80;cv.height=40;const ctx=cv.getContext('2d');ctx.fillStyle='#b6584f';ctx.fillRect(0,0,80,40);
  window.__pasteBlob=await new Promise(r=>cv.toBlob(r));
  await navigator.clipboard.write([new ClipboardItem({'image/png':window.__pasteBlob})]);
 });
 const paste=async expected=>{
  await page.keyboard.press('Control+v');
  await page.waitForFunction(n=>N.core.S.images.length>=n,expected);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>N.core.S.images.length),expected,'one native Ctrl+V adds exactly one image');
 };
 await paste(1);await paste(2);
 await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>N.core.S.images.length),1,'one undo removes one paste');
 await page.keyboard.press('Control+y');assert.equal(await page.evaluate(()=>N.core.S.images.length),2,'redo restores one paste');
 await page.evaluate(()=>{N.ink.setTool('text');const ln=N.text.add(600,true);ln.text='notes';N.text.render();N.text.focusLine(ln.id);});
 await paste(3);await paste(4);
 assert.equal(await page.locator('#lines img').count(),0,'the browser does not also insert an image into the text editor');
 await page.evaluate(()=>N.core.undo());assert.equal(await page.evaluate(()=>N.core.S.images.length),3,'the text-mode image is one undo step');
 await page.evaluate(()=>N.ui.pasteFromClipboard());
 assert.equal(await page.evaluate(()=>N.core.S.images.length),4,'menu paste adds one image');
 // Two clipboard images remain two; their metadata must not collapse them.
 await page.evaluate(()=>{
  N.ink.setTool('pen');const dt=new DataTransfer();
  dt.items.add(new File([__pasteBlob],'same.png',{type:'image/png',lastModified:1}));
  dt.items.add(new File([__pasteBlob],'same.png',{type:'image/png',lastModified:1}));
  document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
 });
 await page.waitForFunction(()=>N.core.S.images.length>=6);await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>N.core.S.images.length),6,'a multi-image paste preserves every selected image');
 assert.deepEqual(errors,[]);
 console.log('Image paste: native Ctrl+V in pen/text modes, repeat paste, undo/redo, menu paste, mirrored clipboard data and multiple images passed');
 await context.close();
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
