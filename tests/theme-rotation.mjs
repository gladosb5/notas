import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0),base=process.env.NOTAS_BASE_URL||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
const errors=[];
async function open(options,prefs){
  const context=await browser.newContext({serviceWorkers:'block',colorScheme:'dark',...options});
  await context.addInitScript(prefs=>{
    if(!localStorage.getItem('notas.prefs'))localStorage.setItem('notas.prefs',JSON.stringify({...prefs,animations:false}));
    localStorage.setItem('notas.tut','done');
  },prefs);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/notas.html');
  await page.waitForFunction(()=>window.N?.ui?.applyTheme&&N.core.S.id);
  await page.evaluate(()=>{
    N.tutorial.finish(false);document.getElementById('preparing').classList.add('done');
    N.core.S.settings.aiOn=false;N.ai.toggle();
  });
  return {context,page};
}
async function palette(page,dark,white=false){
  const paper=dark?'rgb(21, 21, 23)':white?'rgb(255, 255, 255)':'rgb(245, 245, 247)';
  const ink=dark?'rgb(242, 242, 244)':'rgb(28, 28, 30)';
  await page.waitForFunction(([paper,ink])=>getComputedStyle(document.body).backgroundColor===paper&&getComputedStyle(document.body).color===ink&&N.ink.colors.paper.toLowerCase()===getComputedStyle(document.documentElement).getPropertyValue('--paper').trim().toLowerCase(),[paper,ink]);
  const actual=await page.evaluate(()=>{
    const root=getComputedStyle(document.documentElement);
    return {launch:document.documentElement.dataset.launchTheme,scheme:root.colorScheme,
      paper:root.getPropertyValue('--paper').trim(),canvas:N.ink.colors.paper,
      text:getComputedStyle(document.querySelector('.line .txt')||document.body).color,
      menu:document.querySelector('.sheet h2')?getComputedStyle(document.querySelector('.sheet h2')).color:null};
  });
  assert.equal(actual.launch,undefined,'launch theme no longer overrides the notebook');
  assert.equal(actual.scheme,dark?'dark':'light');
  assert.equal(actual.canvas.toLowerCase(),actual.paper.toLowerCase(),'canvas matches the page');
  assert.equal(actual.text,ink,'typed text follows the palette');
  if(actual.menu)assert.equal(actual.menu,ink,'menu labels follow the palette');
}

