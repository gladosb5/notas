// The notes library at three sizes: a docked sidebar on a desktop, a drawer
// on a tablet, a page of its own (with the back gesture) on a phone. Folders,
// pins, the trash and its undo, rename, duplicate, search, thumbnails and the
// backup bundle are all driven through the real UI.
import {chromium, devices} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {startServer} from '../scripts/serve.mjs';

const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL, headless:true});
const shots = process.env.LIBRARY_SHOTS || '';
if(shots) fs.mkdirSync(shots, {recursive:true});

/* a small wave of ink and a typed line, so every note has something to picture */
function sample(title, text, lift){
  const pts = [];
  for(let i = 0; i <= 40; i++) pts.push(40 + i*9, 180 + lift + Math.round(Math.sin(i/4)*18), 0.5);
  return {title, created:Date.now() - 864e5, updated:Date.now() - 1000*lift, strokes:[{id:'s'+lift, w:2.4, pts}],
          lines:[{id:'l'+lift, y:120, text}], images:[], localVersion:2};
}
async function seed(page){
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.library && N.core.S.id);
  await page.evaluate(()=>{ N.tutorial?.finish(false); N.core.S.settings.aiOn=false; N.ai.toggle(); });
  await page.evaluate(b=>N.library.importBundle(b), {notasBundle:1, notes:[
    sample('algebra', 'hello world 2x + 3 = 7', 0), sample('geometry', 'angles in a triangle', 40), sample('', 'shopping list', 80)]});
}
const rows = page=>page.locator('#library .note-row');
const names = page=>page.$$eval('#library .note-row .lib-name', els=>els.map(e=>e.textContent));
const index = page=>page.evaluate(()=>N.core.Store.index());

