import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import { WebsocketProvider } from '../collab-provider.mjs';

// Use real Yjs/protocol/SQLite operations; replace only the Cloudflare host.
const source=(await readFile(new URL('../cloudflare-deploy/room.js',import.meta.url),'utf8'))
  .replace("import { DurableObject } from 'cloudflare:workers';",
    'class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }')
  .replace(/from '([^']+)'/g,(_,specifier)=>`from '${import.meta.resolve(specifier)}'`);
const {NoteRoom}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

function host(t){
  const db=new DatabaseSync(':memory:'),sockets=[],kv=new Map();
  t.after(()=>db.close());
  const stats={writes:0,selects:0};
  const ctx={getWebSockets:()=>sockets,blockConcurrencyWhile:fn=>fn(),autoResponse:null,
    setWebSocketAutoResponse(pair){this.autoResponse=pair;},storage:{
    get:async key=>kv.get(key),put:async(key,value)=>kv.set(key,value),
    sql:{exec(query,...args){
      const stmt=db.prepare(query);
      const rows=stmt.columns().length?stmt.all(...args):[];
      if(!stmt.columns().length)stmt.run(...args);
      if(/^(INSERT|UPDATE|DELETE)/.test(query))stats.writes+=Number(db.prepare('SELECT changes() AS n').get().n);
      if(/^SELECT/.test(query))stats.selects++;
      return rows;
    }},transactionSync(fn){
      db.exec('BEGIN');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}
    }
  }};
  const rooms=[];
  t.after(()=>rooms.forEach(r=>{r.doc?.destroy();r.presenceDoc?.destroy();}));
  return {db,stats,ctx,sockets,room(){const r=new NoteRoom(ctx,{});rooms.push(r);return r;}};
}
globalThis.WebSocketRequestResponsePair??=class{constructor(request,response){this.request=request;this.response=response;}};
function socket(){
  return {messages:[],saved:null,send(bytes){this.messages.push(bytes);},close(){},
    serializeAttachment(value){this.saved=structuredClone(value);},
    deserializeAttachment(){return structuredClone(this.saved);}};
}
function documentMessage(update){
  const enc=encoding.createEncoder();encoding.writeVarUint(enc,0);sync.writeUpdate(enc,update);
  return encoding.toUint8Array(enc);
}
function presenceMessage(id,clock,state){
  const inner=encoding.createEncoder();encoding.writeVarUint(inner,1);
  encoding.writeVarUint(inner,id);encoding.writeVarUint(inner,clock);encoding.writeVarString(inner,JSON.stringify(state));
  const outer=encoding.createEncoder();encoding.writeVarUint(outer,1);
  encoding.writeVarUint8Array(outer,encoding.toUint8Array(inner));return encoding.toUint8Array(outer);
}

test('presence leaves no timers, performs no note reads/writes, and survives hibernation',t=>{
  const h=host(t),a=socket(),b=socket();h.sockets.push(a,b);
  const active=new Set();
  t.mock.method(globalThis,'setInterval',()=>{const token={};active.add(token);return token;});
  t.mock.method(globalThis,'clearInterval',token=>active.delete(token));
  let room=h.room();
  assert.deepEqual({request:h.ctx.autoResponse.request,response:h.ctx.autoResponse.response},{request:'ping',response:'pong'},'the keepalive is answered by the runtime');
  room.webSocketMessage(a,presenceMessage(42,1,{user:{name:'Ana'},cursor:{x:12,y:20}}));
  assert.equal(a.messages.length,1,'awareness heartbeat echoed to avoid idle reconnects');
  assert.equal(active.size,0,'server Awareness interval must be cleared');
  assert.equal(room.doc,null,'cursor message does not load the document');
  assert.deepEqual(h.stats,{writes:0,selects:0});
  room=h.room();room.loadAwareness();
  assert.equal(room.awareness.getStates().get(42).user.name,'Ana');
  assert.equal(room.awareness.getStates().get(42).cursor.x,12);
  h.sockets.splice(0,1); // the closing socket may no longer be in getWebSockets
  room=h.room();room.webSocketClose(a);
  assert.equal(room.awareness.getStates().has(42),false);
  const outer=decoding.createDecoder(b.messages.at(-1));
  assert.equal(decoding.readVarUint(outer),1);
  const update=decoding.createDecoder(decoding.readVarUint8Array(outer));
  assert.equal(decoding.readVarUint(update),1);
  assert.equal(decoding.readVarUint(update),42);
  decoding.readVarUint(update);
  assert.equal(JSON.parse(decoding.readVarString(update)),null,'peers receive departure after wake');
  assert.equal(active.size,0);
});

