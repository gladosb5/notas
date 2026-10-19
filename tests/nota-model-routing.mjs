import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';
const typedPrimary='qwen-3.8-27b';
const primary='qwen-3.8-27b',cloudflare='@cf/qwen/qwen3.8-27b',textModel='gpt-oss-120b';
const server=await startServer(0),browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({serviceWorkers:'block'});
 const source=(await readFile(new URL('../nota.js',import.meta.url),'utf8')).replace('N.nota={','N.nota={stream,');
 await page.route('**/nota.js',r=>r.fulfill({contentType:'application/javascript',body:source}));
 const calls=[];let mode='ok',cfMode='ok',txMode='ok';
 const sse=delta=>'data: '+JSON.stringify({choices:[{delta}]})+'\n\ndata: [DONE]\n\n';
 await page.route(/\/nota\/chat$|api\.cerebras\.ai/,async route=>{
  const body=route.request().postDataJSON();calls.push({body,url:route.request().url()});
  const failure=body.model===primary?mode:body.model===cloudflare?cfMode:txMode;
  if(failure==='http')return route.fulfill({status:503,body:'model unavailable'});
  if(failure==='network')return route.abort('failed');
  if(failure==='empty')return route.fulfill({contentType:'text/event-stream',body:'data: [DONE]\n\n'});
  if(failure==='error')return route.fulfill({contentType:'text/event-stream',body:'data: {"error":{"message":"unavailable"}}\n\n'});
  if(failure==='daily')return route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:{message:'model daily token limit exceeded'}})});
  if(failure==='payment')return route.fulfill({status:402,contentType:'application/json',body:JSON.stringify({message:'Payment required to access this resource. Visit your billing tab.',type:'payment_required_error',param:'quota',code:'payment_required'})});
  if(failure==='site')return route.fulfill({status:429,body:'nota has reached its daily allowance. try again tomorrow.'});
  if(failure==='auth')return route.fulfill({status:401,body:'key refused'});
  if(failure==='absent')return route.fulfill({status:404,body:'no forward here'});
  if(failure==='unconfigured')return route.fulfill({status:503,body:'nota Cloudflare fallback is not configured.'});
  if(failure==='timeout'||failure==='cancel'){await new Promise(r=>setTimeout(r,150));return route.fulfill({contentType:'text/event-stream',body:sse({content:'late'})}).catch(()=>{});}
  if(failure==='partial')return route.fulfill({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"lost"}}\n\n'});
  if(failure==='tool-error')return route.fulfill({contentType:'text/event-stream',body:sse({tool_calls:[{index:0,id:'call_a',type:'function',function:{name:'list_notes',arguments:'{}'}}]})});
  return route.fulfill({contentType:'text/event-stream',body:sse({content:'answer'})});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/notas.html`);
 await page.waitForFunction(()=>window.N?.nota?.stream);
 const run=async(typed=false,tools=false)=>{calls.length=0;return page.evaluate(async({typed,mode,cfMode,tools})=>{
  const control=new AbortController();let text='',fallbacks=0,grabs=0;
  N.nota.config.visionWaitMs=mode==='timeout'?30:20000;
  if(mode==='cancel')setTimeout(()=>control.abort(),30);
  try{await N.nota.stream('what is this','page context',p=>text+=p,control.signal,{url:'data:image/jpeg;base64,AAAA',w:1,h:1},typed,()=>{fallbacks++;N.nota.config.visionWaitMs=cfMode==='timeout'?30:20000;},tools?{onGrab:()=>grabs++}:null);return {text,fallbacks,grabs};}
  catch(e){return {text,fallbacks,grabs,error:true};}
 },{typed:typed&&typedPrimary===textModel,mode,cfMode,tools});};
 const models=()=>calls.map(c=>c.body.model);
 const image=call=>call.body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));
 assert.deepEqual(await run(true),{text:'answer',fallbacks:0,grabs:0});
 assert.deepEqual(models(),[typedPrimary]);
 assert.deepEqual(await run(),{text:'answer',fallbacks:0,grabs:0});
 assert.deepEqual(models(),[primary]);assert.ok(image(calls[0]));
 for(mode of ['http','network','empty','error','daily','timeout']){
  assert.deepEqual(await run(),{text:'answer',fallbacks:1,grabs:0},mode);
  assert.deepEqual(models(),[primary,cloudflare],mode);
  assert.ok(image(calls[1]),mode+' Cloudflare keeps the image');
  assert.ok(calls[1].url.endsWith('/nota/chat'));
  assert.deepEqual(calls[1].body.messages,calls[0].body.messages);
 }
 mode='http';
 for(cfMode of ['http','network','empty','error','daily','timeout','unconfigured']){
  assert.deepEqual(await run(),{text:'answer',fallbacks:2,grabs:0},cfMode);
  assert.deepEqual(models(),[primary,cloudflare,textModel]);
  assert.ok(image(calls[1]));assert.ok(!image(calls[2]));
  assert.match(calls[2].body.messages[1].content,/page context/);
 }
 cfMode='ok';
 for(mode of ['site','auth','cancel','partial']){
  const result=await run();assert.equal(result.error,true,mode);assert.equal(result.fallbacks,0,mode);
  assert.deepEqual(models(),[primary]);
 }
 mode='http';
 for(cfMode of ['site','auth','partial']){
  const result=await run();assert.equal(result.error,true,cfMode);assert.equal(result.fallbacks,1,cfMode);
  assert.deepEqual(models(),[primary,cloudflare]);
 }
 // A browser Cerebras key never routes Cloudflare directly to Cerebras.
 mode='http';
 await page.evaluate(()=>localStorage.setItem('notas.nota.key','csk-test-browser-only'));
 for(cfMode of ['absent','network']){
  assert.deepEqual(await run(),{text:'answer',fallbacks:2,grabs:0});
  assert.deepEqual(models(),[primary,cloudflare,textModel]);
  assert.ok(calls.every(c=>c.url.endsWith('/nota/chat')));
 }
 await page.evaluate(()=>localStorage.removeItem('notas.nota.key'));
 // Tools still work on Cloudflare, and a tool round never triggers another provider.
 cfMode='ok';
 assert.deepEqual(await run(false,true),{text:'answer',fallbacks:1,grabs:0});
 assert.deepEqual(models(),[primary,cloudflare]);assert.ok(calls[1].body.tools);
 cfMode='tool-error';
 const result=await run(false,true);assert.equal(result.error,true);assert.equal(result.grabs,3);
 assert.ok(models().slice(1).every(m=>m===cloudflare));
 // Cerebras out of credit or out of its day: its text model would be refused
 // too, so Cloudflare is the last attempt and is not cut off by the wait.
 for(mode of ['payment','daily']){
  cfMode='ok';
  assert.deepEqual(await run(),{text:'answer',fallbacks:1,grabs:0},mode);
  assert.deepEqual(models(),[primary,cloudflare],mode);
  cfMode='timeout';
  assert.deepEqual(await run(),{text:'late',fallbacks:1,grabs:0},mode+' slow Cloudflare');
  assert.deepEqual(models(),[primary,cloudflare],mode);
  cfMode='http';
  const spent=await run();assert.equal(spent.error,true,mode);
  assert.deepEqual(models(),[primary,cloudflare],mode);
 }
 // A typed question falls back to Cloudflare as well.
 if(typedPrimary===textModel){
  mode='ok';cfMode='ok';txMode='payment';
  assert.deepEqual(await run(true),{text:'answer',fallbacks:1,grabs:0});
  assert.deepEqual(models(),[textModel,cloudflare]);
  assert.ok(!image(calls[0]),'GPT-OSS gets words only');
  assert.ok(image(calls[1]),'the Qwen fallback gets the page picture');
  txMode='ok';
 }
 // Cloudflare's Qwen streams its thinking for longer than the wait before
 // its words; a model that is thinking is not abandoned for the next one.
 mode='http';calls.length=0;
 const thinking=await page.evaluate(async cloudflare=>{
  const real=window.fetch;
  window.fetch=async(url,init)=>{
   if(JSON.parse(init.body).model!==cloudflare)return real(url,init);
   const enc=new TextEncoder(),line=delta=>enc.encode('data: '+JSON.stringify({choices:[{delta}]})+'\n\n');
   return new Response(new ReadableStream({async start(c){
    c.enqueue(line({reasoning:'hmm'}));await new Promise(r=>setTimeout(r,200));
    c.enqueue(line({content:'thought'}));c.enqueue(enc.encode('data: [DONE]\n\n'));c.close();
   }}),{headers:{'Content-Type':'text/event-stream'}});
  };
  N.nota.config.visionWaitMs=50;let text='';
  try{await N.nota.stream('what is this','page context',p=>text+=p,new AbortController().signal,null,false,()=>{});}
  catch(e){text='error: '+e.message;}
  finally{window.fetch=real;}
  return text;
 },cloudflare);
 assert.equal(thinking,'thought');
 assert.deepEqual(models(),[primary]);
 console.log('Three-provider routing passed: image preservation, text-only final fallback, tools, failure/timeout, site/auth, cancellation and partial answers.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
