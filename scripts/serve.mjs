import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { notaBody, MAX_BODY } from '../cloudflare-deploy/nota-body.mjs';
import { cspFor, ASSET_CSP } from '../cloudflare-deploy/csp.mjs';
const root=path.resolve(import.meta.dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.f32':'application/octet-stream','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.onnx':'application/octet-stream','.md':'text/markdown; charset=utf-8'};
export function startServer(port=4173){
// "hey nota" replies come from a hosted model. The page posts here first
// and the request is forwarded with the stream piped back. The key is
// CEREBRAS_API_KEY in the environment, or the page's own when it sent one;
// with neither the answer is 501 and the page falls back to calling the
// provider directly. cloudflare-deploy/worker.js is the same forward as a
// cloudflare worker.
const NOTA_UPSTREAM='https://api.cerebras.ai/v1/chat/completions';
async function notaProxy(req,res){
  // As the worker does: another website open in this browser may not spend
  // the key (a text/plain POST needs no preflight), and the body is bounded.
  const origin=req.headers.origin;
  if(origin&&!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)){res.writeHead(403,{'Content-Type':'text/plain'});res.end('nota answers its own page only.');return;}
  const siteKey=process.env.CEREBRAS_API_KEY;
  const key=siteKey||(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!key){res.writeHead(501,{'Content-Type':'text/plain'});res.end('nota has no key here.');return;}
  const chunks=[];let size=0;
  for await(const c of req){size+=c.length;if(size>MAX_BODY){res.writeHead(413,{'Content-Type':'text/plain'});res.end('the question is too long.');return;}chunks.push(c);}
  // the environment's key is spent only on nota's own question, as the worker's is
  let body=Buffer.concat(chunks);
  if(siteKey){
    let json=null;try{json=JSON.parse(body.toString('utf8'));}catch{}
    const clean=notaBody(json);
    if(!clean){res.writeHead(400,{'Content-Type':'text/plain'});res.end('invalid request');return;}
    body=JSON.stringify(clean);
  }
  let upstream;
  try{
    upstream=await fetch(NOTA_UPSTREAM,{method:'POST',body,
      headers:{'Content-Type':'application/json','Accept':req.headers.accept||'text/event-stream','Authorization':'Bearer '+key}});
  }catch(e){res.writeHead(502,{'Content-Type':'text/plain'});res.end('nota could not reach the model.');return;}
  res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'text/event-stream','Cache-Control':'no-cache'});
  if(!upstream.body){res.end();return;}
  for await(const chunk of upstream.body)res.write(chunk);
  res.end();
}
const server=http.createServer(async(req,res)=>{
  try{
    // Only this machine's own names: a page elsewhere that rebinds its
    // domain to 127.0.0.1 still sends its own Host, and gets nothing.
    if(!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host||'')){res.writeHead(421,{'Content-Type':'text/plain'});res.end('wrong host');return;}
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/nota/chat'){if(req.method==='OPTIONS'){res.writeHead(204,{Allow:'POST'}).end();return;}if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'}).end();return;}await notaProxy(req,res);return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/notas.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const bytes=await readFile(file);
    // the deployed site's policy (cloudflare-deploy/sync.mjs), so the tests
    // run under it too
    const extra={};
    const name=path.relative(root,file).split(path.sep).join('/');
    if(name==='notas.html'){ extra['Content-Security-Policy']=cspFor(bytes.toString('utf8')); extra['X-Frame-Options']='DENY'; }
    else if(['ink-worker.js','text-worker.js','bg-worker.js','sw.js'].includes(name))extra['Content-Security-Policy']=ASSET_CSP;
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',...extra});res.end(bytes);
  }catch{
    // a reply that broke mid-stream has already sent its head: end it there
    if(res.headersSent)res.destroy();else res.writeHead(404).end('Not found');
  }
});
return new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(port,'127.0.0.1',()=>resolve(server));
});
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
  await startServer();
  console.log('notas: http://localhost:4173/notas.html');
}
