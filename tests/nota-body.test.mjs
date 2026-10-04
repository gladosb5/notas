// What the site's key may be spent on: nota's own question to its model, in
// words and up to two pictures of the page, and nothing a caller adds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {notaBody,bodyTokens,MODEL,MAX_TOKENS,IMAGE_TOKENS,MAX_BODY} from '../cloudflare-deploy/nota-body.mjs';

const jpeg='data:image/jpeg;base64,'+'A'.repeat(4000);
const ask=(content,extra={})=>({model:MODEL,stream:true,max_tokens:1600,messages:[{role:'system',content:'you are nota'},{role:'user',content}],...extra});

test('the model that reads pictures, and only it',()=>{
  assert.equal(MODEL,'qwen-3.8-27b');
  assert.ok(notaBody(ask('hello')));
  assert.equal(notaBody({...ask('hello'),model:'gpt-oss-120b'}),null);
  assert.equal(notaBody({...ask('hello'),stream:false}),null);
});

test('a question in words and a picture of the page goes through as it was sent',()=>{
  const body=notaBody(ask([{type:'text',text:'Question: what is this?'},{type:'image_url',image_url:{url:jpeg,detail:'high'}}],{reasoning_effort:'low',temperature:.3,tools:[{}],n:4}));
  assert.deepEqual(body.messages[1].content,[{type:'text',text:'Question: what is this?'},{type:'image_url',image_url:{url:jpeg}}],'only the parts nota sends, and no detail setting the provider refuses');
  assert.equal(body.reasoning_effort,'low');
  assert.equal(body.tools,undefined);assert.equal(body.n,undefined);
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
