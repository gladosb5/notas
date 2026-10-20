import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {startServer} from '../scripts/serve.mjs';

const server=await startServer(0);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
const errors=[];
try{
  for(const dpr of [1,2]){
    const context=await browser.newContext({serviceWorkers:'block',deviceScaleFactor:dpr,viewport:{width:1280,height:900}});
    await context.addInitScript(()=>localStorage.setItem('notas.prefs',JSON.stringify({handwritingRecognitionOn:false,textRecognitionOn:false,backgroundRemovalOn:false,notaOn:false})));
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
    await page.waitForFunction(()=>window.N?.ink&&document.querySelector('#preparing').classList.contains('done'));
    await page.evaluate(()=>N.tutorial.finish(false));
    const screen=([x,y])=>page.evaluate(([x,y])=>{
      const sc=document.querySelector('#scroller'),r=sc.getBoundingClientRect(),M=N.core.M;
      return {x:r.left+M.colLeft+x*M.zoom-sc.scrollLeft,y:r.top+y*M.zoom-sc.scrollTop};
    },[x,y]);
    const move=async point=>{const p=await screen(point);await page.mouse.move(p.x,p.y);};
    const opacity=()=>page.evaluate(()=>getComputedStyle(document.querySelector('#c-ink')).opacity);
    const cleared=async()=>{
      assert.equal(await opacity(),'1','live opacity resets after the gesture');
      assert.equal(await page.evaluate(()=>{
        const c=document.querySelector('#c-ink'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        return data.some((v,i)=>i%4===3&&v!==0);
      }),false,'the temporary eraser trail clears');
    };
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>{N.core.S.settings.theme=theme;N.ui.applyTheme();N.ink.setTool('eraser');},theme);
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme,'the requested theme is active');
      for(const zoom of [0.75,1.5]){
        await page.evaluate(zoom=>N.core.setZoom(zoom),zoom);
        await page.waitForTimeout(100);
        await move([50,340]);await page.mouse.down();
        // Both sparse and dense events, followed by retracing and a crossing.
        for(let i=1;i<=30;i++)await move([50+i*12,340]);
        for(let i=0;i<15;i++)await move([410-i*12,340]);
        for(const point of [[230,310],[230,330],[230,350],[230,370],[250,350]])await move(point);
        const alpha=await page.evaluate(()=>{
          const c=document.querySelector('#c-ink'),ctx=c.getContext('2d'),M=N.core.M,sc=document.querySelector('#scroller');
          const opacity=Number(getComputedStyle(c).opacity),values=[];
          for(let x=75;x<=390;x++){
            const px=Math.round((M.colLeft+x*M.zoom-sc.scrollLeft)*M.dpr),py=Math.round((340*M.zoom-sc.scrollTop)*M.dpr);
            values.push(ctx.getImageData(px,py,1,1).data[3]*opacity);
          }
          return {min:Math.min(...values),max:Math.max(...values)};
        });
        assert.ok(alpha.max-alpha.min<2,`eraser has even opacity at DPR ${dpr}, ${theme}, zoom ${zoom}: ${JSON.stringify(alpha)}`);
        assert.ok(alpha.min>50&&alpha.max<65,'the trail stays translucent even where it crosses itself');
        if(dpr===1&&zoom===1.5){
          mkdirSync(new URL('../test-results/',import.meta.url),{recursive:true});
          await page.locator('#scroller').screenshot({path:fileURLToPath(new URL(`../test-results/eraser-trail-${theme}.png`,import.meta.url))});
        }
        await page.mouse.up();await cleared();
      }
    }
    // Ending a gesture on focus loss must also restore normal pen/lasso opacity.
    await move([100,340]);await page.mouse.down();await move([140,340]);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    await page.mouse.up();await cleared();
    await page.evaluate(()=>N.ink.setTool('pen'));
    await move([100,440]);await page.mouse.down();await move([220,440]);
    assert.equal(await opacity(),'1','pen preview stays fully opaque after erasing');
    await page.mouse.up();
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log('Eraser trail: uniform opacity across joins, retracing and crossings; light/dark, zoom, DPR 1/2, release, blur and pen opacity pass.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
