// What the site's key may be spent on: nota's own question to its model, in
// words and up to two pictures of the page, and nothing a caller adds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {notaBody,bodyTokens,MODEL,TEXT_MODEL,CLOUDFLARE_MODEL,MAX_TOKENS,IMAGE_TOKENS,MAX_BODY,TOOLS,TOOL_ROUNDS,TOOL_CALLS} from '../server/nota-body.mjs';

const jpeg='data:image/jpeg;base64,'+'A'.repeat(4000);
const ask=(content,extra={})=>({model:MODEL,stream:true,max_tokens:1600,messages:[{role:'system',content:'you are nota'},{role:'user',content}],...extra});

test('only the supported vision and text models are allowed',()=>{
  assert.equal(MODEL,'qwen-3.8-27b');
  assert.ok(notaBody(ask('hello')));
  assert.equal(notaBody({...ask('hello'),model:TEXT_MODEL}).model,TEXT_MODEL);
  assert.equal(notaBody(ask([{type:'image_url',image_url:{url:jpeg}}],{model:TEXT_MODEL})),null);
  assert.equal(notaBody({...ask('hello'),stream:false}),null);
});

test('a question in words and a picture of the page goes through as it was sent',()=>{
  const body=notaBody(ask([{type:'text',text:'Question: what is this?'},{type:'image_url',image_url:{url:jpeg,detail:'high'}}],{reasoning_effort:'low',temperature:.3,tools:[{}],n:4}));
  assert.deepEqual(body.messages[1].content,[{type:'text',text:'Question: what is this?'},{type:'image_url',image_url:{url:jpeg}}],'only the parts nota sends, and no detail setting the provider refuses');
  assert.equal(body.reasoning_effort,'low');
  assert.deepEqual(body.tools,TOOLS,'the tools sent are always the ones nota has');assert.equal(body.n,undefined);
  assert.ok(notaBody(ask([{type:'image_url',image_url:{url:'data:image/png;base64,iVBORw0KGgo='}}])),'a PNG is taken too');
});

test('pictures the provider would refuse, or that could carry anything else, are not sent',()=>{
  const pic=url=>ask([{type:'text',text:'q'},{type:'image_url',image_url:{url}}]);
  assert.equal(notaBody(pic('https://example.com/a.jpg')),null,'no links: the provider fetches nothing');
  assert.equal(notaBody(pic('data:image/gif;base64,R0lGOD')),null,'only PNG and JPEG');
  assert.equal(notaBody(pic('data:image/svg+xml;base64,PHN2Zz4=')),null);
  assert.equal(notaBody(pic('data:image/jpeg;base64,AAAA"}],"tools":[')),null,'base64 and nothing else');
  assert.equal(notaBody(pic('data:image/jpeg;base64,'+'A'.repeat(1600*1024))),null,'not too large');
  const three=[{type:'text',text:'q'},...[1,2,3].map(()=>({type:'image_url',image_url:{url:jpeg}}))];
  assert.equal(notaBody(ask(three)),null,'two pictures at most');
  assert.equal(notaBody({...ask('q'),messages:[{role:'system',content:[{type:'image_url',image_url:{url:jpeg}}]},{role:'user',content:'q'}]}),null,'pictures only in the question');
  assert.equal(notaBody(ask([{type:'video_url',video_url:{url:jpeg}}])),null,'nothing but words and pictures');
  assert.ok(MAX_BODY>2*1500*1024,'the forward lets two pictures through');
});

test('the answer is long enough for the thinking before it, and no longer',()=>{
  assert.equal(notaBody(ask('q',{max_tokens:100000})).max_tokens,MAX_TOKENS);
  assert.ok(MAX_TOKENS>=1600);
  assert.equal(notaBody(ask('q',{reasoning_effort:'none'})).reasoning_effort,'none','thinking can be turned off');
  assert.equal(notaBody(ask('q',{reasoning_effort:'max'})).reasoning_effort,undefined);
});

test('a picture counts against the daily allowance',()=>{
  const words=notaBody(ask('Question: what is this?')),seen=notaBody(ask([{type:'text',text:'Question: what is this?'},{type:'image_url',image_url:{url:jpeg}}]));
  assert.equal(bodyTokens(seen)-bodyTokens(words),IMAGE_TOKENS);
  assert.ok(bodyTokens(words)>=words.max_tokens);
});

test("nota's own tools, offered only when asked for",()=>{
  assert.equal(notaBody(ask('q')).tools,undefined);
  assert.deepEqual(TOOLS.map(t=>t.function.name),['list_notes','read_note']);
  const forged=notaBody(ask('q',{tools:[{type:'function',function:{name:'fetch_url',parameters:{}}}],tool_choice:{type:'function',function:{name:'fetch_url'}}}));
  assert.deepEqual(forged.tools,TOOLS,"a caller's own definitions are never sent");
  assert.equal(forged.tool_choice,'auto');
  assert.equal(notaBody(ask('q',{tools:[{}],tool_choice:'none'})).tool_choice,'none');
});

