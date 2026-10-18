// The page and its files (the 18 MB stroke reader included) are static
// assets and never reach this script; only what assets cannot serve arrives
// here: the room's websocket and the "hey nota" forward.
export { NoteRoom } from './room.js';
import { textBudgetExceeded,notaBody, bodyTokens, MAX_BODY, CLOUDFLARE_MODEL } from '../../server/nota-body.mjs';
const UPSTREAM='https://api.cerebras.ai/v1/chat/completions';
// /collab/<note id>: the websocket of the note's room. Ids are what the page
// makes with uid(): lowercase base 36.
const ROOM=/^\/collab\/([a-z0-9]{8,40})(\/(?:close|nota|open))?$/;
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);

    // the notebook lives at /notas.html, and sw.js and the manifest name
    // it, so / is served as that page rather than redirected to it. The
    // _redirects file sync.mjs writes does this before the request gets
    // here; this is the same rule for a public/ made without it.
    if(url.pathname==='/')return env.ASSETS.fetch(new Request(new URL('/notas.html',url),request));

    // /collab/status: asked by a page whose room will not connect, to tell
    // "the day's allowance is spent" from any other failure. A websocket
    // that fails shows the page no status at all. When the Workers
    // allowance is spent, Cloudflare answers this route itself with a 429
    // (error 1027); when the Durable Objects allowance is spent, this call
    // to a room throws and the answer here says so. The room it asks is
    // named "status", shorter than any note id, so no note is ever woken.
    if(url.pathname==='/collab/status'){
      try{
        await env.ROOMS.get(env.ROOMS.idFromName('status')).fetch(new Request(new URL('/collab/status',url)));
        return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
      }catch(e){
        return overQuota(e)?quotaResponse():Response.json({ok:false},{status:503,headers:{'Cache-Control':'no-store'}});
      }
    }

    const room=ROOM.exec(url.pathname);
    if(room){
      if(!room[2]&&request.headers.get('Upgrade')!=='websocket')return new Response('expected a websocket',{status:426});
      // Every connection and POST wakes a room and counts against the day:
      // one address opening rooms by the hundred (made-up ids included) is
      // turned away before it reaches one.
      if(env.COLLAB_LIMIT){
        const {success}=await env.COLLAB_LIMIT.limit({key:request.headers.get('cf-connecting-ip')||'unknown'});
        if(!success)return new Response('too many requests. try again in a minute.',{status:429,headers:{'Content-Type':'text/plain','Retry-After':'60'}});
      }
      if(request.method==='POST'){
        const body=await limitedBody(request,32*1024);
        if(body===null)return new Response('request is too large',{status:413});
        request=new Request(request,{body});
      }
      try{
        return await env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(request);
      }catch(e){
        if(overQuota(e))return quotaResponse();
        throw e;
      }
    }

    // "hey nota" forward: the key is the CEREBRAS_API_KEY secret, or the
    // page's own Authorization header when it sent one; with neither the
    // answer is 501, which the page reads as "no forward here" and falls
    // back to calling the provider itself. Mirrors notaProxy in
    // scripts/serve.mjs. Cloudflare Qwen uses the account ID and API token
    // in server settings and cannot use a browser Cerebras key.
    if(url.pathname==='/nota/chat'){
      // a preflight is answered without any Access-Control headers: the
      // browser then refuses the other site's request, as intended
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{Allow:'POST'}});
      if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
      // The key is spent on whoever calls this, so a browser on another
      // site is refused: it always names its origin on a cross-site POST.
      // The page's own calls carry this origin; a plain client (curl, the
      // tests) sends none and is forwarded only with a key of its own.
      const origin=request.headers.get('origin');
      if(origin&&origin!==url.origin)return new Response('nota answers its own page only.',{status:403,headers:{'Content-Type':'text/plain'}});
      if(env.NOTA_LIMIT){
        const {success}=await env.NOTA_LIMIT.limit({key:request.headers.get('cf-connecting-ip')||'unknown'});
        if(!success)return new Response('nota is busy. try again in a minute.',{status:429,headers:{'Retry-After':'60'}});
      }
      const text=await limitedBody(request,MAX_BODY);
      if(text===null)return new Response('the question is too long.',{status:413,headers:{'Content-Type':'text/plain'}});
      let json;try{json=JSON.parse(text);}catch{json=null;}
      if(textBudgetExceeded(json))return new Response('the question and notes are too long.',{status:413,headers:{'Content-Type':'text/plain','X-Notas-Error':'text-budget'}});
      const clean=notaBody(json);
      if(!clean)return new Response('invalid request',{status:400,headers:{'Content-Type':'text/plain'}});
      const cloudflare=clean.model===CLOUDFLARE_MODEL;
      const own=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
      const siteKey=origin===url.origin&&!!(cloudflare?env.CLOUDFLARE_API_TOKEN:env.CEREBRAS_API_KEY);
      // The browser's Authorization header is a Cerebras key, never a Cloudflare token.
      const key=cloudflare?(siteKey?env.CLOUDFLARE_API_TOKEN:null):(siteKey?env.CEREBRAS_API_KEY:own);
      if(cloudflare&&(!key||!env.CLOUDFLARE_ACCOUNT_ID))return new Response('nota Cloudflare fallback is not configured.',{status:503,headers:{'Content-Type':'text/plain'}});
      if(!key)return new Response('nota has no key here.',{status:501,headers:{'Content-Type':'text/plain'}});
      const target=cloudflare?`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/ai/v1/chat/completions`:UPSTREAM;
      const body=JSON.stringify(clean);
      if(siteKey){
        // Each provider attempt reserves its maximum spend in the same site budget.
        const tokens=bodyTokens(clean);
        let budget;
        try{budget=await env.ROOMS.get(env.ROOMS.idFromName('site-budget')).fetch(new Request(new URL('/site-budget',url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tokens})}));}
        catch{return new Response('nota could not check its allowance.',{status:503});}
        if(!budget.ok)return new Response('nota has reached its daily allowance. try again tomorrow.',{status:429,headers:{'Retry-After':String(Math.ceil((86400000-Date.now()%86400000)/1000))}});
      }
      let upstream;
      try{
        upstream=await fetch(target,{method:'POST',body,signal:request.signal,
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

// A free plan's daily allowance, spent: the runtime's errors name the free
// tier or say the allowance was exceeded. It returns at midnight UTC.
function overQuota(e){ return /free tier|exceeded allowed|daily limit|quota/i.test(String(e&&e.message||e)); }
function quotaResponse(){
  return Response.json({quota:true},{status:429,headers:{'Cache-Control':'no-store','Retry-After':'3600'}});
}

// Count transport bytes before decoding, including requests without Content-Length.
async function limitedBody(request,limit){
  if(+request.headers.get('content-length')>limit){await request.body?.cancel();return null;}
  if(!request.body)return '';
  const reader=request.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit){await reader.cancel();return null;}chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  return new TextDecoder().decode(bytes);
}
