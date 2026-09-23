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
  model:'gpt-oss-120b',
  key:'csk-PASTE-YOUR-KEY-HERE',
  proxy:'./nota/chat',
  maxTokens:420,
  timeoutMs:45000,
  /* gpt-oss thinks before it writes; low keeps the pause short, and the
     thinking never reaches the page, only the answer does */
  extras:{reasoning_effort:'low'}
};
function apiKey(){
  try{ const k=localStorage.getItem('notas.nota.key'); if(k)return k; }catch(e){}
  return CONFIG.key;
}
function hasKey(){ const k=apiKey(); return k.length>12&&!/PASTE/.test(k); }

const SYSTEM=[
  'You are nota, the red pen inside a handwritten notebook. The notebook is used for anything: maths and science homework, recipes, shopping and to-do lists, notes from a lesson or a meeting, a diary, plans, drafts of writing, languages.',
  'The person wrote or typed "hey nota," followed by a question on the page, or circled some handwriting and asked about it. The page contents are given as rows in reading order; "this" or "that" or "it" means the nearest thing above or beside the question: a sum, a list, a paragraph, a recipe, whatever is there.',
  'Answer whatever is asked: work out or check maths, explain an idea, suggest what to cook with what is listed and how, convert units or currencies, fix spelling or grammar, translate, summarise the notes, plan the steps, define a word, give a fact. Be accurate; if you are not sure, say so briefly.',
  'Answer in plain text only: no markdown, no bullets, no LaTeX, no code fences, no emoji, no headings. Write maths in plain notation such as 2x + 3 = 11, sqrt(16), 3/4, 2^3, 12 x 7. Use only plain letters, digits and punctuation, since the answer is handwritten onto the page.',
  'Be brief: one to three short sentences, at most about 45 words, unless the person asks for the full working, the steps, a list or a recipe, then give short numbered lines, one per line.',
  'Do not repeat the question. Do not greet. Do not say "hey nota". Give the answer first, then a short reason if it helps.',
  'If the question is not about anything on the page, answer it anyway, briefly. If the page does not contain what "this" refers to, say what you would need.'
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
    out+=[...plain].every(c=>GLYPHS.has(c))?plain:'';
  }
  return out.replace(/ {2,}/g,' ');
}
function wordWidth(word,unit){
  let w=0;
  for(const ch of word){ const g=GLYPHS.get(ch); w+=(g?g.w:SPACE_W)*unit; }
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

function obstacles(skip){
  const out=[];
  for(const st of S.strokes)if(st.author==='user'&&!skip.has(st.id))out.push(st.bbox);
  for(const ln of S.lines)if(ln.text&&ln.text.trim())out.push([0,ln.y,M.contentW,ln.y+Math.max(C.LINE_H,ln.h||C.LINE_H)]);
  for(const im of S.images)out.push([im.x,im.y,im.x+im.w,im.y+im.h]);
  return out;
}
function Writer(anchor){
  /* anchor: {x,y,rowH,skip} - the question's left edge, its bottom, the
     height of its handwriting and the stroke ids that are the question */
  const unit=Math.max(0.7,Math.min(1.25,(anchor.rowH*0.62)/(BASE-CAP)));
  const rowPx=ROW*unit,gap=Math.max(6,anchor.rowH*0.3);
  const x0=Math.max(8,anchor.x),maxW=Math.max(160,M.contentW-x0-10);
  const rnd=wobble(Math.round(anchor.x*7+anchor.y*13));
  const blocks=obstacles(anchor.skip||new Set());
  const list=[];let registered=false,aborted=false;
  const cursor={x:x0,y:0};
  const clearRow=(y)=>{
    /* a row must not cross the student's own work: drop below anything in the way */
    for(let guard=0;guard<24;guard++){
      const top=y+CAP*unit,bottom=y+(BASE+12)*unit;let hit=null;
      for(const b of blocks){
        if(b[2]<x0||b[0]>x0+maxW||b[3]<top||b[1]>bottom)continue;
        if(!hit||b[3]>hit)hit=b[3];
      }
      if(hit===null)return y;
      y=hit+gap-CAP*unit;
    }
    return y;
  };
  cursor.y=clearRow(anchor.y+gap-CAP*unit);
  const newRow=()=>{cursor.x=x0;cursor.y=clearRow(cursor.y+rowPx);};
  const t=N.ink.now();
  const place=(st)=>{
    if(aborted)return;
    if(!registered){
      registered=true;
      C.act('nota',()=>{const have=new Set(S.strokes.map(s=>s.id));for(const s of list)if(!have.has(s.id))S.strokes.push(s);},
                    ()=>{const ids=new Set(list.map(s=>s.id));S.strokes=S.strokes.filter(s=>!ids.has(s.id));aborted=true;});
    }
    list.push(st);S.strokes.push(st);
    if(C.reducedMotion()){N.ink.render();}
    else{st._show=0;queue.push({st,at:0,left:lengthOf(st.pts)});animate();}
    C.growDoc(st.bbox[3]);C.markDirty();
  };
  const glyph=(ch)=>{
    const g=GLYPHS.get(ch);if(!g)return;
    const base=cursor.y+rnd()*0.8*unit;
    for(const s of g.strokes){
      const pts=[];
      for(let i=0;i<s.length;i+=2){
        pts.push(Math.round((cursor.x+(s[i]-g.l)*unit+rnd()*0.5*unit)*10)/10,
                 Math.round((base+s[i+1]*unit+rnd()*0.5*unit)*10)/10,
                 Math.round((0.5+rnd()*0.16)*100)/100);
      }
      const st={id:C.uid(),author:'ai',tool:'pen',w:3,pts,t0:t,t1:t};
      st.bbox=N.ink.bboxOf(pts);
      place(st);
    }
    cursor.x+=g.w*unit;
  };
  let raw='',written=0;
  const word=(w)=>{
    if(!w)return;
    const width=wordWidth(w,unit);
    if(cursor.x>x0&&cursor.x+width>x0+maxW)newRow();
    for(const ch of w)glyph(ch);
  };
  /* markup is stripped from the whole reply so far, and only words that a
     space or a line break has closed are written: a half-received token is
     never on the page */
  const commit=(final)=>{
    const clean=tidy(raw),text=clean.slice(written);
    let upto=final?text.length:Math.max(text.lastIndexOf(' '),text.lastIndexOf('\n'))+1;
    if(upto<=0)return;
    const done=spell(text.slice(0,upto));written+=upto;
    for(const piece of done.split(/(\n| )/)){
      if(piece==='\n')newRow();
      else if(piece===' '){if(cursor.x>x0)cursor.x+=SPACE_W*unit;}
      else word(piece);
    }
  };
  return {
    /* where the first word will land, for the waiting dots */
    get origin(){return {x:cursor.x,y:cursor.y,unit};},
    feed(text){if(aborted)return;raw+=text;commit(false);},
    finish(){if(aborted)return;commit(true);},
    get aborted(){return aborted;},
    get count(){return list.length;}
  };
}

/* ---- the model ---- */
const TEX={le:'<=',leq:'<=',ge:'>=',geq:'>=',ne:'!=',neq:'!=',pm:'+/-',mp:'-/+',infty:'infinity',approx:'~',equiv:'==',circ:' deg',degree:' deg',ldots:'...',cdots:'...',dots:'...',to:'->',rightarrow:'->',Rightarrow:'=>',leftarrow:'<-',implies:'=>',iff:'<=>',in:' in ',notin:' not in ',angle:'angle ',perp:' perpendicular to ',parallel:' parallel to ',therefore:'therefore ',because:'because ',sum:'sum',int:'integral',prod:'product',
  sin:'sin',cos:'cos',tan:'tan',sec:'sec',csc:'csc',cot:'cot',arcsin:'arcsin',arccos:'arccos',arctan:'arctan',sinh:'sinh',cosh:'cosh',tanh:'tanh',log:'log',ln:'ln',lg:'lg',exp:'exp',min:'min',max:'max',mod:' mod ',lim:'lim',deg:'deg',
  alpha:'alpha',beta:'beta',gamma:'gamma',delta:'delta',epsilon:'epsilon',varepsilon:'epsilon',zeta:'zeta',eta:'eta',theta:'theta',vartheta:'theta',iota:'iota',kappa:'kappa',lambda:'lambda',mu:'mu',nu:'nu',xi:'xi',pi:'pi',rho:'rho',sigma:'sigma',tau:'tau',upsilon:'upsilon',phi:'phi',varphi:'phi',chi:'chi',psi:'psi',omega:'omega',
  Gamma:'Gamma',Delta:'Delta',Theta:'Theta',Lambda:'Lambda',Xi:'Xi',Pi:'Pi',Sigma:'Sigma',Phi:'Phi',Psi:'Psi',Omega:'Omega'};
function tidy(text){
  return String(text)
    .replace(/\\\(|\\\)|\\\[|\\\]|\$\$?/g,'')
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
function pageRows(question){
  /* the notebook as rows in reading order, with a marker where the question
     is. Only what the calculator has read: prose ink joins through its
     search transcript. The tutor's own lines and strokes stay out. */
  const rows=[];
  const skip=question.skip||new Set();
  for(const n of S.nodes||[]){
    if(!n.src||!String(n.src).trim())continue;
    if(n.kind==='line'&&n.ref&&n.ref.tutor)continue;
    if(n.kind==='line'&&question.lineId===n.id)continue;
    if(n.kind==='cluster'&&n.ref&&n.ref.strokeIds&&n.ref.strokeIds.some(id=>skip.has(id)))continue;
    if(n.kind==='cluster'&&n.ref&&n.ref.review)continue;
    let text=String(n.src).trim();
    if(n.result&&!n.stated)text+='   [= '+n.result+']';
    if(n.error&&n.kind==='cluster')continue;
    rows.push({y:n.y,x:n.x||0,text});
  }
  const groups=N.recog&&N.recog.textGroups?N.recog.textGroups():[];
  const byHash=new Map((S.textTranscripts||[]).map(t=>[t.hash,t.text]));
  for(const g of groups){
    if(g.strokeIds.some(id=>skip.has(id)))continue;
    const text=byHash.get(g.hash);if(!text)continue;
    rows.push({y:g.bbox[1],x:g.bbox[0],text:'"'+text+'"'});
  }
  rows.push({y:question.y,x:question.x,marker:true});
  rows.sort((a,b)=>(Math.round(a.y/24)-Math.round(b.y/24))||(a.x-b.x));
  const at=rows.findIndex(r=>r.marker);
  const near=rows.filter((r,i)=>Math.abs(i-at)<=40);
  return near.map(r=>r.marker?'>>> the question is written here':r.text).join('\n');
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
  debugShow('nota context, live ('+CONFIG.model+' via '+CONFIG.proxy+')',pageRows(liveWhere())||'(empty page)');
}
if(DEBUG_CONTEXT){
  setInterval(()=>{ try{debugLive();}catch(e){} },1000);
  console.info('nota: ?debug=context is on; N.nota.context() returns the page as nota reads it');
}
async function stream(question,context,onDelta,signal){
  const body={
    model:CONFIG.model,stream:true,max_tokens:CONFIG.maxTokens,temperature:0.3,
    messages:[{role:'system',content:SYSTEM},{role:'user',content:'Page, in reading order:\n'+(context||'(empty page)')+'\n\nQuestion: '+question}],
    ...CONFIG.extras
  };
  if(DEBUG_CONTEXT){
    debugSent=body.messages.map(m=>'['+m.role+']\n'+m.content).join('\n\n');
    debugShow('nota request, sent '+new Date().toLocaleTimeString()+' ('+body.model+', max_tokens '+body.max_tokens+', temperature '+body.temperature+')',debugSent);
    console.info('nota request',body);
    /* the live view comes back a while after, so the next question's page can be watched */
    clearTimeout(debugHold);debugHold=setTimeout(()=>{debugSent='';},30000);
  }
  const plain={...body};for(const k of Object.keys(CONFIG.extras||{}))delete plain[k];
  let response=null,error=null;
  /* the proxy is tried first and the provider when it is unreachable or
     absent (a plain file server has no such route, and a proxy without a
     key answers 501); an answer with a status, such as a refused key, is
     final. A 400 is retried once without the extras some servers reject.
     The page's own key travels only when it has one, so the proxy's key is
     never overridden by the placeholder. */
  for(const url of [CONFIG.proxy,CONFIG.url]){
    if(url===CONFIG.url&&!hasKey()){error=new Error('nota needs a key. add it in nota.js.');break;}
    let unreachable=false;
    const headers={'Content-Type':'application/json','Accept':'text/event-stream'};
    if(hasKey())headers.Authorization='Bearer '+apiKey();
    for(const payload of [body,plain]){
      try{
        response=await fetch(url,{method:'POST',signal,headers,body:JSON.stringify(payload)});
      }catch(e){ if(e.name==='AbortError')throw e; error=e;response=null;unreachable=true;break; }
      if(response.ok)break;
      if(url===CONFIG.proxy&&[404,405,501].includes(response.status)){response=null;unreachable=true;break;}
      /* the forward explains itself in a line of plain text (a call from
         another site, no key, the model out of reach); that is shown as it
         is, rather than guessed from the status */
      let said='';
      if(/^text\/plain/i.test(response.headers.get('content-type')||'')){ try{ said=(await response.text()).trim().slice(0,140); }catch(e){} }
      error=new Error(said||(response.status===401||response.status===403?'nota\'s key was refused.':'nota could not answer ('+response.status+').'));
      if(response.status!==400){response=null;break;}
      response=null;
    }
    if(response||!unreachable)break;
  }
  if(!response)throw error||new Error('nota could not reach the model.');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',total='';
  for(;;){
    const {value,done}=await reader.read();
    if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    let nl;
    while((nl=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);
      if(!line.startsWith('data:'))continue;
      const data=line.slice(5).trim();
      if(data==='[DONE]')return total;
      let json;try{json=JSON.parse(data);}catch(e){continue;}
      const delta=json.choices&&json.choices[0]&&json.choices[0].delta;
      const piece=delta&&typeof delta.content==='string'?delta.content:'';
      if(piece){total+=piece;onDelta(piece,total);}
    }
  }
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
  if(call&&item.confidence>=0.5)N.ink.render();
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
function armInk(hash,text){
  if(pendingInk.has(hash))clearTimeout(pendingInk.get(hash));
  const delay=/\?\s*$/.test(text)?1200:3500;
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
    if(tries<20)pendingInk.set(hash,setTimeout(()=>fireInk(hash,tries+1),1200));
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
    if(!rr){ if(tries<6){pendingInk.set(hash,setTimeout(()=>fireInk(hash,tries+1),1500));return;} break; }
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
  if(answeredBelow(bbox,rowH))return;
  asked.add(key);
  for(const h of hashes){const t=(S.textTranscripts||[]).find(t=>t.hash===h);if(t)t.asked=true;}
  C.markDirty();
  const writer=Writer({x:bbox[0],y:bbox[3],rowH,skip:ids});
  answer(call.question,{x:bbox[0],y:bbox[1],skip:ids},writer);
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
  if(!navigator.onLine){C.toast('nota needs a connection.');return;}
  if(!N.recog||!N.recog.readStrokesText){C.toast('enable handwriting in settings to ask nota.');return;}
  askingSelection=true;
  const skip=new Set(ids);
  N.ink.clearSelection();
  C.status('nota is reading.');
  let reading;
  try{reading=await N.recog.readStrokesText(ids);}
  catch(e){askingSelection=false;C.status('');C.toast(String(e.message||'nota could not read this.').toLowerCase());return;}
  askingSelection=false;
  const text=reading.text&&reading.confidence>=0.2?reading.text:'',maths=reading.maths||'';
  /* the text reader failing is not the end of it while the maths reader
     had something; with neither, say which */
  if(!text&&!maths){C.status('');C.toast(reading.error?String(reading.error).toLowerCase():'nota could not read this either. try writing it larger, or type it.');return;}
  let question='the person circled some handwriting the notebook could not read well.';
  if(text)question+=' the text reader makes it: "'+text+'".';
  if(maths&&maths!==text)question+=' the maths reader makes it: "'+maths+'".';
  question+=' say what it most likely says, then deal with it: answer it if it is a question, work it out if it is maths, help with it if it is a list, a recipe, a note or a draft.';
  const bbox=reading.bbox,rowH=Math.min(60,Math.max(12,bbox[3]-bbox[1]));
  const writer=Writer({x:bbox[0],y:bbox[3],rowH,skip});
  await answer(question,{x:bbox[0],y:bbox[1],skip},writer);
}
/* ---- typed: a line that starts with the call, answered as a red ghost ---- */
function isCallStroke(id){
  return [...readings.values()].some(t=>t.confidence>=0.5&&parseCall(t.text)&&t.group.strokeIds.includes(id));
}
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
  if(run&&normalizeQ(run.question)===normalizeQ(call.question))return;
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
  await answer(call.question,{x:0,y:ln.y,lineId:id},{
    feed(piece){ if(control.signal.aborted)return; run.answer+=piece; if(!reply.update(tidy(run.answer).trim()))control.abort(); },
    finish(){ run.done=true; },
    /* nothing arrived, or the reply was cut short: the lines go too, unless a
       newer question has already taken them over */
    failed(){ if(!run.superseded)reply.remove(); },
    get aborted(){return control.signal.aborted;}
  },control);
  await claim.finish(run.done).catch(()=>{});
  if(!run.done)asked.delete(key);
}

/* ---- waiting: three dots where the pen will start, until the first word ---- */
const receipt=document.createElement('div');
receipt.id='nota-receipt'; receipt.setAttribute('role','status'); receipt.setAttribute('aria-live','polite');
receipt.style.cssText='position:fixed;bottom:100px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:20px;background:var(--paper);color:var(--blue);box-shadow:0 2px 12px #0002;font:500 14px var(--ui);z-index:40;pointer-events:none';
receipt.hidden=true; document.body.appendChild(receipt);
let waiting=null,waitFrame=0;
function showWaiting(origin){
  waiting={...origin,t0:performance.now()};
  const tick=()=>{ if(!waiting)return; N.ink.renderAI(); waitFrame=C.reducedMotion()?0:requestAnimationFrame(tick); };
  tick();
}
function hideWaiting(){
  if(!waiting)return;
  waiting=null;cancelAnimationFrame(waitFrame);N.ink.renderAI();
}
function drawWaiting(ctx){
  if(!waiting)return;
  const r=Math.max(1.6,waiting.unit*2),gap=r*3.2,y=waiting.y+BASE*waiting.unit-r*1.2;
  const phase=C.reducedMotion()?0:(performance.now()-waiting.t0)/900;
  ctx.save();ctx.fillStyle=N.ink.colors.red;
  for(let i=0;i<3;i++){
    const a=C.reducedMotion()?0.55:0.3+0.5*(0.5+0.5*Math.sin((phase-i*0.18)*Math.PI*2));
    ctx.globalAlpha=a;ctx.beginPath();ctx.arc(waiting.x+r+i*gap,y,r,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

/* ---- one answer, wherever it goes ---- */
async function answer(question,where,writer,control){
  if(!navigator.onLine){C.toast('nota needs a connection.');if(writer.failed)writer.failed();return;}
  control=control||new AbortController();
  const timer=setTimeout(()=>control.abort(),CONFIG.timeoutMs);
  busy++;C.status('nota is thinking.');
  receipt.textContent='got it — nota is thinking…'; receipt.hidden=false;
  if(!where.lineId&&writer.origin)showWaiting(writer.origin);
  let text='';
  try{
    await stream(question,pageRows(where),(piece)=>{
      if(writer.aborted){control.abort();return;}
      if(!text)hideWaiting();
      text+=piece;
      writer.feed(piece);
      C.status('nota is writing.');
      receipt.textContent='nota is writing…';
    },control.signal);
    if(text&&!writer.aborted)writer.finish();
  }catch(e){
    if(e.name!=='AbortError'){C.toast(String(e.message||'nota could not answer.').toLowerCase());}
  }finally{
    clearTimeout(timer);busy--;hideWaiting();
    if(!busy)receipt.hidden=true;
    if((!text||writer.aborted)&&writer.failed)writer.failed();
  }
}

N.nota={isCallStroke,onTranscript,onTyped,askSelection,parseCall,callLength,drawWaiting,tidy,spell,Writer,get busy(){return busy>0;},get writing(){return queue.length;},config:CONFIG,
  /* the page as nota reads it, for the console: N.nota.context() */
  context(where){ return pageRows(where||liveWhere()); }};
})();
