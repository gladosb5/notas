// The notebook's Content-Security-Policy. The page's own scripts are inline
// blocks, so each is allowed by its hash and nothing else inline runs: an
// event handler or a <script> that reached the page's markup (from a shared
// note, an import, a model's answer) is refused by the browser. Styles stay
// open to inline use (the page sets them throughout); pictures are data:
// and blob: URLs; the only other origin reached is the model's, for a page
// with no forward of its own. Used by sync.mjs for _headers and by
// scripts/serve.mjs, so the tests run under the same policy.
import {createHash} from 'node:crypto';

export function cspFor(html){
  const hashes=[];
  for(const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
    if(/\ssrc\s*=/i.test(m[1]||''))continue;
    hashes.push("'sha256-"+createHash('sha256').update(m[2].replace(/\r\n?/g,'\n'),'utf8').digest('base64')+"'");
  }
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' "+hashes.join(' '),
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.cerebras.ai",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ');
}
// for the workers and everything else served beside the page: no inline
// code at all, the same origins
export const ASSET_CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
