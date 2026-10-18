// Exercise the real browser worker lifecycle with two open tabs. Keep the
// production worker logic; trim only its precache list to avoid model downloads.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {startServer} from '../scripts/serve.mjs';
const sourceServer=await startServer(0),sourceBase=`http://127.0.0.1:${sourceServer.address().port}`;
const html=await readFile(new URL('../notas.html',import.meta.url),'utf8');
const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
const current=Number(/notas-local-v(\d+)/.exec(sw)[1]);
let version=current-1;
const server=createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    res.setHeader('Cache-Control','no-store');
    if(pathname==='/sw.js'){
      res.setHeader('Content-Type','text/javascript');
      res.end(sw.replace(/notas-local-v\d+/,`notas-local-v${version}`).replace(/const SHELL=\[[\s\S]*?\];/,"const SHELL=['./notas.html','./nota.js','./model-contract.js'];"));return;
    }
    if(pathname==='/notas.html'){
      res.setHeader('Content-Type','text/html');
      res.end(html.replace(/name="notas-version" content="v\d+"/,`name="notas-version" content="v${version}"`).replace('aiOn:true','aiOn:false'));return;
    }
    if(pathname==='/asset-manifest.json'){res.setHeader('Content-Type','application/json');res.end('[]');return;}
    const response=await fetch(sourceBase+req.url);
    res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type')||'application/octet-stream');
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.statusCode=500;res.end(error.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext(),page=await context.newPage(),errors=[];
await context.addInitScript(()=>{
  localStorage.setItem('notas.tut','done');localStorage.setItem('notas.prefs',JSON.stringify({...JSON.parse(localStorage.getItem('notas.prefs')||'{}'),animations:false}));
  window.updateNotices=[];
  new MutationObserver(()=>{
    const text=document.getElementById('toast')?.textContent||'';
    if(/notas v\d+ is available/.test(text)&&window.updateNotices.at(-1)!==text)window.updateNotices.push(text);
  }).observe(document,{subtree:true,childList:true,characterData:true});
});
// Keep recognition disabled before boot: this test exercises app updates,
// and aborting model downloads races worker startup against page reloads.
await context.route(/\/assets\/(?:ink|text|smart)\//,route=>route.abort());
const ready=async p=>{
  await p.waitForFunction(()=>window.N?.ui&&document.querySelector('#preparing').classList.contains('done'));
  await p.evaluate(()=>{N.core.S.settings.aiOn=false;N.ai.toggle();});
};
const controllerVersion=p=>p.evaluate(()=>new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>reject(Error('worker did not reply')),3000);
  channel.port1.onmessage=({data})=>{clearTimeout(timer);channel.port1.close();resolve(data.version);};
  navigator.serviceWorker.controller.postMessage({type:'GET_VERSION'},[channel.port2]);
}));
try{
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/notas.html');await ready(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();await ready(page);
  assert.equal(await controllerVersion(page),'v'+(current-1));
  await page.evaluate(async()=>{
    N.core.S.title='update preserves this note';N.core.markDirty();await N.core.save();
    N.core.S.settings.theme='dark';N.core.savePrefs();N.ui.applyTheme();
  });
  const note=await page.evaluate(()=>N.core.S.id);
  const peer=await context.newPage();peer.on('pageerror',e=>errors.push(e.message));
  await peer.goto(base+'/notas.html');await ready(peer);
  const peerUrl=peer.url(),peerLoaded=await peer.evaluate(()=>performance.timeOrigin);
  version=current;
  await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('./');await reg.update();});
  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration('./')).waiting);
  await page.waitForFunction(()=>window.updateNotices.length===1);
  assert.ok((await page.evaluate(()=>window.updateNotices[0])).includes('v'+current));
  await page.evaluate(()=>N.ui.menuSheet());
  await Promise.all([page.waitForEvent('load'),page.locator('#refresh-site').click()]);await ready(page);
  assert.equal(await controllerVersion(page),'v'+current,'update activates the new worker before reloading');
  assert.equal(await page.locator('meta[name="notas-version"]').getAttribute('content'),'v'+current);
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(()=>window.updateNotices),[],'updated page does not announce itself');
  assert.equal(await page.evaluate(()=>N.core.S.id),note);assert.equal(await page.evaluate(()=>N.core.S.title),'update preserves this note');
  assert.equal(await page.evaluate(()=>N.core.S.settings.theme),'dark');
  assert.equal(peer.url(),peerUrl);assert.equal(await peer.evaluate(()=>performance.timeOrigin),peerLoaded,'other open tabs are not reloaded');
  assert.equal(await peer.locator('meta[name="notas-version"]').getAttribute('content'),'v'+(current-1),'other tabs keep their open notebook');
  await page.reload();await ready(page);await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(()=>window.updateNotices),[],'ordinary reload does not repeat the same notice');
  // Applying update again when already current should finish quietly too.
  await page.evaluate(()=>N.ui.menuSheet());
  await Promise.all([page.waitForEvent('load'),page.locator('#refresh-site').click()]);await ready(page);
  assert.equal(await controllerVersion(page),'v'+current);await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(()=>window.updateNotices),[]);
  await peer.close();
  // Recover an update applied by an older page's button: its fresh HTML is
  // already cached, but its matching worker was never activated.
  version=current+1;
  await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('./');await reg.update();});
  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration('./')).waiting);
  await page.evaluate(async()=>{
    const key=new URL('./notas.html',location.href).href;
    const fresh=await fetch('./notas.html?update='+Date.now(),{cache:'no-store'});
    for(const name of await caches.keys())if(name.startsWith('notas-local-')||name==='notas-launch-v1')await (await caches.open(name)).put(key,fresh.clone());
  });
  await page.reload();await ready(page);
  await page.waitForFunction(async()=>{const reg=await navigator.serviceWorker.getRegistration('./');return !reg.waiting&&reg.active?.state==='activated';});
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(()=>window.updateNotices),[],'legacy updater handoff does not advertise the page already loaded');
  await page.reload();await ready(page);
  assert.equal(await controllerVersion(page),'v'+(current+1));
  assert.deepEqual(errors,[]);
  console.log('Real update: worker activated before reload, no repeated notice, note/theme preserved, older tab undisturbed, legacy updater handoff repaired.');
}finally{
  await browser.close();server.closeAllConnections();sourceServer.closeAllConnections();
  await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>sourceServer.close(r))]);
}
