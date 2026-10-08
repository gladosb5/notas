// What nota writes is plain: the dollars around maths and markdown the model
// adds never reach the paper, in handwriting or in a typed reply, while a
// price keeps its dollar and maths the page can show keeps its own.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve.mjs';
const server=await startServer(0),browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block'});
 page.on('pageerror',e=>{throw e;});
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.nota?.tidy);
 const tidy=(text,keep=false)=>page.evaluate(({text,keep})=>N.nota.tidy(text,keep),{text,keep});
 const cases=[
  ['**Answer:** $x = 3$','Answer: x = 3'],
  ['The length is $5 cm$.','The length is 5 cm.'],
  ['costs $5 and $10','costs $5 and $10'],
  ['pay \\$5','pay $5'],
  ['a $ stray and $$ more','a stray and more'],
  ['# Steps\n- add 2\n* *then* double it\n+ done','Steps\nadd 2\nthen double it\ndone'],
  ['$\\frac{\\sqrt{9}}{2}$','(sqrt(9))/(2)'],
  ['$\\dfrac{1}{2}$ of $\\text{the cake}$','(1)/(2) of the cake'],
  ['| item | cost |\n|---|---|\n| milk | 2 |','item, cost\nmilk, 2'],
  ['see [my notes](https://example.com/a)','see my notes'],
  ['> a quote\n> two','a quote\ntwo'],
  ['~~wrong~~ `right` and _this_','wrong right and this'],
  ['50\\% of \\(x\\)','50% of x'],
  ['x_1 + 2*3*4 = 24','x_1 + 2*3*4 = 24'],
  ['1. first\n2. second','1. first\n2. second']
 ];
 for(const [text,want] of cases)assert.equal(await tidy(text),want,JSON.stringify(text));
 /* a typed reply keeps maths the page can show, and loses the rest */
 assert.equal(await tidy('**So** $x+2$ costs $5 and $3 cm$',true),'So $x+2$ costs $5 and 3 cm');
 assert.equal(await tidy('The value is $x+2$.',true),'The value is $x+2$.');
 console.log('Answer formatting passed: dollars and markdown stripped, prices and real maths kept.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
