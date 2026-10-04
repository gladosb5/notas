// What the site's own key is spent on: nota's question, and nothing else a
// caller might add. The body sent upstream is rebuilt from these fields
// alone, so a forged request cannot raise the length (max_completion_tokens,
// n), add tools, or send a conversation of its own size. Shared by
// worker.js and scripts/serve.mjs.
// The model reads pictures as well as text: a question may carry up to two
// pictures of the page, as PNG or JPEG data URLs (the provider takes no
// links, and its free trial no more than two pictures to a request).
export const MODEL='qwen-3.8-27b';
// The model thinks before it answers, and its thinking counts against this.
export const MAX_TOKENS=2048;
const MAX_IMAGES=2,MAX_IMAGE_CHARS=1500*1024;
export const MAX_BODY=MAX_IMAGES*MAX_IMAGE_CHARS+256*1024;
// What a picture is reckoned to cost against the site's daily allowance:
// the provider does not say, and a page picture of at most 1280 pixels a
// side comes to about this many tokens in 28-pixel patches.
export const IMAGE_TOKENS=2600;
const MAX_MESSAGES=4,MAX_CHARS=64*1024;
const ROLES=new Set(['system','user','assistant']);
const EFFORTS=new Set(['none','low','medium','high']);
const PICTURE=/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

// a message's content as the provider takes it, or null when it is not one
// nota would send: text, or for a question, text and pictures of the page
function content(m,count){
  if(typeof m.content==='string')return {content:m.content,chars:m.content.length,images:0};
  if(m.role!=='user'||!Array.isArray(m.content)||!m.content.length||m.content.length>MAX_IMAGES+2)return null;
  const parts=[];let chars=0,images=0;
  for(const p of m.content){
    if(!p||typeof p!=='object')return null;
    if(p.type==='text'&&typeof p.text==='string'){parts.push({type:'text',text:p.text});chars+=p.text.length;continue;}
    const url=p.type==='image_url'&&p.image_url&&typeof p.image_url==='object'?p.image_url.url:null;
    if(typeof url!=='string'||url.length>MAX_IMAGE_CHARS||!PICTURE.test(url)||count+ ++images>MAX_IMAGES)return null;
    parts.push({type:'image_url',image_url:{url}});
  }
  return {content:parts,chars,images};
}

// the upstream body, or null when this is not a question nota would ask
export function notaBody(json){
  if(!json||typeof json!=='object'||Array.isArray(json))return null;
  if(json.model!==MODEL||json.stream!==true)return null;
  const list=json.messages;
  if(!Array.isArray(list)||!list.length||list.length>MAX_MESSAGES)return null;
  let chars=0,images=0;
  const messages=[];
  for(const m of list){
    if(!m||typeof m!=='object'||!ROLES.has(m.role))return null;
    const c=content(m,images);
    if(!c)return null;
    chars+=c.chars;images+=c.images;
    messages.push({role:m.role,content:c.content});
  }
  if(chars>MAX_CHARS||messages[messages.length-1].role!=='user')return null;
  const body={model:MODEL,stream:true,messages,max_tokens:Math.max(1,Math.min(Math.floor(+json.max_tokens)||MAX_TOKENS,MAX_TOKENS))};
  const t=+json.temperature;
  if(json.temperature!==undefined&&Number.isFinite(t))body.temperature=Math.max(0,Math.min(1.5,t));
  if(EFFORTS.has(json.reasoning_effort))body.reasoning_effort=json.reasoning_effort;
  return body;
}

// The most a cleaned body can spend, for the site's daily allowance: its
// longest answer, its text, and a reckoning for each picture.
export function bodyTokens(body){
  const bytes=s=>new TextEncoder().encode(s).byteLength;
  let n=body.max_tokens;
  for(const m of body.messages){
    n+=32;
    if(typeof m.content==='string'){n+=bytes(m.content);continue;}
    for(const p of m.content)n+=p.type==='text'?bytes(p.text):IMAGE_TOKENS;
  }
  return n;
}
