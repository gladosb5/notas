// One Durable Object per shared note. It speaks the y-websocket protocol
// (message 0 sync, message 1 awareness) so the page uses the stock
// WebsocketProvider, relays every update to the other people on the note,
// and keeps the merged document in its SQLite storage. Websockets are
// accepted through the hibernation API: while nobody writes, the object is
// evicted from memory and the connections stay open at no cost, and the
// document is read back from storage on the next message.
import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const SYNC=0,AWARENESS=1;
// the close code the page reads as "the host has stopped sharing": in the
// 4400 range, which y-websocket treats as final rather than reconnecting
export const ENDED=4410;
// The document is a snapshot in pieces plus bounded merged delta rows;
// compact after this many delta rows, rather than this many keystrokes.
const COMPACT_AFTER=200;
// ...or after this many bytes of delta rows: a picture moved a few times
// resends its whole data URL each time, and replaying hundreds of those on
// load would crowd the object's 128 MB.
const COMPACT_BYTES=16*1024*1024;
// A stored value may be at most 2 MB, so the snapshot is written in pieces
// and so is any single edit bigger than a piece (a pasted picture): its
// leading pieces are 'part' rows, joined onto the 'upd' row that ends it.
const PIECE=512*1024;
// Reuse a bounded durable delta row, so fewer rows need to be read and
// deleted during compaction.
const DELTA_LIMIT=64*1024;
// Received edits are relayed at once but written in windows of this many
// milliseconds: one row write per window instead of one per edit batch,
// which is what the free plan's 100k rows written a day is spent on. An
// edit lost to an eviction inside the window is recovered from the
// editor's own copy by the Yjs handshake on their next connection.
const FLUSH_AFTER=5000;
// Presence is refreshed by the page every few minutes rather than every
// 15 seconds, so states are only stale after this long without news.
const PRESENCE_TIMEOUT=15*60*1000;
// One outgoing frame larger than this is refused by the runtime, which would
// close a newcomer's socket in the middle of the handshake and have it try
// again forever; a document bigger than this goes out in pieces instead.
const FRAME_LIMIT=900*1024;
// the close code for "this note is too big to send": final, like ENDED
export const TOO_BIG=4413;
// a presence message is a cursor, a selection and a stroke in progress;
// anything much larger is not one this page sends
const PRESENCE_MAX=64*1024;
// asked-question rows a room keeps; the oldest go first
const NOTA_ROWS=500;

