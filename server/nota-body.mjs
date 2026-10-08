// What the site's own key is spent on: nota's question, and nothing else a
// caller might add. The body sent upstream is rebuilt from these fields
// alone, so a forged request cannot raise the length (max_completion_tokens,
// n), add tools of its own, or send a conversation of its own size. Shared
// by worker.js and scripts/serve.mjs.
// nota may look up the notebook's other notes with two tools the page
// answers itself (NOTE_TOOLS in nota.js). A request may only ask for those
// to be offered: the definitions sent upstream are TOOLS below, whatever the
// caller sent, and the conversation may carry nota's calls of them and
// their results, for TOOL_ROUNDS rounds of TOOL_CALLS calls at most.
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
export const TOOLS=[
  {type:'function',function:{name:'list_notes',
    description:'Lists the other notes in the person\'s notebook, newest first: each note\'s id, title, when it was last edited and its first words. With a query, the notes matching its words come first.',
    parameters:{type:'object',properties:{query:{type:'string',description:'A few words of a topic or title to look for. Leave it out for the latest notes.'}}}}},
  {type:'function',function:{name:'read_note',
    description:'Reads one note: its typed lines and what was read of its handwriting.',
    parameters:{type:'object',properties:{id:{type:'string',description:'The note\'s id, from list_notes.'}},required:['id']}}}
];
const TOOL_NAMES=new Set(TOOLS.map(t=>t.function.name));
export const TOOL_ROUNDS=3,TOOL_CALLS=4;
const MAX_MESSAGES=2+TOOL_ROUNDS*(1+TOOL_CALLS),MAX_CHARS=64*1024,MAX_ARGS=2000;
const CALL_ID=/^[\w.:-]{1,128}$/;
const ROLES=new Set(['system','user','assistant','tool']);
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
  const tools=Array.isArray(json.tools)&&json.tools.length>0;
  let chars=0,images=0,rounds=0,open=new Set();
  const messages=[];
  for(const m of list){
    if(!m||typeof m!=='object'||!ROLES.has(m.role))return null;
    // a call of nota's tools, and each call's result straight after it
    if(m.role==='assistant'&&m.tool_calls!==undefined){
      if(!tools||!Array.isArray(m.tool_calls)||!m.tool_calls.length||m.tool_calls.length>TOOL_CALLS||++rounds>TOOL_ROUNDS)return null;
      if(m.content!=null&&typeof m.content!=='string')return null;
      const calls=[];open=new Set();
      for(const t of m.tool_calls){
        const f=t&&t.function;
        if(!f||!CALL_ID.test(t.id)||open.has(t.id)||(t.type!==undefined&&t.type!=='function')||!TOOL_NAMES.has(f.name)||typeof f.arguments!=='string'||f.arguments.length>MAX_ARGS)return null;
        open.add(t.id);chars+=f.arguments.length;
        calls.push({id:t.id,type:'function',function:{name:f.name,arguments:f.arguments}});
      }
      chars+=(m.content||'').length;
      messages.push({role:'assistant',content:m.content||null,tool_calls:calls});
      continue;
    }
    if(m.role==='tool'){
      if(typeof m.tool_call_id!=='string'||!open.delete(m.tool_call_id)||typeof m.content!=='string')return null;
      chars+=m.content.length;
      messages.push({role:'tool',tool_call_id:m.tool_call_id,content:m.content});
      continue;
    }
    if(open.size)return null;
    const c=content(m,images);
    if(!c)return null;
    chars+=c.chars;images+=c.images;
    messages.push({role:m.role,content:c.content});
  }
  if(open.size)return null;
  if(chars>MAX_CHARS||!['user','tool'].includes(messages[messages.length-1].role))return null;
  const body={model:MODEL,stream:true,messages,max_tokens:Math.max(1,Math.min(Math.floor(+json.max_tokens)||MAX_TOKENS,MAX_TOKENS))};
  const t=+json.temperature;
  if(json.temperature!==undefined&&Number.isFinite(t))body.temperature=Math.max(0,Math.min(1.5,t));
  if(EFFORTS.has(json.reasoning_effort))body.reasoning_effort=json.reasoning_effort;
  if(tools){body.tools=TOOLS;body.tool_choice=json.tool_choice==='none'?'none':'auto';}
  return body;
}

// The most a cleaned body can spend, for the site's daily allowance: its
// longest answer, its text, and a reckoning for each picture.
export function bodyTokens(body){
  const bytes=s=>new TextEncoder().encode(s).byteLength;
  let n=body.max_tokens+(body.tools?bytes(JSON.stringify(body.tools)):0);
  for(const m of body.messages){
    n+=32;
    for(const t of m.tool_calls||[])n+=bytes(t.function.name+t.function.arguments);
    if(m.content==null)continue;
    if(typeof m.content==='string'){n+=bytes(m.content);continue;}
    for(const p of m.content)n+=p.type==='text'?bytes(p.text):IMAGE_TOKENS;
  }
  return n;
}
