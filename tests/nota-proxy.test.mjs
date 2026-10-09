import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startServer} from '../scripts/serve.mjs';
import {MODEL,CLOUDFLARE_MODEL,TEXT_MODEL,MAX_TOKENS,bodyTokens,notaBody} from '../server/nota-body.mjs';
const originalFetch=globalThis.fetch;
const workerURL=new URL('../deploy/cloudflare/worker.js',import.meta.url);
const source=(await readFile(workerURL,'utf8')).replace(/^export \{ NoteRoom \}.*$/m,'')
 .replace(/from '([^']+)'/g,(_,specifier)=>`from '${new URL(specifier,workerURL).href}'`);
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const jpeg='data:image/jpeg;base64,AAAA';
const ask=model=>({model,stream:true,max_tokens:99999,reasoning_effort:'low',messages:[{role:'user',content:model===TEXT_MODEL?'question':[{type:'text',text:'question'},{type:'image_url',image_url:{url:jpeg}}]}],tools:[{}]});
const sse='data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n';
const settings={CEREBRAS_API_KEY:'test-cerebras',CLOUDFLARE_ACCOUNT_ID:'test-account',CLOUDFLARE_API_TOKEN:'test-cloudflare'};

test('Node proxy routes each model with the correct credentials, sanitizes bodies, and handles missing configuration',async t=>{
 const saved=Object.fromEntries(Object.keys(settings).map(k=>[k,process.env[k]]));
 Object.assign(process.env,settings);
 t.after(()=>{for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const server=await startServer(0);
 t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return new Response(sse,{headers:{'Content-Type':'text/event-stream'}});});
 const request=body=>originalFetch(`http://127.0.0.1:${server.address().port}/nota/chat`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer browser-cerebras'},body:JSON.stringify(body)});
 for(const model of [MODEL,CLOUDFLARE_MODEL,TEXT_MODEL]){
  const response=await request(ask(model));assert.equal(response.status,200);assert.equal(await response.text(),sse);
  const {url,options}=calls.at(-1),body=JSON.parse(options.body);
  assert.equal(url,model===CLOUDFLARE_MODEL?'https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/chat/completions':'https://api.cerebras.ai/v1/chat/completions');
  assert.equal(options.headers.Authorization,'Bearer '+(model===CLOUDFLARE_MODEL?'test-cloudflare':'test-cerebras'));
  assert.equal(body.max_tokens,MAX_TOKENS);assert.equal(body.model,model);assert.equal(body.tools[0].function.name,'list_notes');
  if(model!==TEXT_MODEL)assert.equal(body.messages[0].content[1].image_url.url,jpeg);
 }
 const count=calls.length;
 delete process.env.CLOUDFLARE_API_TOKEN;
 let response=await request(ask(CLOUDFLARE_MODEL));assert.equal(response.status,503);await response.text();assert.equal(calls.length,count);
 response=await request(ask(TEXT_MODEL));assert.equal(response.status,200);await response.text();
 delete process.env.CEREBRAS_API_KEY;
 response=await request(ask(TEXT_MODEL));assert.equal(response.status,200);await response.text();assert.equal(calls.at(-1).options.headers.Authorization,'Bearer browser-cerebras');
 response=await request(ask('other'));assert.equal(response.status,400);await response.text();
});

test('Worker routing protects the site token, reserves each provider attempt, and preserves upstream SSE/errors',async t=>{
 const calls=[],reservations=[];
 const env={...settings,NOTA_LIMIT:{limit:async()=>({success:true})},ROOMS:{idFromName:x=>x,get:()=>({fetch:async r=>{reservations.push(await r.json());return new Response('ok');}})}};
 let status=200;
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return new Response(status===200?sse:'provider unavailable',{status,headers:{'Content-Type':status===200?'text/event-stream':'text/plain'}});});
 const request=(model,origin='https://notas.test')=>worker.fetch(new Request('https://notas.test/nota/chat',{method:'POST',headers:{...(origin?{Origin:origin}:{}),'Content-Type':'application/json','Authorization':'Bearer browser-cerebras'},body:JSON.stringify(ask(model))}),env,{});
 for(const model of [MODEL,CLOUDFLARE_MODEL,TEXT_MODEL]){
  const response=await request(model);assert.equal(response.status,200);assert.equal(await response.text(),sse);
  const {url,options}=calls.at(-1),body=JSON.parse(options.body);
  assert.equal(url.includes('api.cloudflare.com'),model===CLOUDFLARE_MODEL);
  assert.equal(options.headers.Authorization,'Bearer '+(model===CLOUDFLARE_MODEL?'test-cloudflare':'test-cerebras'));
  assert.equal(reservations.at(-1).tokens,bodyTokens(notaBody(ask(model))));
  assert.equal(body.model,model);assert.equal(body.max_tokens,MAX_TOKENS);
 }
 assert.equal(reservations.length,3);
 const count=calls.length;
 assert.equal((await request(CLOUDFLARE_MODEL,'https://other.test')).status,403);
 assert.equal((await request(CLOUDFLARE_MODEL,null)).status,503);
 assert.equal((await request('other')).status,400);
 assert.equal(calls.length,count);
 delete env.CLOUDFLARE_ACCOUNT_ID;
 assert.equal((await request(CLOUDFLARE_MODEL)).status,503);assert.equal(calls.length,count);
 env.CLOUDFLARE_ACCOUNT_ID='test-account';
 env.NOTA_LIMIT.limit=async()=>({success:false});
 assert.equal((await request(CLOUDFLARE_MODEL)).status,429);assert.equal(calls.length,count);
 env.NOTA_LIMIT.limit=async()=>({success:true});
 env.ROOMS.get=()=>({fetch:async()=>new Response('limit',{status:429})});
 assert.equal((await request(CLOUDFLARE_MODEL)).status,429);assert.equal(calls.length,count);
 env.ROOMS.get=()=>({fetch:async()=>new Response('ok')});
 status=503;
 const response=await request(CLOUDFLARE_MODEL);assert.equal(response.status,503);assert.equal(await response.text(),'provider unavailable');
});