export class NoteRoom extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);
    this.doc=null;
    this.awareness=null;
    this.presenceDoc=null;
    this.pending=0;
    this.pendingBytes=0;
    this.tail=null;
    this.flushTimer=null;
    // The page's keepalive: "ping" every 20 s is answered here by the
    // runtime itself, without waking the room or counting as a request.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
    ctx.blockConcurrencyWhile(async()=>{
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS nota_requests(line TEXT PRIMARY KEY, question TEXT NOT NULL, token TEXT NOT NULL, expires INTEGER NOT NULL, done INTEGER NOT NULL)');
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS site_budget(day TEXT PRIMARY KEY, requests INTEGER NOT NULL, tokens INTEGER NOT NULL)');
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS updates(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, data BLOB NOT NULL)');
    });
  }

  load(){
    if(this.doc)return;
    const doc=new Y.Doc();
    const pieces=[],parts=[];let count=0,bytes=0;
    for(const row of this.ctx.storage.sql.exec('SELECT id, kind, data FROM updates ORDER BY id')){
      const data=new Uint8Array(row.data);
      if(row.kind==='snap')pieces.push(data);
      else if(row.kind==='part'){parts.push(data);bytes+=data.byteLength;}
      else{
        if(pieces.length){Y.applyUpdate(doc,join(pieces));pieces.length=0;}
        Y.applyUpdate(doc,parts.length?join([...parts,data]):data);count++;bytes+=data.byteLength;
        // a row that ends a split edit is never merged into: it holds only the last piece
        this.tail=parts.length?null:{id:row.id,data,dirty:false};
        parts.length=0;
      }
    }
    if(pieces.length)Y.applyUpdate(doc,join(pieces));
    this.pending=count;
    this.pendingBytes=bytes;
    this.doc=doc;
    doc.on('update',(update,origin)=>{
      this.store(update);
      const enc=encoding.createEncoder();
      encoding.writeVarUint(enc,SYNC);
      syncProtocol.writeUpdate(enc,update);
      this.broadcast(encoding.toUint8Array(enc),origin);
    });
  }

  loadAwareness(closingSocket){
    if(this.awareness)return;
    this.presenceDoc=new Y.Doc();
    this.awareness=new awarenessProtocol.Awareness(this.presenceDoc);
    // y-protocols starts a 3-second interval even with local state null.
    // Expire stale presence on incoming events instead, allowing hibernation.
    clearInterval(this.awareness._checkInterval);
    this.awareness.setLocalState(null);
    const sockets=new Set(this.ctx.getWebSockets());
    if(closingSocket)sockets.add(closingSocket);
    for(const socket of sockets){
      const saved=socket.deserializeAttachment();
      if(!saved?.awareness||Date.now()-saved.seenAt>=PRESENCE_TIMEOUT)continue;
      awarenessProtocol.applyAwarenessUpdate(this.awareness,saved.awareness,socket);
      for(const id of saved.clients||[]){
        const meta=this.awareness.meta.get(id);
        if(meta)meta.lastUpdated=saved.seenAt;
      }
    }
    this.awareness.on('update',({added,updated,removed},origin)=>{
      const changed=added.concat(updated,removed);
      const enc=encoding.createEncoder();
      encoding.writeVarUint(enc,AWARENESS);
      encoding.writeVarUint8Array(enc,awarenessProtocol.encodeAwarenessUpdate(this.awareness,changed));
      // Echoed to its sender too: outgoing messages are free, and a page
      // from before the ping keepalive reads its own echo as a heartbeat.
      this.broadcast(encoding.toUint8Array(enc));
    });
  }

  // Merge into the tail row in memory; the row itself is written when the
  // window closes, or a new tail starts, or a socket closes.
  store(update){
    if(this.tail&&this.tail.data.byteLength+update.byteLength<=DELTA_LIMIT){
      this.tail.data=Y.mergeUpdates([this.tail.data,update]);
      this.tail.dirty=true;
    }else{
      this.flush();
      this.tail=this.tail?.dirty?{id:null,data:Y.mergeUpdates([this.tail.data,update]),dirty:true}:{id:null,data:update,dirty:true};
    }
    if(this.flushTimer===null)this.scheduleFlush(FLUSH_AFTER);
  }

  // Called from a timer and from a closing socket, where nothing would
  // catch a storage error: it is logged, the tail stays dirty for the next
  // window, and the room carries on (a thrown error would reset it and
  // drop every connection).
  scheduleFlush(delay){
    this.ctx.waitUntil(new Promise(resolve=>{
      this.flushResolve=resolve;
      this.flushTimer=setTimeout(()=>this.flush(),delay);
    }));
  }

  flush(){
    try{ this.flushNow(); }
    catch(e){
      console.error('room: could not store an edit:',e&&e.message||e);
      if(this.tail)this.tail.dirty=true;
      if(this.flushTimer===null)this.scheduleFlush(FLUSH_AFTER*6);
    }
  }

  flushNow(){
    clearTimeout(this.flushTimer);this.flushTimer=null;
    if(this.flushResolve){this.flushResolve();this.flushResolve=null;}
    const tail=this.tail;
    if(!tail||!tail.dirty)return;
    const sql=this.ctx.storage.sql;
    tail.dirty=false;
    if(tail.id!==null){
      sql.exec('UPDATE updates SET data = ? WHERE id = ?',tail.data,tail.id);
      return;
    }
    const data=tail.data;
    if(data.byteLength>PIECE){
      this.ctx.storage.transactionSync(()=>{
        let at=0;
        for(;at+PIECE<data.byteLength;at+=PIECE)sql.exec('INSERT INTO updates(kind, data) VALUES (?, ?)','part',data.subarray(at,at+PIECE));
        sql.exec('INSERT INTO updates(kind, data) VALUES (?, ?)','upd',data.subarray(at));
      });
      if(this.tail===tail)this.tail=null;
    }else{
      const [row]=sql.exec('INSERT INTO updates(kind, data) VALUES (?, ?) RETURNING id','upd',data);
      tail.id=row.id;
    }
    this.pendingBytes+=data.byteLength;
    if(++this.pending<COMPACT_AFTER&&this.pendingBytes<COMPACT_BYTES)return;
    const full=Y.encodeStateAsUpdate(this.doc);
    this.ctx.storage.transactionSync(()=>{
      sql.exec('DELETE FROM updates');
      for(let at=0;at<full.length;at+=PIECE)sql.exec('INSERT INTO updates(kind, data) VALUES (?, ?)','snap',full.subarray(at,at+PIECE));
    });
    this.pending=0;
    this.pendingBytes=0;
    this.tail=null;
  }

  broadcast(bytes,except){
    for(const ws of this.ctx.getWebSockets()){
      if(ws===except)continue;
      try{ws.send(bytes);}catch(e){}
    }
  }

  // The person who first shares a note is its host: their token arrives
  // with their first connection and is kept. Only the host may end the
  // room, and after that only the host may reopen it; anyone else who
  // connects is closed with ENDED at once, and gets nothing.
  async fetch(request){
    const url=new URL(request.url),token=hostOf(request,url);
    // Internal Worker-to-room route; never exposed by worker.js's routing.
    if(url.pathname==='/site-budget'){
      const data=await request.json().catch(()=>null),cost=data?.tokens;
      if(!Number.isSafeInteger(cost)||cost<1||cost>1048576)return new Response(null,{status:400});
      const configured=(key,fallback)=>{const n=Number(this.env[key]);return Number.isSafeInteger(n)&&n>=0?n:fallback;};
      const requests=configured('NOTA_DAILY_REQUESTS',1000),tokens=configured('NOTA_DAILY_TOKENS',2000000);
      const day=new Date().toISOString().slice(0,10),sql=this.ctx.storage.sql;
      const allowed=this.ctx.storage.transactionSync(()=>{
        const row=[...sql.exec('SELECT requests, tokens FROM site_budget WHERE day = ?',day)][0]||{requests:0,tokens:0};
        if(row.requests>=requests||row.tokens+cost>tokens)return false;
        sql.exec('DELETE FROM site_budget WHERE day <> ?',day);
        sql.exec('INSERT OR REPLACE INTO site_budget(day, requests, tokens) VALUES (?, ?, ?)',day,row.requests+1,row.tokens+cost);
        return true;
      });
      return new Response(null,{status:allowed?204:429});
    }
    // the share this page last saw: '' for a page arriving afresh
    const gen=url.searchParams.get('gen')||'';
    // the worker's /collab/status check: reaching here is the whole answer
    if(url.pathname==='/collab/status')return new Response(null,{status:204});
    if(url.pathname.endsWith('/nota')){
      if(request.method!=='POST')return new Response(null,{status:405});
      if(await this.ctx.storage.get('closed'))return new Response('sharing ended',{status:410});
      let data;try{data=await request.json();}catch{return new Response('invalid request',{status:400});}
      const {line,question,token,action}=data||{};
      if(typeof line!=='string'||line.length>100||typeof question!=='string'||question.length>20000||typeof token!=='string'||token.length>100||!['claim','complete','release'].includes(action))return new Response('invalid request',{status:400});
      // only a room someone has shared answers: a made-up id is not a free
      // place to keep rows
      if(!await this.ctx.storage.get('host')&&!this.hasContent())return new Response('no such note',{status:404});
      // No await between reading and writing: one room grants one owner atomically.
      const sql=this.ctx.storage.sql,now=Date.now();
      const old=[...sql.exec('SELECT * FROM nota_requests WHERE line = ?',line)][0];
      let state='done';
      if(action==='claim'){
        if(old&&old.done&&old.question===question)state='done';
        else if(old&&!old.done&&old.expires>now)state='busy';
        else{
          sql.exec('INSERT OR REPLACE INTO nota_requests(line,question,token,expires,done) VALUES(?,?,?,?,0)',line,question,token,now+60000);
          sql.exec('DELETE FROM nota_requests WHERE line NOT IN (SELECT line FROM nota_requests ORDER BY expires DESC LIMIT ?)',NOTA_ROWS);
          state='claimed';
        }
      }else if(old&&old.token===token){
        if(action==='complete')sql.exec('UPDATE nota_requests SET done=1 WHERE line=?',line);
        else sql.exec('DELETE FROM nota_requests WHERE line=?',line);
      }
      return Response.json({state});
    }
    const host=await this.ctx.storage.get('host');
    if(url.pathname.endsWith('/close')){
      if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
      if(!host||token!==host)return new Response('not the host',{status:403});
      await this.end();
      return new Response('ended',{status:200,headers:{'Content-Type':'text/plain'}});
    }
    // The host starts (or starts again) a share before its link is given
    // out: the room is claimed here, so nobody who connects before the host
    // can make themselves host with a token of their own, and each share
    // has its own generation, so a device still holding the note from an
    // earlier share cannot bring back what was erased since.
    if(url.pathname.endsWith('/open')){
      if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
      if(!/^[a-z0-9]{16,80}$/.test(token)||!/^[a-z0-9]{8,40}$/.test(gen))return new Response('invalid request',{status:400});
      if(host&&token!==host)return new Response('not the host',{status:403});
      const closed=await this.ctx.storage.get('closed');
      if(!host)await this.ctx.storage.put('host',token);
      if(closed||!await this.ctx.storage.get('gen')){ await this.ctx.storage.put('gen',gen); await this.ctx.storage.delete('closed'); }
      return Response.json({gen:await this.ctx.storage.get('gen')});
    }
    if(request.headers.get('Upgrade')!=='websocket')return new Response('expected a websocket',{status:426});
    // a page from before /open claims the room with its first connection
    if(!host)return new Response('no such shared note',{status:404});
    if(token&&token!==host)return new Response('not the host',{status:403});
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const offered=(request.headers.get('Sec-WebSocket-Protocol')||'').split(',').map(s=>s.trim());
    const headers=offered.includes('notas')?{'Sec-WebSocket-Protocol':'notas'}:undefined;
    const current=await this.ctx.storage.get('gen');
    // Ended, or ended and shared again since this page last saw it: the
    // host included, whose other devices keep their copy as their own note.
    // A page with no generation yet is arriving by the link.
    if(await this.ctx.storage.get('closed')||(current&&gen!==current)){
      server.close(ENDED,'the host has stopped sharing');
      return new Response(null,{status:101,webSocket:client,headers});
    }
    this.load();
    this.loadAwareness();
    server.serializeAttachment({clients:[]});
    // first sync step and the present company, as y-websocket's server does
    const enc=encoding.createEncoder();
    encoding.writeVarUint(enc,SYNC);
    syncProtocol.writeSyncStep1(enc,this.doc);
    server.send(encoding.toUint8Array(enc));
    const states=this.awareness.getStates();
    if(states.size){
      const hello=encoding.createEncoder();
      encoding.writeVarUint(hello,AWARENESS);
      encoding.writeVarUint8Array(hello,awarenessProtocol.encodeAwarenessUpdate(this.awareness,[...states.keys()]));
      server.send(encoding.toUint8Array(hello));
    }
    return new Response(null,{status:101,webSocket:client,headers});
  }

  hasContent(){
    if(this.doc)return true;
    return [...this.ctx.storage.sql.exec('SELECT 1 FROM updates LIMIT 1')].length>0;
  }

  // The reply to a newcomer's first sync step is the whole document it is
  // missing. Past a frame's limit it goes as one update per writer, each a
  // valid update on its own (Yjs holds back what depends on a piece not yet
  // arrived); a single writer's share still too big closes the socket with
  // TOO_BIG, which the page shows and does not retry.
  sendMissing(ws,stateVector){
    const whole=Y.encodeStateAsUpdate(this.doc,stateVector);
    if(whole.byteLength<=FRAME_LIMIT){ ws.send(syncMessage(syncProtocol.messageYjsSyncStep2,whole)); return; }
    // Fragment a protocol reply, including a large image written by a single
    // author. The provider reassembles it before Yjs sees the update.
    const message=syncMessage(syncProtocol.messageYjsSyncStep2,whole);
    if(message.byteLength>128*1024*1024){ws.close(TOO_BIG,'this note is too big to share');return;}
    for(let at=0;at<message.length;at+=FRAME_LIMIT-12){
      const chunk=message.subarray(at,at+FRAME_LIMIT-12),frame=new Uint8Array(12+chunk.length),head=new DataView(frame.buffer);
      frame.set([255,78,84,1]);head.setUint32(4,message.length);head.setUint32(8,at);frame.set(chunk,12);ws.send(frame);
    }
  }

  // A frame that is not protocol bytes (a stray client, a damaged message)
  // would otherwise throw out of here, and an uncaught exception resets the
  // object: the tail row merged in memory since the last window closed
  // would go with it. Such a socket is closed alone instead.
  webSocketMessage(ws,message){
    try{this.handle(ws,message);}
    catch(e){ console.error('room: bad message, closing socket:',e&&e.message||e); try{ws.close(1003,'not a y-websocket message');}catch(e){} }
  }

  handle(ws,message){
    if(typeof message==='string')return;
    const dec=decoding.createDecoder(new Uint8Array(message));
    const type=decoding.readVarUint(dec);
    if(type===SYNC){
      this.load();
      if(decoding.peekVarUint(dec)===syncProtocol.messageYjsSyncStep1){
        decoding.readVarUint(dec);
        this.sendMissing(ws,decoding.readVarUint8Array(dec));
        return;
      }
      const enc=encoding.createEncoder();
      encoding.writeVarUint(enc,SYNC);
      syncProtocol.readSyncMessage(dec,enc,this.doc,ws);
      if(encoding.length(enc)>1)ws.send(encoding.toUint8Array(enc));
    }else if(type===AWARENESS){
      if(message.byteLength>PRESENCE_MAX)return;
      this.loadAwareness();
      const stale=[];
      for(const [id,meta] of this.awareness.meta){
        if(this.awareness.states.has(id)&&Date.now()-meta.lastUpdated>=PRESENCE_TIMEOUT)stale.push(id);
      }
      awarenessProtocol.removeAwarenessStates(this.awareness,stale,null);
      const update=decoding.readVarUint8Array(dec);
      // the client ids this socket speaks for are kept on the socket, so
      // they can be cleared when it closes even after a hibernation
      const attachment=ws.deserializeAttachment()||{clients:[]};
      const known=new Set(attachment.clients);
      const peek=decoding.createDecoder(update);
      const n=decoding.readVarUint(peek),named=[];
      for(let i=0;i<n;i++){named.push(decoding.readVarUint(peek));decoding.readVarUint(peek);decoding.readVarString(peek);}
      // A socket speaks only for the client ids it announced first: naming
      // another socket's id would clear or impersonate someone else.
      for(const id of named){ const owner=this.ownerOf(id); if(owner&&owner!==ws)return; }
      for(const id of named)known.add(id);
      awarenessProtocol.applyAwarenessUpdate(this.awareness,update,ws);
      // Keep a bounded presence snapshot on the socket, not in SQLite.
      // This survives hibernation without paying a row write per cursor move.
      const clients=[...known].filter(id=>this.awareness.states.has(id)).slice(-64);
      let snapshot=awarenessProtocol.encodeAwarenessUpdate(this.awareness,clients);
      if(snapshot.byteLength>12000){
        const compact=new Map(clients.map(id=>{
          const state=this.awareness.states.get(id);
          return [id,{user:state.user,tool:state.tool}];
        }));
        snapshot=awarenessProtocol.encodeAwarenessUpdate(this.awareness,clients,compact);
      }
      ws.serializeAttachment({clients,seenAt:Date.now(),
        awareness:snapshot.byteLength<=12000?snapshot:undefined});
    }
  }

  // the host ended the room: everyone is told and cut off, the document
  // is wiped here, and the room stays closed to all but the host
  async end(){
    await this.ctx.storage.put('closed',true);
    clearTimeout(this.flushTimer);this.flushTimer=null;
    if(this.flushResolve){this.flushResolve();this.flushResolve=null;}
    for(const ws of this.ctx.getWebSockets()){ try{ws.close(ENDED,'the host has stopped sharing');}catch(e){} }
    this.ctx.storage.sql.exec('DELETE FROM updates');
    this.ctx.storage.sql.exec('DELETE FROM nota_requests');
    if(this.doc){ this.doc.destroy(); this.doc=null; this.pending=0; this.pendingBytes=0; this.tail=null; }
    if(this.presenceDoc)this.presenceDoc.destroy();
    this.presenceDoc=null; this.awareness=null;
  }

  ownerOf(id){
    for(const socket of this.ctx.getWebSockets()){
      const saved=socket.deserializeAttachment();
      if(saved?.clients?.includes(id))return socket;
    }
    return null;
  }

  webSocketClose(ws){this.leave(ws);}
  webSocketError(ws){this.leave(ws);}
  leave(ws){
    this.flush();
    this.loadAwareness(ws);
    const {clients=[]}=ws.deserializeAttachment()||{};
    const present=clients.filter(id=>this.awareness.getStates().has(id));
    if(present.length)awarenessProtocol.removeAwarenessStates(this.awareness,present,null);
    try{ws.close();}catch(e){}
  }
}

function syncMessage(kind,update){
  const enc=encoding.createEncoder();
  encoding.writeVarUint(enc,SYNC);
  encoding.writeVarUint(enc,kind);
  encoding.writeVarUint8Array(enc,update);
  return encoding.toUint8Array(enc);
}
// The host's token: offered as a websocket subprotocol ("h" + token) or an
// X-Notas-Host header, so it stays out of URLs and request logs; the query
// string of pages from before that is still read.
export function hostOf(request,url){
  for(const p of (request.headers.get('Sec-WebSocket-Protocol')||'').split(','))if(/^h[a-z0-9]{8,80}$/.test(p.trim()))return p.trim().slice(1);
  return request.headers.get('X-Notas-Host')||url.searchParams.get('host')||'';
}

function join(pieces){
  if(pieces.length===1)return pieces[0];
  const out=new Uint8Array(pieces.reduce((n,p)=>n+p.length,0));
  let at=0;for(const p of pieces){out.set(p,at);at+=p.length;}
  return out;
}
