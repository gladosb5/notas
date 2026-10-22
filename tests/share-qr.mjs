import {chromium} from 'playwright';
import jsQR from 'jsqr';
import {PNG} from 'pngjs';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const deploy=path.join(root,existsSync(path.join(root,'cloudflare-deploy'))?'cloudflare-deploy':'deploy/cloudflare');
const probe=net.createServer();
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;
await new Promise(resolve=>probe.close(resolve));
execFileSync(process.execPath,['sync.mjs'],{cwd:deploy,stdio:'inherit',windowsHide:true});
const dev=spawn(process.execPath,[path.join(deploy,'node_modules/wrangler/bin/wrangler.js'),'dev','--port',String(port)],{cwd:deploy,stdio:'pipe',windowsHide:true});
let logs='';
dev.stdout.on('data',b=>logs+=b);dev.stderr.on('data',b=>logs+=b);
const base='http://127.0.0.1:'+port;
let browser;
const errors=[];
try{
  let ready=false;
  for(let i=0;i<90;i++){
    try{if((await fetch(base+'/')).ok){ready=true;break;}}catch{}
    if(dev.exitCode!==null)break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(ready,'local Cloudflare worker starts: '+logs);
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
  const person=async (name,apple=false)=>{
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']});
    await context.addInitScript(name=>{
      localStorage.setItem('notas.collab.name',name);
      localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:false}));
    },name);
    if(apple)await context.addInitScript(()=>{Object.defineProperty(navigator,'platform',{value:'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{value:5});});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    return page;
  };
  const load=async(page,url)=>{
    await page.goto(url);
    await page.waitForFunction(()=>window.N?.collab&&document.querySelector('#preparing').classList.contains('done'));
    await page.evaluate(()=>N.tutorial.finish(false));
  };
  const decoded=async page=>{
    await page.locator('#share-qr').waitFor({state:'visible'});
    // Decode the displayed pixels with an independent reader, including any
    // CSS scaling, rather than comparing a hidden value to the link input.
    const png=PNG.sync.read(await page.locator('#share-qr').screenshot());
    const result=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
    assert.ok(result,'the displayed QR code scans');
    assert.equal(result.data,await page.inputValue('#share-link'));
    const url=new URL(result.data);
    assert.ok(url.searchParams.get('gen'),'QR preserves the invitation generation');
    assert.equal(url.hash,'','QR never includes the host key');
    assert.equal(url.searchParams.has('host'),false);
    return result.data;
  };
  const host=await person('qr host');
  await load(host,base+'/');
  await host.evaluate(()=>{N.core.S.lines[0].text='shared through a QR code';N.text.render();N.core.markDirty();});
  await host.evaluate(()=>N.collab.share());
  const first=await decoded(host);
  await host.click('#share-copy');
  assert.equal(await host.evaluate(()=>navigator.clipboard.readText()),first,'copy link still works');
  mkdirSync(path.join(root,'test-results'),{recursive:true});
  await host.locator('.sheet .box').screenshot({path:path.join(root,'test-results/share-qr-desktop.png')});

  const guest=await person('qr guest',true);
  await load(guest,first);
  await guest.locator('#apple-shared-copy').waitFor();
  assert.equal(await guest.evaluate(()=>N.collab.room),null,'Safari offers the app route before joining');
  await guest.click('#apple-shared-copy');
  assert.equal(await guest.evaluate(()=>navigator.clipboard.readText()),first,'real invitation generation survives Apple copy');
  await guest.click('#apple-shared-stay');
  await guest.waitForFunction(()=>N.core.S.lines.some(l=>l.text==='shared through a QR code'));
  assert.equal(await guest.evaluate(()=>N.collab.isHost()),false,'scanning joins as a guest');
  await guest.evaluate(()=>N.collab.share());
  assert.equal(await decoded(guest),first,'guests can show the same invitation QR');

  for(const theme of ['light','dark']){
    await host.setViewportSize({width:375,height:740});
    await host.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    assert.equal(await decoded(host),first,'mobile QR scans in '+theme+' mode');
    const bounds=await host.locator('#share-qr').boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=375,'QR fits the phone viewport');
    await host.locator('.sheet .box').screenshot({path:path.join(root,'test-results/share-qr-mobile-'+theme+'.png')});
  }
  // Encoding failure keeps the ordinary link and copy controls usable.
  await host.evaluate(()=>{window.savedYjs=Yjs;window.Yjs={...Yjs,qrcode:()=>{throw Error('test failure');}};N.collab.share();});
  await host.locator('#share-qr-caption').filter({hasText:'QR code unavailable'}).waitFor();
  assert.equal(await host.inputValue('#share-link'),first);
  await host.click('#share-copy');
  assert.equal(await host.evaluate(()=>navigator.clipboard.readText()),first);
  await host.evaluate(()=>{window.Yjs=window.savedYjs;N.collab.share();});
  assert.equal(await decoded(host),first,'reopening restores the QR');

  await guest.close();
  await host.locator('#share-stop').scrollIntoViewIfNeeded();
  await host.click('#share-stop');
  await host.locator('#share-link').waitFor({state:'detached'});
  await host.evaluate(()=>N.collab.share());
  const renewed=await decoded(host);
  assert.notEqual(new URL(renewed).searchParams.get('gen'),new URL(first).searchParams.get('gen'),'resharing renders the new generation');
  assert.equal(new URL(renewed).searchParams.get('share'),new URL(first).searchParams.get('share'));
  await host.click('#share-stop');
  assert.deepEqual(errors,[],'no browser errors or CSP violations');
  console.log('share QR: scanned link, guest join, guest sharing, copy link, mobile light/dark, fallback and renewed invitation pass');
}finally{
  await browser?.close();
  if(process.platform==='win32')execFileSync('taskkill',['/pid',String(dev.pid),'/t','/f'],{stdio:'ignore',windowsHide:true});
  else dev.kill();
}
