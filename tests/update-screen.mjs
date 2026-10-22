import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
const errors=[];
await mkdir('test-results',{recursive:true});
async function setup(options={}){
  const context=await browser.newContext({serviceWorkers:'block',...options});
  await context.addInitScript(()=>{
    try{
      localStorage.setItem('notas.tut','done');localStorage.setItem('notas.app.dismissed',String(Date.now()));
      localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:false}));
    }catch{}
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>document.querySelector('#preparing.done')&&window.N?.ui);
  await page.waitForFunction(()=>document.querySelector('#preparing').hidden);
  return {context,page};
}
const progress=page=>page.locator('#prep-bar').evaluate(el=>Number(/scaleX\(([^)]+)\)/.exec(el.style.transform)?.[1]));
try{
  for(const [width,height,colorScheme,reducedMotion] of [[1280,900,'light','no-preference'],[390,844,'dark','reduce']]){
    const {context,page}=await setup({viewport:{width,height},colorScheme,reducedMotion});
    const note=await page.evaluate(()=>{
      N.core.S.lines[0].text='my note stays here if the update fails';N.core.markDirty();return N.core.S.id;
    });
    let release;const held=new Promise(resolve=>release=resolve);
    await page.route('**/sw.js',async route=>{
      if(route.request().method()==='HEAD'){await held;await route.fulfill({status:503});}else await route.continue();
    });
    await page.evaluate(()=>N.ui.menuSheet());await page.click('#refresh-site');
    await page.locator('#prep-update-art').waitFor();
    assert.equal(await page.locator('#prep-word').innerText(),'updating');
    assert.equal(await page.locator('#preparing').getAttribute('aria-hidden'),null);
    assert.equal(await page.locator('#prep-skip').isVisible(),false);
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'preparing','keyboard stays on the update screen');
    assert.equal(await page.locator('#brand').evaluate(el=>el.closest('[inert]')!==null),true,'underlying notebook is inert');
    assert.equal(await page.locator('#prep-update-art').evaluate(el=>getComputedStyle(el).maskImage!=='none'),true,'same embedded logo is shown');
    assert.equal(await page.locator('#brand #prep-art').count(),1,'header logo is preserved');
    await page.waitForTimeout(550);const first=await progress(page);
    await page.waitForTimeout(550);const second=await progress(page);
    assert.ok(first>0&&second<1,'progress stays below completion while the request is held');
    if(reducedMotion==='reduce')assert.equal(second,first,'reduced motion uses phase changes');
    else assert.ok(second>first&&second<.24,'exponential progress moves toward its phase ceiling');
    await page.screenshot({path:`test-results/update-screen-${width}.png`});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    release();await page.waitForFunction(()=>document.querySelector('#preparing').hidden);
    assert.match(await page.locator('#toast').innerText(),/updating needs a connection/);
    assert.equal(await page.locator('#brand').evaluate(el=>el.closest('[inert]')!==null),false);
    assert.equal(await page.evaluate(()=>N.core.S.id),note);
    assert.equal(await page.evaluate(()=>N.core.S.lines[0].text),'my note stays here if the update fails');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('notas.updating')),null,'failed update leaves no reload marker');
    await page.evaluate(()=>N.text.add(190,true));await page.keyboard.insertText('still writable');
    assert.ok(await page.evaluate(()=>N.core.S.lines.some(line=>line.text==='still writable')));
    await context.close();
  }
  // A downloaded update must still return safely if saving fails.
  {
    const {context,page}=await setup();
    await page.evaluate(()=>{window.realSave=N.core.save;N.core.save=async()=>false;});
    await page.evaluate(()=>N.ui.menuSheet());await page.click('#refresh-site');
    await page.waitForFunction(()=>document.querySelector('#preparing').hidden);
    assert.match(await page.locator('#toast').innerText(),/not saved yet/);
    assert.equal(await page.locator('#prep-update-art').count(),0);
    assert.equal(await page.locator('#brand').evaluate(el=>el.closest('[inert]')!==null),false);
    await context.close();
  }
  // Reload continuity uses a one-shot marker and keeps the updating message
  // while real startup work is held; a later normal launch uses preparing.
  {
    const {context,page}=await setup({reducedMotion:'reduce'});
    await page.evaluate(()=>sessionStorage.setItem('notas.updating',String(Date.now())));
    let release;const held=new Promise(resolve=>release=resolve);
    await page.route('**/assets/idb.js',async route=>{await held;await route.continue();});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#preparing[data-update-resume]').waitFor();
    assert.equal(await page.locator('#prep-word').innerText(),'updating');
    assert.ok((await progress(page))>=.92&&(await progress(page))<1);
    assert.equal(await page.locator('#prep-skip').isVisible(),false);
    release();await page.waitForFunction(()=>document.querySelector('#preparing.done'));
    assert.equal(await progress(page),1,'completion waits for the updated notebook');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('notas.updating')),null);
    await page.unroute('**/assets/idb.js');await page.reload();
    assert.equal(await page.locator('#prep-word').textContent(),'preparing');
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log('Update screen: logo, exponential progress, responsive themes, reduced motion, safe failure recovery, and reload continuity passed.');
}finally{
  await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