try{
  // The saved light palette must also cover a slow startup on a dark device.
  for(const prefs of [{theme:'light',paper:'default'},{theme:'dark',paper:'white'}]){
    const context=await browser.newContext({serviceWorkers:'block',colorScheme:'dark'});
    await context.addInitScript(prefs=>localStorage.setItem('notas.prefs',JSON.stringify({...prefs,animations:false})),prefs);
    let release;const held=new Promise(resolve=>release=resolve);
    await context.route(/\/assets\/idb\.js$/,async route=>{await held;await route.continue();});
    try{
      const page=await context.newPage();await page.goto(base+'/notas.html',{waitUntil:'commit'});
      await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
      assert.equal(await page.locator('#preparing').isVisible(),true);
      assert.equal(await page.locator('#preparing').evaluate(el=>getComputedStyle(el).backgroundColor),prefs.paper==='white'?'rgb(255, 255, 255)':'rgb(245, 245, 247)');
      assert.equal(await page.locator('#preparing').evaluate(el=>getComputedStyle(el).color),'rgb(28, 28, 30)');
    }finally{release();await context.close();}
  }
  // Reproduce a dark startup followed by the real light-theme settings action.
  const {context,page}=await open({viewport:{width:1280,height:900}},{theme:'dark',paper:'default'});
  await palette(page,true);
  await page.evaluate(()=>{
    N.core.S.lines=[{id:'theme-text',text:'A clear page for your next idea.',x:0,y:180}];N.text.render();N.ui.menuSheet();
  });
  await page.locator('#seg-theme button[data-v="light"]').click();
  await palette(page,false);
  const contrast=await page.evaluate(()=>{
    const rgba=v=>v.match(/[\d.]+/g).map(Number);
    const blend=(fg,bg)=>fg.slice(0,3).map((c,i)=>c*(fg[3]??1)+bg[i]*(1-(fg[3]??1)));
    const luminance=rgb=>rgb.map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
    return ['#seg-theme button[data-v="auto"]','#quick-expression'].map(selector=>{
      const el=document.querySelector(selector),chain=[];let ancestor=el;
      while(ancestor){chain.unshift(ancestor);ancestor=ancestor.parentElement;}
      const background=chain.reduce((bg,node)=>blend(rgba(getComputedStyle(node).backgroundColor),bg),[255,255,255]);
      const text=blend(rgba(getComputedStyle(el,el.matches('input')?'::placeholder':null).color),background);
      return {selector,ratio:(Math.max(luminance(text),luminance(background))+.05)/(Math.min(luminance(text),luminance(background))+.05)};
    });
  });
  for(const check of contrast)assert.ok(check.ratio>=4.5,'light-mode secondary labels and placeholders meet 4.5:1 contrast: '+JSON.stringify(check));
  await page.screenshot({path:fileURLToPath(new URL('../test-results/theme-light-menu.png',import.meta.url))});
  await page.evaluate(()=>N.ui.closeSheet());
  await page.waitForFunction(()=>!document.querySelector('.sheet'));
  await page.screenshot({path:fileURLToPath(new URL('../test-results/theme-light-page.png',import.meta.url))});
  await page.reload();await page.waitForFunction(()=>window.N?.ui?.applyTheme&&N.core.S.id);
  await palette(page,false);
  await page.evaluate(()=>N.ui.menuSheet());
  await page.locator('#seg-theme button[data-v="auto"]').click();await palette(page,true);
  await page.emulateMedia({colorScheme:'light'});await palette(page,false);
  await page.emulateMedia({colorScheme:'dark'});await palette(page,true);
  await page.locator('#seg-paper button[data-v="white"]').click();await palette(page,false,true);
  await context.close();
  // White paper must also open light on its first paint, despite saved dark mode.
  const white=await open({viewport:{width:800,height:1100}},{theme:'dark',paper:'white'});
  await palette(white.page,false,true);await white.context.close();

  for(const viewport of [{width:1280,height:900},{width:820,height:1100},{width:390,height:844}]){
    const {context,page}=await open({viewport,hasTouch:viewport.width<1000},{theme:'light',paper:'default'});
    await page.evaluate(()=>{
      const cv=document.createElement('canvas');cv.width=180;cv.height=260;
      const x=cv.getContext('2d');x.fillStyle='#3670B2';x.fillRect(0,0,180,260);
      x.fillStyle='#F5F5F7';x.font='22px sans-serif';x.fillText('your image',32,135);
      const S=N.core.S;S.lines=[];S.selection=[];S.images=[{id:'rotate',src:cv.toDataURL(),x:100,y:200,w:180,h:260}];
      N.text.render();N.ink.setTool('select');N.ink.selectImage('rotate');
    });
    for(const zoom of [.5,1,1.75]){
      await page.evaluate(zoom=>N.core.setZoom(zoom,innerWidth/2,innerHeight/2),zoom);
      const checks=await page.evaluate(async()=>{
        await new Promise(requestAnimationFrame);
        const C=N.core,M=C.M,S=C.S,sc=document.getElementById('scroller'),r=sc.getBoundingClientRect(),im=S.images[0],failures=[];
        for(const level of [.3,.7,.9])for(let step=-12;step<=12;step++){
          im.rot=step*Math.PI/12;
          im.x=(r.width/2-M.colLeft+sc.scrollLeft)/M.zoom-im.w/2;
          im.y=(r.height*level+sc.scrollTop)/M.zoom-im.h/2;
          N.ink.showSelBar();
          const bar=document.getElementById('selbar').getBoundingClientRect();
          for(const hd of N.ink.frameHandles(N.ink.frameOf(im))){
            const p={x:r.left+M.colLeft-sc.scrollLeft+hd.x*M.zoom,y:r.top-sc.scrollTop+hd.y*M.zoom};
            if(p.x+22>=bar.left&&p.x-22<=bar.right&&p.y+22>=bar.top&&p.y-22<=bar.bottom)
              failures.push({angle:step*15,level,handle:hd.k,p,bar:{left:bar.left,top:bar.top,right:bar.right,bottom:bar.bottom}});
          }
          if(bar.left<r.left+7||bar.right>r.right-7||bar.top<r.top+7||bar.bottom>r.bottom-7)failures.push({outside:true,angle:step*15,level,bar:{left:bar.left,top:bar.top,right:bar.right,bottom:bar.bottom}});
        }
        return failures;
      });
      assert.equal(checks.length,0,`${viewport.width}px, zoom ${zoom}: toolbar leaves every handle's touch target clear: ${JSON.stringify(checks.slice(0,3))}`);
    }
    // Actually grab the downward-facing knob, turn, release and grab it again.
    const points=await page.evaluate(()=>{
      const C=N.core;C.setZoom(1,innerWidth/2,innerHeight/2);
      const M=C.M,sc=document.getElementById('scroller'),r=sc.getBoundingClientRect(),im=C.S.images[0];
      im.x=(r.width/2-M.colLeft+sc.scrollLeft)-im.w/2;im.y=r.height*.43+sc.scrollTop-im.h/2;im.rot=Math.PI;
      N.ink.showSelBar();N.ink.render();
      const hd=N.ink.frameHandles(N.ink.frameOf(im)).find(p=>p.k==='rot');
      return {x:r.left+M.colLeft-sc.scrollLeft+hd.x,y:r.top-sc.scrollTop+hd.y,cx:r.left+r.width/2,cy:r.top+r.height*.43};
    });
    await page.mouse.move(points.x,points.y);await page.mouse.down();
    await page.mouse.move(points.cx+160,points.cy,{steps:12});
    assert.equal(await page.locator('#selbar').isHidden(),true,'toolbar stays out of the way during a turn');
    await page.mouse.up();
    assert.equal(await page.locator('#selbar').isVisible(),true,'toolbar returns after a turn');
    assert.ok(Math.abs((await page.evaluate(()=>N.core.S.images[0].rot))-Math.PI/2)<.05,'downward-facing handle remains draggable');
    await page.mouse.move(points.cx+160,points.cy);await page.mouse.down();
    await page.mouse.move(points.x,points.y,{steps:12});await page.mouse.up();
    assert.ok(Math.abs(Math.abs(await page.evaluate(()=>N.core.S.images[0].rot))-Math.PI)<.05,'rotation handle can be grabbed again after releasing it');
    await page.screenshot({path:fileURLToPath(new URL(`../test-results/rotation-toolbar-${viewport.width}.png`,import.meta.url))});
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log('Theme and rotation: dark-to-light, reload, automatic theme, white paper, readable page/menu/canvas; 675 angle/zoom/viewport placements and real handle drags passed.');
}finally{await browser.close();server.close();}
