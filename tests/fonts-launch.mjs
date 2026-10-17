import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const fixture=new URL('../assets/fonts/fonts-WnznHAc5bAfYB2QRah7pcpNvOx-pjSx6SII.ttf',import.meta.url);
const sequence=JSON.parse(await readFile(new URL('../assets/launch/sequence.json',import.meta.url)));
const errors=[];
try{
  // Deliberately withhold every app stylesheet and the storage library.
  // First content and sprite movement must happen while these are pending.
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1100,height:800}});
  let release;const held=new Promise(r=>release=r);
  await context.route(/\/(?:assets\/(?:fonts\.css|katex\.css|icons\.css|idb\.js))$/,async route=>{await held;await route.continue();});
  await context.route(/\/assets\/(?:ink|text)\/.*\.(?:onnx|bin)/,route=>route.abort());
  await context.addInitScript(()=>{
    window.launchFrames=[];
    new MutationObserver(records=>{
      for(const record of records)if(record.target.id==='prep-art'&&record.attributeName==='data-frame'){
        const n=+record.target.dataset.frame;
        if(window.launchFrames.at(-1)!==n)window.launchFrames.push(n);
      }
    }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-frame']});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/notas.html',{waitUntil:'commit'});
  await page.waitForFunction(()=>+document.querySelector('#prep-art')?.dataset.frame>=10);
  const early=await page.evaluate(()=>({frame:+document.querySelector('#prep-art').dataset.frame,paint:performance.getEntriesByType('paint').map(p=>p.name),done:document.querySelector('#preparing').classList.contains('done')}));
  assert.ok(early.paint.includes('first-contentful-paint'),'launch painted before external CSS and storage script');
  assert.equal(early.done,false);
  const cdp=await context.newCDPSession(page);
  await writeFile('test-results/launch-playing.png',Buffer.from((await cdp.send('Page.captureScreenshot')).data,'base64'));
  await page.waitForFunction(()=>document.querySelector('#preparing').dataset.launch==='complete');
  assert.equal(await page.locator('#prep-art').getAttribute('data-frame'),String(sequence.frames-1));
  assert.deepEqual((await page.evaluate(()=>window.launchFrames)).slice(0,41),Array.from({length:41},(_,n)=>n),'all 41 spirit drawings display in order');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#preparing').isVisible(),true,'completed logo holds while app is still loading');
  await writeFile('test-results/launch-holding.png',Buffer.from((await cdp.send('Page.captureScreenshot')).data,'base64'));
  release();
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'));
  await page.waitForFunction(()=>document.getElementById('preparing').hidden);
  await page.evaluate(()=>N.tutorial.finish(false));
  await page.evaluate(()=>N.ui.menuSheet());
  const select=page.locator('#nota-font');
  await select.selectOption('caveat');
  await page.waitForFunction(()=>N.core.S.settings.notaFont==='caveat'&&!document.querySelector('#nota-font').disabled);
  assert.equal(await page.evaluate(()=>N.notaFonts.glyph('H','caveat')?.raster),true,'chosen face is loaded before writing');
  const performanceResult=await page.evaluate(()=>{
    const start=performance.now();
    const text='A page that writes back. '.repeat(20),S=N.core.S;
    S.strokes=[];S.lines=[];
    const w=N.nota.Writer({x:10,y:100,rowH:30,instant:true});w.feed(text);w.finish();
    const result={ms:performance.now()-start,strokes:S.strokes.length,chars:text.length};
    S.strokes=[];S.lines=[];N.ink.render();return result;
  });
  assert.ok(performanceResult.strokes<performanceResult.chars*20,'font runs are joined into compact saved ink');
  console.log('Font performance:',JSON.stringify(performanceResult));
  const shapes=await page.evaluate(()=>{
    const S=N.core.S;
    const run=font=>{
      S.settings.notaFont=font;S.strokes=[];S.lines=[];
      const w=N.nota.Writer({x:10,y:100,rowH:30,instant:true});w.feed('Hello $x=2$ again ✓ 你好');w.finish();
      return {points:S.strokes.map(s=>s.pts),finite:S.strokes.every(s=>s.pts.every(Number.isFinite)),lines:S.lines.length,count:S.strokes.length};
    };
    const original=run(''),caveat=run('caveat');
    return {different:JSON.stringify(original.points)!==JSON.stringify(caveat.points),finite:caveat.finite,count:caveat.count,lines:caveat.lines};
  });
  assert.equal(shapes.different,true,'font changes saved ink');assert.equal(shapes.finite,true);assert.ok(shapes.count>0);assert.equal(shapes.lines,0);
  const missingFont=await page.evaluate(()=>{
    N.core.S.settings.notaFont='custom-missing';N.core.S.strokes=[];
    const writer=N.nota.Writer({x:10,y:100,rowH:30,instant:true});writer.feed('Still readable');writer.finish();
    return N.core.S.strokes.length;
  });
  assert.ok(missingFont>0,'an unavailable font falls back to readable original ink');
  await select.selectOption('serif');
  await page.waitForFunction(()=>N.core.S.settings.notaFont==='serif'&&!document.querySelector('#nota-font').disabled);
  await page.locator('#nota-font-file').setInputFiles(fixture.pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
  await page.waitForFunction(()=>document.querySelector('#nota-font').value.startsWith('custom-'));
  const imported=await select.inputValue();
  assert.equal(await page.evaluate(()=>N.notaFonts.find(N.core.S.settings.notaFont).bytes.byteLength), (await readFile(fixture)).length);
  await select.scrollIntoViewIfNeeded();
  await page.waitForTimeout(450);
  await page.screenshot({path:'test-results/nota-font-menu.png'});
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'));
  assert.equal(await page.evaluate(()=>N.core.S.settings.notaFont),imported,'font choice persists after reload');
  assert.equal(await page.evaluate(()=>document.fonts.check('28px "Nota-'+N.core.S.settings.notaFont+'"')),true,'imported face restored');
  await page.evaluate(()=>N.ui.menuSheet());
  await page.locator('#nota-font-file').setInputFiles({name:'invalid.ttf',mimeType:'font/ttf',buffer:Buffer.from('this is not a font')});
  await page.waitForFunction(()=>!document.querySelector('#nota-font').disabled);
  assert.equal(await select.inputValue(),imported,'invalid import leaves chosen font intact');
  await page.locator('#nota-font-remove').click();
  await page.waitForFunction(()=>document.querySelector('#nota-font').value==='');
  await context.close();
  console.log('Fonts: menu choice, distinct saved ink, mixed math/Unicode, import, reload, invalid file, removal.');

  // Accessibility and a narrow dark launch screen.
  const reduced=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce',viewport:{width:390,height:844},colorScheme:'dark'});
  const rp=await reduced.newPage();rp.on('pageerror',e=>errors.push(e.message));
  await rp.route(/\/assets\/idb\.js$/,route=>route.abort());
  await rp.goto(base+'/notas.html',{waitUntil:'domcontentloaded'});
  assert.equal(await rp.locator('#prep-art').getAttribute('data-frame'),String(sequence.frames-1));
  assert.equal(await rp.evaluate(()=>getComputedStyle(document.querySelector('#preparing')).backgroundColor),'rgb(21, 21, 23)');
  await rp.screenshot({path:'test-results/launch-dark-mobile.png'});
  await reduced.close();
  console.log('Launch: first paint with blocked dependencies, complete animation and hold, reduced motion, mobile dark theme.');

  // Only deliver the first few KB of HTML. The preparing screen must paint
  // before even the atlas bytes and the app document finish downloading.
  const html=await readFile(new URL('../notas.html',import.meta.url),'utf8');
  const split=html.indexOf('<style>#prep-art{--launch-atlas:');
  assert.ok(split>0&&split<6000);
  let releaseHtml;const htmlHeld=new Promise(r=>releaseHtml=r);
  const streaming=createServer(async(req,res)=>{
    res.writeHead(200,{'Content-Type':'text/html'});res.write(html.slice(0,split));
    await htmlHeld;res.end(html.slice(split));
  });
  await new Promise(r=>streaming.listen(0,'127.0.0.1',r));
  const streamingContext=await browser.newContext({serviceWorkers:'block'}),sp=await streamingContext.newPage();
  try{
    await sp.goto(`http://127.0.0.1:${streaming.address().port}/notas.html`,{waitUntil:'commit'});
    await sp.waitForFunction(()=>performance.getEntriesByType('paint').some(p=>p.name==='first-contentful-paint'));
    assert.equal(await sp.locator('#prep-word').textContent(),'preparing');
    assert.equal(await sp.evaluate(()=>document.readyState),'loading');
    assert.equal(await sp.locator('#preparing').isVisible(),true);
    console.log('Streaming: launch text paints from the first',split,'HTML bytes, before atlas and app bytes arrive.');
  }finally{
    await streamingContext.close();releaseHtml();streaming.closeAllConnections();await new Promise(r=>streaming.close(r));
  }

  // Real service worker: cache survives the update button and can supply
  // navigation when the versioned app's own document entry is missing.
  const offline=await browser.newContext({reducedMotion:'reduce'}),op=await offline.newPage();
  op.on('pageerror',e=>errors.push(e.message));
  await op.goto(base+'/notas.html');
  await op.waitForFunction(()=>window.N?.core);
  await op.evaluate(()=>{N.core.S.settings.aiOn=false;});
  await op.waitForFunction(()=>document.getElementById('preparing').classList.contains('done'));
  await op.evaluate(()=>N.tutorial.finish(false));
  await op.evaluate(async()=>{
    const registration=await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    if(!registration.active)await new Promise(r=>{const timer=setInterval(()=>{if(registration.active){clearInterval(timer);r();}},100);});
  });
  await op.reload();
  await op.waitForFunction(()=>navigator.serviceWorker.controller&&document.querySelector('#preparing').classList.contains('done'));
  await op.evaluate(()=>{N.core.S.settings.aiOn=false;N.ui.menuSheet();});
  await op.locator('#nota-font').selectOption('plex');
  await op.waitForFunction(()=>N.core.S.settings.notaFont==='plex'&&!document.querySelector('#nota-font').disabled);
  await op.locator('#nota-font-file').setInputFiles(fixture.pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
  await op.waitForFunction(()=>document.querySelector('#nota-font').value.startsWith('custom-'));
  const updateFont=await op.locator('#nota-font').inputValue();
  await Promise.all([op.waitForEvent('load'),op.locator('#refresh-site').click()]);
  await op.waitForFunction(()=>document.querySelector('#preparing').classList.contains('done'));
  assert.equal(await op.evaluate(()=>N.core.S.settings.notaFont),updateFont,'font survives app update');
  const kept=await op.evaluate(async()=>{
    await window.notasLaunch.cacheReady;
    const key=new URL('./notas.html',location.href).href;
    const launch=await (await caches.open('notas-launch-v1')).match(key);
    for(const name of await caches.keys())if(name.startsWith('notas-local-'))await (await caches.open(name)).delete(key);
    return launch?.ok;
  });
  assert.equal(kept,true);
  await offline.setOffline(true);await op.reload();
  await op.waitForFunction(()=>document.querySelector('#preparing').classList.contains('done'));
  assert.equal(await op.evaluate(()=>N.core.S.settings.notaFont),updateFont,'font available offline');
  await offline.close();
  console.log('Cache: real worker, update, retained launch document, offline fallback, imported font preserved.');
  assert.deepEqual(errors,[],'no page errors');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
