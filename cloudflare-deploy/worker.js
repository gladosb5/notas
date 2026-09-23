// The page and its files (the 18 MB stroke reader included) are static
// assets and never reach this script; only what assets cannot serve arrives
// here: the room's websocket and the "hey nota" forward.
export { NoteRoom } from './room.js';
const UPSTREAM='https://api.cerebras.ai/v1/chat/completions';
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
      // The page's own calls carry this origin, and a plain client (curl,
      // the tests) sends none, which stays allowed.
      const origin=request.headers.get('origin');
      if(origin&&origin!==url.origin)return new Response('nota answers its own page only.',{status:403,headers:{'Content-Type':'text/plain'}});
      const key=env.CEREBRAS_API_KEY||(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
      if(!key)return new Response('nota has no key here.',{status:501,headers:{'Content-Type':'text/plain'}});
      let upstream;
      try{
        upstream=await fetch(UPSTREAM,{method:'POST',body:request.body,
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
