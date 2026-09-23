import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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
  const key=process.env.CEREBRAS_API_KEY||(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!key){res.writeHead(501,{'Content-Type':'text/plain'});res.end('nota has no key here.');return;}
  const chunks=[];for await(const c of req)chunks.push(c);
  let upstream;
  try{
    upstream=await fetch(NOTA_UPSTREAM,{method:'POST',body:Buffer.concat(chunks),
      headers:{'Content-Type':'application/json','Accept':req.headers.accept||'text/event-stream','Authorization':'Bearer '+key}});
  }catch(e){res.writeHead(502,{'Content-Type':'text/plain'});res.end('nota could not reach the model.');return;}
  res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'text/event-stream','Cache-Control':'no-cache'});
  if(!upstream.body){res.end();return;}
  for await(const chunk of upstream.body)res.write(chunk);
  res.end();
}
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(req.method==='POST'&&pathname==='/nota/chat'){await notaProxy(req,res);return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/notas.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const bytes=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(bytes);
  }catch{res.writeHead(404).end('Not found');}
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
