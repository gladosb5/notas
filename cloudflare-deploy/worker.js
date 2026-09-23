// The page and its files (the 18 MB stroke reader included) are static
// assets and never reach this script; only what assets cannot serve arrives
// here: the room's websocket and the "hey nota" forward.
export { NoteRoom } from './room.js';
const UPSTREAM='https://api.cerebras.ai/v1/chat/completions';
// what nota.js asks for (CONFIG.model, CONFIG.maxTokens), with room to spare
const MODEL='gpt-oss-120b',MAX_TOKENS=1024,MAX_BODY=256*1024;
// /collab/<note id>: the websocket of the note's room. Ids are what the page
// makes with uid(): lowercase base 36.
const ROOM=/^\/collab\/([a-z0-9]{8,40})(\/(?:close|nota))?$/;
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);

    // the notebook lives at /notas.html, and sw.js and the manifest name
    // it, so / is served as that page rather than redirected to it. The
    // _redirects file sync.mjs writes does this before the request gets
    // here; this is the same rule for a public/ made without it.
    if(url.pathname==='/')return env.ASSETS.fetch(new Request(new URL('/notas.html',url),request));

    const room=ROOM.exec(url.pathname);
    if(room){
      if(!room[2]&&request.headers.get('Upgrade')!=='websocket')return new Response('expected a websocket',{status:426});
      return env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(request);
    }

    // "hey nota" forward: the key is the CEREBRAS_API_KEY secret, or the
    // page's own Authorization header when it sent one; with neither the
    // answer is 501, which the page reads as "no forward here" and falls
    // back to calling the provider itself. Mirrors notaProxy in
    // scripts/serve.mjs.
    if(url.pathname==='/nota/chat'){
      if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
      // The key is spent on whoever calls this, so a browser on another
      // site is refused: it always names its origin on a cross-site POST.
      // The page's own calls carry this origin; a plain client (curl, the
      // tests) sends none and is forwarded only with a key of its own.
      const origin=request.headers.get('origin');
      if(origin&&origin!==url.origin)return new Response('nota answers its own page only.',{status:403,headers:{'Content-Type':'text/plain'}});
      const own=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
      // The site's own key is spent only for its page (a browser's POST
      // always names its origin), only on nota's model and length, and only
      // so often per address. A caller with their own key spends theirs.
      // A script can forge Origin, so the model, length and rate limits are
      // what actually bound the spend; the Origin check keeps other sites'
      // pages and casual reuse out.
      const siteKey=!!env.CEREBRAS_API_KEY&&origin===url.origin;
      const key=siteKey?env.CEREBRAS_API_KEY:own;
      if(!key)return new Response('nota has no key here.',{status:501,headers:{'Content-Type':'text/plain'}});
      let body=request.body;
      if(siteKey){
        if(env.NOTA_LIMIT){
          const {success}=await env.NOTA_LIMIT.limit({key:request.headers.get('cf-connecting-ip')||'unknown'});
          if(!success)return new Response('nota is busy. try again in a minute.',{status:429,headers:{'Content-Type':'text/plain','Retry-After':'60'}});
        }
        if(+request.headers.get('content-length')>MAX_BODY)return new Response('the question is too long.',{status:413,headers:{'Content-Type':'text/plain'}});
        const text=await request.text();
        if(text.length>MAX_BODY)return new Response('the question is too long.',{status:413,headers:{'Content-Type':'text/plain'}});
        let json;try{json=JSON.parse(text);}catch{json=null;}
        if(!json||typeof json!=='object'||json.model!==MODEL||!Array.isArray(json.messages))return new Response('invalid request',{status:400,headers:{'Content-Type':'text/plain'}});
        json.max_tokens=Math.min(+json.max_tokens||MAX_TOKENS,MAX_TOKENS);
        body=JSON.stringify(json);
      }
      let upstream;
      try{
        upstream=await fetch(UPSTREAM,{method:'POST',body,
          headers:{'Content-Type':'application/json','Accept':request.headers.get('accept')||'text/event-stream','Authorization':'Bearer '+key}});
      }catch(e){
        return new Response('nota could not reach the model.',{status:502,headers:{'Content-Type':'text/plain'}});
      }
      return new Response(upstream.body,{status:upstream.status,
        headers:{'Content-Type':upstream.headers.get('content-type')||'text/event-stream','Cache-Control':'no-cache'}});
    }

    return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain'}});
  }
};