try{
  /* ---- logo: overview with real notes, reversible navigation ---- */
  for(const width of [1440,820,390,320]){
    const context = await browser.newContext({viewport:{width,height:900},hasTouch:width<1100,serviceWorkers:'block'});
    const page = await context.newPage(), errors = [];
    page.on('pageerror',e=>errors.push(String(e)));
    await seed(page);
    const current = await page.evaluate(async()=>{
      const ix = await N.core.Store.index(), id = ix.find(r=>r.title==='algebra').id;
      await N.ui.openNote(id);
      N.core.setZoom(1.15);
      const sc = document.querySelector('#scroller'); sc.scrollTop = 360;
      N.core.saveView(id,sc.scrollTop,sc.scrollLeft); N.core.flushView();
      return {id,top:sc.scrollTop,zoom:N.core.M.zoom,width:N.core.M.contentW,text:N.core.S.lines[0].text};
    });
    await page.locator('#brand').click();
    await page.waitForFunction(()=>N.library.mode==='overview'&&!document.documentElement.classList.contains('library-transition'));
    assert.equal(await page.evaluate(()=>N.library.modal),true,'the overview is a destination, not a dock');
    assert.equal(await rows(page).count(),3,'the overview shows the real saved notes');
    assert.equal(await page.locator('.lib-chip[data-view="all"]').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#scroller').evaluate(el=>el.inert),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overview fits '+width);
    assert.equal(await page.locator('#lib-current').isVisible(),width>=1100);
    if(shots) await page.screenshot({path:shots+'/overview-'+width+'.png'});
    await page.evaluate(()=>N.library.close());
    await page.waitForFunction(()=>!N.library.isOpen&&!document.documentElement.classList.contains('library-transition'));
    assert.deepEqual(await page.evaluate(()=>({id:N.core.S.id,top:document.querySelector('#scroller').scrollTop,zoom:N.core.M.zoom,width:N.core.M.contentW,text:N.core.S.lines[0].text})),current,'leaving and returning preserves the page and its view');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'brand','focus returns to the logo');

    // A selected folder or search never hides notes on the next logo visit.
    await page.locator('#brand').click();
    await page.waitForFunction(()=>N.library.mode==='overview'&&!document.documentElement.classList.contains('library-transition'));
    await page.locator('.lib-chip[data-view="trash"]').click();
    await page.evaluate(()=>N.library.close());
    await page.waitForFunction(()=>!N.library.isOpen&&!document.documentElement.classList.contains('library-transition'));
    await page.locator('#brand').click();
    await page.waitForFunction(()=>N.library.mode==='overview'&&!document.documentElement.classList.contains('library-transition'));
    assert.equal(await rows(page).count(),3,'logo restores all notes');
    await rows(page).filter({hasText:'geometry'}).locator('.t').click();
    await page.waitForFunction(()=>!N.library.isOpen&&N.core.S.title==='geometry'&&!document.documentElement.classList.contains('library-transition'));
    assert.equal(await page.locator('#scroller').evaluate(el=>el.inert),false,'choosing a note restores editing');
    assert.equal(await page.locator('.line .txt').first().evaluate(el=>el.value??el.textContent),'angles in a triangle');
    const geometryId = await page.evaluate(()=>N.core.S.id);
    await page.locator('#brand').click();
    await page.waitForFunction(()=>N.library.mode==='overview'&&!document.documentElement.classList.contains('library-transition'));
    await page.goBack();
    await page.waitForFunction(()=>!N.library.isOpen&&!document.documentElement.classList.contains('library-transition'));
    assert.equal(await page.evaluate(()=>N.core.S.id),geometryId,'browser back keeps the current note');

    // Reduced motion and browsers without snapshots retain the same navigation.
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#brand').click();
    await page.waitForFunction(()=>N.library.mode==='overview');
    assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('library-transition')),false);
    await page.evaluate(()=>N.library.close());
    await page.waitForFunction(()=>!N.library.isOpen);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>document.startViewTransition=undefined);
    await page.locator('#brand').click();
    await page.waitForFunction(()=>N.library.mode==='overview');
    await rows(page).filter({hasText:'algebra'}).locator('.t').click();
    await page.waitForFunction(()=>!N.library.isOpen&&N.core.S.title==='algebra');
    assert.deepEqual(errors,[],'no overview errors at '+width);
    await context.close();
  }

  /* ---- desktop: the docked sidebar ---- */
  {
    const context = await browser.newContext({viewport:{width:1440, height:900}, serviceWorkers:'block', acceptDownloads:true});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e=>errors.push(String(e)));
    await seed(page);
    await page.evaluate(()=>N.library.open());
    await page.waitForFunction(()=>N.library.isOpen);
    assert.equal(await page.evaluate(()=>N.library.mode), 'dock', 'a wide desktop docks the library');
    assert.equal(await page.evaluate(()=>document.body.classList.contains('lib-docked')), true);
    const left = await page.evaluate(()=>document.querySelector('#scroller').getBoundingClientRect().left);
    assert.ok(left >= 320, 'the paper moves over for the sidebar: '+left);
    assert.equal(await page.evaluate(()=>document.querySelector('#scroller').inert), false, 'the paper stays usable beside the sidebar');
    await rows(page).first().waitFor();
    assert.equal(await rows(page).count(), 3);
    // thumbnails: pictured lazily as WebP (or PNG where WebP cannot be encoded)
    await page.waitForFunction(()=>document.querySelectorAll('#library .lib-thumb img').length === 3, null, {timeout:10000});
    const thumb = await page.evaluate(async()=>{ const ix = await N.core.Store.index(); return N.core.Store.get('notas.thumb.'+ix[0].id); });
    assert.match(thumb.src, /^data:image\/(webp|png);base64,/);
    assert.ok(thumb.src.length < 60000, 'a thumbnail stays small: '+thumb.src.length);
    if(shots) await page.screenshot({path:shots+'/desktop-dock.png'});

    // a new folder, then a note moved into it through the pointer's menu
    await page.locator('.lib-chip.add').click();
    await page.locator('.sheet .keyin').fill('physics');
    await page.locator('.sheet .keyin').press('Enter');
    await page.waitForFunction(()=>document.querySelector('#lib-heading').textContent === 'physics');
    assert.match(await page.locator('.lib-empty').textContent(), /nothing in this folder/);
    await page.locator('.lib-chip[data-view="all"]').click();
    await rows(page).filter({hasText:'geometry'}).locator('.lib-more').click();
    await page.locator('.lib-pop').waitFor();
    if(shots) await page.screenshot({path:shots+'/desktop-menu.png'});
    await page.locator('.lib-pop .mi', {hasText:'move to folder'}).click();
    await page.locator('.sheet .mi', {hasText:'physics'}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('#library .lib-meta')].some(m=>m.textContent.includes('physics')));
    let ix = await index(page);
    assert.equal(ix.find(r=>r.title==='geometry').folder, 'physics');

    // the folder survives the note being opened, edited and autosaved
    await rows(page).filter({hasText:'geometry'}).locator('.t').click();
    await page.waitForFunction(()=>N.core.S.title === 'geometry');
    await page.evaluate(async()=>{ N.core.S.lines[0].text += ' and more'; N.core.markDirty(); await N.core.save(); });
    ix = await index(page);
    assert.equal(ix.find(r=>r.title==='geometry').folder, 'physics', 'autosave keeps the folder');
    assert.equal(await page.evaluate(()=>N.library.isOpen), true, 'opening a note leaves the docked sidebar open');

    // pin: the pinned note leads the list
    await rows(page).filter({hasText:'shopping list'}).locator('.lib-more').click();
    await page.locator('.lib-pop .mi', {hasText:'pin to top'}).click();
    await page.waitForFunction(()=>document.querySelector('#library .note-row .lib-name')?.textContent === 'shopping list');

    // keyboard: F2 renames, Delete trashes, undo takes it back
    await rows(page).filter({hasText:'algebra'}).locator('.t').focus();
    await page.keyboard.press('F2');
    await page.locator('.sheet .keyin').fill('algebra 1');
    await page.locator('.sheet .keyin').press('Enter');
    await page.waitForFunction(()=>[...document.querySelectorAll('#library .lib-name')].some(n=>n.textContent==='algebra 1'));
    assert.equal((await page.evaluate(async()=>{ const ix = await N.core.Store.index(); return N.core.Store.get('notas.note.'+ix.find(r=>r.title==='algebra 1').id); })).title, 'algebra 1');
    await rows(page).filter({hasText:'algebra 1'}).locator('.t').focus();
    await page.keyboard.press('Delete');
    await page.locator('#lib-undo.in').waitFor();
    assert.equal(await rows(page).count(), 2);
    await page.locator('#lib-undo button').click();
    await page.waitForFunction(()=>document.querySelectorAll('#library .note-row').length === 3);

    // the open note to the trash: the page moves on, the trash can restore it
    const openId = await page.evaluate(()=>N.core.S.id);
    await rows(page).filter({hasText:'geometry'}).locator('.lib-more').click();
    await page.locator('.lib-pop .mi', {hasText:'move to trash'}).click();
    await page.waitForFunction(id=>N.core.S.id !== id, openId);
    await page.locator('.lib-chip[data-view="trash"]').click();
    assert.deepEqual(await names(page), ['geometry']);
    await rows(page).first().locator('.lib-more').click();
    await page.locator('.lib-pop .mi', {hasText:'restore'}).click();
    await page.waitForFunction(()=>document.querySelector('.lib-empty')?.textContent.includes('trash is empty'));
    await page.locator('.lib-chip[data-view="all"]').click();

    // duplicate keeps the folder; search still reaches typed text
    await rows(page).filter({hasText:'geometry'}).locator('.lib-more').click();
    await page.locator('.lib-pop .mi', {hasText:'duplicate'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#library .note-row').length === 4);
    ix = await index(page);
    assert.equal(ix.find(r=>r.title==='geometry copy').folder, 'physics');
    await page.keyboard.press('Control+k');
    await page.waitForFunction(()=>document.activeElement?.id === 'search', null, {timeout:3000});
    await page.locator('#search').fill('hello');
    await page.waitForFunction(()=>document.querySelectorAll('#library .note-row').length === 1);
    assert.equal(await rows(page).first().locator('.match').textContent(), 'hello world 2x + 3 = 7');
    await page.locator('#search').fill('');

    // ctrl-click picks several; the bar exports them as one bundle
    await rows(page).nth(0).locator('.t').click({modifiers:['Control']});
    await rows(page).nth(1).locator('.t').click({modifiers:['Control']});
    assert.equal(await page.locator('.lib-count').textContent(), '2 selected');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.lib-selbar [data-act="export"]').click()]);
    const bundle = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(bundle.notasBundle, 1); assert.equal(bundle.notes.length, 2);
    // and the bundle comes back in through import
    const before = (await index(page)).length;
    await page.evaluate(b=>N.library.importBundle(b), bundle);
    assert.equal((await index(page)).length, before + 2);

    // reload: the sidebar that was left open is open again
    await page.reload(); await page.waitForFunction(()=>window.N?.library && N.library.isOpen, null, {timeout:15000});
    await page.evaluate(()=>N.library.close());
    assert.equal(await page.evaluate(()=>document.body.classList.contains('lib-docked')), false);
    assert.equal(await page.evaluate(()=>document.querySelector('#scroller').getBoundingClientRect().left), 0);
    assert.deepEqual(errors, [], 'no page errors on the desktop');
    await context.close();
  }

  /* ---- tablet: a drawer over the paper ---- */
  {
    const context = await browser.newContext({...devices['iPad Pro 11'], serviceWorkers:'block'});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e=>errors.push(String(e)));
    await seed(page);
    await page.evaluate(()=>N.library.open());
    await page.waitForFunction(()=>N.library.isOpen);
    assert.equal(await page.evaluate(()=>N.library.mode), 'drawer');
    assert.equal(await page.evaluate(()=>document.querySelector('#scroller').inert), true, 'the paper is out of reach under the drawer');
    await rows(page).first().waitFor();
    await page.waitForTimeout(400);
    if(shots) await page.screenshot({path:shots+'/tablet-drawer.png'});
    // a note's actions are a sheet on touch
    await rows(page).first().locator('.lib-more').tap();
    await page.locator('.sheet.fit').waitFor();
    if(shots){ await page.waitForTimeout(400); await page.screenshot({path:shots+'/tablet-actions.png'}); }
    await page.evaluate(()=>N.ui.closeSheet());
    await page.waitForFunction(()=>!document.querySelector('.sheet:not(.leave)'));
    assert.equal(await page.evaluate(()=>document.querySelector('#scroller').inert), true, 'closing an action sheet leaves the drawer modal');
    await page.mouse.click(700, 600);                    /* the dimmed paper */
    await page.waitForFunction(()=>!N.library.isOpen);
    assert.equal(await page.evaluate(()=>document.querySelector('#scroller').inert), false);
    assert.deepEqual(errors, [], 'no page errors on the tablet');
    await context.close();
  }

  /* ---- phone: a page of its own ---- */
  {
    const context = await browser.newContext({...devices['Pixel 7'], serviceWorkers:'block'});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e=>errors.push(String(e)));
    await seed(page);
    const noteId = await page.evaluate(()=>N.core.S.id);
    await page.evaluate(()=>N.library.open());
    await page.waitForFunction(()=>N.library.isOpen);
    assert.equal(await page.evaluate(()=>N.library.mode), 'page');
    await page.waitForTimeout(500);                        /* the page slides in */
    const box = await page.locator('#library .lib-panel').boundingBox();
    assert.deepEqual([box.x, box.y, Math.round(box.width)], [0, 0, 412], 'the list fills the phone');
    assert.equal(await page.locator('#lib-fab').isVisible(), true, 'new note sits in thumb reach');
    assert.equal(await page.locator('#lib-new').isVisible(), false);
    await rows(page).first().waitFor();
    await page.waitForTimeout(400);
    if(shots) await page.screenshot({path:shots+'/phone-page.png'});
    // the system back gesture closes the page, not the notebook
    await page.goBack();
    await page.waitForFunction(()=>!N.library.isOpen);
    assert.equal(await page.evaluate(()=>N.core.S.id), noteId);
    assert.equal(page.url().startsWith(base+'/notas.html'), true);

    // a long press picks a note; the bar acts on the pick
    await page.evaluate(()=>N.library.open());
    await page.waitForFunction(()=>N.library.isOpen);
    await rows(page).first().waitFor();
    const touch = async(sel, type, x, y)=>page.evaluate(([sel, type, x, y])=>{
      const el = document.querySelector(sel), r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent(type, {bubbles:true, pointerId:7, pointerType:'touch', isPrimary:true, button:0, clientX:r.left + x, clientY:r.top + y}));
    }, [sel, type, x, y]);
    const second = '#library .note-row:nth-child(2) .t';
    await touch(second, 'pointerdown', 120, 20);
    await page.waitForTimeout(600);
    await touch(second, 'pointerup', 120, 20);
    assert.equal(await page.locator('.lib-count').textContent(), '1 selected');
    assert.equal(await page.locator('#lib-fab').isVisible(), false);
    if(shots) await page.screenshot({path:shots+'/phone-select.png'});
    await page.locator('.lib-selbar [data-done]').tap();

    // a swipe to the left sends a note to the trash
    const first = '#library .note-row:first-child .t', name = (await names(page))[0];
    await touch(first, 'pointerdown', 200, 20);
    for(const dx of [-20, -60, -110, -140]) await touch(first, 'pointermove', 200 + dx, 22);
    await touch(first, 'pointerup', 60, 22);
    await page.locator('#lib-undo.in').waitFor();
    assert.equal((await names(page)).includes(name), false, 'swiped note left the list');
    assert.equal((await index(page)).find(r=>r.title===name || r.preview===name).trashed > 0, true);
    // a note opened from the page closes it and pops its history entry
    await page.waitForTimeout(450);                        /* the swipe's own tap is swallowed, not the next */
    await rows(page).first().locator('.t').tap();
    await page.waitForFunction(()=>!N.library.isOpen);

    assert.deepEqual(errors, [], 'no page errors on the phone');
    await context.close();
  }
  console.log('library: ok');
}finally{
  await browser.close();
  server.close();
}