test('large transient presence fits the attachment budget; expired presence stays gone',t=>{
  const h=host(t),a=socket();h.sockets.push(a);
  h.room().webSocketMessage(a,presenceMessage(7,1,{user:{name:'Ben'},live:{pts:Array(12000).fill(123)}}));
  assert.ok(a.saved.awareness.byteLength<12000);
  let room=h.room();room.loadAwareness();
  assert.equal(room.awareness.states.get(7).user.name,'Ben');
  a.saved.seenAt-=14*60*1000;
  room=h.room();room.loadAwareness();assert.equal(room.awareness.states.has(7),true,'a tab quiet for 14 minutes is still here');
  a.saved.seenAt-=2*60*1000;
  room=h.room();room.loadAwareness();assert.equal(room.awareness.states.has(7),false);
});

test('200 small edits relay at once, are written as one row when the window closes, and reload',t=>{
  const h=host(t),a=socket(),b=socket();h.sockets.push(a,b);
  const timers=[];
  t.mock.method(globalThis,'setTimeout',fn=>{timers.push(fn);return timers.length;});
  t.mock.method(globalThis,'clearTimeout',()=>{});
  let room=h.room();const source=new Y.Doc();t.after(()=>source.destroy());
  source.on('update',update=>room.webSocketMessage(a,documentMessage(update)));
  for(let i=0;i<200;i++)source.getText('text').insert(i,'x');
  assert.equal(b.messages.length,200,'every edit is relayed immediately');
  assert.equal(h.stats.writes,0,'nothing is written inside the window');
  assert.equal(timers.length,1,'one window is open');
  timers[0]();
  assert.equal(h.stats.writes,1);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM updates').get().n,1);
  source.getText('text').insert(200,'y');
  assert.equal(timers.length,2,'a new window opens for the next edit');
  room.webSocketClose(b);
  assert.equal(h.stats.writes,2,'a closing socket flushes the window');
  room=h.room();room.load();assert.equal(room.doc.getText('text').toString(),'x'.repeat(200)+'y');
  source.getText('text').delete(0,100);
  timers.at(-1)();
  room=h.room();room.load();assert.equal(room.doc.getText('text').length,101);
});

test('existing snapshots/update logs migrate without losing concurrent edits',t=>{
  const h=host(t),a=new Y.Doc(),b=new Y.Doc();t.after(()=>{a.destroy();b.destroy();});
  h.room();
  a.getText('text').insert(0,'hello');
  const snapshot=Y.encodeStateAsUpdate(a);
  h.ctx.storage.sql.exec('INSERT INTO updates(kind,data) VALUES (?,?)','snap',snapshot);
  Y.applyUpdate(b,snapshot);const edits=[];
  a.on('update',u=>edits.push(u));b.on('update',u=>edits.push(u));
  a.getText('text').insert(0,'A');b.getText('text').insert(5,'B');
  for(const u of edits)h.ctx.storage.sql.exec('INSERT INTO updates(kind,data) VALUES (?,?)','upd',u);
  const room=h.room();room.load();assert.equal(room.doc.getText('text').toString(),'AhelloB');
  room.doc.getText('text').insert(7,'!');room.flush();
  const awake=h.room();awake.load();assert.equal(awake.doc.getText('text').toString(),'AhelloB!');
});

test('large delta segments compact and split snapshots reload correctly',t=>{
  const h=host(t),room=h.room();room.load();
  // Each update exceeds the tail limit, forcing the 200-segment compaction.
  for(let i=0;i<200;i++)room.doc.getMap('chunks').set(String(i),'x'.repeat(66000));
  room.flush();
  assert.equal(room.pending,0);
  assert.equal(room.tail,null);
  assert.ok(h.db.prepare("SELECT count(*) AS n FROM updates WHERE kind='snap'").get().n>1);
  const awake=h.room();awake.load();
  assert.equal(awake.doc.getMap('chunks').size,200);
  assert.equal(awake.doc.getMap('chunks').get('199').length,66000);
});

