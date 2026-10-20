/* PDF pages are locked paper. Ink, text and pictures remain ordinary Notas
 * objects in page coordinates; only the original PDF and page order are new. */
(()=>{
  'use strict';
  const C=N.core,{S,M}=C,W=720,GAP=28,TOP=32,MAX_BYTES=32*1024*1024,MAX_PAGES=200;
  let libraries,active=null,loading=null,epoch=0,busy=false,sideOpen=false,paintQueued=false;
  const bitmaps=new Map(),pending=new Set();
  const sc=document.getElementById('scroller');
  const style=document.createElement('style');
  style.textContent=`
    #pdf-nav{position:fixed;left:16px;bottom:calc(88px + env(safe-area-inset-bottom));z-index:31;display:flex;align-items:center;gap:4px;padding:5px;background:var(--panel);color:var(--graphite);border:1px solid var(--rule);border-radius:14px;box-shadow:0 3px 16px #0001;font:12px var(--type)}
    #pdf-nav[hidden],#pdf-pages[hidden]{display:none}
    #pdf-nav button,#pdf-pages button{font:inherit;color:inherit;border:0;background:transparent;cursor:pointer;border-radius:8px;min-width:36px;min-height:36px;padding:6px}
    #pdf-nav button:hover,#pdf-pages button:hover{background:var(--hover,#8882)}
    #pdf-nav button:focus-visible,#pdf-pages button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
    #pdf-count{font-variant-numeric:tabular-nums;min-width:65px;text-align:center}
    #pdf-pages{position:fixed;left:16px;top:90px;bottom:154px;width:164px;z-index:30;overflow:auto;background:var(--panel);color:var(--graphite);border:1px solid var(--rule);border-radius:16px;padding:12px;box-shadow:0 6px 30px #0002;overscroll-behavior:contain}
    #pdf-pages header{display:flex;align-items:center;justify-content:space-between;font:12px var(--type);margin-bottom:12px}
    #pdf-page-list{display:grid;gap:12px}
    #pdf-page-list button{display:grid;justify-items:center;gap:6px;font:11px var(--type);border:1px solid transparent;padding:8px}
    #pdf-page-list button[aria-current=page]{border-color:var(--blue);background:var(--hover,#8881)}
    .pdf-mini{width:100px;max-height:160px;object-fit:contain;background:white;box-shadow:0 1px 5px #0002}
    body.pdf-notebook #lines .txt{color:var(--pdf-text-ink,#1d1d1f)}
    body.pdf-notebook #lines .line.tutor .txt{color:var(--nota)}
    @media(max-width:600px){#pdf-nav{left:8px;bottom:calc(88px + env(safe-area-inset-bottom));max-width:calc(100vw - 16px)}#pdf-pages{left:8px;top:75px;bottom:144px;width:148px}#pdf-nav button{min-width:32px}}
  `;
  document.head.appendChild(style);
  const nav=document.createElement('nav');nav.id='pdf-nav';nav.hidden=true;nav.setAttribute('aria-label','PDF page navigation');
  nav.innerHTML='<button id="pdf-toggle" title="pages" aria-label="show PDF pages" aria-expanded="false">☷</button><button id="pdf-prev" title="previous page" aria-label="previous page">‹</button><span id="pdf-count" aria-live="polite"></span><button id="pdf-next" title="next page" aria-label="next page">›</button><button id="pdf-add" title="insert blank page after this page" aria-label="insert blank page after this page">+</button><button id="pdf-save" title="save annotated PDF">save PDF</button>';
  document.body.appendChild(nav);
  const side=document.createElement('aside');side.id='pdf-pages';side.hidden=true;side.setAttribute('aria-label','PDF pages');
  side.innerHTML='<header><span>pages</span><button id="pdf-close" aria-label="close PDF pages">×</button></header><div id="pdf-page-list"></div>';
  document.body.appendChild(side);
  const $=id=>document.getElementById(id);
  function pageAt(y){return S.pdf?.pages.find(p=>y>=p.y&&y<p.y+p.h)||null;}
  function current(){
    if(!S.pdf)return 0;
    const y=(sc.scrollTop+Math.min(160,M.vh/3))/M.zoom;
    let best=0;S.pdf.pages.forEach((p,i)=>{if(p.y<=y)best=i;});return best;
  }
  function position(pages){let y=TOP;for(const p of pages){p.y=y;y+=p.h+GAP;}return y;}
  function validate(value){
    if(value==null)return null;
    if(!value||typeof value!=='object'||typeof value.data!=='string'||value.data.length>Math.ceil(MAX_BYTES/3)*4||!/^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(value.data)||value.data.length%4||!Array.isArray(value.pages)||!value.pages.length||value.pages.length>MAX_PAGES)throw Error('this note contains invalid PDF data.');
    const ids=new Set();
    const pages=value.pages.map(p=>{
      if(!p||typeof p.id!=='string'||p.id.length>100||ids.has(p.id)||!Number.isFinite(p.h)||p.h<60||p.h>10000||!(p.source===null||Number.isInteger(p.source)&&p.source>=0&&p.source<MAX_PAGES))throw Error('this note contains invalid PDF pages.');
      ids.add(p.id);return {id:p.id,source:p.source,h:p.h,y:0};
    });
    position(pages);
    return {name:typeof value.name==='string'?value.name.slice(0,500):'document.pdf',data:value.data,pages};
  }
  function bytes(data){const raw=atob(data),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
  function base64(data){let s='';for(let i=0;i<data.length;i+=32768)s+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(s);}
  async function libs(){
    if(!libraries)libraries=Promise.all([
      import('./assets/pdf/pdf.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc=new URL('./assets/pdf/pdf.worker.mjs',location.href).href;return lib;}),
      new Promise((resolve,reject)=>{if(window.PDFLib)return resolve(window.PDFLib);const s=document.createElement('script');s.src='./assets/pdf/pdf-lib.js';s.onload=()=>resolve(window.PDFLib);s.onerror=()=>{s.remove();reject(Error('could not load PDF tools.'));};document.head.appendChild(s);})
    ]).catch(e=>{libraries=null;throw e;});
    return libraries;
  }
  async function documentFor(pdf){
    const [lib]=await libs();
    const task=lib.getDocument({data:bytes(pdf.data),cMapUrl:new URL('./assets/pdf/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('./assets/pdf/standard_fonts/',location.href).href,wasmUrl:new URL('./assets/pdf/wasm/',location.href).href,isEvalSupported:false,enableXfa:false});
    task.onPassword=()=>task.destroy();
    try{return await task.promise;}catch(e){throw Error(/password|destroy/i.test(String(e))?'password-protected PDFs cannot be opened yet.': 'could not open this PDF. check that the file is a valid, unencrypted PDF.');}
  }
  function reset(){
    epoch++;active?.loadingTask.destroy();active=null;loading=null;
    for(const cv of bitmaps.values())cv.width=cv.height=0;
    bitmaps.clear();pending.clear();
  }
  let shown=null,shape='';
  function refresh(){
    const pdf=S.pdf||null;
    if(shown!==pdf){reset();shown=pdf;shape='';}
    document.body.classList.toggle('pdf-notebook',!!pdf);document.body.style.setProperty('--pdf-text-ink',S.settings.textColor||'#1d1d1f');nav.hidden=!pdf;side.hidden=!pdf||!sideOpen;
    if(!pdf)return;
    const signature=pdf.pages.map(p=>p.id).join('|');
    if(shape!==signature){
      shape=signature;const list=$('pdf-page-list');list.replaceChildren();
      pdf.pages.forEach((p,i)=>{const b=document.createElement('button');b.type='button';b.dataset.page=p.id;b.setAttribute('aria-label','go to page '+(i+1));const cv=document.createElement('canvas');cv.className='pdf-mini';cv.width=100;cv.height=Math.round(100*p.h/W);cv.setAttribute('aria-hidden','true');const x=cv.getContext('2d');x.fillStyle='white';x.fillRect(0,0,cv.width,cv.height);const cached=bitmaps.get(p.id);if(cached)x.drawImage(cached,0,0,cv.width,cv.height);b.append(cv,document.createTextNode('page '+(i+1)+(p.source===null?' · blank':'')));b.onclick=()=>go(i);list.append(b);});
    }
    updateCounter();
  }
  function updateCounter(){
    if(!S.pdf)return;const i=current();$('pdf-count').textContent=(i+1)+' / '+S.pdf.pages.length;$('pdf-prev').disabled=i===0;$('pdf-next').disabled=i===S.pdf.pages.length-1;$('pdf-add').disabled=S.pdf.pages.length>=MAX_PAGES;
    for(const b of side.querySelectorAll('[data-page]')){if(b.dataset.page===S.pdf.pages[i].id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  }
  function setSide(on){sideOpen=on;side.hidden=!on||!S.pdf;$('pdf-toggle').setAttribute('aria-expanded',String(on));if(on)queueVisible();else $('pdf-toggle').focus();}
  function go(i){if(!S.pdf)return;const p=S.pdf.pages[Math.max(0,Math.min(S.pdf.pages.length-1,i))];sc.scrollTop=Math.max(0,p.y*M.zoom-24);updateCounter();N.ink.render();}
  function queueVisible(){
    if(paintQueued)return;paintQueued=true;requestAnimationFrame(()=>{paintQueued=false;if(!S.pdf)return;const top=sc.scrollTop/M.zoom,bottom=(sc.scrollTop+M.vh)/M.zoom;for(const p of S.pdf.pages)if(p.y+p.h>=top-500&&p.y<=bottom+500)request(p);if(sideOpen){const r=side.getBoundingClientRect();for(const b of side.querySelectorAll('[data-page]')){const br=b.getBoundingClientRect();if(br.bottom>=r.top&&br.top<=r.bottom)request(S.pdf.pages.find(p=>p.id===b.dataset.page));}}});
  }
  async function request(p){
    if(!p||p.source===null||bitmaps.has(p.id)||pending.has(p.id)||!S.pdf)return;
    const pdf=S.pdf,token=epoch;pending.add(p.id);
    try{
      if(!loading)loading=documentFor(pdf).then(doc=>{if(token!==epoch){doc.loadingTask.destroy();return null;}active=doc;return doc;});
      const doc=await loading;if(!doc||token!==epoch)return;
      const page=await doc.getPage(p.source+1);if(token!==epoch)return;
      const vp=page.getViewport({scale:1}),scale=Math.min(2,W*1.65/vp.width,Math.sqrt(4e6/(vp.width*vp.height)));
      const viewport=page.getViewport({scale}),cv=document.createElement('canvas');cv.width=Math.ceil(viewport.width);cv.height=Math.ceil(viewport.height);
      await page.render({canvasContext:cv.getContext('2d'),viewport,background:'white'}).promise;
      if(token!==epoch){cv.width=cv.height=0;return;}
      bitmaps.set(p.id,cv);
      // Bound decoded page memory even in a long document.
      while(bitmaps.size>8){const key=bitmaps.keys().next().value;if(key===p.id)break;const old=bitmaps.get(key);old.width=old.height=0;bitmaps.delete(key);}
      const mini=side.querySelector('[data-page="'+CSS.escape(p.id)+'"] canvas');if(mini)mini.getContext('2d').drawImage(cv,0,0,mini.width,mini.height);
      N.ink.render();
    }catch(e){if(token===epoch){loading=null;C.toast(e.message||'could not render this PDF page.',6000);}}
    finally{if(token===epoch)pending.delete(p.id);}
  }
  function draw(ctx){
    refresh();if(!S.pdf)return;
    const top=sc.scrollTop/M.zoom,bottom=(sc.scrollTop+M.vh)/M.zoom;
    for(const p of S.pdf.pages){if(p.y+p.h<top||p.y>bottom)continue;ctx.fillStyle='#fff';ctx.fillRect(0,p.y,W,p.h);const cv=bitmaps.get(p.id);if(cv&&cv.width)ctx.drawImage(cv,0,p.y,W,p.h);else request(p);ctx.strokeStyle='#8885';ctx.lineWidth=1/M.zoom;ctx.strokeRect(0,p.y,W,p.h);}
    queueVisible();
  }
  async function paintBackground(ctx,top,height){
    if(!S.pdf)return;const pdf=S.pdf,token=epoch;
    if(!loading)loading=documentFor(pdf).then(doc=>{if(token!==epoch){doc.loadingTask.destroy();return null;}active=doc;return doc;});
    const doc=await loading;if(!doc||pdf!==S.pdf)throw Error('the note changed during export.');
    for(const p of pdf.pages){if(p.y+p.h<=top||p.y>=top+height)continue;ctx.fillStyle='white';ctx.fillRect(0,p.y,W,p.h);if(p.source===null)continue;const page=await doc.getPage(p.source+1),vp=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(W*2/vp.width,Math.sqrt(12e6/(vp.width*vp.height)))}),cv=document.createElement('canvas');cv.width=Math.ceil(viewport.width);cv.height=Math.ceil(viewport.height);try{await page.render({canvasContext:cv.getContext('2d'),viewport,background:'white'}).promise;if(pdf!==S.pdf)throw Error('the note changed during export.');ctx.drawImage(cv,0,p.y,W,p.h);}finally{cv.width=cv.height=0;}}
  }
  async function importFile(file){
    if(busy||N.ui.changing)return false;busy=true;const original=S.id;let doc;
    try{
      if(!file.size||file.size>MAX_BYTES)throw Error('choose a PDF up to 32 MB.');
      C.toast('opening PDF…',30000);const data=new Uint8Array(await file.arrayBuffer());
      if(!new TextDecoder().decode(data.subarray(0,5)).startsWith('%PDF-'))throw Error('that file is not a PDF.');
      const pdf={name:file.name||'document.pdf',data:base64(data),pages:[]};doc=await documentFor(pdf);
      if(doc.numPages>MAX_PAGES)throw Error('choose a PDF with up to 200 pages.');
      for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),vp=page.getViewport({scale:1}),h=W*vp.height/vp.width;if(!Number.isFinite(h)||h<60||h>10000)throw Error('this PDF has an unsupported page size.');pdf.pages.push({id:C.uid(),source:i-1,h,y:0});}
      position(pdf.pages);if(S.id!==original)throw Error('the note changed while opening the PDF. import it again.');
      await N.ui.newNote();if(S.id===original)throw Error('save the current note before opening a PDF.');
      S.pdf=pdf;S.title=pdf.name.replace(/\.pdf$/i,'');S.lines=[];S.docH=pdf.pages.at(-1).y+pdf.pages.at(-1).h+TOP;
      M.zoom=Math.max(.2,Math.min(1,(M.vw-24)/W));N.ui.paintAll();N.ui.refreshTitle();C.markDirty();
      C.saveView(S.id,0,0,M.zoom);C.setActive(S.id);if(!await C.save())throw Error('PDF opened but could not be saved. retry saving before closing.');N.library?.close();N.library?.changed();
      C.toast('PDF ready. write with the pen, or tap a page with the text tool.',6500);return true;
    }catch(e){C.toast(e.message||'could not import this PDF.',7000);return false;}
    finally{busy=false;await doc?.loadingTask.destroy();}
  }
  function choose(){const input=document.createElement('input');input.type='file';input.accept='.pdf,application/pdf';input.hidden=true;document.body.appendChild(input);input.onchange=()=>{const f=input.files?.[0];input.remove();if(f)importFile(f);};input.oncancel=()=>input.remove();input.click();}
  function insertBlank(index=current()+1){
    if(!S.pdf||S.pdf.pages.length>=MAX_PAGES)return;
    N.ink.finishInput();const pdf=S.pdf,at=Math.max(0,Math.min(pdf.pages.length,index)),prev=pdf.pages[Math.max(0,at-1)],p={id:C.uid(),source:null,h:prev.h,y:0},start=pdf.pages[at]?.y??Infinity,delta=p.h+GAP;
    // Capture ids once: coordinates after insertion no longer match the old cut.
    const moved={strokes:new Map(S.strokes.filter(s=>s.bbox[1]>=start).map(s=>[s.id,{pts:s.pts.slice(),bbox:s.bbox.slice()}])),lines:new Map(S.lines.filter(l=>l.y>=start).map(l=>[l.id,l.y])),images:new Map(S.images.filter(im=>im.y>=start).map(im=>[im.id,im.y]))};
    const move=amount=>{for(const st of S.strokes){const old=moved.strokes.get(st.id);if(old){st.pts=old.pts.map((v,i)=>i%3===1?v+amount:v);st.bbox=old.bbox.map((v,i)=>i%2?v+amount:v);st.rev=(st.rev||0)+1;}}for(const l of S.lines)if(moved.lines.has(l.id))l.y=moved.lines.get(l.id)+amount;for(const im of S.images)if(moved.images.has(im.id))im.y=moved.images.get(im.id)+amount;};
    const paint=()=>{position(pdf.pages);S.docH=pdf.pages.at(-1).y+pdf.pages.at(-1).h+TOP;shape='';N.ui.paintAll();};
    C.act('insert blank PDF page',()=>{pdf.pages.splice(at,0,p);move(delta);paint();},()=>{pdf.pages=pdf.pages.filter(x=>x.id!==p.id);move(0);paint();});go(at);
  }
  async function exportFile(){
    if(!S.pdf||busy)return null;busy=true;$('pdf-save').disabled=true;
    try{
      N.ink.finishInput();await document.fonts.ready;const pdf=S.pdf,id=S.id,revision=C.revision;
      const check=()=>{if(S.id!==id||S.pdf!==pdf||C.revision!==revision)throw Error('the note changed during export. try saving the PDF again.');};
      C.toast('saving PDF…',30000);const [,lib]=await libs();check();
      const source=await lib.PDFDocument.load(bytes(pdf.data)),out=await lib.PDFDocument.create();
      const loaded=await Promise.all(S.images.map(im=>new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve({im,el});el.onerror=()=>reject(Error('an image could not be loaded. retry saving the PDF.'));el.src=im.src;})));check();
      for(const p of pdf.pages){
        check();let page;
        if(p.source===null)page=out.addPage([595.28,595.28*p.h/W]);
        else{[page]=await out.copyPages(source,[p.source]);out.addPage(page);}
        const cv=await N.ui.renderExport({bounds:{left:0,top:p.y,width:W,height:p.h},top:p.y,height:p.h,loaded,transparent:true,noPdf:true,check});
        try{
          check();const png=await new Promise(r=>cv.toBlob(r,'image/png'));if(!png)throw Error('could not render PDF annotations.');const image=await out.embedPng(await png.arrayBuffer()),box=page.getCropBox(),r=((page.getRotation().angle%360)+360)%360;
          const placement=r===90?{x:box.x+box.width,y:box.y,width:box.height,height:box.width}:r===180?{x:box.x+box.width,y:box.y+box.height,width:box.width,height:box.height}:r===270?{x:box.x,y:box.y+box.height,width:box.height,height:box.width}:{x:box.x,y:box.y,width:box.width,height:box.height};
          page.drawImage(image,{...placement,rotate:lib.degrees(r)});
        }finally{cv.width=cv.height=0;}
      }
      out.setTitle(S.title||pdf.name);const data=await out.save();check();const blob=new Blob([data],{type:'application/pdf'}),url=URL.createObjectURL(blob);N.ui.download((S.title||'document')+'.pdf',url);setTimeout(()=>URL.revokeObjectURL(url),60000);await C.save();C.toast('annotated PDF saved.');return data;
    }catch(e){C.toast(e.message||'could not save this PDF.',7000);return null;}
    finally{busy=false;$('pdf-save').disabled=false;}
  }
  $('pdf-toggle').onclick=()=>setSide(!sideOpen);$('pdf-close').onclick=()=>setSide(false);$('pdf-prev').onclick=()=>go(current()-1);$('pdf-next').onclick=()=>go(current()+1);$('pdf-add').onclick=()=>insertBlank();$('pdf-save').onclick=()=>exportFile();
  side.addEventListener('scroll',queueVisible,{passive:true});sc.addEventListener('scroll',()=>{updateCounter();queueVisible();},{passive:true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&sideOpen)setSide(false);});
  document.addEventListener('drop',e=>{const file=[...(e.dataTransfer?.files||[])].find(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name));if(file){e.preventDefault();e.stopImmediatePropagation();importFile(file);}},{capture:true});
  N.pdf={validate,draw,refresh,pageAt,current,go,choose,importFile,insertBlank,exportFile,paintBackground,libs,width:W};
})();
