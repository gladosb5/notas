/* =========================================================================
   COLLAB - a note written on together. Share makes a link; anyone who opens
   it is on the same page, ink and typed lines alike, each under their own
   name. The shared copy is a Yjs document: every device holds one, edits
   merge without a referee, and the note's room on the worker only relays
   updates and keeps the merged result for whoever arrives next. The
   notebook's own state (S.strokes, S.lines, S.images) stays exactly as it
   is; this file mirrors it into the document after each change and back
   out again when someone else writes. The person who shared is the host:
   when they stop, the room ends and everyone else loses the note. Nothing
   here runs until a note is shared, and the library that does the merging
   is fetched only then.
   ========================================================================= */
(function(){
'use strict';
const N=window.N;
if(!N||!N.core)return;
const C=N.core,S=C.S;

const NAME_KEY='notas.collab.name',SHARED_KEY='notas.collab.shared',HOST_KEY='notas.collab.host.';
const LOCAL='local';                /* origin of the page's own transactions */
let room=null,lib=null,flushQueued=false,applying=false;
const strokeSigs=new WeakMap();

/* ---- small stores ---- */
function name(){ try{ return (localStorage.getItem(NAME_KEY)||'').trim(); }catch(e){ return ''; } }
function setName(v){ try{ localStorage.setItem(NAME_KEY,v); }catch(e){} }
function shared(){ try{ return JSON.parse(localStorage.getItem(SHARED_KEY)||'{}')||{}; }catch(e){ return {}; } }
function setShared(id,on){
  const m=shared(); if(on)m[id]=Date.now(); else delete m[id];
  try{ localStorage.setItem(SHARED_KEY,JSON.stringify(m)); }catch(e){}
}
function isShared(id){ return !!shared()[id]; }
/* the host's token for a note: made when they share it, kept so they can
   end the room and open it again later; nobody else has one */
function hostToken(id,make){
  let t=''; try{ t=localStorage.getItem(HOST_KEY+id)||''; }catch(e){}
  if(!t&&make){ t=secret(); try{ localStorage.setItem(HOST_KEY+id,t); }catch(e){} }
  return t;
}
/* a token nobody can work out from ids they have seen: the browser's
   cryptographic randomness, 128 bits as lowercase hex */
function secret(){ return Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''); }
function isHost(){ return !!(room&&hostToken(room.id)); }
function linkFor(id){ const u=new URL(location.href); u.search=''; u.hash=''; u.searchParams.set('share',id); const gen=room?.id===id?genOf(room):'';if(gen)u.searchParams.set('gen',gen);return u.href; }
/* the same link with the host's token on it: for the host's own other
   devices, so they are the host there too rather than a guest of their own
   note; never the link that is sent to others */
function hostLinkFor(id){ const t=hostToken(id); if(!t)return ''; const u=new URL(linkFor(id)); u.hash='host='+t; return u.href; }
function linkedRoom(){ const m=/[?&]share=([a-z0-9]{8,40})/.exec(location.search); return m?m[1]:null; }
function linkedHost(){ const m=/[?&]host=([a-z0-9]{8,80})/.exec(location.hash.replace(/^#/, '?')||location.search); return m?m[1]:''; }
/* the page is online as far as the browser knows; offline is certain, online only likely */
function offline(){ return navigator.onLine===false; }
function socketUrl(){ return (location.protocol==='https:'?'wss://':'ws://')+location.host+'/collab'; }
/* a page opened from a file (or any non-web address) has no room to reach */
function served(){ return /^https?:$/.test(location.protocol)&&!!location.host; }
function colorFor(s){ let h=0; for(const c of s)h=(h*31+c.charCodeAt(0))>>>0; return 'hsl('+(h%360)+' 45% 45%)'; }
function initials(s){ const w=String(s||'').trim().split(/\s+/).filter(Boolean); return ((w[0]||'?')[0]+(w[1]?w[1][0]:'')).toUpperCase(); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
/* what arrives from the others is only data: a colour is one this page
   would have made, and a picture is only ever its own bytes, never an
   address to fetch (which would tell a stranger who is looking, and taint
   the canvas it is drawn on) */
function peerColor(c,n){ return /^hsl\(\d{1,3} 45% 45%\)$/.test(c||'')?c:colorFor(n||'someone'); }
const PICTURE=/^data:image\/(?:png|jpe?g|gif|webp);base64,/i;   /* what an import accepts */
/* A picture's pixel size, read from its header without decoding it: a few
   hundred bytes that claim 60000 x 60000 pixels would otherwise be decoded
   by every device on the note, and take a tablet's tab down each time the
   note opens. What this page adds is never over 2000 on a side. */
const PICTURE_SIDE=8192,PICTURE_AREA=36e6;
function pictureSize(src){
  let bin='';
  try{ const b64=src.slice(src.indexOf(',')+1,src.indexOf(',')+1+262144); bin=atob(b64.slice(0,b64.length-b64.length%4)); }catch(e){ return null; }
  const at=i=>bin.charCodeAt(i)&255,be16=i=>at(i)<<8|at(i+1),le16=i=>at(i)|at(i+1)<<8,le24=i=>at(i)|at(i+1)<<8|at(i+2)<<16;
  if(bin.startsWith('\x89PNG'))return bin.length>=24?{w:(at(16)<<24|at(17)<<16|at(18)<<8|at(19))>>>0,h:(at(20)<<24|at(21)<<16|at(22)<<8|at(23))>>>0}:null;
  if(bin.startsWith('GIF8'))return bin.length>=10?{w:le16(6),h:le16(8)}:null;
  if(bin.startsWith('RIFF')&&bin.slice(8,12)==='WEBP'){
    const kind=bin.slice(12,16);
    if(kind==='VP8 '&&bin.length>=30)return {w:le16(26)&0x3fff,h:le16(28)&0x3fff};
    if(kind==='VP8L'&&bin.length>=25)return {w:1+(at(21)|(at(22)&0x3f)<<8),h:1+(at(22)>>6|at(23)<<2|(at(24)&0x0f)<<10)};
    if(kind==='VP8X'&&bin.length>=30)return {w:1+le24(24),h:1+le24(27)};
    return null;
  }
  if(at(0)===0xff&&at(1)===0xd8){
    for(let i=2;i+9<bin.length;){
      if(at(i)!==0xff){ i++; continue; }
      const m=at(i+1);
      if(m===0xff){ i++; continue; }
      if(m>=0xc0&&m<=0xcf&&m!==0xc4&&m!==0xc8&&m!==0xcc)return {w:be16(i+7),h:be16(i+5)};
      if(m===0xd8||m===0x01||(m>=0xd0&&m<=0xd7)){ i+=2; continue; }
      i+=2+be16(i+2);
    }
  }
  return null;
}
function safePicture(src){
  if(typeof src!=='string'||!PICTURE.test(src))return false;
  const s=pictureSize(src);
  return !!s&&s.w>0&&s.h>0&&s.w<=PICTURE_SIDE&&s.h<=PICTURE_SIDE&&s.w*s.h<=PICTURE_AREA;
}
const num=(v,limit=1e6)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;
function safeImage(im){
  return !!im&&typeof im==='object'&&safePicture(im.src)&&['full','bg','cut'].every(k=>!im[k]||safePicture(im[k]))&&
    num(im.x)&&num(im.y)&&num(im.w)&&num(im.h)&&im.w>0&&im.h>0&&(im.rot===undefined||num(im.rot,100))&&
    (!im.crop||(typeof im.crop==='object'&&['l','t','r','b'].every(k=>num(im.crop[k],1)&&im.crop[k]>=0)));
}
/* Everything else someone else writes is held to what an import accepts
   (validateImportedNote): a stroke whose points or box are missing or not
   numbers threw on every frame of every device's ink, for good. Fields of
   the page's own (a leading _) never come from another device; a stroke's
   box is worked out here from its points. */
function plainFields(v,skip){
  const o={};
  for(const k in v){
    if(k[0]==='_'||skip.includes(k)||k==='__proto__'||k==='constructor'||k==='prototype')continue;
    const x=v[k];
    if(typeof x==='boolean'||(typeof x==='number'&&Number.isFinite(x))||(typeof x==='string'&&x.length<=200))o[k]=x;
  }
  return o;
}
function cleanStroke(v,id){
  if(!v||typeof v!=='object')return null;
  const p=v.pts;
  if(!Array.isArray(p)||p.length<3||p.length%3||p.length>600000)return null;
  for(let i=0;i<p.length;i+=3)if(!num(p[i])||!num(p[i+1])||!num(p[i+2],1.5)||p[i+2]<0)return null;
  if(!num(v.w,100)||v.w<=0)return null;
  const st={...plainFields(v,['pts','bbox','times','id','author','color']),id,author:v.author==='ai'?'ai':'user',pts:p.slice(),bbox:N.ink.bboxOf(p)};
  if(typeof v.color==='string'&&/^#[0-9a-f]{6}$/i.test(v.color))st.color=v.color;
  if(typeof v.quickMath==='string'&&v.quickMath.length<=8192)st.quickMath=v.quickMath;
  if(typeof v.notaText==='string'&&v.notaText.length<=32000)st.notaText=v.notaText;
  if(Array.isArray(v.times)&&v.times.length===p.length/3&&v.times.every(t=>num(t,3600000)&&t>=0))st.times=v.times.slice();
  return st;
}
function cleanLineAttrs(a){
  const o=plainFields(a&&typeof a==='object'?a:{},['id','text','wait','h']);
  if(!num(o.y)||o.y<0)o.y=120;
  if(o.x!==undefined&&(!num(o.x)||o.x<0))delete o.x;
  return o;
}

/* ---- the day's allowance ----
   The rooms run on a free plan with a daily allowance of requests. When it
   is spent the websocket simply fails, which says nothing about why, so
   the page asks /collab/status: a 429 (the worker's own, or Cloudflare's
   error 1027 page when the worker itself is out) means the allowance is
   gone until it resets. Asked at most once a minute, only while the link
   is down, and cleared the moment the room connects again. */
const PROBE_MS=60000,BUSY_TEXT='we are currently having high load, please check tomorrow.';
let busy=false,probing=null,probedAt=0;
function probe(){
  if(probing||offline()||!/^https?:$/.test(location.protocol))return;
  if(probedAt&&performance.now()-probedAt<PROBE_MS)return;
  probedAt=performance.now();
  probing=fetch('./collab/status',{cache:'no-store',signal:AbortSignal.timeout(8000)})
    .then(async res=>{
      if(res.status===429)return true;
      if(res.ok)return false;
      return /\b1027\b|"quota"/.test(await res.text().catch(()=>''))||null;
    })
    .catch(()=>null)
    .then(over=>{ probing=null; if(over!==null)setBusy(over); });
}
function setBusy(on){ if(busy===on)return; busy=on; paintButton(); }

function loadLib(){
  if(window.Yjs)return Promise.resolve(window.Yjs);
  return lib||(lib=new Promise((resolve,reject)=>{
    const s=document.createElement('script'); s.src='./assets/collab.js';
    s.onload=()=>resolve(window.Yjs);
    s.onerror=()=>{ lib=null; reject(new Error('sharing could not load.')); };
    document.head.appendChild(s);
  }));
}

/* ---- what goes into the document ----
   Strokes and images are whole values under their id: a stroke never
   changes except to move (rev counts that), so the last writer wins and
   nothing is lost. A typed line is a map of its fields plus a shared text,
   so two people in the same line both keep their letters. */
function plainStroke(st){ const o={}; for(const k in st){ if(k[0]==='_'||k==='drawn')continue; o[k]=st[k]; } return o; }
function strokeSig(st){
  const rev=st.rev||0; let c=strokeSigs.get(st);
  if(!c||c.rev!==rev){ c={rev,json:JSON.stringify(plainStroke(st))}; strokeSigs.set(st,c); }
  return c.json;
}
/* A line's height is measured by each device for its own screen and never
   shared: two screens that wrap it differently would each write theirs back
   over the other's, forever, on an idle page. */
function lineAttrs(ln){ const o={}; for(const k in ln){ if(k==='id'||k==='text'||k==='wait'||k==='h'||k[0]==='_')continue; o[k]=ln[k]; } return o; }
/* the pictures themselves by length: a cropped picture carries its original (full) too,
   and one whose background was removed or put back the other version (bg or cut) */
function imageSig(im){ return JSON.stringify({...im,src:undefined,full:undefined,bg:undefined,cut:undefined})+'|'+(im.src||'').length+'|'+(im.full||'').length+'|'+(im.bg||'').length+'|'+(im.cut||'').length; }
/* The one span that differs between two texts, never splitting a character
   made of two UTF-16 units (an emoji, a rare letter) between the kept and
   the changed part. */
const low=c=>c>=0xdc00&&c<=0xdfff;
function textDiff(from,to){
  let a=0; while(a<from.length&&a<to.length&&from[a]===to[a])a++;
  if(a>0&&(low(from.charCodeAt(a))||low(to.charCodeAt(a))))a--;
  let b=0; while(b<from.length-a&&b<to.length-a&&from[from.length-1-b]===to[to.length-1-b])b++;
  if(b>0&&(low(from.charCodeAt(from.length-b))||low(to.charCodeAt(to.length-b))))b--;
  return {at:a,del:from.length-a-b,ins:to.slice(a,to.length-b)};
}
/* this device's edit to a line (base to mine) put into the shared text,
   which may meanwhile hold someone else's edit of the same base: where the
   two touch, mine goes after theirs, and nothing of theirs is deleted that
   this device never saw */
function editText(ytext,base,mine){
  const d=textDiff(base,mine),now=ytext.toString();
  let at=d.at,del=d.del;
  if(now!==base){
    const r=textDiff(base,now);
    if(at>=r.at+r.del)at+=r.ins.length-r.del;
    else if(at+del>r.at){
      /* overlapping: keep what they wrote, remove only what this device
         removed outside their span */
      const end=at+del;
      if(at<r.at){ del=r.at-at; }
      else{ at=r.at+r.ins.length; del=Math.max(0,end-(r.at+r.del)); }
    }
  }
  at=Math.max(0,Math.min(at,now.length)); del=Math.max(0,Math.min(del,now.length-at));
  if(del)ytext.delete(at,del);
  if(d.ins)ytext.insert(at,d.ins);
}

/* the page changed: mirror the difference into the document */
function flush(){
  flushQueued=false;
  const r=room; if(!r||applying||r.id!==S.id||!r.ready)return;   /* never another note into this room */
  const {Y}=window.Yjs,known=r.known,merged=[];
  r.doc.transact(()=>{
    const seen=new Set();
    for(const st of S.strokes){
      seen.add(st.id); const sig=strokeSig(st);
      if(known.strokes.get(st.id)!==sig){ r.strokes.set(st.id,JSON.parse(sig)); known.strokes.set(st.id,sig); }
    }
    for(const id of [...known.strokes.keys()])if(!seen.has(id)){ r.strokes.delete(id); known.strokes.delete(id); }
    seen.clear();
    for(const ln of S.lines){
      /* the empty line a blank page opens with is this device's own until
         something is typed in it: every device that joined, or saw the last
         line go, added one, and each was sent to everyone */
      if(ln._auto){ if(!ln.text&&!known.lines.has(ln.id))continue; delete ln._auto; }
      seen.add(ln.id);
      const attrs=JSON.stringify(lineAttrs(ln)),text=ln.text||'';
      let k=known.lines.get(ln.id),ym=r.lines.get(ln.id);
      if(!ym){ ym=new Y.Map(); r.lines.set(ln.id,ym); ym.set('attrs',JSON.parse(attrs)); ym.set('text',new Y.Text(text)); known.lines.set(ln.id,{attrs,text}); continue; }
      if(!k){ k={attrs:'',text:ym.get('text')?ym.get('text').toString():''}; known.lines.set(ln.id,k); }
      if(k.attrs!==attrs){ ym.set('attrs',JSON.parse(attrs)); k.attrs=attrs; }
      if(k.text!==text&&composing!==ln.id){
        let yt=ym.get('text'); if(!yt){ yt=new Y.Text(); ym.set('text',yt); }
        editText(yt,k.text,text);
        k.text=yt.toString();
        /* someone else's letters were already in it: the line becomes both */
        if(k.text!==text)merged.push(ln);
      }
    }
    for(const id of [...known.lines.keys()])if(!seen.has(id)){ r.lines.delete(id); known.lines.delete(id); }
    seen.clear();
    for(const im of S.images){
      seen.add(im.id); const sig=imageSig(im);
      if(known.images.get(im.id)!==sig){ r.images.set(im.id,{...im}); known.images.set(im.id,sig); }
    }
    for(const id of [...known.images.keys()])if(!seen.has(id)){ r.images.delete(id); known.images.delete(id); }
    /* only a title this device changed: a device that has not yet had the
       room's copy would otherwise send its blank page's "untitled" */
    if(S.title!==known.title&&r.meta.get('title')!==S.title){ r.meta.set('title',S.title); }
    known.title=S.title;
    if((r.meta.get('docH')||0)<S.docH)r.meta.set('docH',Math.min(S.docH,DOC_H_MAX));
  },LOCAL);
  for(const ln of merged){ const k=known.lines.get(ln.id); if(k){ ln.text=k.text; showText(ln); } }
}
const DOC_H_MAX=2e6;
/* a line's text changed underneath the person typing in it: the box shows
   it at once (not a frame later, when a keystroke in between would be
   typed into the old text), the caret kept on the same letter */
function showText(ln,before){
  const el=document.querySelector('.line .txt[data-id="'+CSS.escape(String(ln.id))+'"]');
  if(!el||el.value===ln.text)return;
  const selection=document.getSelection();
  if(!selection||!el.contains(selection.anchorNode)&&!el.contains(selection.focusNode)){ el.value=ln.text; return; }
  const old=before===undefined?el.value:before,d=textDiff(old,ln.text);
  const move=p=>p<=d.at?p:p>=d.at+d.del?p+d.ins.length-d.del:d.at+d.ins.length;
  const endpoint=(node,offset)=>{
    if(!el.contains(node))return {node,offset};
    const range=document.createRange();range.selectNodeContents(el);range.setEnd(node,offset);
    return {offset:move(range.toString().length)};
  };
  const anchor=endpoint(selection.anchorNode,selection.anchorOffset),focus=endpoint(selection.focusNode,selection.focusOffset);
  el.value=ln.text;
  const point=p=>p.node?[p.node,p.offset]:[el.firstChild||el,Math.min(p.offset,el.firstChild?.textContent.length||0)];
  try{ selection.setBaseAndExtent(...point(anchor),...point(focus)); }catch(err){}
}
/* the line an input method is composing in: its box is left alone until
   the word is done, and its own text is sent then (merged as above) */
let composing=null;
document.addEventListener('compositionstart',e=>{ composing=N.text.focusedLine()?.id||e.target?.dataset?.id||null; },true);
document.addEventListener('compositionend',()=>{
  const id=composing; composing=null;
  if(!id||!room)return;
  /* the finished word goes out now, merged with whatever came in meanwhile */
  changed();
},true);
function changed(hint){
  if(!room||applying||room.id!==S.id)return;
  /* the device's copy is still being read: a stroke drawn now is sent once
     it is in (see startNow); anything else is picked up by that pass */
  if(!room.ready){ if(hint?.stroke)room.early.push(hint.stroke.id); return; }
  /* A pen lift is one new immutable stroke. Publish it now, without walking
     every stroke and line in a growing note or waiting for the batch timer. */
  if(hint?.stroke&&room.provider){
    const r=room,st=hint.stroke,sig=strokeSig(st);
    r.doc.transact(()=>{
      r.strokes.set(st.id,JSON.parse(sig));
      if((r.meta.get('docH')||0)<S.docH)r.meta.set('docH',S.docH);
    },LOCAL);
    r.known.strokes.set(st.id,sig);
    r.provider.flushUpdates();
    return;
  }
  if(flushQueued)return;
  flushQueued=true; queueMicrotask(flush);
  paint();
}

/* ---- and back out: someone else wrote ---- */
function lineFrom(id,ym){
  const attrs=ym.get('attrs'),yt=ym.get('text');
  const ln={id,...cleanLineAttrs(attrs),text:yt&&typeof yt.toString==='function'?String(yt.toString()).slice(0,5000000):''};
  if(typeof ln.answerPrefix==='string'&&!ln.text.startsWith(ln.answerPrefix))delete ln.answerPrefix;
  return ln;
}
function takeLine(id){
  const r=room,ym=r.lines.get(id);
  if(!ym||typeof ym.get!=='function'){ S.lines=S.lines.filter(l=>l.id!==id); r.known.lines.delete(id); return; }
  const fresh=lineFrom(id,ym),was=r.known.lines.get(id);
  const ln=S.lines.find(l=>l.id===id);
  /* a word still being composed here: its text waits (see compositionend) */
  const hold=!!ln&&composing===id;
  r.known.lines.set(id,{attrs:JSON.stringify(lineAttrs(fresh)),text:hold&&was?was.text:fresh.text});
  if(!ln){ S.lines.push(fresh); return; }
  const before=ln.text;
  for(const key of Object.keys(ln))if(key!=='id'&&key!=='wait'&&key!=='h'&&key!=='text'&&key[0]!=='_'&&!(key in fresh))delete ln[key];
  const {text,...attrs}=fresh;
  Object.assign(ln,attrs);
  if(!hold&&ln.text!==text){ ln.text=text; showText(ln,before); }
}
function takeStroke(id,v){ const st=cleanStroke(v,id); if(st)return st; console.warn('collab: a stroke from another device was not valid and was skipped:',id); return null; }
function takeImage(id,v){ if(!safeImage(v))return null; const im={...v,id}; for(const k of Object.keys(im))if(k[0]==='_')delete im[k]; return im; }
function takeMeta(r){
  const title=r.meta.get('title'),h=r.meta.get('docH');
  return {title:typeof title==='string'&&title.trim()?title.slice(0,500):'',docH:num(h,DOC_H_MAX)&&h>0?h:0};
}
function pullAll(){
  const r=room;
  applying=true;
  try{
    S.strokes=[];
    for(const [id,v] of r.strokes.entries()){ const st=takeStroke(id,v); r.known.strokes.set(id,st?strokeSig(st):''); if(st)S.strokes.push(st); }
    orderStrokes();
    S.lines=[]; for(const id of r.lines.keys())takeLine(id);
    S.images=[];
    for(const [id,v] of r.images.entries()){ const im=takeImage(id,v); if(im){ r.known.images.set(id,imageSig(im)); S.images.push(im); } }
    orderImages();
    const meta=takeMeta(r);
    if(meta.title)S.title=meta.title;
    r.known.title=S.title;
    S.selection=[]; S.imageSelection=null;
    S.docH=Math.max(S.docH||1600,meta.docH);
    N.ui.paintAll();
    if(!S.lines.length)N.text.add(120,false)._auto=true;
  }finally{ applying=false; }
  C.markDirty();
}
/* Strokes and pictures are kept in maps, which have no order of their own:
   each device drew the later ones on top in the order it happened to hear
   of them, and a note opened again came back in yet another. They are put
   in the order they were made (a stroke's start time; a picture's z, the
   time it was added), the id breaking ties, the same on every device; a
   picture arriving later goes into that order, not simply on top. */
const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
function imageOrder(a,b){ return (a.z||0)-(b.z||0)||byId(a,b); }
function orderStrokes(){ S.strokes.sort((a,b)=>(a.t0||0)-(b.t0||0)||byId(a,b)); }
function orderImages(){ S.images.sort(imageOrder); }
/* the other way round: the document is made to match the page. Everything
   it holds is taken as known but stale, so flush() rewrites what differs and
   deletes what the page no longer has */
function adopt(r){
  for(const id of r.strokes.keys())r.known.strokes.set(id,'');
  for(const [id,ym] of r.lines.entries())r.known.lines.set(id,{attrs:'',text:ym&&ym.get&&ym.get('text')?ym.get('text').toString():''});
  for(const id of r.images.keys())r.known.images.set(id,'');
  r.known.title=null;
  flush();
}
/* a stroke or image that only moved: the offset, so it can glide there */
function translationOf(a,b){
  if(!a||!b)return null;
  if(a.pts&&b.pts){
    const p=a.pts,q=b.pts,n=p.length;
    if(n!==q.length||n<3)return null;
    const dx=q[0]-p[0],dy=q[1]-p[1]; if(!dx&&!dy)return null;
    for(const i of [n-3,Math.floor(n/6)*3])if(Math.abs(q[i]-p[i]-dx)>.01||Math.abs(q[i+1]-p[i+1]-dy)>.01)return null;
    return {dx,dy};
  }
  if(a.w===b.w&&a.h===b.h&&(a.x!==b.x||a.y!==b.y))return {dx:b.x-a.x,dy:b.y-a.y};
  return null;
}
/* something of theirs landed where they had been dragging it: the picture
   stays put on screen and the offset eases out from there */
function landed(id,moved){
  const shift=N.ink.peerShift,v=shift.get(id)||{dx:0,dy:0};
  shift.set(id,{dx:v.dx-moved.dx,dy:v.dy-moved.dy});
  for(const p of room.peers){
    const d=p.drag||(p.dragGhost&&p.dragGhost.drag);
    if(d&&(d.image===id||d.ids.includes(id)))p.dragDone=d.id;
  }
  paint();
}
const dirty={text:false,ink:false,images:false,bottom:0};
function observe(){
  const r=room;
  r.strokes.observe((e,txn)=>{
    if(txn.origin===LOCAL)return;
    applying=true;
    try{
      for(const [id,ch] of e.changes.keys){
        if(ch.action==='delete'){ S.strokes=S.strokes.filter(s=>s.id!==id); r.known.strokes.delete(id); N.ink.peerShift.delete(id); continue; }
        const st=takeStroke(id,r.strokes.get(id));
        if(!st){ r.known.strokes.set(id,''); continue; }
        /* written on another device: not this pen (local-recognition.js penResting); never synced, as _ fields are not */
        st._peer=true;
        r.known.strokes.set(id,strokeSig(st));
        dirty.bottom=Math.max(dirty.bottom,st.bbox[3]);
        const at=S.strokes.findIndex(s=>s.id===id);
        if(at<0)S.strokes.push(st);
        else{ const moved=translationOf(S.strokes[at],st); S.strokes[at]=st; if(moved)landed(id,moved); }
      }
      S.selection=S.selection.filter(id=>S.strokes.some(s=>s.id===id));
    }finally{ applying=false; }
    dirty.ink=true; refresh();
  });
  r.lines.observeDeep((events,txn)=>{
    if(txn.origin===LOCAL)return;
    const ids=new Set();
    for(const e of events){ if(e.target===r.lines)for(const id of e.changes.keys.keys())ids.add(id); else ids.add(e.path[0]); }
    applying=true;
    try{ for(const id of ids){ takeLine(id); const ln=S.lines.find(l=>l.id===id); if(ln)dirty.bottom=Math.max(dirty.bottom,ln.y+(ln.h||C.LINE_H)); } }finally{ applying=false; }
    dirty.text=true; refresh();
  });
  r.images.observe((e,txn)=>{
    if(txn.origin===LOCAL)return;
    applying=true;
    try{
      for(const [id,ch] of e.changes.keys){
        if(ch.action==='delete'){ S.images=S.images.filter(i=>i.id!==id); r.known.images.delete(id); N.ink.peerShift.delete(id); if(S.imageSelection===id)S.imageSelection=null; continue; }
        const im=takeImage(id,r.images.get(id)); if(!im)continue; r.known.images.set(id,imageSig(im));
        dirty.bottom=Math.max(dirty.bottom,im.y+im.h);
        const at=S.images.findIndex(i=>i.id===id);
        if(at<0){ const after=S.images.findIndex(i=>imageOrder(i,im)>0); if(after<0)S.images.push(im); else S.images.splice(after,0,im); }
        else{ const moved=translationOf(S.images[at],im); S.images[at]=im; if(moved)landed(id,moved); }
      }
    }finally{ applying=false; }
    dirty.images=true; refresh();
  });
  r.meta.observe((e,txn)=>{
    if(txn.origin===LOCAL)return;
    const meta=takeMeta(r);
    if(e.keysChanged.has('title')&&meta.title){ S.title=meta.title; r.known.title=meta.title; N.ui.refreshTitle(); }
    if(e.keysChanged.has('gen')&&r.provider)r.provider.params.gen=genOf(r);
    refresh();
  });
}
/* one repaint for a burst of remote changes, and only of what changed:
   repainting and re-reading everything on every letter someone typed was
   the lag. The maths waits a moment for the typing to pause. */
let refreshQueued=false,mathTimer=null,needRecog=false;
function refresh(){
  if(refreshQueued)return; refreshQueued=true;
  requestAnimationFrame(()=>{
    refreshQueued=false;
    if(!room)return;
    C.growDoc(Math.min(DOC_H_MAX,Math.max(dirty.bottom,takeMeta(room).docH-700)));
    dirty.bottom=0;
    /* the blank line a page falls back on is this device's own (see flush) */
    if(dirty.text){ N.text.render(); if(!S.lines.length){ applying=true; try{ N.text.add(120,false)._auto=true; }finally{ applying=false; } } }
    if(dirty.ink)needRecog=true;
    if(dirty.ink||dirty.images)N.ink.render(()=>{
      if(!room)return;
      for(const p of room.peers)if(p.live&&S.strokes.some(st=>st.id===p.live.id))p.live=null;
      paint();
    });
    dirty.text=dirty.ink=dirty.images=false;
    clearTimeout(mathTimer); mathTimer=setTimeout(()=>{
      if(!room)return;
      if(needRecog&&N.recog)N.recog.rebuild();
      needRecog=false;
      if(N.mathcore)N.mathcore.run();
    },250);
    C.markDirty();
    paint();
  });
}

/* ---- the room ---- */
let starting=null,startSeq=0;
async function start(id,seed,gen){
  stop();
  /* shared from here for the first time (or again, after it was ended):
     the note on the page is the truth. A note still marked shared whose
     room simply failed to start is not: the others' edits since are in the
     device's copy of the room and must not be written over */
  const fresh=seed&&!isShared(id);
  const ticket=++startSeq;
  starting=id;
  try{ await startNow(id,seed,fresh,ticket,gen); }
  finally{ if(starting===id&&ticket===startSeq)starting=null; }
}
/* the share this device's copy belongs to ('' for a copy yet to arrive) */
function genOf(r){ const g=r.meta.get('gen'); return typeof g==='string'&&/^[a-z0-9]{8,40}$/.test(g)?g:''; }
async function startNow(id,seed,fresh,ticket,gen){
  const {Y,WebsocketProvider,IndexeddbPersistence}=await loadLib();
  /* a later start (the note opened twice, a link opened on a known note)
     has taken over: this one leaves no second document behind */
  if(S.id!==id||ticket!==startSeq)return;
  if(room)stop();
  const doc=new Y.Doc();
  const r=room={id,doc,strokes:doc.getMap('strokes'),lines:doc.getMap('lines'),images:doc.getMap('images'),meta:doc.getMap('meta'),
    known:{strokes:new Map(),lines:new Map(),images:new Map(),title:seed?null:S.title},status:'connecting',peers:[],synced:false,ready:false,early:[]};
  r.idb=new IndexeddbPersistence('notas-collab-'+id,doc);
  await r.idb.whenSynced;
  if(room!==r)return;
  const stored=r.strokes.size||r.lines.size||r.images.size;
  /* until the device's copy is read, nothing is written into it: a change
     made in that moment would otherwise land as a rival of what is stored.
     A stroke drawn meanwhile is kept and sent once the copy is in. */
  r.ready=true;
  /* Sharing from here, the note on the page is the truth. A copy of the room
     this device still held from an earlier share used to be pulled over it,
     and everything written, erased or renamed since came undone. */
  if(stored&&fresh){ adopt(r); observe(); }
  else if(stored){
    const early=r.early.map(sid=>S.strokes.find(s=>s.id===sid)).filter(Boolean);
    pullAll(); observe();
    if(early.length){ for(const st of early)if(!S.strokes.some(s=>s.id===st.id))S.strokes.push(st); orderStrokes(); N.ink.render(); flush(); }
  }
  else if(seed){ flush(); observe(); }
  if(gen&&!stored&&genOf(r)!==gen)r.doc.transact(()=>r.meta.set('gen',gen),LOCAL);
  else if(gen&&seed&&fresh)r.doc.transact(()=>r.meta.set('gen',gen),LOCAL);
  if(!served()){ r.status='disconnected'; setShared(id,true); paintButton(); return; }
  const params={name:name(),gen:genOf(r)};
  const token=hostToken(id,false);
  /* the host's token goes as a websocket subprotocol, out of the address
     and so out of the request logs */
  r.provider=new WebsocketProvider(socketUrl(),id,doc,{params,protocols:token?['notas','h'+token]:['notas']});
  announce();
  r.provider.on('status',({status})=>{
    if(room!==r)return; r.status=status;
    if(status==='connected'){ probedAt=0; setBusy(false); }
    paintButton();
    if(status==='connected'&&r.wasOff){ r.wasOff=false; C.status('sharing again.'); }
    /* said once when the link drops, not on every retry: edits keep going
       into the copy on this device and catch up on their own */
    if(status==='disconnected'&&r.synced&&!r.wasOff){ r.wasOff=true; C.status(offline()?'offline. your edits are kept here.':'sharing paused. your edits are kept here.'); }
  });
  r.provider.on('sync',synced=>{
    if(room!==r||!synced)return;
    /* arriving by link with nothing on this device yet: the note is what
       the room holds, replacing the blank page opened for it */
    if(!r.synced&&!stored&&!seed){ pullAll(); observe(); }
    r.synced=true; paintButton();
    /* the share this copy now belongs to, for every reconnection from here */
    r.provider.params.gen=genOf(r);
  });
  /* every failed or dropped attempt, the first included (which never
     reports "disconnected"): is it the day's allowance? */
  r.provider.on('connection-close',()=>{ if(room===r)probe(); });
  /* the room closed the door for good: the host has stopped sharing, or
     the note is too big to send over this connection */
  r.provider.on('closed',({code})=>{
    if(room!==r)return;
    if(code===4410)ended();
    else if(code===4413){ r.status='disconnected'; paintButton(); C.toast('this shared note is too big to open here. ask whoever shared it to make it smaller, or to send it as a file.',8000); }
  });
  r.provider.awareness.on('change',()=>{ if(room===r)peers(); });
  /* a quarter second pulse: sends what this device is doing when that
     changed, and repaints after a zoom, which has no event of its own */
  seenZoom=C.M.zoom; seenDoing='';
  pulse=setInterval(()=>{ if(room!==r)return; sendDoing(); if(C.M.zoom!==seenZoom){ seenZoom=C.M.zoom; paint(); } },250);
  setShared(id,true);
  paintButton();
}
/* who this device is, to the others */
function announce(){
  if(!room||!room.provider)return;
  const n=name()||'someone';
  room.provider.awareness.setLocalStateField('user',{name:n,color:colorFor(n)});
}
function stop(){
  const r=room; if(!r)return; room=null; liveSent=null; dragId=null;
  clearInterval(pulse); pulse=null; clearTimeout(mathTimer); needRecog=false;
  try{ r.provider&&r.provider.destroy(); }catch(e){}
  try{ r.idb&&r.idb.destroy(); }catch(e){}
  r.doc.destroy();
  N.ink.peerShift.clear(); N.ink.render();
  paintButton(); paint();
}
/* the host ends the room: the others are cut off and lose the note; this
   device keeps it as an ordinary note and can share it again later */
async function endForEveryone(){
  const r=room; if(!r)return false;
  const token=hostToken(r.id); if(!token)return false;
  try{
    const res=await fetch('./collab/'+r.id+'/close',{method:'POST',headers:{'X-Notas-Host':token}});
    if(!res.ok)throw new Error('could not end sharing ('+res.status+').');
  }catch(e){ C.toast(String(e.message||'could not end sharing.').toLowerCase()); return false; }
  if(room===r)stop(); setShared(r.id,false);
  if(S.id===r.id){C.markDirty(); await C.save();}
  forget(r.id);
  return true;
}
/* What this device kept of a room it no longer shares. Kept, it came back
   the next time the note was shared and replaced everything written since.
   Deleting waits for every tab's connection to it to close. */
function forget(id){
  setTimeout(()=>{ if(room&&room.id===id)return; try{ indexedDB.deleteDatabase('notas-collab-'+id); }catch(e){} },400);
}
/* this device leaves a note that is not its own: the note goes with it,
   unless a copy is kept first as a note of this device's own, which is
   then the page */
let leaving=null,ending=false;
function leave(id,keep){
  /* one leaving at a time: a second call while the first is under way
     (whatever asked twice) joins it rather than making a blank note or
     deleting under the first one's feet */
  if(leaving)return leaving;
  leaving=leaveNow(id,keep).finally(()=>{ leaving=null; });
  return leaving;
}
async function leaveNow(id,keep){
  if(room&&room.id===id)stop();
  const copyId=keep?await keepCopy(id):null;
  /* the copy could not be made: nothing is deleted, the note stays as an
     ordinary one under its own id, and the caller is told so with false */
  if(keep&&!copyId){ C.toast('could not keep a copy, so the note stays here as it is.',5000); setShared(id,false); return false; }
  setShared(id,false);
  if(copyId)await N.ui.openNote(copyId); else await N.ui.newNote();
  /* the page must have moved off the note before it is deleted; if it
     could not (another note change was under way), nothing is lost: the
     note stays here as an ordinary one */
  if(S.id===id){ C.toast('the note stays here as it is for now.',5000); return false; }
  await C.deleteStoredNote(id);
  forget(id);
  return copyId;
}
/* what this device holds of a shared note, saved again under a new id as
   an ordinary note; the way save() makes its conflict copies */
async function keepCopy(id){
  try{
    if(S.id===id&&S.dirty&&!await C.save())return null;
    const doc=await C.Store.get('notas.note.'+id); if(!doc)return null;
    const copyId=C.uid(),now=Date.now();
    const copy={...doc,id:copyId,title:C.displayTitle(doc.title,doc.lines)+' (my copy)',created:now,updated:now,rev:1};
    if(!await C.Store.set('notas.note.'+copyId,copy))return null;
    const first=(doc.lines||[]).slice().sort((a,b)=>a.y-b.y).find(l=>l.text&&l.text.trim());
    const listed=await C.withIndexLock(async()=>{
      const ix=await C.Store.index(); ix.unshift({id:copyId,title:copy.title,updated:now,preview:first?first.text.trim().replace(/\s+/g,' ').slice(0,60):''});
      return C.Store.putIndex(ix);
    });
    if(!listed){ await C.Store.del('notas.note.'+copyId); return null; }
    return copyId;
  }catch(e){ return null; }
}
/* the choice before a shared note leaves this device. The sheet closing
   any other way is the safe answer: keep, unless leaving was cancelled */
function leaveSheet(title,why,keepLabel,goLabel,onDismiss){
  return new Promise(resolve=>{
    const box=N.ui.openSheet(
      '<h2>'+title+'</h2><p>'+why+'</p>'+
      '<button class="mi" type="button" id="leave-keep"><i class="ph ph-copy"></i>'+keepLabel+'<span class="k">as a note of your own</span></button>'+
      '<button class="mi" type="button" id="leave-go"><i class="ph ph-sign-out"></i>'+goLabel+'</button>');
    let done=false;
    const finish=v=>{ if(done)return; done=true; clearInterval(watcher); if(box.isConnected)N.ui.closeSheet(); resolve(v); };
    box.querySelector('#leave-keep').onclick=()=>finish('keep');
    box.querySelector('#leave-go').onclick=()=>finish('go');
    const watcher=setInterval(()=>{ if(!box.isConnected)finish(onDismiss); },150);
    box.querySelector('#leave-keep').focus();
  });
}
async function ended(){
  const r=room;
  if(r&&hostToken(r.id)){
    stop(); setShared(r.id,false);
    C.markDirty(); await C.save();
    forget(r.id);
    C.status("sharing ended. your note is saved.");
    return;
  }
  /* the room is gone; the note is still on this device until the choice is made */
  if(!r||ending)return;
  ending=true;
  try{
    const id=r.id; stop();
    const choice=await leaveSheet('sharing has ended',
      'the host has stopped sharing this note. it is theirs, so it leaves this device, but what is on the page now can stay as a copy of your own.',
      'keep a copy','let it go','keep');
    const copyId=await leave(id,choice==='keep');
    if(copyId===false)return;
    C.toast(copyId?'kept as "'+S.title+'". the shared note itself has ended.':'sharing has ended. the note has left this device.',5000);
  }finally{ ending=false; }
}

/* ---- who is here ---- */
function peers(){
  const r=room; if(!r)return;
  const me=r.provider.awareness.clientID,was=new Map(r.peers.map(p=>[p.id,p])),list=[],now=performance.now();
  let ghostStarted=false;
  for(const [id,st] of r.provider.awareness.getStates()){
    if(id===me||!st||!st.user)continue;
    const prev=was.get(id)||{};
    let live=liveOf(prev.live,st.live);
    if(!live&&prev.live?.kind==='pen'){
      if(!prev.live.until)ghostStarted=true;
      const until=prev.live.until||now+2000;
      if(until>now){ prev.live.until=until; live=prev.live; }
    }
    const p={id,name:String(st.user.name||'someone').slice(0,40),color:peerColor(st.user.color,st.user.name),cursor:cleanCursor(st.cursor),selection:cleanSelection(st.selection),focus:cleanFocus(st.focus),drag:cleanDrag(st.drag),
      tool:typeof st.tool==='string'?st.tool.slice(0,20):'',live,
      view:prev.view||null,caret:prev.caret,dragDone:prev.dragDone,dragGhost:prev.dragGhost};
    /* a drag that stopped being reported keeps its last offset for a
       moment, until the move itself lands, so nothing snaps back and forth */
    if(prev.drag&&!p.drag&&prev.dragDone!==prev.drag.id)p.dragGhost={drag:prev.drag,until:now+800};
    if(p.drag)p.dragGhost=null;
    list.push(p);
  }
  const alone=!r.peers.length;
  r.peers=list;
  if(ghostStarted)setTimeout(()=>{
    if(room!==r)return;
    const t=performance.now();
    for(const p of r.peers)if(p.live?.until&&p.live.until<=t)p.live=null;
    paint();
  },2050);
  /* the first to arrive is told what this device is doing right away:
     nothing was sent while it was alone */
  if(alone&&list.length){ sentPos=null; seenDoing=''; sendDoing(); }
  /* the avatars and count repaint only when who is here changes; a moving
     pen only repaints the presence layer */
  const sig=list.map(p=>p.id+':'+p.name).join();
  if(sig!==r.peerSig){ r.peerSig=sig; paintButton(); }
  paint();
}
/* The stroke someone is in the middle of arrives in pieces: each message
   carries the points added since the last one and where they start, so a
   long stroke does not resend itself on every move. The pieces are joined
   here; a piece already held (a repeat of the same message) is dropped,
   and one that starts past what is held is joined anyway, so a message
   lost mid-stroke costs a short straight bit, not the stroke. */
/* What someone's presence says is only drawn from, never trusted: every
   field is checked for the shape this page sends, and anything else is as
   if it had not been said (a list that was not a list stopped every
   device's presence layer, and a stroke in progress could grow without end). */
const LIVE_MAX=60000;
function cleanIds(v){ return Array.isArray(v)?v.filter(x=>typeof x==='string'&&x.length<=160).slice(0,200):[]; }
function cleanCursor(c){ return c&&num(c.x)&&num(c.y)?{x:c.x,y:c.y}:null; }
function cleanSelection(s){ if(!s||typeof s!=='object')return null; return {ids:cleanIds(s.ids),image:typeof s.image==='string'?s.image:null}; }
function cleanFocus(f){ if(!f||typeof f!=='object'||typeof f.line!=='string')return null; return {line:f.line,start:num(f.start,1e7)?Math.max(0,f.start|0):0,end:num(f.end,1e7)?Math.max(0,f.end|0):0}; }
function cleanDrag(d){ if(!d||typeof d!=='object'||typeof d.id!=='string')return null; return {id:d.id,ids:cleanIds(d.ids),image:typeof d.image==='string'?d.image:null,dx:num(d.dx)?d.dx:0,dy:num(d.dy)?d.dy:0}; }
function liveOf(prev,msg){
  if(!msg||typeof msg.id!=='string'||!Array.isArray(msg.pts)||!msg.pts.every(v=>num(v)))return null;
  const kind=['pen','eraser','lasso'].includes(msg.kind)?msg.kind:'pen',stride=kind==='lasso'?2:3;
  if(prev&&prev.id===msg.id){
    const have=prev.pts.length/stride;
    if(num(msg.from,1e7)&&msg.from>=have&&msg.pts.length&&prev.pts.length+msg.pts.length<=LIVE_MAX)prev.pts=prev.pts.concat(msg.pts);
    return prev;
  }
  return {id:msg.id,kind,pts:msg.pts.slice(0,LIVE_MAX),w:num(msg.w,100)&&msg.w>0?msg.w:2.4,color:typeof msg.color==='string'&&/^#[0-9a-f]{6}$/i.test(msg.color)?msg.color:'',r:num(msg.r,200)?msg.r:0};
}
/* the share sheet while the allowance is spent: everything in it greyed and
   out of reach, and the reason above it, until the room connects again */
function paintBusy(){
  const note=document.getElementById('share-busy'),main=document.getElementById('share-main');
  if(note)note.hidden=!busy;
  if(main){ main.classList.toggle('share-down',busy); main.inert=busy; }
}
let busyStyled=false;
function busyStyle(){
  if(busyStyled)return; busyStyled=true;
  const s=document.createElement('style');
  s.textContent='#share-main.share-down{opacity:.4;filter:grayscale(1);pointer-events:none;user-select:none;transition:opacity .2s ease}'+
    '#share-busy{color:var(--ink-1);font-weight:500;margin:6px 0 10px}';
  document.head.appendChild(s);
}
function paintButton(){
  paintBusy();
  const people=document.getElementById('share-people'); if(people)people.innerHTML=peopleHtml();
  const row=document.getElementById('peers');
  if(row){
    const list=room?room.peers.slice().sort((a,b)=>a.name.localeCompare(b.name)):[];
    const shown=list.slice(0,4),more=list.length-shown.length;
    row.innerHTML=shown.map(p=>'<button class="peer" type="button" style="--who:'+esc(p.color)+'" title="'+esc(p.name)+'" aria-label="'+esc(p.name)+' is here">'+esc(initials(p.name))+'</button>').join('')+
      (more>0?'<button class="peer more" type="button" title="'+esc(list.slice(4).map(p=>p.name).join(', '))+'">+'+more+'</button>':'');
    for(const b of row.querySelectorAll('.peer'))b.onclick=()=>shareSheet();
  }
  const b=document.getElementById('btn-share'); if(!b)return;
  const count=b.querySelector('#share-count');
  const on=!!room;
  b.classList.toggle('on',on);
  b.classList.toggle('off',on&&room.status!=='connected');
  b.title=on?(busy&&room.status!=='connected'?'shared. sharing is under high load today'
    :room.status==='connected'?'shared. '+(room.peers.length?room.peers.length+' here with you':'only you here')
    :room.status==='connecting'&&!room.synced?'shared, connecting':offline()?'shared, offline':'shared, reconnecting'):'share';
  b.setAttribute('aria-label',b.title);
  if(count){ const n=on?room.peers.length+1:0; count.textContent=String(n); count.hidden=!on; }
}
function peopleHtml(){
  const r=room; if(!r)return '';
  const you='<span class="who" style="--who:'+colorFor(name()||'someone')+'">'+esc(name()||'someone')+' (you'+(isHost()?', host':'')+')</span>';
  const others=r.peers.map(p=>'<span class="who" style="--who:'+esc(p.color||'')+'">'+esc(p.name)+'</span>').join('');
  /* what the link is doing, and why, when it is not up: the browser knows
     when it is offline; otherwise the room is out of reach, which on the
     website means it is down or over its day's allowance, and from a file
     or a plain server means there is no room at all */
  const state=r.status==='connected'?(r.peers.length?'':'only you so far. ')
    :r.status==='connecting'&&!r.synced?'connecting. '
    :offline()?'offline. your edits are kept here and catch up when you are back. '
    :!/^https?:$/.test(location.protocol)?'not connected: sharing needs this notebook served from its website. '
    :'sharing is unavailable right now. your edits are kept here and catch up when it returns. ';
  return '<p>'+state+(r.synced&&r.status!=='connected'?'last here: ':'here now: ')+you+others+'</p>';
}

/* ---- presence on the page ----
   Each device tells the room where its pen is, what it has selected, the
   line it is typing in, and any drag in progress. The others draw all of
   that in the person's colour on a layer above the ink, and nothing
   there jumps: positions ease toward where they were last reported, a
   dragged stroke or picture slides along with the hand and glides the
   last bit when the move lands. Only changes are sent, a few times a
   second at most, so an idle page costs the room nothing. */
let layer=null,frameQueued=false,frameAt=0,sentAt=0,sentPos=null,dragId=null,liveSent=null,pulse=null,seenZoom=0,seenDoing='',doingQueued=false;
const EASE=180;                      /* ms to close most of the gap */
function presenceLayer(){
  if(layer)return layer;
  const wrap=document.getElementById('canvaswrap'); if(!wrap)return null;
  layer=document.createElement('canvas'); layer.id='c-peers'; layer.setAttribute('aria-hidden','true');
  layer.style.pointerEvents='none';
  wrap.appendChild(layer);
  return layer;
}
function ease(v,t,k){ const d=t-v; return Math.abs(d)<.25?t:v+d*k; }
/* what every dragged thing should be offset by right now: the drag in
   progress, or its ghost while its landing is awaited */
function dragTargets(now){
  const targets=new Map(); if(!room)return targets;
  for(const p of room.peers){
    let d=p.drag; if(d&&p.dragDone===d.id)d=null;
    if(!d&&p.dragGhost&&p.dragGhost.until>now&&p.dragDone!==p.dragGhost.drag.id)d=p.dragGhost.drag;
    if(!d)continue;
    for(const id of d.ids)targets.set(id,d);
    if(d.image)targets.set(d.image,d);
  }
  return targets;
}
function paint(){ if(frameQueued)return; frameQueued=true; requestAnimationFrame(frame); }
function frame(now){
  frameQueued=false;
  const dt=Math.min(64,frameAt?now-frameAt:16); frameAt=now;
  const k=1-Math.pow(0.02,dt/EASE);
  let settled=true;
  /* dragged ink and pictures */
  const shift=N.ink.peerShift,targets=dragTargets(now);
  let inkMoved=false;
  for(const id of new Set([...shift.keys(),...targets.keys()])){
    const t=targets.get(id),tx=t?t.dx:0,ty=t?t.dy:0;
    const v=shift.get(id)||{dx:0,dy:0};
    const nx=ease(v.dx,tx,k),ny=ease(v.dy,ty,k);
    if(nx!==v.dx||ny!==v.dy)inkMoved=true;
    if(!nx&&!ny&&!t){ if(shift.has(id)){ shift.delete(id); inkMoved=true; } }
    else{ shift.set(id,{dx:nx,dy:ny}); if(nx!==tx||ny!==ty)settled=false; }
  }
  if(inkMoved)N.ink.render();
  const c=presenceLayer(); if(!c)return;
  const M=C.M,sc=document.getElementById('scroller');
  const w=Math.round(M.vw*M.dpr),h=Math.round(M.vh*M.dpr);
  if(c.width!==w||c.height!==h){ c.width=w; c.height=h; c.style.width=M.vw+'px'; c.style.height=M.vh+'px'; }
  const ctx=c.getContext('2d');
  ctx.setTransform(M.dpr,0,0,M.dpr,0,0); ctx.clearRect(0,0,M.vw,M.vh);
  if(!room){ frameAt=0; return; }
  const ui=(getComputedStyle(document.body).getPropertyValue('--ui')||'system-ui').trim();
  const origin=sc.getBoundingClientRect();
  const toX=x=>M.colLeft-sc.scrollLeft+x*M.zoom,toY=y=>-sc.scrollTop+y*M.zoom;
  const tag=(label,x,y,color)=>{
    ctx.font='500 11px '+ui; ctx.textBaseline='middle';
    const tw=ctx.measureText(label).width,lh=18;
    x=Math.max(0,Math.min(x,M.vw-tw-12));y=Math.max(0,Math.min(y,M.vh-lh));
    ctx.beginPath(); ctx.roundRect(x,y,tw+12,lh,9); ctx.fillStyle=color; ctx.fill();
    ctx.fillStyle='#fff'; ctx.fillText(label,x+6,y+lh/2);
  };
  for(const p of room.peers){
    const color=p.color;
    /* their selection: a box in their colour around the ink and images,
       moving with them while they drag */
    if(p.selection){
      let b=null;
      const grow=(r,id)=>{ const s=shift.get(id),dx=s?s.dx:0,dy=s?s.dy:0; const q=[r[0]+dx,r[1]+dy,r[2]+dx,r[3]+dy]; b=b?[Math.min(b[0],q[0]),Math.min(b[1],q[1]),Math.max(b[2],q[2]),Math.max(b[3],q[3])]:q; };
      const ids=new Set(p.selection.ids);
      for(const st of S.strokes)if(ids.has(st.id)&&st.bbox)grow(st.bbox,st.id);
      if(p.selection.image){ const im=S.images.find(i=>i.id===p.selection.image); if(im)grow([im.x,im.y,im.x+im.w,im.y+im.h],im.id); }
      if(b){
        const x=toX(b[0])-6,y=toY(b[1])-6,bw=(b[2]-b[0])*M.zoom+12,bh=(b[3]-b[1])*M.zoom+12;
        ctx.beginPath(); ctx.roundRect(x,y,bw,bh,6);
        ctx.fillStyle=color; ctx.globalAlpha=.08; ctx.fill(); ctx.globalAlpha=1;
        ctx.setLineDash([4,3]); ctx.lineWidth=1.5; ctx.strokeStyle=color; ctx.stroke(); ctx.setLineDash([]);
        tag(p.name,x,y-20,color);
      }
    }
    /* the line they are typing in: a soft band, their caret easing along
       it, and what they have highlighted, all in their colour */
    if(p.focus){
      const el=document.querySelector('.line .txt[data-id="'+CSS.escape(String(p.focus.line))+'"]');
      const ln=S.lines.find(l=>l.id===p.focus.line);
      if(el&&ln){
        const r=el.getBoundingClientRect(),x=r.left-origin.left,y=r.top-origin.top;
        ctx.beginPath(); ctx.roundRect(x-4,y-2,r.width+8,r.height+4,6);
        ctx.fillStyle=color; ctx.globalAlpha=.07; ctx.fill(); ctx.globalAlpha=1;
        const cs=getComputedStyle(el),single=r.height<parseFloat(cs.lineHeight||'0')*1.5||r.height<C.LINE_H*M.zoom*1.5;
        if(single){
          ctx.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;
          const scale=r.width/el.offsetWidth;
          const pad=(parseFloat(cs.paddingLeft)||0)*scale,text=ln.text||'';
          const at=i=>Math.max(x+pad,Math.min(x+r.width-pad,x+pad+(ctx.measureText(text.slice(0,Math.max(0,Math.min(i,text.length)))).width-el.scrollLeft)*scale));
          const a=at(Math.min(p.focus.start,p.focus.end)),bTarget=at(Math.max(p.focus.start,p.focus.end));
          const bx=p.caret==null||p.caret.line!==p.focus.line?bTarget:ease(p.caret.x,bTarget,k);
          p.caret={line:p.focus.line,x:bx}; if(bx!==bTarget)settled=false;
          if(bx>a){ ctx.fillStyle=color; ctx.globalAlpha=.25; ctx.fillRect(a,y+2,bx-a,r.height-4); ctx.globalAlpha=1; }
          ctx.fillStyle=color; ctx.fillRect(bx-1,y+2,2,r.height-4);
          tag(p.name,bx+4,y-16,color);
        }else tag(p.name,x+r.width-ctx.measureText(p.name).width-16,y-16,color);
      }
    }else p.caret=null;
    /* what their pen is in the middle of, as it happens: a stroke in the
       ink it will become, an eraser pass as the band it clears, a lasso as
       its dashed loop, the last two in their colour */
    if(p.live&&p.live.pts.length>=(p.live.kind==='lasso'?2:3))drawLive(ctx,p.live,color,M,sc);
    /* their pen: the mark says which tool is up */
    const cu=p.cursor;
    if(!cu){ p.view=null; continue; }
    if(!p.view)p.view={x:cu.x,y:cu.y};
    else{ p.view.x=ease(p.view.x,cu.x,k); p.view.y=ease(p.view.y,cu.y,k); if(p.view.x!==cu.x||p.view.y!==cu.y)settled=false; }
    const x=toX(p.view.x),y=toY(p.view.y);
    if(x<-60||y<-60||x>M.vw+60||y>M.vh+60)continue;
    drawCursor(ctx,p.tool,x,y,color);
    tag(p.name+(p.tool?' · '+(TOOL_NAMES[p.tool]||p.tool):''),x+10,y+7,color);
  }
  if(!settled)paint(); else frameAt=0;
}

const TOOL_NAMES={pen:'pen',eraser:'eraser',select:'select',text:'text'};
/* the piece someone is drawing, in page coordinates like the ink itself */
function drawLive(ctx,lv,color,M,sc){
  ctx.save();
  const k=M.dpr*M.zoom;
  ctx.setTransform(k,0,0,k,M.dpr*(M.colLeft-sc.scrollLeft),-M.dpr*sc.scrollTop);
  const p=lv.pts;
  if(lv.kind==='pen'){
    N.ink.drawStroke(ctx,{id:lv.id,author:'user',w:lv.w,pts:p,...(lv.color?{color:lv.color}:{})});
  }else if(lv.kind==='eraser'){
    const r=lv.r||9;
    ctx.strokeStyle=color; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.globalAlpha=.18; ctx.lineWidth=r*2;
    if(p.length>=6){ ctx.beginPath(); ctx.moveTo(p[0],p[1]); for(let i=3;i<p.length;i+=3)ctx.lineTo(p[i],p[i+1]); ctx.stroke(); }
    ctx.globalAlpha=.7; ctx.lineWidth=1.25/M.zoom;
    ctx.beginPath(); ctx.arc(p[p.length-3],p[p.length-2],r,0,Math.PI*2); ctx.stroke();
  }else if(lv.kind==='lasso'){
    ctx.strokeStyle=color; ctx.setLineDash([5/M.zoom,4/M.zoom]); ctx.lineWidth=1/M.zoom;
    ctx.beginPath(); ctx.moveTo(p[0],p[1]); for(let i=2;i<p.length;i+=2)ctx.lineTo(p[i],p[i+1]); ctx.stroke();
  }
  ctx.restore();
}
/* the mark under someone's name: a dot for the pen, a ring for the eraser,
   a dashed corner for the lasso, a caret for text */
function drawCursor(ctx,tool,x,y,color){
  ctx.save();
  ctx.fillStyle=color; ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.lineCap='round';
  if(tool==='eraser'){
    ctx.beginPath(); ctx.arc(x,y,7,0,Math.PI*2); ctx.globalAlpha=.18; ctx.fill(); ctx.globalAlpha=1; ctx.stroke();
    ctx.beginPath(); ctx.arc(x,y,1.5,0,Math.PI*2); ctx.fill();
  }else if(tool==='select'){
    ctx.setLineDash([3,2]); ctx.strokeRect(x-6,y-6,12,12); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x,y,1.5,0,Math.PI*2); ctx.fill();
  }else if(tool==='text'){
    ctx.beginPath(); ctx.moveTo(x,y-7); ctx.lineTo(x,y+7); ctx.moveTo(x-3,y-7); ctx.lineTo(x+3,y-7); ctx.moveTo(x-3,y+7); ctx.lineTo(x+3,y+7); ctx.stroke();
  }else{
    ctx.beginPath(); ctx.arc(x,y,4.5,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#fff'; ctx.stroke();
  }
  ctx.restore();
}

/* ---- what this device sends ---- */
function sendState(fields){
  const r=room; if(!r||!r.provider)return;
  const aw=r.provider.awareness;
  aw.setLocalState({...(aw.getLocalState()||{}),...fields});
}
/* the pen, the drag it is making, and the stroke, eraser pass or lasso it
   is in the middle of, together in one message; the stroke goes as the
   points added since the last message (see liveOf) */
function livePiece(){
  const lv=N.ink.live&&N.ink.live();
  if(!lv){ liveSent=null; return null; }
  const stride=lv.kind==='lasso'?2:3,n=Math.floor(lv.pts.length/stride);
  const from=liveSent&&liveSent.id===lv.id?liveSent.n:0;
  if(n<=from&&from)return undefined;            /* nothing new since the last piece */
  /* coordinates to a tenth of a pixel, pressure to a hundredth */
  const pts=new Array((n-from)*stride);
  for(let i=from*stride,j=0;i<n*stride;i++,j++){ const k=stride===3&&j%3===2?100:10; pts[j]=Math.round(lv.pts[i]*k)/k; }
  liveSent={id:lv.id,n};
  return {kind:lv.kind,id:lv.id,from,pts,w:lv.w,color:lv.color||'',r:Math.round((lv.r||0)*10)/10};
}
/* every message counts against the room's day, so the pointer goes out
   only when someone is there to see it, and a bare cursor less often than
   a stroke or a drag being made */
function onPointer(ev){
  if(!room||!N.ink)return;
  if(alone())return;
  const now=performance.now();
  const drag=N.ink.drag();
  if(now-sentAt<(drag||(N.ink.live&&N.ink.live())?60:120))return;
  const p=N.ink.toWorld(ev);
  if(drag&&!dragId)dragId=C.uid();
  if(!drag)dragId=null;
  const live=livePiece();
  if(!drag&&!live&&sentPos&&Math.hypot(p.x-sentPos.x,p.y-sentPos.y)<1.5)return;
  sentAt=now; sentPos=p;
  const fields={cursor:{x:Math.round(p.x),y:Math.round(p.y)},
    drag:drag?{id:dragId,ids:S.selection.slice(0,200),image:S.imageSelection||null,dx:Math.round(drag.dx*10)/10,dy:Math.round(drag.dy*10)/10}:null};
  if(live!==undefined)fields.live=live;
  sendState(fields);
}
/* nobody else on the note: what this device has sent of its pointer is
   taken down once, then nothing goes until someone arrives */
function alone(){
  if(!room||room.peers.length)return false;
  if(sentPos||liveSent||dragId){ sentPos=null; liveSent=null; dragId=null; sendState({cursor:null,drag:null,live:null}); }
  return true;
}
function onPointerEnd(){
  if(!room)return;
  /* after the page's own handler has committed the move or the stroke: the
     ink itself has gone out through the document by then, so the piece
     being drawn can be taken down */
  setTimeout(()=>{ if(!room)return; const f={}; if(dragId){ dragId=null; f.drag=null; } if(liveSent){ liveSent=null; f.live=null; } if(Object.keys(f).length)sendState(f); sendDoing(); },0);
}
/* what this device has selected or is typing in, sent when it changes */
function sendDoing(){
  const r=room; if(!r||!r.provider)return;
  const sel=S.selection.length||S.imageSelection?{ids:S.selection.slice(0,200),image:S.imageSelection||null}:null;
  let focus=null;
  const ln=N.text&&N.text.focusedLine();
  if(ln){ const el=document.querySelector('.line .txt[data-id="'+ln.id+'"]'); if(el)focus={line:ln.id,start:el.selectionStart||0,end:el.selectionEnd||0}; }
  const tool=S.tool||'';
  const key=JSON.stringify([sel,focus,tool]);
  if(key===seenDoing)return;
  seenDoing=key;
  if(!r.peers.length)return;           /* sent when the first one arrives */
  sendState({selection:sel,focus,tool});
}
function doingSoon(){ if(doingQueued||!room)return; doingQueued=true; setTimeout(()=>{ doingQueued=false; sendDoing(); },40); }
function watch(){
  const sc=document.getElementById('scroller'); if(!sc)return;
  sc.addEventListener('pointermove',onPointer,{passive:true});
  sc.addEventListener('pointerleave',()=>{ if(!sentPos)return; sentPos=null; sendState({cursor:null}); },{passive:true});
  window.addEventListener('pointerup',onPointerEnd,{passive:true});
  window.addEventListener('pointercancel',onPointerEnd,{passive:true});
  document.addEventListener('selectionchange',doingSoon);
  document.addEventListener('input',doingSoon,true);
  document.addEventListener('keyup',doingSoon,true);
  document.addEventListener('focusin',doingSoon);
  document.addEventListener('focusout',doingSoon);
  sc.addEventListener('scroll',()=>{ if(room)paint(); },{passive:true});
  window.addEventListener('resize',()=>{ if(room)paint(); });
  document.addEventListener('visibilitychange',()=>{ if(document.hidden&&(sentPos||liveSent||dragId)){ sentPos=null; liveSent=null; dragId=null; sendState({cursor:null,drag:null,live:null}); } });
  /* "stop sharing" and "leave" mean every tab of this device: the others
     see the note leave the shared list and let go of the room too */
  window.addEventListener('storage',e=>{ if(e.key===SHARED_KEY&&room&&!isShared(room.id))stop(); });
  /* the browser going offline or back changes what the button and the
     sheet should say about a link that is down */
  window.addEventListener('online',()=>{ if(room)paintButton(); });
  window.addEventListener('offline',()=>{ if(room)paintButton(); });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch); else watch();

/* ---- sheets ---- */
function askName(){
  return new Promise(resolve=>{
    const box=N.ui.openSheet(
      '<h2>your nickname</h2>'+
      '<p>shown to the people you write with, and kept on this device.</p>'+
      '<label class="mi" for="collab-name"><span>nickname</span><input class="keyin" id="collab-name" maxlength="24" autocomplete="nickname" spellcheck="false" enterkeyhint="done" value="'+esc(name())+'" style="max-width:220px;margin:0 0 0 auto"></label>'+
      '<div class="sheet-act"><button class="sheet-cta" type="button" id="collab-name-ok">continue</button></div>');
    const input=box.querySelector('#collab-name'),ok=box.querySelector('#collab-name-ok');
    let done=false;
    const finish=v=>{ if(done)return; done=true; clearInterval(watcher); if(v){ setName(v); N.ui.closeSheet(); } resolve(!!v); };
    const submit=()=>{ const v=input.value.trim().replace(/\s+/g,' '); if(!v){ input.focus(); return; } finish(v); };
    ok.onclick=submit;
    input.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){ e.preventDefault(); submit(); } });
    const watcher=setInterval(()=>{ if(!box.isConnected)finish(''); },150);
    input.focus(); input.select();
  });
}
async function copy(text){
  try{ await navigator.clipboard.writeText(text); return true; }catch(e){}
  try{
    const t=document.createElement('textarea'); t.value=text; t.setAttribute('readonly',''); t.style.position='fixed'; t.style.opacity='0';
    document.body.appendChild(t); t.select(); const ok=document.execCommand('copy'); t.remove(); return ok;
  }catch(e){ return false; }
}
function shareSheet(){
  const r=room; if(!r)return;
  const link=linkFor(r.id),host=isHost();
  const box=N.ui.openSheet(
    '<h2>share</h2>'+
    '<p id="share-busy" role="status"'+(busy?'':' hidden')+'>'+BUSY_TEXT+'</p>'+
    '<div id="share-main"'+(busy?' class="share-down" inert':'')+'>'+
    (host?'<p>anyone with this link writes on this note with you, live. keep it to people you trust.</p>'
         :'<p>you are writing on someone else\'s note. it is theirs: if they stop sharing, or you leave, it goes from this device.</p>')+
    '<label class="mi" for="share-link"><span>link</span><input class="keyin" id="share-link" readonly value="'+esc(link)+'" style="margin:0 0 0 auto"></label>'+
    '<button class="mi" id="share-copy"><i class="ph ph-copy"></i>copy link</button>'+
    (navigator.share?'<button class="mi" id="share-send"><i class="ph ph-paper-plane-tilt"></i>send link</button>':'')+
    '<div id="share-people">'+peopleHtml()+'</div>'+
    (host?'<button class="mi" id="share-mine"><i class="ph ph-devices"></i>copy link for your other devices<span class="k">keeps you the host there. not for sending</span></button>'+
          '<button class="mi" id="share-stop"><i class="ph ph-link-break"></i>stop sharing<span class="k">everyone else loses the note</span></button>'
         :'<button class="mi" id="share-leave"><i class="ph ph-sign-out"></i>leave this note<span class="k">it goes from this device</span></button>')+
    '</div>');
  busyStyle();
  box.querySelector('#share-link').onclick=e=>e.target.select();
  box.querySelector('#share-copy').onclick=async()=>{ C.toast((await copy(link))?'link copied.':'could not copy. select the link and copy it.'); };
  const send=box.querySelector('#share-send'); if(send)send.onclick=()=>{ navigator.share({title:S.title||'notas',url:link}).catch(()=>{}); };
  const mine=box.querySelector('#share-mine');
  if(mine)mine.onclick=async()=>{ const l=hostLinkFor(r.id); C.toast(l&&await copy(l)?'copied. open it on your other device, and only there: it carries your host key.':'could not copy that link.',6000); };
  const stopBtn=box.querySelector('#share-stop');
  if(stopBtn)stopBtn.onclick=async()=>{ stopBtn.disabled=true; if(await endForEveryone()){ N.ui.closeSheet(); C.toast('sharing has ended. the note is yours alone again.'); } else stopBtn.disabled=false; };
  const leaveBtn=box.querySelector('#share-leave');
  if(leaveBtn)leaveBtn.onclick=async()=>{
    const choice=await leaveSheet('leave this note','it is someone else\'s note, so leaving takes it off this device. what is on the page now can stay as a copy of your own.',
      'keep a copy, then leave','leave without a copy',null);
    if(!choice||!room||room.id!==r.id)return;      /* closed: still on the note */
    const copyId=await leave(r.id,choice==='keep');
    if(copyId===false)return;
    C.toast(copyId?'you left the note. your copy is "'+S.title+'".':'you left the note.',5000);
  };
}
async function share(){
  if(room){ shareSheet(); return; }
  if(!served()){ C.toast('sharing needs this notebook opened from its website.',6000); return; }
  /* A note already shared here that this device is not the host of is
     someone else's (its room simply did not start): try joining again. It
     used to make this device a host of its own, with a key the room refuses. */
  if(isShared(S.id)&&!hostToken(S.id)){
    C.status('joining the shared note again.');
    try{ await start(S.id,false); }catch(e){ C.toast(String(e.message||'sharing could not start.').toLowerCase()); }
    return;
  }
  if(!name()&&!(await askName()))return;
  C.status('sharing.');
  const id=S.id,fresh=!isShared(id);
  let gen='';
  if(fresh){
    /* the room is claimed before the link exists (see room.js /open), and
       each share is a new generation of it */
    const opened=await openRoom(id);
    if(opened===false)return;
    if(opened==='taken'){
      /* this note's room belongs to a key this device does not have (it was
         shared from another browser, or this one was cleared): a copy of it
         is shared instead, under a new id */
      const copyId=await keepCopy(id);
      if(!copyId){ C.toast('this note was shared from another device. share it from there, or share a copy of it.',7000); return; }
      await N.ui.openNote(copyId);
      if(S.id!==copyId)return;
      C.toast('this note was shared from another device, so a copy of it is shared instead.',6000);
      return share();
    }
    gen=opened;
  }
  try{ await start(id,true,gen); }catch(e){ C.toast(String(e.message||'sharing could not start.').toLowerCase()); return; }
  if(room){ const id=room.id; shareSheet(); const ok=await copy(linkFor(id)); if(ok&&room?.id===id)C.toast('link copied. send it to whoever writes with you.'); }
}
/* the generation of a new share, 'taken' when another key holds the room,
   or false when it could not be reached (said) */
async function openRoom(id){
  if(offline()){ C.toast('sharing starts online. connect, then share again.',6000); return false; }
  const token=hostToken(id,true),gen=secret().slice(0,20);
  try{
    const res=await fetch('./collab/'+id+'/open?gen='+gen,{method:'POST',headers:{'X-Notas-Host':token},signal:AbortSignal.timeout(10000)});
    if(res.status===403)return 'taken';
    if(res.status===429){ setBusy(true); C.toast(BUSY_TEXT,6000); return false; }
    if(!res.ok)throw new Error(String(res.status));
    const j=await res.json().catch(()=>null);
    return j&&typeof j.gen==='string'?j.gen:gen;
  }catch(e){ C.toast('sharing could not start. check the connection and try again.',6000); return false; }
}

/* The room arbitrates requests; a Yjs map alone cannot prevent two writers
   from both starting before their edits have reached one another. */
async function claimNota(line,question){
  const r=room;
  /* a shared note whose room is not up cannot arbitrate: that is
     "offline", not "busy", and the page says which */
  if(!r)return isShared(S.id)?{state:'offline'}:{state:'claimed',finish:async()=>{}};
  /* the room is out of its day's allowance: not a wait that ends soon */
  if(r.status!=='connected'||!r.synced)return {state:busy?'overloaded':'offline'};
  const token=crypto.randomUUID(),url='./collab/'+r.id+'/nota';
  const send=async action=>{
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({line,question,token,action}),signal:AbortSignal.timeout(5000)});
    if(res.status===429)return {state:'overloaded'};
    if(!res.ok)throw new Error('nota could not coordinate this shared question.');
    return res.json();
  };
  const result=await send('claim');
  if(result.state==='overloaded'){ setBusy(true); return {state:'overloaded',finish:async()=>{}}; }
  return {...result,finish:async complete=>{await send(complete?'complete':'release');}};
}

/* ---- the page's hooks ---- */
/* the note on the page changed: leave the old room, join the new one if
   this note is a shared one */
function noteChanged(){
  if(room&&room.id!==S.id)stop();
  if(!room&&isShared(S.id))start(S.id,false).catch(e=>C.toast(String(e.message||'sharing could not start.').toLowerCase()));
}
/* opened by a link: the note the link names becomes the page, and the
   room fills it in */
async function openLink(){
  const id=linkedRoom(); if(!id)return false;
  let known;
  try{ known=(await C.Store.index()).some(row=>row.id===id); }
  catch(e){ C.toast('your notes could not be read just now. open the link again in a moment.',7000); return false; }
  /* the host's own link for another of their devices carries their token */
  const t=linkedHost(),linkGen=new URL(location.href).searchParams.get('gen')||'';
  /* A link naming a note this device already has, but has never shared or
     joined, is not an invitation into it: joining would replace the note
     with whatever that room holds. The note simply opens, as it is. */
  if(known&&!isShared(id)&&!hostToken(id)&&!t){
    history.replaceState(null,'',location.pathname);
    await N.ui.openNote(id);
    C.toast('that link names a note you already have here, which is not shared. it opened as it is.',7000);
    return true;
  }
  if(t&&!hostToken(id)){ try{ localStorage.setItem(HOST_KEY+id,t); }catch(e){} }
  if(known)await N.ui.openNote(id); else await N.ui.newNote(id);
  if(S.id!==id)return false;
  history.replaceState(null,'',location.pathname);
  setShared(id,true);
  try{ await start(id,false,linkGen); }catch(e){ C.toast(String(e.message||'sharing could not start.').toLowerCase()); return true; }
  /* nothing here yet and nothing arriving: say so, rather than leave a
     blank page and a button that only says "connecting" */
  if(!known){ const r=room; setTimeout(()=>{ if(room!==r||r.synced)return;
    C.toast(offline()?'you are offline. the shared note arrives when you are back.':'the shared note is taking a while to arrive. check the link, or try again in a moment.',7000); },15000); }
  /* the room is joined before the name is asked, so the note arrives while
     the sheet waits; until it is answered the others see "someone" */
  if(!name())askName().then(ok=>{ if(ok)announce(); });
  return true;
}

/* this tab is in the note's room, or joining it: its edits are merged with
   everyone's (a tab still joining takes the room's copy when it arrives) */
function isLive(id){ return (!!room&&room.id===id)||starting===id; }
N.collab={claimNota,share,changed,noteChanged,openLink,linkedRoom,isShared,isLive,isHost,name,get room(){ return room; }};
N.collab._test={cleanStroke,cleanLineAttrs,safeImage,pictureSize,textDiff,editText,liveOf};
})();