const call=(id,name='read_note',args='{"id":"abc"}')=>({id,type:'function',function:{name,arguments:args}});
const round=(id,extra={})=>[{role:'assistant',content:null,tool_calls:[call(id)],...extra},{role:'tool',tool_call_id:id,content:'{"title":"photosynthesis","text":"chloroplasts"}'}];
const convo=(...rest)=>({...ask('q'),tools:[{}],messages:[{role:'system',content:'you are nota'},{role:'user',content:'q'},...rest]});

test("nota's calls and their results go through, and nothing else in their place",()=>{
  const body=notaBody(convo(...round('call_1')));
  assert.deepEqual(body.messages.slice(2),[{role:'assistant',content:null,tool_calls:[call('call_1')]},{role:'tool',tool_call_id:'call_1',content:'{"title":"photosynthesis","text":"chloroplasts"}'}]);
  assert.ok(notaBody(convo(...round('a'),...round('b'),...round('c'))),'up to the rounds allowed');
  assert.equal(notaBody(convo(...round('a'),...round('b'),...round('c'),...round('d'))),null,'no more rounds than TOOL_ROUNDS');
  assert.equal(TOOL_ROUNDS,3);
  assert.equal(notaBody({...convo(...round('a')),tools:undefined}),null,'no calls without the tools');
  assert.equal(notaBody(convo({role:'assistant',content:null,tool_calls:[call('a','fetch_url')]},{role:'tool',tool_call_id:'a',content:'x'})),null,"only nota's tools");
  assert.equal(notaBody(convo({role:'assistant',content:null,tool_calls:[call('a')]})),null,'every call has its result');
  assert.equal(notaBody(convo({role:'assistant',content:null,tool_calls:[call('a'),call('b')]},...round('c'))),null,'a round is answered before the next');
  assert.equal(notaBody(convo({role:'assistant',content:null,tool_calls:[call('a')]},{role:'tool',tool_call_id:'b',content:'x'})),null,'a result answers a call');
  assert.equal(notaBody(convo({role:'tool',tool_call_id:'a',content:'x'})),null,'no result without its call');
  assert.equal(notaBody(convo({role:'assistant',content:null,tool_calls:[call('a',undefined,'x'.repeat(3000))]},{role:'tool',tool_call_id:'a',content:'x'})),null,'short arguments');
  assert.equal(notaBody(convo({role:'assistant',content:null,tool_calls:[call('bad id!')]},{role:'tool',tool_call_id:'bad id!',content:'x'})),null);
  const many=Array.from({length:TOOL_CALLS+1},(_,i)=>call('c'+i));
  assert.equal(notaBody(convo({role:'assistant',content:null,tool_calls:many},...many.map(c=>({role:'tool',tool_call_id:c.id,content:'x'})))),null,'TOOL_CALLS calls to a round at most');
  /* a call written out as text, and its result as the question's next words */
  assert.ok(notaBody(convo({role:'assistant',content:'<tool_call>{"name":"list_notes","arguments":{}}</tool_call>'},{role:'user',content:'<tool_response>\n{"notes":[]}\n</tool_response>'})));
});

test('what the calls bring back counts against the allowance',()=>{
  const bare=notaBody(ask('q')),offered=notaBody(ask('q',{tools:[{}]})),read=notaBody(convo(...round('a')));
  assert.ok(bodyTokens(offered)>bodyTokens(bare));
  assert.ok(bodyTokens(read)>bodyTokens(offered));
});


test('Cloudflare Qwen accepts images and tools with only supported reasoning efforts',()=>{
  const input=ask([{type:'text',text:'what is this?'},{type:'image_url',image_url:{url:jpeg}}],{model:CLOUDFLARE_MODEL,tools:[{}],reasoning_effort:'low',max_tokens:99999});
  const body=notaBody(input);
  assert.equal(body.model,'@cf/qwen/qwen3.8-27b');
  assert.equal(body.messages[1].content[1].image_url.url,jpeg);
  assert.deepEqual(body.tools,TOOLS);
  assert.equal(body.max_tokens,MAX_TOKENS);
  assert.equal(body.reasoning_effort,'low');
  assert.equal(notaBody({...input,reasoning_effort:'xhigh'}).reasoning_effort,'xhigh');
  assert.equal(notaBody({...input,reasoning_effort:'none'}).reasoning_effort,undefined);
  assert.equal(notaBody({...input,reasoning_effort:'high'}).reasoning_effort,undefined);
  assert.equal(notaBody({...input,model:'@cf/some/other-model'}),null);
  assert.ok(notaBody({...convo(...round('cf_call')),model:CLOUDFLARE_MODEL}));
});
