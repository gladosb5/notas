/* =========================================================================
   NOTA - "hey nota," written or typed on the page is a question to the page.
   The reading (PP-OCRv6 for ink, the line itself for typed text) is the
   question; the notebook around it is the context; the reply comes back
   streamed from a language model and is written onto the paper in the
   tutor's red: real strokes for ink, red lines of the note for typed text.
   Nothing here is special once it is on the page. The strokes are strokes:
   saved, erased, selected, undone like any other ink. The lines are lines.
   The calculator never reads either, so the machine never grades its own
   writing.
   ========================================================================= */
(function(){
'use strict';
const N=window.N;
if(!N||!N.core)return;
const C=N.core,S=C.S,M=C.M;

/* The forward at ./nota/chat is tried first on every host: the dev server
   and the cloudflare worker both carry the key as CEREBRAS_API_KEY, so a
   page served from either needs no key of its own. Cerebras also answers
   browsers directly (CORS is open), so a plain static host, where the
   forward is absent, falls back to calling it with the key below or the
   one in localStorage. */
const CONFIG={
  url:'https://api.cerebras.ai/v1/chat/completions',
  model:'qwen-3.8-27b',
  key:'csk-PASTE-YOUR-KEY-HERE',
  proxy:'./nota/chat',
  /* the model's thinking counts against this, so it is well over the
     few dozen words of an answer */
  maxTokens:1600,
  timeoutMs:45000,
  /* the model thinks before it writes; low keeps the pause short, and the
     thinking never reaches the page, only the answer does */
  extras:{reasoning_effort:'low'}
};
function apiKey(){
  try{ const k=localStorage.getItem('notas.nota.key'); if(k)return k; }catch(e){}
  return CONFIG.key;
}
function hasKey(){ const k=apiKey(); return k.length>12&&!/PASTE/.test(k); }

/* A rate limit pauses requests briefly. The provider's error wording must
   not disable a notebook for the rest of the day. */
const LOAD_KEY='notas.nota.highload',LOAD_RETRY_MS=60*1000;
const LOAD_TEXT='nota is busy. try again in a minute.';
function loadState(){ try{ const s=JSON.parse(localStorage.getItem(LOAD_KEY)||'null')||{until:0,tried:0};s.until=Math.min(s.until||0,(s.tried||0)+LOAD_RETRY_MS);return s; }catch(e){ return {until:0,tried:0}; } }
function overloaded(){ return Date.now()<loadState().until; }
/* whether this question should not be sent at all; the cooldown retry
   counts as the one let through */
function holdBack(){
  const s=loadState(),now=Date.now();
  if(now>=s.until)return false;
  if(now-s.tried>=LOAD_RETRY_MS){ s.tried=now; try{ localStorage.setItem(LOAD_KEY,JSON.stringify(s)); }catch(e){} return false; }
  return true;
}
function setOverloaded(on){
  if(on===overloaded()&&!on)return;
  try{ if(on)localStorage.setItem(LOAD_KEY,JSON.stringify({until:Date.now()+LOAD_RETRY_MS,tried:Date.now()})); else localStorage.removeItem(LOAD_KEY); }catch(e){}
  paintOverloaded();
}
/* a written "hey nota," is not blue while nota cannot answer */
function paintOverloaded(){
  const on=overloaded();
  if(!!document.body.dataset.notaBusy===on)return;
  if(on)document.body.dataset.notaBusy='1'; else delete document.body.dataset.notaBusy;
  if(N.ink&&N.ink.render)N.ink.render();
}
/* An answer refused because an allowance is spent, told apart from a
   refusal that clears in a minute (the worker's own per-address limit, or
   the model's per-minute one): Cloudflare's page for a worker over its day
   is error 1027; the worker marks a spent allowance of its own as quota;
   Cerebras names the day in its message. */
function spentAllowance(status,text){
  if(status===500&&/error(?:\s+code)?\s*:?\s*1027\b/i.test(text))return true;
  if(status!==429)return false;
  let j=null; try{ j=JSON.parse(text); }catch(e){}
  if(!j)return false;
  if(j.quota===true)return true;
  const said=JSON.stringify(j.error||j);
  return /per[ _]day|\bdaily\b|\bday\b/i.test(said);
}

/* the message, beside the question: on the page's column, so it scrolls and
   zooms with the paper, but not a stroke or a line, so it is never saved,
   shared or undone. It goes when the page is written on, typed in, or
   swapped for another note. */
const loadNote=document.createElement('div');
loadNote.className='nota-busy'; loadNote.setAttribute('role','status'); loadNote.setAttribute('aria-live','polite');
loadNote.hidden=true;
let loadNoteFor=null,loadNoteWatch=0;
(function(){
  const s=document.createElement('style');
  s.textContent='.nota-busy{position:absolute;z-index:4;pointer-events:none;box-sizing:border-box;padding:3px 10px;border-radius:10px;'+
    'background:var(--paper);color:var(--ink-2);font:italic 400 14px/1.4 var(--ui);box-shadow:0 0 0 1px var(--rule,rgba(0,0,0,.08));'+
    'animation:notaBusyIn .2s ease}'+
    '@keyframes notaBusyIn{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}'+
    '@media (prefers-reduced-motion:reduce){.nota-busy{animation:none}}'+
    'body[data-nota-busy] .line.call .ghost-layer .call{color:var(--ink-3)}';
  document.head.appendChild(s);
})();
function showOverloaded(at){
  const col=document.getElementById('col'); if(!col||!at)return;
  hideOverloaded();
  const x=Math.max(2,at.x||0);
  loadNote.style.left=x+'px'; loadNote.style.top=(at.y+4)+'px';
  loadNote.style.maxWidth=Math.max(160,M.contentW-x-8)+'px';
  loadNote.textContent=LOAD_TEXT;
  if(loadNote.parentNode!==col)col.appendChild(loadNote);
  loadNote.hidden=false;
  loadNoteFor={note:S.id,line:at.lineId||null,text:at.lineId?(S.lines.find(l=>l.id===at.lineId)||{}).text:null};
  /* the note changing has no event here; checked while the message shows */
  loadNoteWatch=setInterval(()=>{
    if(!loadNoteFor)return;
    if(S.id!==loadNoteFor.note)return hideOverloaded();
    if(loadNoteFor.line){ const ln=S.lines.find(l=>l.id===loadNoteFor.line); if(!ln||ln.text!==loadNoteFor.text)hideOverloaded(); }
  },400);
}
function hideOverloaded(){
  clearInterval(loadNoteWatch); loadNoteWatch=0;
  loadNoteFor=null; loadNote.hidden=true;
}
/* writing or erasing on the page puts the message away; the tap that
   shows it (the lasso's button) does not */
document.addEventListener('pointerdown',e=>{
  if(!loadNoteFor||loadNoteFor.line)return;
  if(e.target&&e.target.closest&&e.target.closest('#selbar'))return;
  if(e.target&&e.target.closest&&e.target.closest('#scroller'))hideOverloaded();
},true);
paintOverloaded();

const SYSTEM=[
  'You are nota, the red pen inside a handwritten notebook. The notebook is used for anything: maths and science homework, recipes, shopping and to-do lists, notes from a lesson or a meeting, a diary, plans, drafts of writing, languages.',
  'Your owner is a student inside a school: the person writing in this notebook. If you are asked who owns you, who you belong to or who you work for, say your owner is a student inside a school. Never claim to know their name, school or anything else about them.',
  'The person wrote or typed "hey nota," followed by a question on the page, or circled some handwriting and asked about it. The page contents are given as rows in reading order; "this" or "that" or "it" means the nearest thing above or beside the question: a sum, a list, a paragraph, a recipe, whatever is there. Rows between [box] and [end of box] were written inside a box drawn on the page, usually a heading and its notes; boxes side by side are separate topics.',
  'The rows are machine readings of handwriting and can contain misread words or stray symbols. Read them for their meaning and ignore fragments that make no sense, rather than explaining them.',
  'Drawings on the page are described in words between [diagram] and [end of diagram], or [graph] and [end of graph]: the shapes, the lines and arrows joining them, and the handwriting labelling each part, with places as (across, down) from 0 to 100 over the drawing. An arrow "from A to B" points at B. A graph gives its curves as points in the units written on its axes. Read the description as the drawing the person made (a flowchart, a food chain, a Venn diagram, a triangle, a circuit, a graph) and answer about the drawing itself; never mention the description, the coordinates or the brackets.',
  'A question may come with a picture of the page around it: the person\'s handwriting and drawings in dark ink, and any photo or picture they put on the page. The machine readings come from that same ink. Use the picture to read what the readings missed or got wrong and to see drawings and photos, and trust it over a reading that disagrees with it. Never mention that you were sent a picture.',
  'Answer whatever is asked: work out or check maths, explain an idea, suggest what to cook with what is listed and how, convert units or currencies, fix spelling or grammar, translate, summarise the notes, plan the steps, define a word, give a fact. Be accurate; if you are not sure, say so briefly.',
  'Answer in plain text only: no markdown, no bullets, no LaTeX, no code fences, no emoji, no headings. Write maths in plain notation such as 2x + 3 = 11, sqrt(16), 3/4, 2^3, 12 x 7. Use only plain letters, digits and punctuation, since the answer is handwritten onto the page.',
  'Be brief: one to three short sentences, at most about 45 words, unless the person asks for the full working, the steps, a list or a recipe, then give short numbered lines, one per line.',
  'Write so a grade 7 student (about 12 years old) understands, above all when explaining: short sentences, everyday words, one idea at a time, and a simple example when it helps. When you must use a subject word, such as denominator or photosynthesis, say what it means in a few plain words. Stay correct; make it simple, not wrong.',
  'Do not repeat the question. Do not greet. Do not say "hey nota". Give the answer first, then a short reason if it helps.',
  'If the question is not about anything on the page, answer it anyway, briefly. If the page does not contain what "this" refers to, say what you would need.',
  'Notes read with the tools are the person\'s own notes: use them when the question is about their notes. To test or quiz them, write three to five short numbered questions drawn from those notes, without the answers, unless they ask for the answers.'
].join('\n');

/* ---- a single stroke hand: the upright Hershey Sans 1-stroke face, one polyline per stroke ---- */
// Hershey Sans 1-stroke, from techninja/hersheytextjs (Hershey glyph data).
const GLYPH_DATA=`32:0,16|
33:0,10|5,-12,5,2;5,7,4,8,5,9,6,8,5,7
34:0,16|4,-12,4,-5;12,-12,12,-5
35:0,22|11,-16,4,16;17,-16,10,16;4,-3,18,-3;3,3,17,3
36:0,20|8,-16,8,13;12,-16,12,13;17,-9,15,-11,12,-12,8,-12,5,-11,3,-9,3,-7,4,-5,5,-4,7,-3,13,-1,15,0,16,1,17,3,17,6,15,8,12,9,8,9,5,8,3,6
37:0,24|21,-12,3,9;8,-12,10,-10,10,-8,9,-6,7,-5,5,-5,3,-7,3,-9,4,-11,6,-12,8,-12,10,-11,13,-10,16,-10,19,-11,21,-12;17,2,15,3,14,5,14,7,16,9,18,9,20,8,21,6,21,4,19,2,17,2
38:0,26|23,-3,23,-4,22,-5,21,-5,20,-4,19,-2,17,3,15,6,13,8,11,9,7,9,5,8,4,7,3,5,3,3,4,1,5,0,12,-4,13,-5,14,-7,14,-9,13,-11,11,-12,9,-11,8,-9,8,-7,9,-4,11,-1,16,6,18,8,20,9,22,9,23,8,23,7
39:0,10|5,-10,4,-11,5,-12,6,-11,6,-9,5,-7,4,-6
40:0,14|11,-16,9,-14,7,-11,5,-7,4,-2,4,2,5,7,7,11,9,14,11,16
41:0,14|3,-16,5,-14,7,-11,9,-7,10,-2,10,2,9,7,7,11,5,14,3,16
42:0,16|8,-6,8,6;3,-3,13,3;13,-3,3,3
43:0,26|13,-9,13,9;4,0,22,0
44:0,8|5,5,4,6,3,5,4,4,5,5,5,7,3,9
45:0,26|4,0,22,0
46:0,8|4,4,3,5,4,6,5,5,4,4
47:0,22|20,-16,2,16
48:0,20|9,-12,6,-11,4,-8,3,-3,3,0,4,5,6,8,9,9,11,9,14,8,16,5,17,0,17,-3,16,-8,14,-11,11,-12,9,-12
49:0,20|6,-8,8,-9,11,-12,11,9
50:0,20|4,-7,4,-8,5,-10,6,-11,8,-12,12,-12,14,-11,15,-10,16,-8,16,-6,15,-4,13,-1,3,9,17,9
51:0,20|5,-12,16,-12,10,-4,13,-4,15,-3,16,-2,17,1,17,3,16,6,14,8,11,9,8,9,5,8,4,7,3,5
52:0,20|13,-12,3,2,18,2;13,-12,13,9
53:0,20|15,-12,5,-12,4,-3,5,-4,8,-5,11,-5,14,-4,16,-2,17,1,17,3,16,6,14,8,11,9,8,9,5,8,4,7,3,5
54:0,20|16,-9,15,-11,12,-12,10,-12,7,-11,5,-8,4,-3,4,2,5,6,7,8,10,9,11,9,14,8,16,6,17,3,17,2,16,-1,14,-3,11,-4,10,-4,7,-3,5,-1,4,2
55:0,20|17,-12,7,9;3,-12,17,-12
56:0,20|8,-12,5,-11,4,-9,4,-7,5,-5,7,-4,11,-3,14,-2,16,0,17,2,17,5,16,7,15,8,12,9,8,9,5,8,4,7,3,5,3,2,4,0,6,-2,9,-3,13,-4,15,-5,16,-7,16,-9,15,-11,12,-12,8,-12
57:0,20|16,-5,15,-2,13,0,10,1,9,1,6,0,4,-2,3,-5,3,-6,4,-9,6,-11,9,-12,10,-12,13,-11,15,-9,16,-5,16,0,15,5,13,8,10,9,8,9,5,8,4,6
58:0,8|4,-3,3,-2,4,-1,5,-2,4,-3;4,4,3,5,4,6,5,5,4,4
59:0,8|4,-3,3,-2,4,-1,5,-2,4,-3;5,5,4,6,3,5,4,4,5,5,5,7,3,9
60:0,24|20,-9,4,0,20,9
61:0,26|4,-3,22,-3;4,3,22,3
62:0,24|4,-9,20,0,4,9
63:0,18|3,-7,3,-8,4,-10,5,-11,7,-12,11,-12,13,-11,14,-10,15,-8,15,-6,14,-4,13,-3,9,-1,9,2;9,7,8,8,9,9,10,8,9,7
64:0,28|18,-4,17,-6,15,-7,12,-7,10,-6,9,-5,8,-2,8,1,9,3,11,4,14,4,16,3,17,1;12,-7,10,-5,9,-2,9,1,10,3,11,4;18,-7,17,1,17,3,19,4,21,4,23,2,24,-1,24,-3,23,-6,22,-8,20,-10,18,-11,15,-12,12,-12,9,-11,7,-10,5,-8,4,-6,3,-3,3,0,4,3,5,5,7,7,9,8,12,9,15,9,18,8,20,7,21,6;19,-7,18,1,18,3,19,4
65:0,18|9,-12,1,9;9,-12,17,9;4,2,14,2
66:0,20|4,-12,4,9;4,-12,13,-12,16,-11,17,-10,18,-8,18,-6,17,-4,16,-3,13,-2;4,-2,13,-2,16,-1,17,0,18,2,18,5,17,7,16,8,13,9,4,9
67:0,22|18,-7,17,-9,15,-11,13,-12,9,-12,7,-11,5,-9,4,-7,3,-4,3,1,4,4,5,6,7,8,9,9,13,9,15,8,17,6,18,4
68:0,20|4,-12,4,9;4,-12,11,-12,14,-11,16,-9,17,-7,18,-4,18,1,17,4,16,6,14,8,11,9,4,9
69:0,18|4,-12,4,9;4,-12,17,-12;4,-2,12,-2;4,9,17,9
70:0,16|4,-12,4,9;4,-12,17,-12;4,-2,12,-2
71:0,22|18,-7,17,-9,15,-11,13,-12,9,-12,7,-11,5,-9,4,-7,3,-4,3,1,4,4,5,6,7,8,9,9,13,9,15,8,17,6,18,4,18,1;13,1,18,1
72:0,22|4,-12,4,9;18,-12,18,9;4,-2,18,-2
73:0,8|4,-12,4,9
74:0,16|12,-12,12,4,11,7,10,8,8,9,6,9,4,8,3,7,2,4,2,2
75:0,20|4,-12,4,9;18,-12,4,2;9,-3,18,9
76:0,14|4,-12,4,9;4,9,16,9
77:0,24|4,-12,4,9;4,-12,12,9;20,-12,12,9;20,-12,20,9
78:0,22|4,-12,4,9;4,-12,18,9;18,-12,18,9
79:0,22|9,-12,7,-11,5,-9,4,-7,3,-4,3,1,4,4,5,6,7,8,9,9,13,9,15,8,17,6,18,4,19,1,19,-4,18,-7,17,-9,15,-11,13,-12,9,-12
80:0,20|4,-12,4,9;4,-12,13,-12,16,-11,17,-10,18,-8,18,-5,17,-3,16,-2,13,-1,4,-1
81:0,22|9,-12,7,-11,5,-9,4,-7,3,-4,3,1,4,4,5,6,7,8,9,9,13,9,15,8,17,6,18,4,19,1,19,-4,18,-7,17,-9,15,-11,13,-12,9,-12;12,5,18,11
82:0,20|4,-12,4,9;4,-12,13,-12,16,-11,17,-10,18,-8,18,-6,17,-4,16,-3,13,-2,4,-2;11,-2,18,9
83:0,20|17,-9,15,-11,12,-12,8,-12,5,-11,3,-9,3,-7,4,-5,5,-4,7,-3,13,-1,15,0,16,1,17,3,17,6,15,8,12,9,8,9,5,8,3,6
84:0,16|8,-12,8,9;1,-12,15,-12
85:0,22|4,-12,4,3,5,6,7,8,10,9,12,9,15,8,17,6,18,3,18,-12
86:0,18|1,-12,9,9;17,-12,9,9
87:0,24|2,-12,7,9;12,-12,7,9;12,-12,17,9;22,-12,17,9
88:0,20|3,-12,17,9;17,-12,3,9
89:0,18|1,-12,9,-2,9,9;17,-12,9,-2
90:0,20|17,-12,3,9;3,-12,17,-12;3,9,17,9
91:0,14|4,-16,4,16;5,-16,5,16;4,-16,11,-16;4,16,11,16
92:0,14|0,-12,14,12
93:0,14|9,-16,9,16;10,-16,10,16;3,-16,10,-16;3,16,10,16
94:0,16|8,-14,0,0;8,-14,16,0
95:0,18|0,16,18,16
96:0,8|5,-7,3,-5,3,-3,4,-2,5,-3,4,-4,3,-3
97:0,20|15,-5,15,9;15,-2,13,-4,11,-5,8,-5,6,-4,4,-2,3,1,3,3,4,6,6,8,8,9,11,9,13,8,15,6
98:0,18|4,-12,4,9;4,-2,6,-4,8,-5,11,-5,13,-4,15,-2,16,1,16,3,15,6,13,8,11,9,8,9,6,8,4,6
99:0,18|15,-2,13,-4,11,-5,8,-5,6,-4,4,-2,3,1,3,3,4,6,6,8,8,9,11,9,13,8,15,6
100:0,20|15,-12,15,9;15,-2,13,-4,11,-5,8,-5,6,-4,4,-2,3,1,3,3,4,6,6,8,8,9,11,9,13,8,15,6
101:0,18|3,1,15,1,15,-1,14,-3,13,-4,11,-5,8,-5,6,-4,4,-2,3,1,3,3,4,6,6,8,8,9,11,9,13,8,15,6
102:0,14|10,-12,8,-12,6,-11,5,-8,5,9;2,-5,9,-5
103:0,20|15,-5,15,11,14,14,13,15,11,16,8,16,6,15;15,-2,13,-4,11,-5,8,-5,6,-4,4,-2,3,1,3,3,4,6,6,8,8,9,11,9,13,8,15,6
104:0,20|4,-12,4,9;4,-1,7,-4,9,-5,12,-5,14,-4,15,-1,15,9
105:0,8|3,-12,4,-11,5,-12,4,-13,3,-12;4,-5,4,9
106:0,10|5,-12,6,-11,7,-12,6,-13,5,-12;6,-5,6,12,5,15,3,16,1,16
107:0,16|4,-12,4,9;14,-5,4,5;8,1,15,9
108:0,8|4,-12,4,9
109:0,30|4,-5,4,9;4,-1,7,-4,9,-5,12,-5,14,-4,15,-1,15,9;15,-1,18,-4,20,-5,23,-5,25,-4,26,-1,26,9
110:0,20|4,-5,4,9;4,-1,7,-4,9,-5,12,-5,14,-4,15,-1,15,9
111:0,20|8,-5,6,-4,4,-2,3,1,3,3,4,6,6,8,8,9,11,9,13,8,15,6,16,3,16,1,15,-2,13,-4,11,-5,8,-5
112:0,18|4,-5,4,16;4,-2,6,-4,8,-5,11,-5,13,-4,15,-2,16,1,16,3,15,6,13,8,11,9,8,9,6,8,4,6
113:0,20|15,-5,15,16;15,-2,13,-4,11,-5,8,-5,6,-4,4,-2,3,1,3,3,4,6,6,8,8,9,11,9,13,8,15,6
114:0,12|4,-5,4,9;4,1,5,-2,7,-4,9,-5,12,-5
115:0,18|14,-2,13,-4,10,-5,7,-5,4,-4,3,-2,4,0,6,1,11,2,13,3,14,5,14,6,13,8,10,9,7,9,4,8,3,6
116:0,14|5,-12,5,5,6,8,8,9,10,9;2,-5,9,-5
117:0,20|4,-5,4,5,5,8,7,9,10,9,12,8,15,5;15,-5,15,9
118:0,16|2,-5,8,9;14,-5,8,9
119:0,22|3,-5,7,9;11,-5,7,9;11,-5,15,9;19,-5,15,9
120:0,18|3,-5,14,9;14,-5,3,9
121:0,16|2,-5,8,9;14,-5,8,9,6,13,4,15,2,16,1,16
122:0,18|14,-5,3,9;3,-5,14,-5;3,9,14,9
123:0,14|9,-16,7,-15,6,-14,5,-12,5,-10,6,-8,7,-7,8,-5,8,-3,6,-1;7,-15,6,-13,6,-11,7,-9,8,-8,9,-6,9,-4,8,-2,4,0,8,2,9,4,9,6,8,8,7,9,6,11,6,13,7,15;6,1,8,3,8,5,7,7,6,8,5,10,5,12,6,14,7,15,9,16
124:0,8|4,-16,4,16
125:0,14|5,-16,7,-15,8,-14,9,-12,9,-10,8,-8,7,-7,6,-5,6,-3,8,-1;7,-15,8,-13,8,-11,7,-9,6,-8,5,-6,5,-4,6,-2,10,0,6,2,5,4,5,6,6,8,7,9,8,11,8,13,7,15;8,1,6,3,6,5,7,7,8,8,9,10,9,12,8,14,7,15,5,16
126:0,24|3,3,3,1,4,-2,6,-3,8,-3,10,-2,14,1,16,2,18,2,20,1,21,-1;3,1,4,-1,6,-2,8,-2,10,-1,14,2,16,3,18,3,20,2,21,-1,21,-3`;
/* Units: cap line at -12, baseline at 9, descenders to 21. A row is 33 units
   tall; rows sit 40 units apart. */
const CAP=-12,BASE=9,ROW=40,SPACE_W=16;
const GLYPHS=new Map();
for(const line of GLYPH_DATA.split('\n')){
  const at=line.indexOf(':'),bar=line.indexOf('|');
  if(at<0||bar<0)continue;
  const code=+line.slice(0,at),[l,w]=line.slice(at+1,bar).split(',').map(Number);
  const strokes=line.slice(bar+1).split(';').filter(Boolean).map(s=>s.split(',').map(Number));
  GLYPHS.set(String.fromCharCode(code),{l,w,strokes});
}
/* what the face cannot draw is written the way a student would write it:
   a Greek letter by its name, a symbol by its keyboard spelling. A letter
   that is a word (theta, pi) gets a space on the side that touches a
   letter, so "sinθ" reads sin theta rather than sintheta. */
const GREEK={'α':'alpha','β':'beta','γ':'gamma','δ':'delta','ε':'epsilon','ζ':'zeta','η':'eta','θ':'theta','ϑ':'theta','ι':'iota','κ':'kappa','λ':'lambda','μ':'mu','µ':'mu','ν':'nu','ξ':'xi','π':'pi','ρ':'rho','σ':'sigma','ς':'sigma','τ':'tau','υ':'upsilon','φ':'phi','ϕ':'phi','χ':'chi','ψ':'psi','ω':'omega',
  'Γ':'Gamma','Δ':'Delta','∆':'Delta','Θ':'Theta','Λ':'Lambda','Ξ':'Xi','Π':'Pi','Σ':'Sigma','∑':'sum','Φ':'Phi','Ψ':'Psi','Ω':'Omega','∞':'infinity','∫':'integral','∏':'product'};
const FALLBACK={'×':' x ','−':'-','–':'-','—':'-','÷':'/','√':'sqrt','’':"'",'‘':"'",'“':'"','”':'"','…':'...','≈':'~','≤':'<=','≥':'>=','≠':'!=','≡':'==','≅':'~=','±':'+/-','∓':'-/+','·':'*','⋅':'*','∙':'*','•':'*','°':' deg','′':"'",'″':'"','→':'->','⇒':'=>','⇔':'<=>','↔':'<->','←':'<-','∈':' in ','∉':' not in ','∠':'angle ','⊥':' perpendicular to ','∥':' parallel to ','∴':'therefore ','∵':'because ','⁄':'/','∝':' proportional to ','¬':'not ','ℝ':'R','ℕ':'N','ℤ':'Z','ℚ':'Q','∅':'empty set','\t':' ',' ':' '};
for(const [d,i] of [['⁰',0],['¹',1],['²',2],['³',3],['⁴',4],['⁵',5],['⁶',6],['⁷',7],['⁸',8],['⁹',9]])FALLBACK[d]='^'+i;
for(const [d,i] of [['₀',0],['₁',1],['₂',2],['₃',3],['₄',4],['₅',5],['₆',6],['₇',7],['₈',8],['₉',9]])FALLBACK[d]='_'+i;
FALLBACK['ⁿ']='^n';FALLBACK['½']='1/2';FALLBACK['⅓']='1/3';FALLBACK['⅔']='2/3';FALLBACK['¼']='1/4';FALLBACK['¾']='3/4';FALLBACK['⅕']='1/5';FALLBACK['⅛']='1/8';
function spell(text){
  let out='';
  const chars=[...String(text)];
  for(let i=0;i<chars.length;i++){
    const ch=chars[i];
    if(GLYPHS.has(ch)||ch==='\n'){out+=ch;continue;}
    if(GREEK[ch]){
      const before=chars[i-1],after=chars[i+1];
      out+=(before&&/[A-Za-z0-9)]/.test(before)?' ':'')+GREEK[ch]+(after&&/[A-Za-z0-9(]/.test(after)?' ':'');
      continue;
    }
    if(FALLBACK[ch]!==undefined){out+=FALLBACK[ch];continue;}
    const plain=ch.normalize('NFKD').replace(/\p{M}+/gu,'');
    out+=[...plain].every(c=>GLYPHS.has(c))?plain:ch;
  }
  return out.replace(/ {2,}/g,' ');
}
// Rare Unicode characters stay ink. Rasterize the system font into short
// pen runs instead of replacing the entire answer with an editable text line.
const EXTRA_GLYPHS=new Map();
function penGlyph(ch){
  if(GLYPHS.has(ch))return GLYPHS.get(ch);
  if(EXTRA_GLYPHS.has(ch))return EXTRA_GLYPHS.get(ch);
  const canvas=document.createElement('canvas');canvas.width=80;canvas.height=64;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.font='28px "Segoe UI", sans-serif';ctx.fillStyle='#000';
  const width=Math.min(76,Math.max(1,Math.ceil(ctx.measureText(ch).width)));
  ctx.fillText(ch,2,36);
  const pixels=ctx.getImageData(0,0,80,64).data,strokes=[];
  for(let y=0;y<64;y++)for(let x=0;x<80;){
    if(pixels[(y*80+x)*4+3]<96){x++;continue;}
    const start=x;while(x<80&&pixels[(y*80+x)*4+3]>=96)x++;
    strokes.push([(start-2)*.75,(y-36)*.75+BASE,(x-2)*.75,(y-36)*.75+BASE]);
  }
  const glyph={l:0,w:(width+3)*.75,strokes,raster:true};
  EXTRA_GLYPHS.set(ch,glyph);return glyph;
}
function wordWidth(word,unit){
  let w=0;
  for(const ch of word){ const g=penGlyph(ch); w+=(g?g.w:SPACE_W)*unit; }
  return w;
}
/* a small, repeatable wobble so the hand is not a plotter */
function wobble(seed){
  let s=seed|0||1;
  return ()=>{ s=(s*1103515245+12345)&0x7fffffff; return s/0x7fffffff-0.5; };
}

/* ---- the writer: text in, strokes on the page out, at the pace of a hand ---- */
const HAND=0.62;               /* px per ms, the tutor's pace */
const HAND_FAST=1.6;           /* when the model is far ahead of the pen */
let queue=[],animating=false,debt=0;
function animate(){
  if(animating)return;
  animating=true;
  let last=performance.now();
  const step=(now)=>{
    const dt=Math.min(64,now-last);last=now;
    let backlog=0;for(const q of queue)backlog+=q.left;
    let budget=dt*(backlog>1400?HAND_FAST:HAND)-debt;debt=0;
    while(queue.length&&budget>0){
      const q=queue[0],st=q.st,p=st.pts;
      while(q.at<p.length/3&&budget>0){
        const i=q.at;
        const seg=i?Math.hypot(p[i*3]-p[i*3-3],p[i*3+1]-p[i*3-2]):0;
        if(seg>budget){debt=seg-budget;budget=0;q.left-=seg;q.at++;st._show=q.at;break;}
        budget-=seg;q.left-=seg;q.at++;st._show=q.at;
      }
      if(q.at>=p.length/3){delete st._show;queue.shift();}
    }
    N.ink.render();
    if(queue.length)requestAnimationFrame(step);else animating=false;
  };
  requestAnimationFrame(step);
}
function lengthOf(pts){let L=0;for(let i=3;i<pts.length;i+=3)L+=Math.hypot(pts[i]-pts[i-3],pts[i+1]-pts[i-2]);return L;}

/* everything the answer must not be written over: ink (the student's and
   nota's earlier answers), typed lines, pictures, and the answer chips
   beside the working. The question's own ink, and its own chip, are left
   out: the answer starts under it. */
function obstacles(skip){
  const out=[];
  for(const st of S.strokes)if((st.author==='user'||st.author==='ai')&&st.bbox&&!skip.has(st.id))out.push(st.bbox);
  for(const ln of S.lines)if(ln.text&&ln.text.trim())out.push([ln.x||0,ln.y,M.contentW,ln.y+Math.max(C.LINE_H,ln.h||C.LINE_H)]);
  for(const im of S.images){
    if(!im.rot){out.push([im.x,im.y,im.x+im.w,im.y+im.h]);continue;}
    /* a turned picture covers the box round its turned corners */
    const cx=im.x+im.w/2,cy=im.y+im.h/2,c=Math.abs(Math.cos(im.rot)),s=Math.abs(Math.sin(im.rot));
    const hw=(im.w*c+im.h*s)/2,hh=(im.w*s+im.h*c)/2;
    out.push([cx-hw,cy-hh,cx+hw,cy+hh]);
  }
  for(const el of document.querySelectorAll('#margin .chip')){
    const n=(S.nodes||[]).find(x=>x.id===el.dataset.node);
    if(n&&n.ref&&n.ref.strokeIds&&n.ref.strokeIds.some(id=>skip.has(id)))continue;
    const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
    const a=N.ink.toWorld({clientX:r.left,clientY:r.top}),b=N.ink.toWorld({clientX:r.right,clientY:r.bottom});
    out.push([a.x,a.y,b.x,b.y]);
  }
  return out;
}
function mathLayout(source){
  if(source.length>4000)throw Error('equation too long');
  let at=0;
  const empty=()=>({w:0,h:21,paths:[]});
  const put=(box,part,x,y,scale=1)=>{
    for(const path of part.paths)box.paths.push(path.map((v,i)=>v*scale+(i%2?y:x)));
  };
  const letters=text=>{
    const box=empty();
    for(const ch of spell(text)){
      const g=penGlyph(ch);if(!g)continue;
      for(const path of g.strokes)box.paths.push(path.map((v,i)=>i%2?v-CAP:v-g.l+box.w));
      box.w+=g.w;
    }
    return box;
  };
  const skip=()=>{while(/\s/.test(source[at]||'')&&at<source.length)at++;};
  const argument=depth=>{skip();return atom(depth+1);};
  function atom(depth){
    if(depth>24)throw Error('equation nested too deeply');
    const ch=source[at++];if(!ch)throw Error('missing argument');
    if(ch==='{'){const box=sequence('}',depth+1);return box;}
    if(ch==='}'||ch==='^'||ch==='_')throw Error('unexpected TeX token');
    if(ch!=='\\')return letters(ch);
    const match=source.slice(at).match(/^[a-zA-Z]+|^./);if(!match)throw Error('unfinished command');
    const name=match[0];at+=name.length;
    if(['left','right'].includes(name))return empty();
    if([',',';',':','!','quad','qquad',' '].includes(name))return {w:name==='!'?0:8,h:21,paths:[]};
    if(['frac','dfrac','tfrac'].includes(name)){
      const num=argument(depth),den=argument(depth),scale=.82;
      const w=Math.max(num.w,den.w)*scale+10,bar=num.h*scale+4;
      const box={w,h:bar+5+den.h*scale,paths:[[1,bar,w-1,bar]]};
      put(box,num,(w-num.w*scale)/2,0,scale);put(box,den,(w-den.w*scale)/2,bar+5,scale);return box;
    }
    if(name==='sqrt'){
      skip();let index=null;
      if(source[at]==='['){at++;index=sequence(']',depth+1);}
      const body=argument(depth),lead=index?Math.max(18,index.w*.5):18;
      const box={w:body.w+lead+4,h:body.h+7,paths:[[0,body.h*.55+5,5,body.h*.55+2,10,body.h+5,lead,2,body.w+lead+4,2]]};
      put(box,body,lead+2,7);if(index)put(box,index,0,0,.5);return box;
    }
    if(name==='text'){
      skip();if(source[at++]!=='{')throw Error('missing text group');
      const start=at;let nesting=1;
      while(at<source.length&&nesting){const c=source[at++];if(c==='{')nesting++;else if(c==='}')nesting--;}
      if(nesting)throw Error('unclosed text group');
      return letters(source.slice(start,at-1).replace(/[{}]/g,''));
    }
    if(['mathrm','mathbf','mathit','operatorname','boxed'].includes(name))return argument(depth);
    const symbols={pi:{w:24,h:21,paths:[[2,3,22,3],[7,3,6,21],[18,3,17,18,20,21,23,19]]},
      theta:{w:22,h:21,paths:[[10,0,4,3,2,10,4,18,10,21,16,18,18,10,16,3,10,0],[3,10,18,10]]},
      sum:{w:25,h:28,paths:[[23,0,2,0,14,14,2,28,23,28]]},
      int:{w:16,h:32,paths:[[15,1,11,0,8,3,7,27,4,32,0,31]]}};
    if(symbols[name])return symbols[name];
    if(name==='times')return letters('x');if(name==='cdot')return letters('*');if(name==='div')return letters('/');
    if(TEX[name]!==undefined)return letters(TEX[name]);
    if(/^[%{}$&#_]$/.test(name))return letters(name);
    throw Error('unsupported command: '+name);
  }
  function sequence(end,depth){
    const parts=[];
    while(at<source.length&&source[at]!==end){
      if(/\s/.test(source[at])){at++;continue;}
      let base=atom(depth),sup=null,sub=null;
      while(source[at]==='^'||source[at]==='_'){
        const kind=source[at++],arg=argument(depth);if(kind==='^')sup=arg;else sub=arg;
      }
      if(sup||sub){
        const rise=sup?sup.h*.65+2:0;
        const box={w:base.w+Math.max(sup?sup.w*.65:0,sub?sub.w*.65:0),h:rise+base.h+(sub?sub.h*.65:0),paths:[]};
        put(box,base,0,rise);if(sup)put(box,sup,base.w,0,.65);if(sub)put(box,sub,base.w,rise+base.h-3,.65);base=box;
      }
      parts.push(base);
    }
    if(end){if(source[at]!==end)throw Error('unclosed group');at++;}
    const box={w:parts.reduce((n,p)=>n+p.w,0),h:Math.max(21,...parts.map(p=>p.h)),paths:[]};
    let x=0;for(const p of parts){put(box,p,x,(box.h-p.h)/2);x+=p.w;}return box;
  }
  return sequence(null,0);
}

function Writer(anchor){
  /* anchor: {x,y,right,rowH,skip} - the question's left edge, its bottom,
     its right edge, the height of its handwriting and the stroke ids that
     are the question */
  const unit=Math.max(0.7,Math.min(1.25,(anchor.rowH*0.62)/(BASE-CAP)));
  const rowPx=ROW*unit,gap=Math.max(6,anchor.rowH*0.3),padX=10*unit;
  /* The answer is as wide as the question was written, and at least as wide
     as the text column: a question written across the whole page, zoomed
     out, gets its answer across the whole page, not squeezed into the
     column. The paper's left edge is the only limit on the left. */
  const paperL=-M.colLeft/M.zoom;
  const x0=Math.max(paperL+8,anchor.x);
  const right=Math.max(x0+160,M.contentW-10,(anchor.right!=null?anchor.right:0));
  const minW=Math.max(140,SPACE_W*unit*9);
  const rnd=wobble(Math.round(anchor.x*7+anchor.y*13));
  const list=[],textList=[];let registered=false,aborted=false;
  /* the answer belongs to the note it was asked in: another note opened
     while it is being written stops it, rather than letting the rest land
     on that note */
  let noteId=S.id;
  const cursor={x:x0,y:0},row={l:x0,r:right};
  /* Where a row can go. The answer used to take the full width under the
     question and drop below anything that reached into it, so a picture
     beside the question sent the whole answer under the picture, however
     much paper was free beside it. A row now takes the free stretch of its
     own height: from the question's left edge up to whatever is in the
     way, when that leaves room for a few words; failing that, a wide free
     stretch further along; failing both, it moves down to just below the
     nearest thing in the way and looks again. The next row goes back to
     the left edge, so the answer wraps round a picture the way text does. */
  const roomAt=(y)=>{
    const skip=new Set([...(anchor.skip||[]),...list.map(st=>st.id)]);
    const blocks=obstacles(skip);
    for(let guard=0;guard<60;guard++){
      const top=y+CAP*unit-2,bottom=y+(BASE+12)*unit;
      const hits=blocks.filter(b=>b[3]>=top&&b[1]<=bottom&&b[2]>=x0-padX&&b[0]<=right+padX);
      let free=[[x0,right]];
      for(const b of hits){
        const a=b[0]-padX,c=b[2]+padX,next=[];
        for(const [l,r] of free){
          if(c<=l||a>=r){next.push([l,r]);continue;}
          if(a-l>0)next.push([l,a]);
          if(r-c>0)next.push([c,r]);
        }
        free=next;
      }
      const home=free.find(([l,r])=>l<=x0+0.5&&r-x0>=minW);
      if(home)return {y,l:x0,r:home[1]};
      const wide=free.find(([l,r])=>r-l>=Math.max(minW,(right-x0)*0.4));
      if(wide)return {y,l:wide[0],r:wide[1]};
      /* nothing wide enough on this row: below the first thing in the way to end */
      let next=Infinity;for(const b of hits)if(b[3]+gap-CAP*unit>y)next=Math.min(next,b[3]+gap-CAP*unit);
      if(!isFinite(next))next=y+rowPx;
      y=next;
    }
    return {y,l:x0,r:right};
  };
  const startRow=(y)=>{const p=roomAt(y);cursor.y=p.y;cursor.x=p.l;row.l=p.l;row.r=p.r;};
  startRow(anchor.y+gap-CAP*unit);
  const newRow=()=>{startRow(Math.max(cursor.y+rowPx,rowBottom));rowBottom=0;};
  const t=N.ink.now();
  const place=(st)=>{
    /* a save that forked this page into a conflict copy keeps the page as
       it was, under the copy's id: the answer carries on there */
    if(S.id!==noteId&&S.forkedFrom&&S.forkedFrom.from===noteId&&S.forkedFrom.to===S.id)noteId=S.id;
    if(!aborted&&S.id!==noteId)aborted=true;
    if(aborted)return;
    if(!registered){
      registered=true;
      C.act(anchor.label||'nota',()=>{const have=new Set(S.strokes.map(s=>s.id));for(const s of list)if(!have.has(s.id))S.strokes.push(s);for(const ln of textList)if(!S.lines.some(l=>l.id===ln.id))S.lines.push(ln);N.text.render();},
                    ()=>{const ids=new Set(list.map(s=>s.id));S.strokes=S.strokes.filter(s=>!ids.has(s.id));const lines=new Set(textList.map(l=>l.id));S.lines=S.lines.filter(l=>!lines.has(l.id));N.text.render();aborted=true;});
    }
    if(!st)return;
    list.push(st);S.strokes.push(st);
    if(anchor.instant||C.reducedMotion()){N.ink.render();}
    else{st._show=0;queue.push({st,at:0,left:lengthOf(st.pts)});animate();}
    C.growDoc(st.bbox[3]);C.markDirty();
  };
  const glyph=(ch)=>{
    const g=penGlyph(ch);if(!g)return;
    const base=cursor.y+rnd()*0.8*unit;
    for(const s of g.strokes){
      const pts=[];
      for(let i=0;i<s.length;i+=2){
        pts.push(Math.round((cursor.x+(s[i]-g.l)*unit+rnd()*0.5*unit)*10)/10,
                 Math.round((base+s[i+1]*unit+rnd()*0.5*unit)*10)/10,
                 Math.round((0.5+rnd()*0.16)*100)/100);
      }
      const st={id:C.uid(),author:'ai',tool:'pen',w:g.raster?0.85*unit:3,pts,t0:t,t1:t,...(anchor.color?{color:anchor.color}:{})};
      st.bbox=N.ink.bboxOf(pts);
      place(st);
    }
    cursor.x+=g.w*unit;
  };
  let raw='',written=0;
  const word=(w)=>{
    if(!w)return;
    const width=wordWidth(w,unit);
    if(cursor.x>row.l&&cursor.x+width>row.r)newRow();
    for(const ch of w){
      const width=wordWidth(ch,unit);
      const p=roomAt(cursor.y);
      if(p.y!==cursor.y||cursor.x<p.l){startRow(p.y);}
      else if(cursor.x+width>p.r){newRow();}
      else{row.l=p.l;row.r=p.r;}
      if(cursor.x>row.l&&cursor.x+width>row.r)newRow();
      glyph(ch);
    }
  };
  let rowBottom=0,afterDisplay=false;
  const equation=(source,display=false)=>{
    let box;
    try{box=mathLayout(source);}catch(e){prose(source);return;}
    if(!box.paths.length)return;
    if(display&&cursor.x>row.l)newRow();
    const scale=Math.min(unit,(right-x0)/Math.max(1,box.w));
    if(cursor.x>row.l&&cursor.x+box.w*scale>row.r)newRow();
    const room=roomAt(cursor.y,box.h*scale+6,box.w*scale);
    if(room.y!==cursor.y||cursor.x<room.l||cursor.x+box.w*scale>room.r)startRow(room.y);
    const top=cursor.y+CAP*unit;
    for(const path of box.paths){
      const pts=[];
      for(let i=0;i<path.length;i+=2)pts.push(cursor.x+path[i]*scale,top+path[i+1]*scale,.5);
      const st={id:C.uid(),author:'ai',tool:'pen',w:Math.max(1,3*scale/unit),pts,t0:t,t1:t,...(anchor.color?{color:anchor.color}:{})};
      st.bbox=N.ink.bboxOf(pts);place(st);
    }
    cursor.x+=box.w*scale;
    rowBottom=Math.max(rowBottom,top+box.h*scale+gap-CAP*unit);
    if(display){newRow();afterDisplay=true;}
  };
  const prose=text=>{
    for(const piece of spell(tidy(text)).split(/(\n| )/)){
      if(piece==='\n'){if(!afterDisplay)newRow();afterDisplay=false;}
      else if(piece===' '){if(cursor.x>row.l)cursor.x+=SPACE_W*unit;}
      else if(piece){afterDisplay=false;word(piece);}
    }
  };
  const commit=final=>{
    while(written<raw.length){
      const rest=raw.slice(written),match=mathMatches(rest)[0];
      if(match){
        if(match.index)prose(rest.slice(0,match.index));
        equation(match[1]??match[2]??match[3]??match[4],match[1]!==undefined||match[4]!==undefined);
        written+=match.index+match[0].length;continue;
      }
      let n=final?rest.length:Math.max(rest.lastIndexOf(' '),rest.lastIndexOf('\n'))+1;
      if(!final){
        const open=/(?<!\\)\$\$|(?<![\\\w$])\$(?!\s)|\\\(|\\\[/.exec(rest);
        // Hold possible maths, but an unclosed price or prose dollar must
        // never stop subsequent words from appearing.
        if(open){
          const tail=rest.slice(open.index+open[0].length);
          const literal=open[0]==='$'&&(/^(?:\d[\d,.]*\s+[A-Za-z]|[^\n]*\b[A-Za-z]{2,}\s)/.test(tail)||tail.includes('\n')||tail.length>256);
          if(!literal)n=Math.min(n,open.index);
        }
        const escape=rest.lastIndexOf('\\');
        if(escape>=0&&escape>=n-1)n=Math.min(n,escape);
      }
      if(n<=0)return;
      prose(rest.slice(0,n));written+=n;
    }
  };
  return {
    /* where the first word will land, for the waiting animation */
    get origin(){return {x:cursor.x,y:cursor.y,unit};},
    /* the answer's left edge and the bottom of what the hand has drawn so
       far; the waiting animation stands under it until the answer is done */
    get tail(){
      let bottom=-Infinity;
      for(const st of list)if(st._show!==0&&st.bbox)bottom=Math.max(bottom,st.bbox[3]);
      for(const ln of textList)bottom=Math.max(bottom,ln.y+Math.max(C.LINE_H,ln.h||C.LINE_H));
      return isFinite(bottom)?{x:x0,y:bottom,unit}:null;
    },
    /* strokes placed but not yet drawn out by the hand */
    get drawing(){return !aborted&&list.some(st=>st._show!==undefined);},
    feed(text){if(aborted)return;raw=(raw+text).replace(/\r\n/g,'\n');if(raw.endsWith('\r'))return;raw=raw.replace(/\r/g,'\n');commit(false);},
    finish(){if(aborted)return;raw=raw.replace(/\r/g,'\n');commit(true);},
    get aborted(){return aborted;},
    get count(){return list.length+textList.length;},
    get ids(){return list.map(st=>st.id);},
    setColor(color){anchor.color=color;}
  };
}

/* ---- the model ---- */
const TEX={le:'<=',leq:'<=',ge:'>=',geq:'>=',ne:'!=',neq:'!=',pm:'+/-',mp:'-/+',infty:'infinity',approx:'~',equiv:'==',circ:' deg',degree:' deg',ldots:'...',cdots:'...',dots:'...',to:'->',rightarrow:'->',Rightarrow:'=>',leftarrow:'<-',implies:'=>',iff:'<=>',in:' in ',notin:' not in ',angle:'angle ',perp:' perpendicular to ',parallel:' parallel to ',therefore:'therefore ',because:'because ',sum:'sum',int:'integral',prod:'product',
  sin:'sin',cos:'cos',tan:'tan',sec:'sec',csc:'csc',cot:'cot',arcsin:'arcsin',arccos:'arccos',arctan:'arctan',sinh:'sinh',cosh:'cosh',tanh:'tanh',log:'log',ln:'ln',lg:'lg',exp:'exp',min:'min',max:'max',mod:' mod ',lim:'lim',deg:'deg',
  alpha:'alpha',beta:'beta',gamma:'gamma',delta:'delta',epsilon:'epsilon',varepsilon:'epsilon',zeta:'zeta',eta:'eta',theta:'theta',vartheta:'theta',iota:'iota',kappa:'kappa',lambda:'lambda',mu:'mu',nu:'nu',xi:'xi',pi:'pi',rho:'rho',sigma:'sigma',tau:'tau',upsilon:'upsilon',phi:'phi',varphi:'phi',chi:'chi',psi:'psi',omega:'omega',
  Gamma:'Gamma',Delta:'Delta',Theta:'Theta',Lambda:'Lambda',Xi:'Xi',Pi:'Pi',Sigma:'Sigma',Phi:'Phi',Psi:'Psi',Omega:'Omega'};
/* Dollar math requires tight delimiters and no following price digit.
   Escaped dollars are literal; prose such as "$5 and $10" stays prose. */
function mathMatches(text){
  return [...String(text).matchAll(/(?<!\\)\$\$([\s\S]*?)\$\$|(?<![\\\w$])\$(?!\s)([^$\n]*?\S)\$(?![\d$])|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g)].filter(m=>m[2]===undefined||!/(?:^|\s)[A-Za-z]{2,}(?:\s|$)/.test(m[2]));
}
function tidy(text,keepMath=false){
  text=String(text).replace(/\r\n?/g,'\n');
  const math=mathMatches(text),parts=[];let at=0;
  for(const m of math){parts.push(String(text).slice(at,m.index),m[1]??m[2]??m[3]??m[4]);at=m.index+m[0].length;}
  // Protected math is restored after ordinary prose has been tidied.
  if(keepMath&&math.length){
    let protectedText='',offset=0;
    math.forEach((m,i)=>{protectedText+=String(text).slice(offset,m.index)+'\u0001'+i+'\u0002';offset=m.index+m[0].length;});
    return tidy(protectedText+String(text).slice(offset)).replace(/\u0001(\d+)\u0002/g,(_,i)=>math[+i][0]);
  }
  parts.push(String(text).slice(at));
  return parts.join('')
    .replace(/\\\$/g,'$').replace(/\\\(|\\\)|\\\[|\\\]/g,'')
    .replace(/\\sqrt\{([^}]*)\}/g,'sqrt($1)').replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g,'($1)/($2)')
    .replace(/\\times/g,'x').replace(/\\cdot/g,'*').replace(/\\div/g,'/')
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^}]*)\}/g,'$1')
    /* a command that names a letter or a sign is written as it is said;
       one that only shapes the layout goes */
    .replace(/\\([a-zA-Z]+)/g,(m,name,at,str)=>{
      const w=TEX[name];if(w===undefined)return '';
      if(!/^[A-Za-z]/.test(w))return w;
      const before=str[at-1],after=str[at+m.length];
      return (before&&/[A-Za-z0-9)]/.test(before)?' ':'')+w+(after&&/[A-Za-z0-9(]/.test(after)?' ':'');
    })
    .replace(/\*\*|__|`+|^#+\s*/gm,'').replace(/^\s*[-*]\s+/gm,'')
    .replace(/[{}]/g,'');
}
/* ---- drawings ----
   What is drawn rather than written (boxes and the arrows between them, a
   food chain, a Venn diagram, a triangle, a graph) is found by its shape in
   diagram.js and goes to nota as a few lines of words, in the page's order
   where the drawing is: never as ink or a picture. The writing that labels
   a drawing is read label by label, because a row the text reader read
   whole ("grass -> rabbit -> fox") holds three of them. diagram.js is
   loaded from here rather than from the page, whose own source is part of
   the readers' fingerprint: adding it there would make every note's ink be
   read again. */
if(!window.NOTAS_DIAGRAM){
  const s=document.createElement('script');
  s.src=new URL('./diagram.js',(document.currentScript&&document.currentScript.src)||location.href).href;
  document.head.appendChild(s);
}
const labelReadings=new Map();   /* a label's strokes, as they are -> what it says */
function labelKey(ids){
  return ids.map(id=>{const st=C.strokeById(id);return id+':'+(st?st.pts.length+':'+(st.rev||0):'');}).sort().join('|');
}
function sameStrokes(a,b){if(a.length!==b.length)return false;const set=new Set(a);return b.every(id=>set.has(id));}
/* what the page has already read of exactly these strokes as words */
function knownText(ids){
  const groups=N.recog&&N.recog.textGroups?N.recog.textGroups():[];
  for(const g of groups){
    if(!sameStrokes(g.strokeIds,ids))continue;
    const t=(S.textTranscripts||[]).find(t=>t.hash===g.hash);
    if(t&&t.text)return t.text;
  }
  return null;
}
/* the maths reader's reading of these strokes, when its expressions lie
   wholly inside them and cover them */
function knownMaths(ids){
  const set=new Set(ids),parts=[];let covered=0;
  for(const cl of S.clusters||[]){
    if(cl.source!=='ink'||!cl.strokeIds.length||!cl.strokeIds.every(id=>set.has(id)))continue;
    const node=(S.nodes||[]).find(n=>n.kind==='cluster'&&n.ref===cl);
    const t=String((node&&!node.error&&node.src)||cl.ascii||'').trim();
    if(!t)continue;
    parts.push({x:cl.bbox[0],t});covered+=cl.strokeIds.length;
  }
  return covered>=ids.length*0.9?parts.sort((a,b)=>a.x-b.x).map(p=>p.t).join(' '):'';
}
const looksMath=t=>N.mathcore&&N.mathcore.looksLikeMath?N.mathcore.looksLikeMath(t):/[0-9=+*\/^-]/.test(t);
const readsProse=t=>N.mathcore&&N.mathcore.readsAsProse?N.mathcore.readsAsProse(t):/[A-Za-z]{3,}/.test(t);
/* One label: the text reader's reading of it, unless it is not words and
   the maths reader has a formula for it. A reading that failed is not
   kept, so the next question tries again. */
async function readLabel(ids){
  const key=labelKey(ids);
  if(labelReadings.has(key))return labelReadings.get(key);
  const known=knownText(ids);
  if(known!=null){labelReadings.set(key,known);return known;}
  const maths=knownMaths(ids);
  let read=null;
  if(N.recog&&N.recog.readStrokesText){try{read=await N.recog.readStrokesText(ids);}catch(e){}}
  const said=read&&read.text&&read.confidence>=0.5&&/[\p{L}\p{N}]/u.test(read.text)?read.text:'';
  const text=said&&(readsProse(said)||!maths||!looksMath(maths))?said:maths||(read&&read.confidence>=0.3?read.text||'':'');
  if(!text&&(!read||read.error))return '';
  labelReadings.set(key,text);
  if(labelReadings.size>3000)labelReadings.delete(labelReadings.keys().next().value);
  return text;
}
/* The drawings on the page, each as {bbox, ids, lines}: those among the
   strokes not skipped, or only among `only` (a lasso's), at the page's
   size of writing. */
function findDrawings(skip,only){
  const D=window.NOTAS_DIAGRAM;if(!D)return null;
  const mine=S.strokes.filter(st=>st.author==='user'&&Array.isArray(st.pts));
  const strokes=only?mine.filter(st=>only.has(st.id)):mine.filter(st=>!skip.has(st.id));
  try{return D.find(strokes,only?{H:D.heightOf(mine)}:{});}catch(e){console.warn('nota: drawings',e);return null;}
}
/* a drawing that cannot be put into words is left out, and its writing
   stays in the page's rows as before: it never stops the question */
function sayDrawings(found,said){
  const out=[];
  for(const d of found.diagrams){
    try{out.push({bbox:d.bbox,ids:new Set(d.strokeIds),lines:window.NOTAS_DIAGRAM.describe(d,l=>said(l)||'')});}
    catch(e){console.warn('nota: a drawing could not be described',e);}
  }
  return out;
}
/* what is already known of a label, without reading it */
function knownLabel(l){
  const key=labelKey(l.strokeIds);
  if(labelReadings.has(key))return labelReadings.get(key);
  const known=knownText(l.strokeIds);
  return known!=null?known:knownMaths(l.strokeIds);
}
/* Labels the page has not read are read while `wait` milliseconds last;
   after that what is already known is said and the rest left out. */
async function readDrawings(skip,wait,only){
  const found=findDrawings(skip,only);
  if(!found||!found.diagrams.length)return [];
  const until=performance.now()+wait,said=new Map();
  for(const d of found.diagrams)for(const l of d.labels){
    const key=labelKey(l.strokeIds);
    said.set(l,labelReadings.has(key)||knownText(l.strokeIds)!=null||performance.now()>=until?knownLabel(l):await readLabel(l.strokeIds));
  }
  return sayDrawings(found,l=>said.get(l));
}
/* ---- a picture of the page ----
   The model reads pictures, so the question goes with one: the part of
   the page around it as the person sees it, so handwriting the readers
   misread, a drawing, or a photo put on the page is seen as it is. Only
   the person's own ink and pictures are drawn, as the readers see them:
   nota's red replies stay out, as they do from the words. A lasso's
   question sends what was circled; a written question is in its own
   picture, so a misread question is seen as written. A typed question on
   a page with no ink or picture near it goes as words alone. */
const PICTURE_MAX=1280,PICTURE_ABOVE=900,PICTURE_TALL=1700,PICTURE_CHARS=1400*1024;
function loadPicture(src){
  return new Promise(resolve=>{
    const img=new Image(),done=ok=>{clearTimeout(timer);resolve(ok&&img.naturalWidth?img:null);};
    const timer=setTimeout(()=>done(false),4000);
    img.onload=()=>done(true);img.onerror=()=>done(false);img.src=src;
  });
}
async function pagePicture(where,drawings){
  let box;
  if(where.picture){const b=where.picture,pad=24;box=[b[0]-pad,b[1]-pad,b[2]+pad,b[3]+pad];}
  else{
    const bottom=(where.below!=null?where.below:where.y+C.LINE_H)+16;
    let top=Math.max(0,where.y-PICTURE_ABOVE);
    /* a drawing the band cuts through is taken whole, within reason */
    for(const d of drawings||[])if(d.bbox[3]>top&&d.bbox[1]<top)top=Math.max(d.bbox[1]-16,bottom-PICTURE_TALL);
    box=[0,top,M.contentW,bottom];
  }
  const meets=b=>b[2]>=box[0]&&b[0]<=box[2]&&b[3]>=box[1]&&b[1]<=box[3];
  const ink=S.strokes.filter(st=>st.author==='user'&&st.bbox&&Array.isArray(st.pts)&&meets(st.bbox));
  const pics=(S.images||[]).filter(im=>meets([im.x,im.y,im.x+im.w,im.y+im.h]));
  if(!pics.length&&!ink.length)return null;
  /* the band widens to the writing in it, which can run past the column */
  if(!where.picture)for(const b of [...ink.map(st=>st.bbox),...pics.map(im=>[im.x,im.y,im.x+im.w,im.y+im.h])]){box[0]=Math.min(box[0],b[0]-8);box[2]=Math.max(box[2],b[2]+8);}
  const w=box[2]-box[0],h=box[3]-box[1];
  const loaded=await Promise.all(pics.map(im=>loadPicture(im.src)));
  for(let scale=Math.min(2,PICTURE_MAX/Math.max(w,h)),quality=0.85,tries=0;tries<4;tries++,scale*=0.75,quality-=0.1){
    const cv=document.createElement('canvas');
    cv.width=Math.max(1,Math.round(w*scale));cv.height=Math.max(1,Math.round(h*scale));
    const ctx=cv.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);
    ctx.scale(scale,scale);ctx.translate(-box[0],-box[1]);
    pics.forEach((im,i)=>{
      const el=loaded[i];if(!el)return;
      if(im.rot){ctx.save();ctx.translate(im.x+im.w/2,im.y+im.h/2);ctx.rotate(im.rot);ctx.drawImage(el,-im.w/2,-im.h/2,im.w,im.h);ctx.restore();}
      else ctx.drawImage(el,im.x,im.y,im.w,im.h);
    });
    paintInk(ctx,ink,scale);
    let url;try{url=cv.toDataURL('image/jpeg',quality);}catch(e){return null;}
    if(url.startsWith('data:image/jpeg;base64,')&&url.length<=PICTURE_CHARS)return {url,w:cv.width,h:cv.height};
  }
  return null;
}

/* ---- the notebook's other notes, in words, for the tools below ----
   A note is its typed lines top to bottom and what was read of its ink;
   list_notes matches a query against titles, first words and, for the
   latest few dozen notes, the words inside. */
const RECALL_SCAN=60;
const RECALL_STOP=new Set(('the and for are but not you your yours with what this that these those from have has had was were will would can could should '+
  'about into onto over under some any all one two how why when where who which they them their there then than its on in of to is be me my mine our ours '+
  'we us do does did please hey nota note notes notebook notebooks page pages test tests quiz ask tell give make show help write wrote written stuff thing things '+
  'remember recall know learn learned learnt revise revision review recap summarise summarize summary questions question answer answers').split(' '));
function recallWords(s){
  return String(s||'').toLowerCase().normalize('NFKD').replace(/\p{M}+/gu,'').split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3&&!RECALL_STOP.has(w));
}
/* a note in words: its typed lines top to bottom, then what was read of its ink */
function noteText(doc){
  const out=[],seen=new Set(),add=s=>{const t=String(s||'').replace(/\s+/g,' ').trim();if(t&&!seen.has(t)){seen.add(t);out.push(t);}};
  for(const l of (Array.isArray(doc.lines)?doc.lines:[]).filter(l=>l&&typeof l.text==='string'&&!l.tutor&&!l.wait).sort((a,b)=>(+a.y||0)-(+b.y||0)))add(l.text);
  for(const t of Array.isArray(doc.textTranscripts)?doc.textTranscripts:[])if(t&&typeof t.text==='string'&&(t.confidence||0)>=0.3)add(t.text);
  for(const t of Array.isArray(doc.transcripts)?doc.transcripts:[])if(t&&!t.dismissed&&typeof t.ascii==='string')add(t.ascii);
  return out.join('\n');
}
function noteTitle(doc,row){
  const t=(row&&row.title)||doc.title;
  if(t&&t!=='untitled')return String(t).slice(0,120);
  return (row&&row.preview)||C.firstLine(doc.lines||[])||'untitled';
}
/* ink as the model sees it: dark on white, whatever the theme */
function paintInk(ctx,strokes,scale){
  ctx.lineCap='round';ctx.lineJoin='round';
  for(const st of strokes){
    const p=st.pts;ctx.strokeStyle=ctx.fillStyle=st.color||(st.author==='ai'?'#c0392b':'#1b1d21');
    const w=+st.w||2.4;
    if(p.length<6){ctx.beginPath();ctx.arc(p[0],p[1],Math.max(1,w*0.6),0,Math.PI*2);ctx.fill();continue;}
    for(let i=3;i<p.length;i+=3){ctx.beginPath();ctx.moveTo(p[i-3],p[i-2]);ctx.lineTo(p[i],p[i+1]);ctx.lineWidth=Math.max(1.2/scale,w*(0.55+0.9*(p[i+2]||0.5)));ctx.stroke();}
  }
}

/* the drawings now, from what is already known: for the context panel */
function knownDrawings(skip){
  const found=findDrawings(skip||new Set());
  return found?sayDrawings(found,knownLabel):[];
}

function pageRows(question){
  /* the notebook as rows in reading order, with a marker where the question
     is. Only what the calculator has read: prose ink joins through its
     search transcript. The tutor's own lines and strokes stay out. */
  const rows=[];
  const skip=question.skip||new Set();
  /* writing that is part of a drawing is said in the drawing's own lines */
  const drawings=question.diagrams||[];
  const drawn=new Set();for(const d of drawings)for(const id of d.ids)drawn.add(id);
  const inDrawing=ids=>{if(!drawn.size||!ids.length)return false;let n=0;for(const id of ids)if(drawn.has(id))n++;return n>=ids.length*0.6;};
  const groups=N.recog&&N.recog.textGroups?N.recog.textGroups():[];
  const byHash=new Map((S.textTranscripts||[]).map(t=>[t.hash,t.text]));
  /* Ink the text reader read as words is words. The maths reader reads
     every stroke as a formula, and its reading of a written sentence or a
     boxed definition ("((((499*99)/500)/...") went to nota beside the real
     words, which nota then tried to explain. Such a reading is left out,
     unless the student asked for it to be worked out. */
  const prose=new Set();
  const isProse=t=>N.mathcore&&N.mathcore.readsAsProse?N.mathcore.readsAsProse(t):(String(t).match(/[A-Za-z]{3,}/g)||[]).length>=2;
  for(const g of groups){const t=byHash.get(g.hash);if(t&&isProse(t))for(const id of g.strokeIds)prose.add(id);}
  const wordy=cl=>{
    if(!prose.size||cl.confirmed||cl.asked)return false;
    let n=0;for(const id of cl.strokeIds)if(prose.has(id))n++;
    return n>=cl.strokeIds.length*0.6;
  };
  for(const n of S.nodes||[]){
    if(!n.src||!String(n.src).trim())continue;
    if(n.kind==='line'&&n.ref&&n.ref.tutor)continue;
    if(n.kind==='line'&&question.lineId===n.id)continue;
    if(n.kind==='cluster'&&n.ref&&n.ref.strokeIds&&n.ref.strokeIds.some(id=>skip.has(id)))continue;
    if(n.kind==='cluster'&&n.ref&&n.ref.review)continue;
    if(n.kind==='cluster'&&n.ref&&n.ref.strokeIds&&wordy(n.ref))continue;
    if(n.kind==='cluster'&&n.ref&&n.ref.strokeIds&&inDrawing(n.ref.strokeIds))continue;
    let text=String(n.src).trim();
    if(n.result&&!n.stated)text+='   [= '+n.result+']';
    if(n.error&&n.kind==='cluster')continue;
    rows.push({y:n.y,x:n.x||0,text});
  }
  for(const g of groups){
    if(g.strokeIds.some(id=>skip.has(id)))continue;
    if(inDrawing(g.strokeIds))continue;
    const text=byHash.get(g.hash);if(!text)continue;
    rows.push({y:g.bbox[1],x:g.bbox[0],text:'"'+text+'"'});
  }
  // Quick Maths is generated ink, but it is user-inserted content, not a
  // tutor reply. Keep exact source text only while all of its ink survives.
  const quickGroups=new Map();
  for(const st of S.strokes||[]){
    if(typeof st.quickGroup!=='string'||!Number.isInteger(st.quickCount)||st.quickCount<1)continue;
    if(!quickGroups.has(st.quickGroup))quickGroups.set(st.quickGroup,[]);
    quickGroups.get(st.quickGroup).push(st);
  }
  for(const strokes of quickGroups.values()){
    const count=strokes[0].quickCount;
    if(strokes.length!==count||strokes.some(st=>st.quickCount!==count||skip.has(st.id)))continue;
    if(inDrawing(strokes.map(st=>st.id)))continue;
    const source=strokes.filter(st=>typeof st.quickMath==='string'&&st.quickMath.length<=8192);
    if(source.length!==1||!source[0].quickMath.trim())continue;
    rows.push({y:Math.min(...strokes.map(st=>st.bbox[1])),x:Math.min(...strokes.map(st=>st.bbox[0])),text:source[0].quickMath});
  }
  for(const d of drawings)rows.push({y:d.bbox[1],x:d.bbox[0],drawing:d.lines});
  rows.push({y:question.y,x:question.x,marker:true});
  const order=(a,b)=>(Math.round(a.y/24)-Math.round(b.y/24))||(a.x-b.x);
  /* Writing inside a drawn box is read as one block, box by box: two boxes
     side by side read row by row made every line half of one box and half
     of the other. A block stands in the page's order at its box's corner. */
  /* a box that is part of a drawing (a flowchart's) is said by the drawing */
  const boxes=((N.recog&&N.recog.frames&&N.recog.frames().boxes)||[]).filter(b=>!drawings.some(d=>b[0]>=d.bbox[0]-2&&b[1]>=d.bbox[1]-2&&b[2]<=d.bbox[2]+2&&b[3]<=d.bbox[3]+2));
  const within=(r)=>{let best=-1,area=Infinity;boxes.forEach((b,i)=>{if(r.x>=b[0]-4&&r.x<=b[2]&&r.y>=b[1]-4&&r.y<=b[3]){const a=(b[2]-b[0])*(b[3]-b[1]);if(a<area){area=a;best=i;}}});return best;};
  const blocks=new Map(),flat=[];
  for(const r of rows){
    const at=r.marker||r.drawing?-1:within(r);
    if(at<0){flat.push(r);continue;}
    if(!blocks.has(at))blocks.set(at,{y:boxes[at][1],x:boxes[at][0],rows:[]});
    blocks.get(at).rows.push(r);
  }
  for(const b of blocks.values())flat.push({y:b.y,x:b.x,block:b.rows.sort(order)});
  flat.sort(order);
  const MARK='>>> the question is written here',lines=[];
  for(const r of flat){
    if(r.block){lines.push('[box]');for(const x of r.block)lines.push(x.text);lines.push('[end of box]');}
    else if(r.drawing)lines.push(...r.drawing);
    else lines.push(r.marker?MARK:r.text);
  }
  const at=lines.indexOf(MARK);
  return lines.filter((r,i)=>Math.abs(i-at)<=48).join('\n');
}
/* ---- context diagnostics ----
   Open the page with ?debug=context to see what nota is told. The panel
   shows the page as nota would read it right now, and the moment a question
   goes out it shows the exact messages that went, model and all. What the
   model sees is otherwise invisible, and a wrong answer is as often a
   reading nota was never given as a reading it got wrong. */
const DEBUG_CONTEXT=/[?&]debug=context/.test(location.search);
let debugEl=null,debugSent='',debugHold=0;
function debugPanel(){
  if(debugEl)return debugEl;
  debugEl=document.createElement('div');
  debugEl.id='context-trace';
  debugEl.style.cssText='position:fixed;z-index:99;right:8px;top:60px;width:min(46vw,520px);max-height:60vh;'+
    'overflow:auto;background:rgba(0,0,0,.86);color:#9f9;font:400 11px/1.4 ui-monospace,monospace;'+
    'padding:8px 10px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;-webkit-user-select:text';
  document.body.appendChild(debugEl);
  return debugEl;
}
function debugShow(title,text){
  debugPanel().textContent=title+'\n'+'-'.repeat(Math.min(60,title.length))+'\n'+text;
}
/* the page as nota would read it now, the question marker after the last row */
function liveWhere(){
  let low=0,x=0;for(const n of S.nodes||[]){if(n.y>=low){low=n.y;x=n.x||0;}}
  return {x,y:low+1};
}
function debugLive(){
  if(debugSent)return;
  debugShow('nota context, live ('+CONFIG.model+' via '+CONFIG.proxy+')',pageRows({...liveWhere(),diagrams:knownDrawings()})||'(empty page)');
}
if(DEBUG_CONTEXT){
  setInterval(()=>{ try{debugLive();}catch(e){} },1000);
  console.info('nota: ?debug=context is on; N.nota.context() returns the page as nota reads it');
}
/* ---- tools: nota looks up the notebook's other notes itself ----
   The model is offered two tools and asks for what it needs: list_notes for
   the notebook's notes (those matching a few words first), read_note for one
   note's words. The calls are answered here, in the browser, from the
   notebook this page keeps, so no note leaves it unless the model asked for
   it. A call the provider did not parse comes back in the answer's text as
   <tool_call>{...}</tool_call> and is read here the same way; neither kind
   is ever written on the page. When the calls fail (the notebook cannot
   be read, calls that make no sense, more rounds than allowed, nothing
   answered after them), the question ends there, quietly: nothing is
   written and no error is shown. The forward (nota-body.mjs) sends its own
   copy of these definitions upstream. */
const NOTE_TOOLS=[
  {type:'function',function:{name:'list_notes',
    description:'Lists the other notes in the person\'s notebook, newest first: each note\'s id, title, when it was last edited and its first words. With a query, the notes matching its words come first.',
    parameters:{type:'object',properties:{query:{type:'string',description:'A few words of a topic or title to look for. Leave it out for the latest notes.'}}}}},
  {type:'function',function:{name:'read_note',
    description:'Reads one note: its typed lines and what was read of its handwriting.',
    parameters:{type:'object',properties:{id:{type:'string',description:'The note\'s id, from list_notes.'}},required:['id']}}}
];
const TOOL_SYSTEM='You can look at the person\'s other notes in this notebook with two tools: list_notes lists them (with a query, those matching its words first) and read_note reads one by its id. Use them when the question is about their notes (a test, a quiz, a summary, what they wrote about something) or names a topic or note that is not on this page: list, read the one to three notes that fit, then answer from them. Do not use them when the page or general knowledge answers the question. Never mention the tools, the ids or looking anything up in the answer.';
const TOOL_ROUNDS=3,TOOL_CALLS=4,TOOL_ERRORS=3,TOOL_CHARS=32000,LIST_MAX=30,READ_CHARS=5000,TOOL_TAG='<tool_call>';
const GRAB_TEXT='nota is grabbing your notes for its reference.';
const toolsFailed=(why,cause)=>Object.assign(new Error('nota could not look at the notes: '+why),{toolsFailed:true,cause});
const CALL_ID=/^[\w.:-]{1,128}$/;
async function notebookRows(){
  if(!C.Store||!C.Store.index)throw new Error('the notebook has no store');
  const rows=await C.Store.index();
  return (Array.isArray(rows)?rows:[]).filter(r=>r&&r.id&&r.id!==S.id&&!r.trashed).sort((a,b)=>(b.updated||0)-(a.updated||0));
}
function rowTitle(r){ return String(r.title&&r.title!=='untitled'?r.title:(r.preview||'untitled')).replace(/\s+/g,' ').trim().slice(0,120); }
function editedOn(t){ return t?new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):''; }
async function listNotes(args){
  const rows=await notebookRows();
  if(!rows.length)return {notes:[],note:'the notebook has no other notes'};
  const words=new Set(recallWords(args.query));
  let list=rows,matched=0;
  if(words.size){
    /* the title counts most, then the first words, then (for the latest
       few dozen notes) the words inside */
    const scored=[];
    for(let i=0;i<rows.length;i++){
      const r=rows[i],tWords=new Set(recallWords(rowTitle(r))),pWords=new Set(recallWords(r.preview));
      let cWords=null;
      if(i<RECALL_SCAN){ let doc=null;try{doc=await C.Store.get('notas.note.'+r.id);}catch(e){} if(doc)cWords=new Set(recallWords(noteText(doc))); }
      let score=0;
      for(const w of words){ if(tWords.has(w))score+=4; else if(pWords.has(w)||cWords&&cWords.has(w))score+=1; }
      scored.push({r,score});
    }
    matched=scored.filter(s=>s.score>0).length;
    list=scored.sort((a,b)=>b.score-a.score).map(s=>s.r);
  }
  const out={notes:list.slice(0,LIST_MAX).map(r=>({id:r.id,title:rowTitle(r),edited:editedOn(r.updated),start:String(r.preview||'').replace(/\s+/g,' ').trim().slice(0,80)}))};
  if(words.size&&!matched)out.note='no note matched those words; these are the latest notes';
  if(rows.length>LIST_MAX)out.more=rows.length-LIST_MAX;
  return out;
}
async function readNote(args){
  const id=String(args.id==null?'':args.id).trim();
  if(id&&id===S.id)return {id,note:'that is the page the question is on, given above'};
  const row=(await notebookRows()).find(r=>r.id===id);
  if(!row)return {error:'no note has the id "'+id.slice(0,40)+'"; list_notes gives the ids'};
  const doc=await C.Store.get('notas.note.'+row.id);
  if(!doc)return {error:'that note could not be opened'};
  const text=noteText(doc);
  return {id:row.id,title:noteTitle(doc,row),edited:editedOn(row.updated||doc.updated),
    text:text?text.slice(0,READ_CHARS):(doc.strokes||[]).length||(doc.images||[]).length?'(handwriting or pictures the notebook could not read)':'(an empty note)'};
}
/* one call answered, as the words the model reads. A call that makes no
   sense is told so, for the model to put right; a notebook that cannot be
   read ends the tools. What the calls bring back is bounded per question. */
async function runTool(name,argText,budget){
  const said=(result,error)=>({error,text:JSON.stringify(result)});
  let args;
  try{ args=argText&&String(argText).trim()?JSON.parse(argText):{}; }catch(e){ return said({error:'the arguments were not JSON'},true); }
  if(!args||typeof args!=='object'||Array.isArray(args))args={};
  if(name!=='list_notes'&&name!=='read_note')return said({error:'there is no tool called "'+String(name||'').slice(0,40)+'"'},true);
  if(budget.left<=0)return said({note:'enough notes have been read for this question; answer with what you have'},false);
  let result;
  try{ result=name==='list_notes'?await listNotes(args):await readNote(args); }
  catch(e){ throw toolsFailed('the notebook could not be read',e); }
  let text=JSON.stringify(result);
  if(text.length>budget.left&&result.text){ result.text=result.text.slice(0,Math.max(0,result.text.length-(text.length-budget.left)))+'...'; text=JSON.stringify(result); }
  budget.left-=text.length;
  return {error:!!result.error,text};
}
/* calls written out as text: <tool_call>{"name":..,"arguments":{..}}</tool_call> */
function textCalls(said){
  const out=[];
  for(const m of String(said).matchAll(/<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g)){
    let j=null;try{j=JSON.parse(m[1]);}catch(e){}
    const args=j&&j.arguments!==undefined?j.arguments:j&&j.parameters;
    out.push({id:'',name:j&&typeof j.name==='string'?j.name:'',args:typeof args==='string'?args:JSON.stringify(args||{})});
  }
  return out;
}

function ask(context,question,notes){ return 'Page, in reading order:\n'+(context||'(empty page)')+(notes?'\n\n'+notes:'')+'\n\nQuestion: '+question; }
function debugRequest(body,pictures){
  if(!DEBUG_CONTEXT)return;
  let at=0;
  const said=m=>{
    const c=m.content;
    const words=c==null?'':typeof c==='string'?c:c.map(p=>{if(p.type==='text')return p.text;const q=pictures[at++]||{what:'a picture',w:0,h:0,url:''};return '[picture of '+q.what+', '+q.w+' x '+q.h+', '+Math.round(q.url.length*0.75/1024)+' KB]';}).join('\n');
    return [words,...(m.tool_calls||[]).map(t=>'[asks '+t.function.name+' '+t.function.arguments+']')].filter(Boolean).join('\n');
  };
  debugSent=body.messages.map(m=>'['+m.role+(m.tool_call_id?' '+m.tool_call_id:'')+']\n'+said(m)).join('\n\n');
  debugShow('nota request, sent '+new Date().toLocaleTimeString()+' ('+body.model+', max_tokens '+body.max_tokens+', temperature '+body.temperature+(body.tools?', tools':'')+')',debugSent);
  console.info('nota request',body);
  /* the live view comes back a while after, so the next question's page can be watched */
  clearTimeout(debugHold);debugHold=setTimeout(()=>{debugSent='';},30000);
}
/* A request sent, and the response it got with the payload that got it.
   The proxy is tried first and the provider when it is unreachable or
   absent (a plain file server has no such route, and a proxy without a
   key answers 501); an answer with a status, such as a refused key, is
   final. Each payload in `tries` is the one before it made plainer, tried
   on a 400 (or a 413, when pictures are why). The page's own key travels
   only when it has one, so the proxy's key is never overridden by the
   placeholder. */
async function post(tries,signal,pictured){
  let error=null;
  for(const url of [CONFIG.proxy,CONFIG.url]){
    if(url===CONFIG.url&&!hasKey()){error=new Error('nota needs a key. add it in nota.js.');break;}
    let unreachable=false;
    const headers={'Content-Type':'application/json','Accept':'text/event-stream'};
    if(url===CONFIG.url&&hasKey())headers.Authorization='Bearer '+apiKey();
    for(const payload of tries){
      let response;
      try{
        response=await fetch(url,{method:'POST',signal,headers,body:JSON.stringify(payload)});
      }catch(e){ if(e.name==='AbortError')throw e; error=e;unreachable=true;break; }
      if(response.ok)return {response,payload};
      if(url===CONFIG.proxy&&[404,405,501].includes(response.status)){unreachable=true;break;}
      /* the forward explains itself in a line of plain text (a call from
         another site, no key, the model out of reach); that is shown as it
         is, rather than guessed from the status */
      let said='',whole='';
      try{ whole=await response.text(); }catch(e){}
      if(spentAllowance(response.status,whole)){ error=Object.assign(new Error(LOAD_TEXT),{overloaded:true}); break; }
      if(/^text\/plain/i.test(response.headers.get('content-type')||''))said=whole.trim().slice(0,140);
      error=new Error(said||(response.status===401||response.status===403?'nota\'s key was refused.':'nota could not answer ('+response.status+').'));
      error.status=response.status;
      if(response.status!==400&&!(response.status===413&&pictured))break;
    }
    if(!unreachable||error?.overloaded)break;
  }
  throw error||new Error('nota could not reach the model.');
}
/* the answer's stream: each delta the model sends, until it is done */
async function readSSE(response,onDelta){
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='';
  for(;;){
    const {value,done}=await reader.read();
    buffer+=done?decoder.decode()+'\n':decoder.decode(value,{stream:true});
    let nl;
    while((nl=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);
      if(!line.startsWith('data:'))continue;
      const data=line.slice(5).trim();
      if(data==='[DONE]'){await reader.cancel();return;}
      let json;try{json=JSON.parse(data);}catch(e){continue;}
      if(json.error)throw Object.assign(new Error('nota model stream failed.'),{status:502});
      const delta=json.choices&&json.choices[0]&&json.choices[0].delta;
      if(delta)onDelta(delta);
    }
    if(done)break;
  }
}
/* A question the model may answer after looking at notes: up to
   TOOL_ROUNDS rounds of calls, each answered here and sent back, then an
   answer streamed as any other. Words before the first call are held, as
   they may be the call itself written out; a round that turns out to be
   calls never reaches the page. onGrab is told when notes are fetched. */
async function streamTools(question,context,onDelta,signal,picture,model,{onGrab}={}){
  const text=ask(context,question,'');
  const pictures=picture?[{...picture,what:'the page'}]:[];
  const messages=[{role:'system',content:SYSTEM+'\n'+TOOL_SYSTEM},{role:'user',content:pictures.length?[{type:'text',text},{type:'image_url',image_url:{url:picture.url}}]:text}];
  const budget={left:TOOL_CHARS};
  let total='',errors=0,extras=true;
  for(let round=0;;round++){
    const last=round>=TOOL_ROUNDS;
    const plain={model,stream:true,max_tokens:CONFIG.maxTokens,temperature:0.3,messages,tools:NOTE_TOOLS,tool_choice:last?'none':'auto'};
    const body=extras?{...plain,...CONFIG.extras}:plain;
    debugRequest(body,pictures);
    /* the page's picture refused: the question goes as words, from then on */
    const words={...plain,messages:[messages[0],{role:'user',content:text},...messages.slice(2)]};
    const tries=[...(extras?[body]:[]),plain,...(typeof messages[1].content==='string'?[]:[words])];
    const sent=await post(tries,signal,pictures.length>0);
    if(sent.payload!==body)extras=false;
    if(sent.payload===words)messages[1]={role:'user',content:text};
    const calls=[];let said='',held='',live=false;
    await readSSE(sent.response,delta=>{
      if(Array.isArray(delta.tool_calls))for(const t of delta.tool_calls){
        if(!t)continue;
        const i=Number.isInteger(t.index)?t.index:t.id||!calls.length?calls.length:calls.length-1;
        const c=calls[i]||(calls[i]={id:'',name:'',args:''});
        if(t.id)c.id=String(t.id);
        const f=t.function||{};
        if(typeof f.name==='string'&&f.name!==c.name)c.name+=f.name;
        if(typeof f.arguments==='string')c.args+=f.arguments;
        else if(f.arguments&&typeof f.arguments==='object')c.args+=JSON.stringify(f.arguments);
      }
      const piece=typeof delta.content==='string'?delta.content:'';
      if(!piece)return;
      said+=piece;
      if(live){total+=piece;onDelta(piece,total);return;}
      held+=piece;
      const lead=held.trimStart();
      if(!lead||calls.length||lead.startsWith(TOOL_TAG)||TOOL_TAG.startsWith(lead))return;
      live=true;total+=held;onDelta(held,total);held='';
    });
    const asked=calls.filter(c=>c&&(c.name||c.args));
    const textual=!asked.length&&!live&&held.trimStart().startsWith(TOOL_TAG);
    const found=(textual?textCalls(held):asked).slice(0,TOOL_CALLS);
    if(!found.length){
      if(held.trim()){total+=held;onDelta(held,total);}
      if(!total.trim()&&round)throw toolsFailed('nothing was answered after them');
      return total;
    }
    if(last)throw toolsFailed('it kept asking for notes');
    onGrab?.();
    found.forEach((c,i)=>{ if(!CALL_ID.test(c.id))c.id='call_'+round+'_'+i; });
    const results=[];
    for(const c of found){
      if(signal.aborted)throw new DOMException('Question withdrawn','AbortError');
      const r=await runTool(c.name,c.args,budget);
      if(r.error)errors++;
      results.push(r.text);
    }
    if(errors>=TOOL_ERRORS)throw toolsFailed('its calls made no sense');
    if(textual)messages.push({role:'assistant',content:said},{role:'user',content:results.map(r=>'<tool_response>\n'+r+'\n</tool_response>').join('\n')});
    else{
      messages.push({role:'assistant',content:said.trim()||null,tool_calls:found.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:c.args||'{}'}}))});
      found.forEach((c,i)=>messages.push({role:'tool',tool_call_id:c.id,content:results[i]}));
    }
  }
}
async function stream(question,context,onDelta,signal,picture,tools=null){
  const model=CONFIG.model;
  if(tools)return streamTools(question,context,onDelta,signal,picture,model,tools);
  const text=ask(context,question,'');
  const pictures=picture?[{...picture,what:'the page'}]:[];
  const body={
    model,stream:true,max_tokens:CONFIG.maxTokens,temperature:0.3,
    messages:[{role:'system',content:SYSTEM},{role:'user',content:pictures.length?[{type:'text',text},...pictures.map(p=>({type:'image_url',image_url:{url:p.url}}))]:text}],
    ...CONFIG.extras
  };
  debugRequest(body,pictures);
  const plain={...body};for(const k of Object.keys(CONFIG.extras||{}))delete plain[k];
  /* a picture the provider or the forward will not take: the question goes
     again without it, as words only */
  const words={...plain,messages:[body.messages[0],{role:'user',content:text}]};
  const {response}=await post(pictures.length?[body,plain,words]:[body,plain],signal,pictures.length>0);
  let total='';
  await readSSE(response,delta=>{
    const piece=typeof delta.content==='string'?delta.content:'';
    if(piece){total+=piece;onDelta(piece,total);}
  });
  return total;
}

/* ---- the trigger: "hey nota," at the start, question after ---- */
function distance(a,b){
  const m=a.length,n=b.length;let prev=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;}
  return prev[n];
}
/* handwriting is read loosely, a letter out either way; typing is exact,
   so "hey not" is not yet a call and nothing turns blue early */
function parseCall(text,strict){
  const s=String(text||'').replace(/[‘’]/g,"'").trim();
  const m=s.match(/^\s*([A-Za-z]+)[\s,.:;!]*([A-Za-z]+)[\s,.:;!\-]*([\s\S]*)$/);
  if(!m)return null;
  const a=m[1].toLowerCase(),b=m[2].toLowerCase().replace(/s$/,'');
  const slack=strict?0:1;
  if(distance(a,'hey')>slack||distance(b,'nota')>slack)return null;
  return {question:m[3].trim(),prefix:m[0].length-m[3].length};
}
/* how many characters of a line are the call itself, for painting it blue */
function callLength(text){
  const raw=String(text||''),lead=raw.length-raw.trimStart().length;
  const call=parseCall(raw,true);
  return call?lead+call.prefix:0;
}
function normalizeQ(q){return q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
const asked=new Set();
let busy=0;
function noteKey(){return (S.id||'')+'|';}

/* ---- handwriting: a transcript that starts with the call ---- */
const readings=new Map();      /* hash -> {text,confidence,group} for every reading, even quiet ones */
const pendingInk=new Map();    /* hash -> timer */
function onTranscript(item,group){
  if(!item||!group)return;
  readings.set(item.hash,{text:item.text,confidence:item.confidence,group});
  const call=parseCall(item.text);
  /* the maths reader's chip on the call goes; the call turns blue only once
     the whole question is taken, never while it is still being written */
  if(call&&item.confidence>=0.5)N.mathcore&&N.mathcore.run();
  if(item.asked)return;
  /* a row written under a call still waiting to be asked carries the
     question on, so the wait starts over from this row */
  if(!call||item.confidence<0.5){
    for(const [hash] of pendingInk){
      const head=readings.get(hash);
      if(head&&rowUnder(head.group,group))armInk(hash,item.text);
    }
    return;
  }
  armInk(item.hash,item.text);
}
/* the reading itself already waited for the pen to rest, so a question
   ending in "?" is taken almost at once; without one the hand gets a
   moment more to carry on */
function armInk(hash,text){
  if(pendingInk.has(hash))clearTimeout(pendingInk.get(hash));
  const delay=/\?\s*$/.test(text)?400:2200;
  pendingInk.set(hash,setTimeout(()=>fireInk(hash,0),delay));
}
/* whether a text group sits within a few rows below another, aligned with
   it; fireInk decides more strictly which rows join the question */
function rowUnder(above,below){
  const rowH=Math.max(12,above.bbox[3]-above.bbox[1]);
  return below.bbox[1]>above.bbox[1]&&below.bbox[1]-above.bbox[3]<=rowH*5&&Math.abs(below.bbox[0]-above.bbox[0])<=M.contentW*0.45;
}
function lastPenLift(){let t=0;for(const st of S.strokes)if(st.author==='user'&&st.t1>t)t=st.t1;return t;}
function answeredBelow(bbox,rowH){
  const top=bbox[3],bottom=bbox[3]+rowH*2.2;
  return S.strokes.some(st=>st.author==='ai'&&st.bbox[1]>=top-2&&st.bbox[1]<=bottom&&st.bbox[2]>=bbox[0]&&st.bbox[0]<=bbox[2]+M.contentW*0.5);
}
function fireInk(hash,tries){
  pendingInk.delete(hash);
  const r=readings.get(hash);if(!r)return;
  const groups=N.recog.textGroups();
  const mine=groups.find(g=>g.hash===hash);if(!mine)return;
  if(N.ink.drawing()||N.ink.now()-lastPenLift()<1500){
    if(tries<40)pendingInk.set(hash,setTimeout(()=>fireInk(hash,tries+1),600));
    return;
  }
  /* the rest of the question can wrap onto the rows below */
  const rowH=Math.max(12,mine.bbox[3]-mine.bbox[1]);
  const parts=[r.text],ids=new Set(mine.strokeIds),hashes=[hash];
  let bbox=mine.bbox.slice(),bottom=mine.bbox[3];
  for(const g of groups.filter(g=>g.bbox[1]>mine.bbox[1]).sort((a,b)=>a.bbox[1]-b.bbox[1])){
    if(g.bbox[1]-bottom>rowH*1.6)break;
    if(Math.abs(g.bbox[0]-mine.bbox[0])>M.contentW*0.45)break;
    const rr=readings.get(g.hash);
    if(!rr){ if(tries<12){pendingInk.set(hash,setTimeout(()=>fireInk(hash,tries+1),700));return;} break; }
    if(parseCall(rr.text))break;
    parts.push(rr.text);g.strokeIds.forEach(id=>ids.add(id));hashes.push(g.hash);
    bbox=[Math.min(bbox[0],g.bbox[0]),Math.min(bbox[1],g.bbox[1]),Math.max(bbox[2],g.bbox[2]),Math.max(bbox[3],g.bbox[3])];
    bottom=g.bbox[3];
  }
  const call=parseCall(parts.join(' '));
  if(!call||!call.question)return;
  const key=noteKey()+normalizeQ(call.question);
  if(asked.has(key))return;
  /* red ink already sitting under the question means it was answered before
     this page was reopened: the answer is on the paper, not in memory */
  if(hashes.some(h=>(S.textTranscripts||[]).some(t=>t.hash===h&&t.asked)))return;
  asked.add(key);
  /* taken: every stroke of the question, its wrapped rows too, turns blue */
  for(const id of ids)sentInk.add(id);
  N.ink.render();
  const noteId=S.id;
  const writer=Writer({x:bbox[0],y:bbox[3],right:bbox[2],rowH,skip:ids});
  answer(call.question,{x:bbox[0],y:bbox[1],below:bbox[3],skip:ids},writer).then(ok=>{
    if(!ok){asked.delete(key);for(const id of ids)sentInk.delete(id);N.ink.render();return;}
    if(S.id!==noteId)return;
    for(const h of hashes){const t=(S.textTranscripts||[]).find(t=>t.hash===h);if(t)t.asked=true;}
    C.markDirty();
  });
}

/* ---- asked outright: lassoed ink the page could not read, sent to nota ----
   The selection bar offers this when the maths reader made nothing of the
   circled strokes. The text reader reads them once as a line, and whatever
   the maths reader had is passed along; nota answers under the ink, in
   red, as it does a "hey nota" written on the page. */
let askingSelection=false;
async function askSelection(){
  const ids=(S.selection||[]).slice();
  if(!ids.length){C.toast('circle some handwriting with the lasso first.');return;}
  if(askingSelection||busy){C.toast('nota is still busy.');return;}
  /* the day's allowance is spent: the message goes under the circled ink,
     and nothing is read or asked */
  if(overloaded()){ const b=selectedBox(ids); if(b){ N.ink.clearSelection(); showOverloaded({x:b[0],y:b[3]}); } return; }
  if(!navigator.onLine){C.toast('nota needs a connection.');return;}
  if(!N.recog||!N.recog.readStrokesText){C.toast('enable handwriting in settings to ask nota.');return;}
  askingSelection=true;
  const selectedNote=S.id;
  const skip=new Set(ids);
  N.ink.clearSelection();
  C.status('nota is reading.');say('nota is reading…',true);
  /* a circled drawing is asked about as the drawing it is: its shapes,
     arrows and labels in words, not its strokes read as one line of text */
  const drawn=await readDrawings(new Set(),LABEL_WAIT,skip);
  if(S.id!==selectedNote){askingSelection=false;C.status('');unsay();return;}
  let inDrawing=0;for(const id of ids)if(drawn.some(d=>d.ids.has(id)))inDrawing++;
  if(drawn.length&&inDrawing>=ids.length*0.5){
    askingSelection=false;
    const box=selectedBox(ids);if(!box){C.status('');return;}
    const question='the person circled this drawing on the page and asked about it:\n'+drawn.map(d=>d.lines.join('\n')).join('\n')+
      '\nsay briefly what it shows, then help with it: answer it if it asks something, check it if it is working, explain the idea if it is a diagram from a lesson.';
    const rowH=Math.min(60,Math.max(12,window.NOTAS_DIAGRAM.heightOf(S.strokes.filter(st=>st.author==='user'))));
    const writer=Writer({x:box[0],y:box[3],right:box[2],rowH,skip});
    await answer(question,{x:box[0],y:box[1],below:box[3],skip,picture:box},writer);
    return;
  }
  let reading;
  try{reading=await N.recog.readStrokesText(ids);}
  catch(e){askingSelection=false;C.status('');unsay();C.toast(String(e.message||'nota could not read this.').toLowerCase());return;}
  askingSelection=false;
  if(S.id!==selectedNote){C.status('');unsay();return;}
  const text=reading.text&&reading.confidence>=0.2?reading.text:'';
  /* The maths reader reads everything as a formula, so words come out of it
     as nonsense ("hey nota" as =2y*y*y*y=), and that nonsense, handed to
     nota as a second opinion, was then explained as if it were on the page.
     It goes along only when it looks like maths and the text reader did not
     find words. */
  const words=text&&N.mathcore&&N.mathcore.readsAsProse?N.mathcore.readsAsProse(text):/[A-Za-z]{3,}/.test(text);
  const looksMaths=s=>N.mathcore&&N.mathcore.looksLikeMath?N.mathcore.looksLikeMath(s):/[0-9=+*\/^-]/.test(s);
  const maths=reading.maths&&(!text||reading.confidence<0.6||!words)&&looksMaths(reading.maths)?reading.maths:'';
  /* neither reader making anything of it is not the end of it: nota is
     sent a picture of what was circled and reads it there */
  const bbox=reading.bbox||selectedBox(ids),rowH=Math.min(60,Math.max(12,bbox[3]-bbox[1]));
  /* circled ink that is itself "hey nota, ..." is simply that question */
  const call=text&&parseCall(text);
  let question;
  if(call&&call.question)question=call.question;
  else{
    question='the person circled some handwriting the notebook could not read well; it is in the picture.';
    if(text)question+=' the text reader makes it: "'+text+'".';
    if(maths&&maths!==text)question+=' the maths reader makes it: "'+maths+'".';
    if(!text&&!maths)question+=' neither reader could make it out.';
    question+=' say what it most likely says, then deal with it: answer it if it is a question, work it out if it is maths, help with it if it is a list, a recipe, a note or a draft.';
  }
  const questionKey=call&&call.question?noteKey()+normalizeQ(call.question):null;
  if(questionKey)asked.add(questionKey);
  const writer=Writer({x:bbox[0],y:bbox[3],right:bbox[2],rowH,skip});
  /* a circled question is about the page round it, as a written one is;
     circled writing is itself what is asked about, and is what is sent */
  const where={x:bbox[0],y:bbox[1],below:bbox[3],skip};
  if(!questionKey)where.picture=bbox;
  if(!await answer(question,where,writer)&&questionKey)asked.delete(questionKey);
}
/* ---- typed: a line that starts with the call, answered as a red ghost ---- */
/* ink read as a call, finished or not: the maths reader leaves it alone */
function isCallStroke(id){
  if(overloaded())return false;
  return [...readings.values()].some(t=>t.confidence>=0.5&&parseCall(t.text)&&t.group.strokeIds.includes(id));
}
/* ink of a question nota has taken: painted the machine's blue */
const sentInk=new Set();
function isAskedStroke(id){ return sentInk.has(id)&&!overloaded(); }
const typedTimers=new Map(),typedRuns=new Map();
/* questions told once that they wait for the shared note's room */
const waitingRoom=new Set();
function onTyped(ln){
  if(!ln||ln.tutor)return;
  clearTimeout(typedTimers.get(ln.id));
  let run=typedRuns.get(ln.id);
  if(run&&!run.reply.alive()){
    run.abort(); typedRuns.delete(ln.id);
    asked.delete(noteKey()+'typed:'+ln.id+':'+normalizeQ(run.question)); run=null;
  }
  const call=parseCall(ln.text,true);
  /* the reply is part of the note; an edit to its question leaves it alone.
     Removing the call while the reply is still arriving stops it; a
     different question replaces the reply that stood for the old one */
  if(!call){ if(run&&!run.done){run.abort();typedRuns.delete(ln.id);} return; }
  if(run&&!run.failed&&normalizeQ(run.question)===normalizeQ(call.question))return;
  if(!call.question||call.question.split(/\s+/).length<2)return;
  const delay=/\?\s*$/.test(ln.text)?500:1500;
  typedTimers.set(ln.id,setTimeout(()=>fireTyped(ln.id),delay));
}
async function fireTyped(id){
  typedTimers.delete(id);
  const ln=S.lines.find(l=>l.id===id);if(!ln)return;
  const call=parseCall(ln.text,true);if(!call||!call.question)return;
  const key=noteKey()+'typed:'+id+':'+normalizeQ(call.question);
  if(asked.has(key))return;
  const noteId=S.id,question=normalizeQ(call.question);
  let claim;
  try{claim=N.collab?await N.collab.claimNota(id,question):{state:'claimed',finish:async()=>{}};}
  catch(e){C.toast(e.message);return;}
  if(S.id!==noteId||normalizeQ(parseCall(S.lines.find(l=>l.id===id)?.text||'',true)?.question||'')!==question){
    if(claim.state==='claimed')await claim.finish(false).catch(()=>{});
    return;
  }
  /* the shared note's room is out of its day too: no one can be asked */
  if(claim.state==='overloaded'){ showOverloaded(lineBottom(id)); return; }
  if(claim.state==='busy'||claim.state==='offline'){
    /* someone else is asking, or the shared note's room is not up to say
       who may: the question waits, and the page says which, once */
    if(claim.state==='offline'&&!waitingRoom.has(key)){ waitingRoom.add(key); C.status('nota waits for the shared note to reconnect.'); }
    clearTimeout(typedTimers.get(id));
    typedTimers.set(id,setTimeout(()=>fireTyped(id),claim.state==='offline'?2000:1000));
    return;
  }
  waitingRoom.delete(key);
  if(claim.state!=='claimed')return;
  asked.add(key);
  /* the lines of the previous reply to this question are reused when they
     are still on the page, so a reworded question rewrites them in place */
  const old=typedRuns.get(id);
  let reply=null;
  if(old){ old.superseded=true; old.abort(); typedRuns.delete(id); if(old.reply.alive()&&old.reply.reset())reply=old.reply; }
  if(!reply)reply=N.text.notaReply(id);
  if(!reply){await claim.finish(false).catch(()=>{});asked.delete(key);return;}
  const control=new AbortController(),run={question:call.question,abort:()=>control.abort(),done:false,superseded:false,answer:'',reply};
  typedRuns.set(id,run);
  const completed=await answer(call.question,{x:0,y:ln.y,lineId:id},{
    feed(piece){ if(control.signal.aborted)return; run.answer+=piece; if(!reply.update(tidy(run.answer).trim()))control.abort(); },
    /* the paper under the reply goes once the last word is in */
    finish(){ run.done=true; reply.done(); },
    /* nothing arrived, or the reply was cut short: the lines go too, unless a
       newer question has already taken them over */
    failed(){ run.failed=true;if(run.superseded)return;if(!run.answer.trim())reply.remove();else reply.done(); },
    get aborted(){return control.signal.aborted;}
  },control);
  run.done=completed;
  await claim.finish(completed).catch(()=>{});
  if(!run.done)asked.delete(key);
}

/* ---- waiting: a sheet of paper, drawn by hand, tips over, curls and comes
   back where the pen will start, while nota reads the page, fetches notes,
   thinks, and until its last word. The frames are one strip of white ink
   (assets/nota-thinking.png), painted in nota's red. The receipt and a typed
   reply's waiting line play the same strip as a CSS mask. ---- */
const THINK={src:'./assets/nota-thinking.png',frames:41,fps:12,w:104,h:81};
const thinkImg=new Image();
thinkImg.onload=()=>{ if(waiting)N.ink.renderAI(); };
thinkImg.src=THINK.src;
const thinkTint=new Map();
function thinkSheet(color){
  if(!thinkImg.complete||!thinkImg.naturalWidth)return null;
  let cv=thinkTint.get(color);
  if(!cv){
    cv=document.createElement('canvas');cv.width=thinkImg.naturalWidth;cv.height=thinkImg.naturalHeight;
    const c=cv.getContext('2d');c.drawImage(thinkImg,0,0);
    c.globalCompositeOperation='source-in';c.fillStyle=color;c.fillRect(0,0,cv.width,cv.height);
    thinkTint.set(color,cv);
  }
  return cv;
}
function thinkFrame(t0){ return C.reducedMotion()?0:Math.floor((performance.now()-t0)*THINK.fps/1000)%THINK.frames; }
(function(){
  /* the strip's own rules (.nota-think, the typed reply's waiting line) are
     in notas.html beside the reply's red */
  const s=document.createElement('style');
  s.textContent='#nota-receipt{display:flex;align-items:center;gap:8px}#nota-receipt[hidden]{display:none}';
  document.head.appendChild(s);
})();
const receipt=document.createElement('div');
receipt.id='nota-receipt'; receipt.setAttribute('role','status'); receipt.setAttribute('aria-live','polite');
receipt.style.cssText='position:fixed;bottom:100px;left:50%;transform:translateX(-50%);padding:8px 16px 8px 12px;border-radius:20px;background:var(--paper);color:var(--blue);box-shadow:0 2px 12px #0002;font:500 14px var(--ui);z-index:40;pointer-events:none';
const receiptMark=document.createElement('span'),receiptText=document.createElement('span');
receiptMark.className='nota-think';receiptMark.setAttribute('aria-hidden','true');
receipt.append(receiptMark,receiptText);
receipt.hidden=true; document.body.appendChild(receipt);
/* the mark plays while nota is reading or thinking, and stops once it writes */
function say(text,thinking){ receiptText.textContent=text; receiptMark.hidden=!thinking; receipt.hidden=false; }
function unsay(){ if(!busy)receipt.hidden=true; }
/* Written answers: the paper stands where the first word will go, then
   under the bottom left of the answer as the hand writes it, and goes when
   the last stroke is drawn. */
let waiting=null,waitFrame=0;
const WAIT_FADE_MS=450;
function showWaiting(writer){
  cancelAnimationFrame(waitFrame);
  waiting={writer,origin:writer.origin,t0:performance.now(),done:false,fade:0};
  /* the AI layer is redrawn only when the frame changes, not every display
     frame; while the hand writes, its own redraws move the paper along.
     While it fades out, every frame. */
  let shown=-1;
  const tick=()=>{
    if(!waiting)return;
    if(waiting.done&&!waiting.writer.drawing&&!waiting.fade)waiting.fade=performance.now();
    if(waiting.fade){
      if(performance.now()-waiting.fade>=WAIT_FADE_MS){hideWaiting();return;}
      N.ink.renderAI();
    }else{
      const f=thinkFrame(waiting.t0);
      if(f!==shown){shown=f;N.ink.renderAI();}
    }
    waitFrame=C.reducedMotion()?0:requestAnimationFrame(tick);
  };
  tick();
}
/* the answer is written: the paper fades out, still turning, rather than
   vanishing */
function fadeWaiting(){
  if(!waiting)return;
  if(C.reducedMotion()){hideWaiting();return;}
  if(!waiting.fade)waiting.fade=performance.now();
}
function hideWaiting(){
  if(!waiting)return;
  waiting=null;cancelAnimationFrame(waitFrame);N.ink.renderAI();
}
/* the answer is in: the paper stays until the hand has written it all out
   and then fades, or goes now when nothing was written */
function endWaiting(wrote){
  if(!waiting)return;
  if(!wrote)hideWaiting();
  else if(!waiting.writer.drawing)fadeWaiting();
  else waiting.done=true;
}
function drawWaiting(ctx){
  if(!waiting)return;
  const sheet=thinkSheet(N.ink.colors.red);if(!sheet)return;
  /* the sheet (inside its frame's margin) about a capital's height: on the
     line the first word will sit on, then
     just under the lowest row written so far, at the answer's left edge */
  const tail=waiting.writer.tail,o=waiting.origin,u=o.unit,h=Math.max(20,32*u),w=h*THINK.w/THINK.h;
  const x=tail?tail.x-3*u:o.x-3*u,top=tail?tail.y+2*u:o.y+(BASE+6)*u-h;
  const t=waiting.fade?Math.min(1,(performance.now()-waiting.fade)/WAIT_FADE_MS):0;
  if(t>=1)return;
  ctx.save();ctx.globalAlpha*=1-t*t*(3-2*t);
  ctx.drawImage(sheet,thinkFrame(waiting.t0)*THINK.w,0,THINK.w,THINK.h,x,top,w,h);
  ctx.restore();
}

/* ---- one answer, wherever it goes ---- */
/* where the high-load message goes: under the question */
function lineBottom(id){
  const ln=S.lines.find(l=>l.id===id); if(!ln)return null;
  return {x:2,y:ln.y+Math.max(C.LINE_H,ln.h||C.LINE_H),lineId:id};
}
function messageAt(where){ return where.lineId?lineBottom(where.lineId):{x:where.x,y:where.below!=null?where.below:where.y}; }
function selectedBox(ids){
  let b=null;
  for(const st of S.strokes)if(ids.includes(st.id)&&st.bbox)b=b?[Math.min(b[0],st.bbox[0]),Math.min(b[1],st.bbox[1]),Math.max(b[2],st.bbox[2]),Math.max(b[3],st.bbox[3])]:st.bbox.slice();
  return b;
}

const LABEL_WAIT=2500;
async function answer(question,where,writer,control){
  if(!navigator.onLine){C.toast('nota needs a connection.');writer.failed?.();return false;}
  if(holdBack()){writer.failed?.();showOverloaded(messageAt(where));return false;}
  control=control||new AbortController();
  let timedOut=false,timer;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;control.abort();},CONFIG.timeoutMs);};
  arm();
  busy++;C.status('nota is thinking.');
  say('got it — nota is thinking…',true);
  if(!where.lineId&&writer.origin)showWaiting(writer);
  let text='',complete=false;
  try{
    /* the drawings' labels the page has not read yet are read now, for a
       couple of seconds at most, while the paper turns over */
    const drawings=await readDrawings(where.skip||new Set(),LABEL_WAIT);
    const context=pageRows({...where,diagrams:drawings});
    let picture=null;try{picture=await pagePicture(where,drawings);}catch(e){console.warn('nota: no picture of the page',e);}
    if(writer.aborted||control.signal.aborted)throw new DOMException('Question withdrawn','AbortError');
    const feed=piece=>{
      if(writer.aborted){control.abort();return;}
      arm();
      if(!text&&overloaded())setOverloaded(false);
      text+=piece;writer.feed(piece);C.status('nota is writing.');say('nota is writing…',false);
    };
    /* while notes are fetched, the paper keeps turning and the words say so */
    const grab=()=>{arm();C.status(GRAB_TEXT);say(GRAB_TEXT,true);};
    /* the model asks for the notes it needs (see NOTE_TOOLS) */
    await stream(question,context,feed,control.signal,picture,{onGrab:grab});
    if(!text.trim())throw Error('nota returned an empty answer. try again.');
    if(!writer.aborted){writer.finish();complete=true;}
  }catch(e){
    // Flush buffered words before reporting a stalled or broken stream.
    if(text.trim()&&(!writer.aborted||timedOut))writer.finish();
    if(e.overloaded){setOverloaded(true);showOverloaded(messageAt(where));}
    /* calls of the notes tools that failed end the question quietly */
    else if(e.toolsFailed)console.warn(e.message,e.cause||'');
    else if(timedOut)C.toast('nota timed out. try again.');
    else if(e.name!=='AbortError')C.toast(String(e.message||'nota could not answer.').toLowerCase());
  }finally{
    clearTimeout(timer);busy--;endWaiting(!!text.trim()&&!writer.aborted);C.status('');
    unsay();
    if(!complete)writer.failed?.();
  }
  return complete;
}

/* A circled drawing is offered to nota too. The bar offers "ask nota" for
   ink the maths reader made nothing of, but it makes something of most
   arrows and boxes, so that alone would hide the button for a drawing. The
   answer is kept for the selection, as the bar asks on every change. */
if(N.recog&&N.recog.selectionUnread){
  const unread=N.recog.selectionUnread;let last={key:'',drawing:false};
  N.recog.selectionUnread=ids=>{
    if(unread(ids))return true;
    const key=S.id+'|'+labelKey(ids);
    if(last.key!==key){
      const found=findDrawings(null,new Set(ids));
      last={key,drawing:!!(found&&found.diagrams.some(d=>d.strokeIds.length>=ids.length*0.5))};
    }
    return last.drawing;
  };
}

N.nota={overloaded,tools:NOTE_TOOLS,isCallStroke,isAskedStroke,drawings:readDrawings,onTranscript,onTyped,askSelection,parseCall,callLength,drawWaiting,mathMatches,tidy,spell,Writer,get busy(){return busy>0;},get writing(){return queue.length;},config:CONFIG,
  /* the page as nota reads it, for the console: N.nota.context() */
  context(where){ where=where||liveWhere(); return pageRows({...where,diagrams:knownDrawings(where.skip)}); }};
})();