test('browser batches updates while local document stays current and flushes on disconnect',async t=>{
  const doc=new Y.Doc(),remote=new Y.Doc();
  const provider=new WebsocketProvider('ws://localhost','usage-test',doc,{connect:false,disableBc:true});
  t.after(()=>{provider.destroy();doc.destroy();remote.destroy();});
  const sent=[];
  provider.wsconnected=true;provider.ws={OPEN:1,readyState:1,send:bytes=>sent.push(bytes),close(){}};
  for(let i=0;i<100;i++)doc.getText('text').insert(i,'x');
  assert.equal(doc.getText('text').length,100);
  assert.equal(sent.length,0);
  await new Promise(resolve=>setTimeout(resolve,550));
  assert.equal(sent.length,1,'one merged network update for the burst');
  let dec=decoding.createDecoder(sent[0]);assert.equal(decoding.readVarUint(dec),0);
  sync.readSyncMessage(dec,encoding.createEncoder(),remote,null);
  assert.equal(remote.getText('text').length,100);
  doc.getText('text').insert(100,'!');
  provider.disconnect();
  dec=decoding.createDecoder(sent[1]);assert.equal(decoding.readVarUint(dec),0);
  sync.readSyncMessage(dec,encoding.createEncoder(),remote,null);
  assert.equal(remote.getText('text').toString(),'x'.repeat(100)+'!');
  assert.equal(provider.batchTimer,null);
});

test('keepalive is a text ping the room need not wake for; presence is refreshed slowly; backoff is long',t=>{
  const active=new Set();
  t.mock.method(globalThis,'setInterval',()=>{const token={};active.add(token);return token;});
  t.mock.method(globalThis,'clearInterval',token=>active.delete(token));
  class FakeWS{constructor(url){this.url=url;this.OPEN=1;this.readyState=1;this.sent=[];}send(d){this.sent.push(d);}close(){this.readyState=3;}}
  const doc=new Y.Doc();
  const provider=new WebsocketProvider('ws://localhost','usage-test',doc,{disableBc:true,WebSocketPolyfill:FakeWS});
  t.after(()=>{provider.destroy();doc.destroy();});
  assert.equal(active.size,3,'only the ping, the presence refresh and the local stale-peer check remain; the 30 s watchdog and the 15 s presence heartbeat are gone');
  assert.equal(provider.maxBackoffTime,30000);
  const ws=provider.ws;assert.ok(ws instanceof FakeWS);
  ws.onopen();
  assert.equal(provider.wsconnected,true);
  const opened=ws.sent.length;
  provider.wsLastMessageReceived-=10000;
  const before=provider.wsLastMessageReceived;
  provider.ping();
  assert.equal(ws.sent.at(-1),'ping');
  ws.onmessage({data:'pong'});                  // text: never reaches the protocol reader
  assert.ok(provider.wsLastMessageReceived>before,'a pong counts as a sign of life');
  assert.equal(ws.sent.length,opened+1,'a pong sends nothing back');
  provider.awareness.setLocalState({user:{name:'Ana'}});
  const announced=ws.sent.length;
  provider.refreshPresence();
  assert.equal(ws.sent.length,announced+1);
  const dec=decoding.createDecoder(ws.sent.at(-1));
  assert.equal(decoding.readVarUint(dec),1,'the refresh is an awareness message');
  /* a peer unheard from for over six minutes is forgotten locally; one
     heard from five minutes ago is not */
  const peer=encoding.createEncoder();encoding.writeVarUint(peer,1);
  const inner=encoding.createEncoder();encoding.writeVarUint(inner,2);
  encoding.writeVarUint(inner,7);encoding.writeVarUint(inner,1);encoding.writeVarString(inner,JSON.stringify({user:{name:'Ben'}}));
  encoding.writeVarUint(inner,8);encoding.writeVarUint(inner,1);encoding.writeVarString(inner,JSON.stringify({user:{name:'Cy'}}));
  encoding.writeVarUint8Array(peer,encoding.toUint8Array(inner));
  ws.onmessage({data:encoding.toUint8Array(peer)});
  assert.deepEqual([...provider.awareness.getStates().keys()].filter(id=>id!==provider.awareness.clientID).sort(),[7,8]);
  provider.awareness.meta.get(7).lastUpdated-=7*60*1000;
  provider.awareness.meta.get(8).lastUpdated-=5*60*1000;
  provider.forgetStalePeers();
  assert.deepEqual([...provider.awareness.getStates().keys()].filter(id=>id!==provider.awareness.clientID),[8],'the silent peer is gone, the recent one stays');
  provider.wsLastMessageReceived-=80000;
  provider.ping();
  assert.equal(ws.readyState,3,'a link silent for 75 s is closed, to be reopened');
  provider.destroy();
  assert.equal(active.size,0);
});
