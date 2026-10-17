/* Fonts are device preferences. Answers remain ordinary saved ink, so they
   still export, erase, undo and travel to another device without the font. */
(function(){
'use strict';
const N=window.N,C=N.core,S=C.S;
const presets=[
  {id:'',name:'nota original',css:''},
  {id:'caveat',name:'Caveat',css:'600 28px "Nota Caveat"',file:'./assets/fonts/fonts-WnznHAc5bAfYB2QRah7pcpNvOx-pjSx6SII.ttf',family:'Nota Caveat',weight:'600'},
  {id:'plex',name:'IBM Plex Mono',css:'400 28px "Nota Plex"',file:'./assets/fonts/fonts--F63fjptAgt5VM-kVkqdyU8n5ig.ttf',family:'Nota Plex'},
  {id:'serif',name:'serif',css:'28px Georgia, serif'},
  {id:'sans',name:'sans serif',css:'28px "Segoe UI", sans-serif'}
];
let custom=[],initializing;
const faces=new Map(),glyphs=new Map();
const find=id=>[...presets,...custom].find(f=>f.id===id)||presets[0];
async function load(font){
  if(!font.family||faces.has(font.id))return;
  const face=new FontFace(font.family,font.bytes||'url('+font.file+')',{weight:font.weight||'400'});
  await face.load();document.fonts.add(face);faces.set(font.id,face);
}
async function select(id){
  const font=find(id);await load(font);S.settings.notaFont=font.id;C.savePrefs();return font;
}
function init(){
  return initializing||(initializing=(async()=>{
    try{
      const saved=await idbKeyval.get('notas.fonts');
      if(Array.isArray(saved))custom=saved.filter(f=>/^custom-[\w-]+$/.test(f?.id)&&f.bytes instanceof ArrayBuffer&&f.bytes.byteLength<=10*1024*1024).slice(0,16)
        .map(f=>({id:f.id,name:String(f.name).slice(0,100),bytes:f.bytes,family:'Nota-'+f.id,css:'28px "Nota-'+f.id+'"'}));
    }catch(e){}
    try{await load(find(S.settings.notaFont||''));}
    catch(e){C.toast('nota’s font could not load. using the original hand.');}
  })());
}
async function importFont(file){
  await init();
  if(!/\.(?:ttf|otf|woff2?)$/i.test(file.name))throw Error('choose a ttf, otf, woff or woff2 font.');
  if(file.size>10*1024*1024)throw Error('choose a font smaller than 10 MB.');
  if(custom.length>=16)throw Error('remove an imported font before adding another.');
  const id='custom-'+C.uid().replace(/[^\w-]/g,''),family='Nota-'+id;
  const font={id,name:file.name.replace(/\.[^.]+$/,'').slice(0,100),bytes:await file.arrayBuffer(),family,css:'28px "'+family+'"'};
  try{await load(font);}catch(e){throw Error('that file could not be read as a font.');}
  try{await idbKeyval.set('notas.fonts',[...custom,font]);}
  catch(e){document.fonts.delete(faces.get(id));faces.delete(id);throw Error('the font could not be saved on this device.');}
  custom.push(font);await select(id);return font;
}
async function remove(id){
  if(!custom.some(f=>f.id===id))return;
  const kept=custom.filter(f=>f.id!==id);await idbKeyval.set('notas.fonts',kept);custom=kept;
  if(S.settings.notaFont===id)await select('');
  if(faces.has(id)){document.fonts.delete(faces.get(id));faces.delete(id);}
  for(const key of glyphs.keys())if(key.startsWith(id+'\0'))glyphs.delete(key);
}
// Rasterize once per character and face, into the same short pen runs used
// for Unicode by the original hand. No font file is embedded in a note.
function glyph(ch,id){
  const font=find(id);if(!font.id||(font.family&&!faces.has(font.id)))return null;
  const key=font.id+'\0'+ch;if(glyphs.has(key))return glyphs.get(key);
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.font=font.css;
  // Normalize unusually tall fonts to the writer's cap height; keep wide
  // glyphs (CJK, ligatures) rather than clipping them to a fixed canvas.
  const size=28*Math.min(1,22/Math.max(1,ctx.measureText('M').actualBoundingBoxAscent));
  const css=font.css.replace('28px',size+'px');ctx.font=css;const metrics=ctx.measureText(ch);
  const left=Math.max(0,Math.ceil(metrics.actualBoundingBoxLeft||0));
  canvas.width=Math.min(512,Math.max(8,Math.ceil(Math.max(metrics.width,metrics.actualBoundingBoxRight||0)+left+6)));
  canvas.height=80;ctx.font=css;ctx.fillStyle='#000';ctx.fillText(ch,left+2,45);
  const pixels=ctx.getImageData(0,0,canvas.width,80).data,strokes=[];
  let previous=[];
  for(let y=0;y<80;y++){
    const runs=[],used=new Set();
    for(let x=0;x<canvas.width;){
      if(pixels[(y*canvas.width+x)*4+3]<96){x++;continue;}
      const start=x;while(x<canvas.width&&pixels[(y*canvas.width+x)*4+3]>=96)x++;
      // Join adjacent scanlines inside each connected part of the letter.
      // This keeps the exact filled face with a handful of ink strokes per
      // glyph instead of hundreds of individual horizontal strokes.
      const above=previous.filter(r=>!used.has(r.path)&&r.end>start&&x>r.start)
        .sort((a,b)=>(Math.min(b.end,x)-Math.max(b.start,start))-(Math.min(a.end,x)-Math.max(a.start,start)))[0];
      const path=above?above.path:[];
      if(above)used.add(path);else strokes.push(path);
      const a=(start-left-2)*.75,b=(x-left-2)*.75,v=(y-45)*.75+9;
      if(path.length&&Math.abs(path[path.length-2]-b)<Math.abs(path[path.length-2]-a))path.push(b,v,a,v);
      else path.push(a,v,b,v);
      runs.push({start,end:x,path});
    }
    previous=runs;
  }
  const result={l:0,w:(metrics.width+2)*.75,strokes,raster:true};
  if(glyphs.size>=1024)glyphs.delete(glyphs.keys().next().value);
  glyphs.set(key,result);return result;
}
function mount(box){
  const selectEl=box.querySelector('#nota-font'),preview=box.querySelector('#nota-font-preview'),removeEl=box.querySelector('#nota-font-remove');
  const render=()=>{
    selectEl.replaceChildren(...[...presets,...custom].map(f=>{const o=document.createElement('option');o.value=f.id;o.textContent=f.name;return o;}));
    selectEl.value=find(S.settings.notaFont).id;
    preview.style.font=find(selectEl.value).css||'600 28px Caveat, cursive';
    removeEl.hidden=!custom.some(f=>f.id===selectEl.value);
  };
  let changing=false;
  const change=async run=>{
    if(changing)return;changing=true;selectEl.disabled=true;
    try{await run();}catch(e){C.toast(e.message||'the font could not be saved.');}
    finally{changing=false;selectEl.disabled=false;render();}
  };
  selectEl.onchange=()=>change(()=>select(selectEl.value));
  removeEl.onclick=()=>change(()=>remove(selectEl.value));
  box.querySelector('#nota-font-import').onclick=()=>box.querySelector('#nota-font-file').click();
  box.querySelector('#nota-font-file').onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)change(()=>importFont(file));};
  render();init().then(render);
}
N.notaFonts={init,select,importFont,remove,glyph,mount,find};
})();
