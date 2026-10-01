import { WebsocketProvider as Provider } from 'y-websocket';
import { mergeUpdates } from 'yjs';
import { removeAwarenessStates } from 'y-protocols/awareness';

// The room bills by the message and by the time it is awake, so this
// provider sends less than the stock one: outgoing document updates are
// merged over a short window, the keepalive is a text "ping" the runtime
// answers without waking the room, and presence is refreshed every few
// minutes instead of every 15 seconds. Local Yjs changes and IndexedDB
// persistence remain immediate, as do the sync handshake and presence
// changes.
const BATCH_MS=500,BATCH_BYTES=128*1024;
const PING_MS=20000;
// close a silent connection after this long: three pings, and a hidden
// tab's timers run once a minute at most
const SILENT_MS=75000;
const PRESENCE_MS=5*60*1000;
// y-protocols' cleared interval was also what forgot a peer gone silent
// (a lid shut, a phone asleep: no close frame). Everyone refreshes their
// presence every PRESENCE_MS while visible, so a peer unheard from for a
// minute longer than that is let go here, locally, at no cost to the room;
// a hidden tab that comes back announces itself again on its own.
const PEER_STALE_MS=PRESENCE_MS+60*1000,PEER_CHECK_MS=30*1000;
const now=()=>Date.now();

export class WebsocketProvider extends Provider {
  constructor(url,room,doc,options={}){
    let self=null;
    // y-websocket parses every message as protocol bytes; the runtime's
    // "pong" is text, so it is taken off here and counts as a sign of life
    const Base=options.WebSocketPolyfill||globalThis.WebSocket;
    class Socket extends Base {
      set onmessage(fn){
        super.onmessage=fn&&(event=>{
          if(typeof event.data!=='string'){
            const bytes=new Uint8Array(event.data);
            if(bytes.length>=12&&bytes[0]===255&&bytes[1]===78&&bytes[2]===84&&bytes[3]===1){
              const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),total=header.getUint32(4),at=header.getUint32(8);
              if(total<1||total>128*1024*1024||at+bytes.length-12>total){this.close(4413,'invalid document chunks');return;}
              if(at===0){this.notasChunk=new Uint8Array(total);this.notasAt=0;}
              if(!this.notasChunk||this.notasChunk.length!==total||this.notasAt!==at){this.close(4413,'incomplete document chunks');return;}
              this.notasChunk.set(bytes.subarray(12),at);this.notasAt+=bytes.length-12;
              if(self)self.wsLastMessageReceived=now();
              if(this.notasAt===total){const data=this.notasChunk.buffer;this.notasChunk=null;fn({data});}
              return;
            }
            return fn(event);
          }
          if(event.data==='pong'&&self)self.wsLastMessageReceived=now();
        });
      }
      get onmessage(){ return super.onmessage; }
    }
    super(url,room,doc,{maxBackoffTime:30000,...options,WebSocketPolyfill:Socket});
    self=this;
    this.batch=[];
    this.batchBytes=0;
    this.batchTimer=null;
    this.sendUpdate=this._updateHandler;
    doc.off('update',this._updateHandler);
    this._updateHandler=(update,origin)=>{
      if(origin===this)return;
      this.batch.push(update);
      this.batchBytes+=update.byteLength;
      if(this.batchBytes>=BATCH_BYTES)this.flushUpdates();
      else if(this.batchTimer===null)this.batchTimer=setTimeout(()=>this.flushUpdates(),BATCH_MS);
    };
    doc.on('update',this._updateHandler);
    // y-websocket closes a connection silent for 30 s, and y-protocols
    // re-sends the local presence every 15 s to keep it talking; both
    // intervals go, replaced by the ping and a slower presence refresh
    clearInterval(this._checkInterval);
    clearInterval(this.awareness._checkInterval);
    this.pingTimer=setInterval(()=>this.ping(),PING_MS);
    this.presenceTimer=setInterval(()=>this.refreshPresence(),PRESENCE_MS);
    this.staleTimer=setInterval(()=>this.forgetStalePeers(),PEER_CHECK_MS);
    this.onPageHide=()=>this.flushUpdates();
    this.onVisibility=()=>{
      if(globalThis.document?.hidden)this.flushUpdates();
      else this.refreshPresence();
    };
    globalThis.addEventListener?.('pagehide',this.onPageHide);
    globalThis.document?.addEventListener('visibilitychange',this.onVisibility);
  }

  ping(){
    if(!this.wsconnected||!this.ws)return;
    if(now()-this.wsLastMessageReceived>SILENT_MS){ try{this.ws.close();}catch(e){} return; }
    try{ if(this.ws.readyState===1)this.ws.send('ping'); }catch(e){}
  }

  // the local presence again, so the room and the others keep it; a hidden
  // tab stays quiet and is let go by the room after a while
  refreshPresence(){
    if(globalThis.document?.hidden)return;
    const state=this.awareness.getLocalState();
    if(state!==null&&this.wsconnected)this.awareness.setLocalState(state);
  }

  forgetStalePeers(){
    const aw=this.awareness,stale=[],t=now();
    for(const [id,meta] of aw.meta){
      if(id!==aw.clientID&&aw.states.has(id)&&t-meta.lastUpdated>=PEER_STALE_MS)stale.push(id);
    }
    if(stale.length)removeAwarenessStates(aw,stale,'timeout');
  }

  flushUpdates(){
    clearTimeout(this.batchTimer);
    this.batchTimer=null;
    if(!this.batch?.length)return;
    const update=this.batch.length===1?this.batch[0]:mergeUpdates(this.batch);
    // The provider's original handler retains BroadcastChannel behavior.
    // If offline, the next handshake syncs the complete local document.
    this.sendUpdate(update,null);
    this.batch=[];
    this.batchBytes=0;
  }

  disconnect(){
    this.flushUpdates();
    super.disconnect();
  }

  destroy(){
    clearInterval(this.pingTimer);
    clearInterval(this.presenceTimer);
    clearInterval(this.staleTimer);
    globalThis.removeEventListener?.('pagehide',this.onPageHide);
    globalThis.document?.removeEventListener('visibilitychange',this.onVisibility);
    super.destroy();
  }
}
