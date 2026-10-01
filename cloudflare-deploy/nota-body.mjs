// What the site's own key is spent on: nota's question, and nothing else a
// caller might add. The body sent upstream is rebuilt from these fields
// alone, so a forged request cannot raise the length (max_completion_tokens,
// n), add tools, or send a conversation of its own size. Shared by
// worker.js and scripts/serve.mjs.
export const MODEL='gpt-oss-120b';
export const MAX_TOKENS=1024;
export const MAX_BODY=256*1024;
const MAX_MESSAGES=4,MAX_CHARS=64*1024;
const ROLES=new Set(['system','user','assistant']);
const EFFORTS=new Set(['low','medium','high']);

// the upstream body, or null when this is not a question nota would ask
export function notaBody(json){
  if(!json||typeof json!=='object'||Array.isArray(json))return null;
  if(json.model!==MODEL||json.stream!==true)return null;
  const list=json.messages;
  if(!Array.isArray(list)||!list.length||list.length>MAX_MESSAGES)return null;
  let chars=0;
  const messages=[];
  for(const m of list){
    if(!m||typeof m!=='object'||!ROLES.has(m.role)||typeof m.content!=='string')return null;
    chars+=m.content.length;
    messages.push({role:m.role,content:m.content});
  }
  if(chars>MAX_CHARS||messages[messages.length-1].role!=='user')return null;
  const body={model:MODEL,stream:true,messages,max_tokens:Math.max(1,Math.min(Math.floor(+json.max_tokens)||MAX_TOKENS,MAX_TOKENS))};
  const t=+json.temperature;
  if(json.temperature!==undefined&&Number.isFinite(t))body.temperature=Math.max(0,Math.min(1.5,t));
  if(EFFORTS.has(json.reasoning_effort))body.reasoning_effort=json.reasoning_effort;
  return body;
}
