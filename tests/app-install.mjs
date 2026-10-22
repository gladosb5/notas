// Real notebook UI and service-worker messaging. Standalone mode and the
// browser's native installation event are emulated; OS installation is manual QA.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {startServer} from '../scripts/serve.mjs';

const source=await startServer(0),sourceBase=`http://127.0.0.1:${source.address().port}`;
const worker=await readFile(new URL('../sw.js',import.meta.url),'utf8');
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/sw.js'){
      res.setHeader('Content-Type','text/javascript');
      res.end((worker+"\nself.addEventListener('message',event=>{if(event.data?.type==='TEST_FOCUS_ALLOWED'){self.testFocusAllowed=true;event.ports[0].postMessage({ok:true});}});").replace('await app.focus();','if(!self.testFocusAllowed)await app.focus();').replace(/const SHELL=\[[\s\S]*?\];/,"const SHELL=['./notas.html','./app-install.js','./app-install.css','./model-contract.js'];"));return;
    }
    if(url.pathname==='/asset-manifest.json'){res.setHeader('Content-Type','application/json');res.end('[]');return;}
    const response=await fetch(sourceBase+req.url);
    res.statusCode=response.status;
    for(const key of ['content-type','content-security-policy'])if(response.headers.has(key))res.setHeader(key,response.headers.get(key));
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.statusCode=500;res.end(error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
const errors=[];
await mkdir('test-results',{recursive:true});
async function context(options={}){
  const ctx=await browser.newContext({serviceWorkers:'block',...options});
  await ctx.addInitScript(()=>{
    try{localStorage.setItem('notas.tut','done');
    localStorage.setItem('notas.prefs',JSON.stringify({animations:false,handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:false}));}catch{}
  });
  ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  return ctx;
}
async function load(page,url=base+'/notas.html'){
  await page.goto(url);
  await page.waitForFunction(()=>window.N?.appInstall&&document.querySelector('#preparing.done'));
}
try{
  for(const [width,height,theme] of [[1280,900,'light'],[390,844,'dark'],[320,740,'light'],[844,390,'dark']]){
    const ctx=await context({viewport:{width,height},colorScheme:theme});
    const page=await ctx.newPage();await load(page);
    await page.locator('#app-recommend-action').waitFor();
    assert.match(await page.locator('#app-recommendation').innerText(),/Download Notas as an app/);
    await page.screenshot({path:`test-results/app-recommendation-${width}.png`});
    await page.click('#app-recommend-action');
    await page.selectOption('#app-device','apple');
    assert.match(await page.locator('#app-device-steps').innerText(),/Safari[\s\S]*Share[\s\S]*Add to Home Screen[\s\S]*Open as Web App/);
    assert.doesNotMatch(await page.locator('.app-guide').innerText(),/\bpwa\b/i);
    await page.screenshot({path:`test-results/app-ipad-guide-${width}.png`});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'guide fits the viewport');
    await page.selectOption('#app-device','android');
    assert.match(await page.locator('#app-device-steps').innerText(),/Chrome[\s\S]*⋮[\s\S]*Install app/);
    await page.keyboard.press('Escape');
    await page.click('#app-stay');await page.reload();
    await page.waitForFunction(()=>document.querySelector('#preparing.done'));
    assert.equal(await page.locator('#app-recommendation').count(),0,'dismissal survives ordinary visits');
    await page.evaluate(()=>N.ui.menuSheet());await page.click('#mi-app');
    await page.locator('#app-device').waitFor();
    await ctx.close();
  }

  const ipad=await context({viewport:{width:1024,height:768}});
  await ipad.addInitScript(()=>{Object.defineProperty(navigator,'platform',{value:'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{value:5});});
  const ipadPage=await ipad.newPage();await load(ipadPage);await ipadPage.click('#app-recommend-action');
  assert.equal(await ipadPage.inputValue('#app-device'),'apple','desktop-class iPad gets iPad instructions');
  await ipad.close();

  const ctx=await context({permissions:['clipboard-read','clipboard-write']});
  const page=await ctx.newPage();await load(page);
  // A genuine beforeinstallprompt cannot be manufactured in automation;
  // emulate its public event contract and check one-shot use and cancellation.
  await page.evaluate(()=>{
    window.installCalls=0;
    const event=new Event('beforeinstallprompt',{cancelable:true});
    event.prompt=async()=>{window.installCalls++;};event.userChoice=Promise.resolve({outcome:'dismissed'});
    window.dispatchEvent(event);window.installPrevented=event.defaultPrevented;
  });
  await page.click('#app-recommend-action');await page.click('#app-install-now');
  assert.equal(await page.evaluate(()=>window.installCalls),1);
  assert.equal(await page.evaluate(()=>window.installPrevented),true);
  assert.equal(await page.locator('#app-install-now').count(),0,'native event is not reused after dismissal');
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
  assert.equal(await page.evaluate(()=>localStorage.getItem('notas.app.installed')),'1');
  assert.equal(await page.locator('#app-recommendation').count(),0);

  // The full invitation stays private in memory, even if collaboration later
  // removes it from the address bar. Invalid IDs avoid needing a live room here.
  const invitation=base+'/notas.html?share=short&gen=1234#host=private-token';
  await load(page,invitation);await page.locator('#app-recommend-action').waitFor();
  assert.match(await page.locator('#app-recommendation').innerText(),/shared note/);
  await page.click('#app-recommend-action');await page.click('#app-copy-link');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),invitation);
  await page.evaluate(()=>N.appInstall.openShared());
  await page.fill('#app-shared-url','https://example.com/notas.html?share=abcdefgh');
  await page.click('#app-shared-form [type="submit"]');
  assert.match(await page.locator('#app-shared-status').innerText(),/same site/);
  const valid=base+'/notas.html?share=abcdefgh&gen=1234#host=private-token';
  await page.route('**/notas.html?share=abcdefgh*',route=>route.abort());
  await page.fill('#app-shared-url',valid);
  const navigation=page.waitForRequest(request=>request.isNavigationRequest()&&request.url().includes('share=abcdefgh'));
  await page.click('#app-shared-form [type="submit"]');
  assert.equal((await navigation).url(),valid.split('#')[0],'manual shared-link opening keeps invitation query');
  await ctx.close();

  const live=await context({serviceWorkers:'allow'});
  const app=await live.newPage();
  await app.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
  await load(app);
  await app.evaluate(()=>navigator.serviceWorker.ready);
  await load(app);
  await app.waitForFunction(()=>!!navigator.serviceWorker.controller);
  assert.equal(await app.locator('#app-recommendation').count(),0,'no recommendation inside the app');
  const tab=await live.newPage();await load(tab);
  await tab.waitForFunction(()=>!!navigator.serviceWorker.controller);
  // Reload so the first discovery definitely runs after worker activation.
  await load(tab);await tab.waitForFunction(()=>document.querySelector('#app-recommend-action')?.textContent==='Open in app');
  const ask=(page,type,extra={})=>page.evaluate(({type,extra})=>new Promise(resolve=>{
    const channel=new MessageChannel();channel.port1.onmessage=({data})=>resolve(data);
    navigator.serviceWorker.controller.postMessage({type,...extra},[channel.port2]);
  }),{type,extra});
  assert.equal((await ask(tab,'NOTAS_APP_FIND')).found,true,'worker identifies a running standalone client');
  assert.equal((await ask(tab,'NOTAS_APP_OPEN',{url:'https://example.com/notas.html',shared:true})).opened,false,'worker rejects off-origin handoffs');
  assert.equal((await ask(tab,'NOTAS_APP_OPEN',{url:base+'/nota/chat',shared:true})).opened,false,'worker rejects non-notebook paths');
  await tab.evaluate(()=>{window.sourceSave=N.core.save;N.core.save=async()=>false;});
  await tab.click('#app-recommend-action');
  assert.match(await tab.locator('#toast').innerText(),/Save your note/,'unsaved source prevents switching');
  assert.equal(await tab.locator('#app-recommendation').count(),1);
  await tab.evaluate(()=>{N.core.save=window.sourceSave;});
  await tab.click('#app-recommend-action');
  await tab.waitForFunction(()=>!document.querySelector('#app-recommendation')||!!document.querySelector('#app-device'));
  if(await tab.locator('#app-device').count())assert.match(await tab.locator('.app-guide').innerText(),/browser decides/);
  // Headless Edge can deny OS window focus even after a click. Emulate only
  // permission for the remaining tests; discovery/save/navigation use the real worker.
  await ask(tab,'TEST_FOCUS_ALLOWED');
  await tab.evaluate(()=>N.ui.closeSheet(true));
  assert.ok(app.url().startsWith(base),'ordinary visits focus the existing app without replacing its note');

  // A failed save in the app must prevent navigation and offer browser help.
  await app.evaluate(()=>{window.realSave=N.core.save;N.core.save=async()=>false;});
  await load(tab,invitation);
  await tab.waitForFunction(()=>document.querySelector('#app-recommend-action')?.textContent==='Open in app');
  await tab.click('#app-recommend-action');await tab.locator('#app-device').waitFor();
  assert.equal(app.url(),base+'/notas.html','failed save leaves the app on its current note');
  await app.evaluate(()=>{N.core.save=window.realSave;});
  await tab.evaluate(()=>N.ui.closeSheet(true));
  // Request via the same worker protocol used by the button and observe the
  // app accepting the complete deep link, including its host-only fragment.
  const savedNote=await app.evaluate(()=>{N.core.S.lines[0].text='keep this work when opening the invitation';N.core.S.title='before app handoff';N.core.markDirty();return N.core.S.id;});
  const opened=await ask(tab,'NOTAS_APP_OPEN',{url:invitation,shared:true});
  assert.equal(opened.opened,true);
  await app.waitForURL(invitation);
  await app.waitForFunction(()=>document.querySelector('#preparing.done'));
  assert.equal(await app.evaluate(async id=>(await N.core.Store.get('notas.note.'+id)).lines[0].text,savedNote),'keep this work when opening the invitation','handoff saves the previous app note');
  await live.close();
  assert.deepEqual(errors,[]);
  console.log('app install: responsive guides, native prompt, dismissal, iPad detection, shared-link fallback and real worker handoff passed');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  await new Promise(resolve=>source.close(resolve));
}
