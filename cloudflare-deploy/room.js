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

export class NoteRoom extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);
    this.doc=null;
    this.awareness=null;
    this.presenceDoc=null;
    this.pending=0;
    this.tail=null;
    this.flushTimer=null;
    // The page's keepalive: "ping" every 20 s is answered here by the
    // runtime itself, without waking the room or counting as a request.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
    ctx.blockConcurrencyWhile(async()=>{
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS nota_requests(line TEXT PRIMARY KEY, question TEXT NOT NULL, token TEXT NOT NULL, expires INTEGER NOT NULL, done INTEGER NOT NULL)');
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS updates(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, data BLOB NOT NULL)');
    });
  }

  load(){
    if(this.doc)return;
    const doc=new Y.Doc();
    const pieces=[];let count=0;
    for(const row of this.ctx.storage.sql.exec('SELECT id, kind, data FROM updates ORDER BY id')){
      const data=new Uint8Array(row.data);
      if(row.kind==='snap')pieces.push(data);
      else{
        if(pieces.length){Y.applyUpdate(doc,join(pieces));pieces.length=0;}
        Y.applyUpdate(doc,data);count++;
        this.tail={id:row.id,data,dirty:false};
      }
    }
    if(pieces.length)Y.applyUpdate(doc,join(pieces));
    this.pending=count;
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
      this.tail={id:null,data:update,dirty:true};
    }
    if(this.flushTimer===null)this.flushTimer=setTimeout(()=>{this.flushTimer=null;this.flush();},FLUSH_AFTER);
  }

  flush(){
    clearTimeout(this.flushTimer);this.flushTimer=null;
    const tail=this.tail;
    if(!tail||!tail.dirty)return;
    const sql=this.ctx.storage.sql;
    tail.dirty=false;
    if(tail.id!==null){
      sql.exec('UPDATE updates SET data = ? WHERE id = ?',tail.data,tail.id);
      return;
    }
    const [row]=sql.exec('INSERT INTO updates(kind, data) VALUES (?, ?) RETURNING id','upd',tail.data);
    tail.id=row.id;
    if(++this.pending<COMPACT_AFTER)return;
    const full=Y.encodeStateAsUpdate(this.doc);
    this.ctx.storage.transactionSync(()=>{
      sql.exec('DELETE FROM updates');
      for(let at=0;at<full.length;at+=PIECE)sql.exec('INSERT INTO updates(kind, data) VALUES (?, ?)','snap',full.subarray(at,at+PIECE));
    });
    this.pending=0;
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
    const url=new URL(request.url),token=url.searchParams.get('host')||'';
    if(url.pathname.endsWith('/nota')){
      if(request.method!=='POST')return new Response(null,{status:405});
      if(await this.ctx.storage.get('closed'))return new Response('sharing ended',{status:410});
      let data;try{data=await request.json();}catch{return new Response('invalid request',{status:400});}
      const {line,question,token,action}=data||{};
      if(typeof line!=='string'||line.length>100||typeof question!=='string'||question.length>20000||typeof token!=='string'||token.length>100||!['claim','complete','release'].includes(action))return new Response('invalid request',{status:400});
      // No await between reading and writing: one room grants one owner atomically.
      const sql=this.ctx.storage.sql,now=Date.now();
      const old=[...sql.exec('SELECT * FROM nota_requests WHERE line = ?',line)][0];
      let state='done';
      if(action==='claim'){
        if(old&&old.done&&old.question===question)state='done';
        else if(old&&!old.done&&old.expires>now)state='busy';
        else{
          sql.exec('INSERT OR REPLACE INTO nota_requests(line,question,token,expires,done) VALUES(?,?,?,?,0)',line,question,token,now+60000);
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
    if(request.headers.get('Upgrade')!=='websocket')return new Response('expected a websocket',{status:426});
    if(!host&&token)await this.ctx.storage.put('host',token);
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server);
    if(await this.ctx.storage.get('closed')){
      if(host&&token===host)await this.ctx.storage.delete('closed');
      else{ server.close(ENDED,'the host has stopped sharing'); return new Response(null,{status:101,webSocket:client}); }
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
    return new Response(null,{status:101,webSocket:client});
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
      const enc=encoding.createEncoder();
      encoding.writeVarUint(enc,SYNC);
      syncProtocol.readSyncMessage(dec,enc,this.doc,ws);
      if(encoding.length(enc)>1)ws.send(encoding.toUint8Array(enc));
    }else if(type===AWARENESS){
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
      const n=decoding.readVarUint(peek);
      for(let i=0;i<n;i++){known.add(decoding.readVarUint(peek));decoding.readVarUint(peek);decoding.readVarString(peek);}
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
    for(const ws of this.ctx.getWebSockets()){ try{ws.close(ENDED,'the host has stopped sharing');}catch(e){} }
    this.ctx.storage.sql.exec('DELETE FROM updates');
    this.ctx.storage.sql.exec('DELETE FROM nota_requests');
    if(this.doc){ this.doc.destroy(); this.doc=null; this.pending=0; this.tail=null; }
    if(this.presenceDoc)this.presenceDoc.destroy();
    this.presenceDoc=null; this.awareness=null;
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

function join(pieces){
  if(pieces.length===1)return pieces[0];
  const out=new Uint8Array(pieces.reduce((n,p)=>n+p.length,0));
  let at=0;for(const p of pieces){out.set(p,at);at+=p.length;}
  return out;
}
