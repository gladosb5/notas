/* Languages. The app is written in English; Malay and Chinese are looked up
   from the English it puts on the page, as whole strings, so every label,
   toast, panel and spoken label follows the chosen language without each
   one being written twice. Only the chosen language's catalogue is loaded
   (i18n-ms.js, i18n-zh.js), so English costs nothing.
   What a student wrote is never translated: the typed lines, note names and
   previews, and the page's spoken copy are left exactly as they are. */
(function(){
'use strict';
const N=window.N=window.N||{};
const LANGS={
  en:{name:'English',html:'en'},
  ms:{name:'Bahasa Melayu',html:'ms'},
  zh:{name:'中文',html:'zh-Hans'}
};
const ATTRS=['aria-label','title','placeholder','data-placeholder','alt','aria-valuetext','aria-roledescription'];
/* the student's own words, and what draws its own language */
const KEEP='#lines,#title,.lib-name,.lib-thumb-txt,#page-accessible,#intro,[data-no-i18n],script,style,textarea,code';
/* a few of the app's words can sit inside those places */
const KEEP_ALLOW=new Set(['untitled']);

let lang='en';
try{const p=JSON.parse(localStorage.getItem('notas.prefs')||'{}')||{};if(LANGS[p.language])lang=p.language;}catch(e){}
const catalogues=window.NOTAS_I18N=window.NOTAS_I18N||{};
const compiled={};
const listeners=new Set();

/* ---- the catalogue ---- */
const squash=s=>s.replace(/\s+/g,' ').trim();
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function compile(code){
  if(compiled[code])return compiled[code];
  const cat=catalogues[code];if(!cat)return null;
  const exact=new Map(),patterns=[];
  for(const [en,tr] of Object.entries(cat.strings||{})){
    if(/\{\d\}/.test(en)){
      const order=[];
      const source='^'+en.split(/(\{\d\})/).map(part=>{const m=/^\{(\d)\}$/.exec(part);if(m){order.push(+m[1]);return '(.+?)';}return escape(part.replace(/\s+/g,' '));}).join('')+'$';
      try{patterns.push({re:new RegExp(source,'s'),order,tr});}catch(e){}
    }else exact.set(squash(en),tr);
  }
  /* longer patterns first, so the most specific sentence wins */
  patterns.sort((a,b)=>b.re.source.length-a.re.source.length);
  return compiled[code]={exact,patterns,extra:cat.extra||{}};
}
function lookup(text,code=lang,depth=0){
  if(code==='en'||!text)return null;
  const c=compile(code);if(!c)return null;
  const key=squash(text);if(!key)return null;
  const hit=c.exact.get(key);if(hit!=null)return hit;
  if(depth>1)return null;
  for(const p of c.patterns){
    const m=p.re.exec(key);if(!m)continue;
    return p.tr.replace(/\{(\d)\}/g,(_,i)=>{const v=m[p.order.indexOf(+i)+1];if(v==null)return '';return lookup(v,code,depth+1)??v;});
  }
  return null;
}
/* the text in the current language; English when there is none */
function t(text){
  const out=lookup(text);
  if(out==null)return text;
  /* keep the spacing around it as it was */
  const lead=/^\s*/.exec(text)[0],trail=/\s*$/.exec(text)[0];
  return lead+out+trail;
}

/* ---- the page ---- */
const nodes=new WeakMap();   /* text node -> {en, shown} */
const attrs=new WeakMap();   /* element -> {attr: {en, shown}} */
function kept(el){return !!(el&&el.closest&&el.closest(KEEP));}
function doText(node){
  const parent=node.parentElement;if(!parent)return;
  const data=node.data;
  const was=nodes.get(node);
  if(was&&data===was.shown)return;          /* our own write */
  const en=data;
  if(kept(parent)&&!KEEP_ALLOW.has(squash(en)))return;
  const shown=t(en);
  if(shown===en){if(was)nodes.delete(node);return;}
  nodes.set(node,{en,shown});node.data=shown;
}
function doAttr(el,name){
  const value=el.getAttribute(name);if(value==null)return;
  let map=attrs.get(el);const was=map&&map[name];
  if(was&&value===was.shown)return;
  /* an empty line's placeholder is the app's, even among the typed lines */
  if(name!=='data-placeholder'&&kept(el)&&!KEEP_ALLOW.has(squash(value)))return;
  const shown=t(value);
  if(shown===value){if(was)delete map[name];return;}
  if(!map)attrs.set(el,map={});
  map[name]={en:value,shown};el.setAttribute(name,shown);
}
function walk(root){
  if(!root)return;
  if(root.nodeType===3){doText(root);return;}
  if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11)return;
  if(root.nodeType===1){for(const a of ATTRS)if(root.hasAttribute(a))doAttr(root,a);}
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
  for(let n=w.nextNode();n;n=w.nextNode()){
    if(n.nodeType===3)doText(n);
    else for(const a of ATTRS)if(n.hasAttribute(a))doAttr(n,a);
  }
}
/* back to what the app wrote, before showing another language */
function restore(root=document.documentElement){
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
  for(let n=w.currentNode;n;n=w.nextNode()){
    if(n.nodeType===3){const was=nodes.get(n);if(was){if(n.data===was.shown)n.data=was.en;nodes.delete(n);}}
    else if(n.nodeType===1){const map=attrs.get(n);if(map){for(const [a,v] of Object.entries(map))if(n.getAttribute(a)===v.shown)n.setAttribute(a,v.en);attrs.delete(n);}}
  }
}
const observer=new MutationObserver(records=>{
  for(const r of records){
    if(r.type==='childList')for(const n of r.addedNodes)walk(n);
    else if(r.type==='characterData')doText(r.target);
    else if(r.type==='attributes')doAttr(r.target,r.attributeName);
  }
});
let watching=false;
function watch(on){
  if(on===watching)return;watching=on;
  if(on)observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
  else observer.disconnect();
}
function apply(){
  document.documentElement.lang=LANGS[lang].html;
  restore();
  if(lang==='en'){watch(false);return;}
  watch(true);walk(document.documentElement);
}

/* ---- loading a language ---- */
const loading={};
function load(code){
  if(code==='en'||catalogues[code])return Promise.resolve(true);
  return loading[code]||(loading[code]=new Promise(resolve=>{
    const s=document.createElement('script');s.src='./i18n-'+code+'.js';
    s.onload=()=>resolve(!!catalogues[code]);s.onerror=()=>{delete loading[code];resolve(false);};
    document.head.appendChild(s);
  }));
}
async function set(code){
  if(!LANGS[code])return false;
  if(!await load(code))return false;
  lang=code;
  try{
    const p=JSON.parse(localStorage.getItem('notas.prefs')||'{}')||{};p.language=code;
    localStorage.setItem('notas.prefs',JSON.stringify(p));
  }catch(e){}
  if(N.core&&N.core.S)N.core.S.settings.language=code;
  apply();
  for(const fn of listeners)try{fn(code);}catch(e){console.error(e);}
  return true;
}

/* the chosen language's catalogue arrives before the page does, so even
   the launch screen is in it */
if(lang!=='en'&&!catalogues[lang]){
  try{document.write('<script src="./i18n-'+lang+'.js"><\/script>');}catch(e){load(lang).then(apply);}
}
document.documentElement.lang=LANGS[lang].html;
if(lang!=='en')watch(true);
document.addEventListener('DOMContentLoaded',()=>{if(lang!=='en'){if(catalogues[lang])apply();else load(lang).then(ok=>{if(ok)apply();});}});

N.i18n={
  t,set,load,
  get lang(){return lang;},
  languages:LANGS,
  /* what the app wrote here, whatever language it is shown in */
  source(el){if(!el)return '';const n=el.firstChild;const was=n&&nodes.get(n);return was?was.en:el.textContent;},
  /* nota is told to answer in the chosen language */
  replyRule(){if(lang==='en')return '';const c=compile(lang);return (c&&c.extra.reply)||'';},
  extra(key){const c=compile(lang);return c&&c.extra[key];},
  onChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
  get ready(){return lang==='en'||!!catalogues[lang];}
};
})();
