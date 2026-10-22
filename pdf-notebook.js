/* PDF pages are locked paper. Ink, text and pictures remain ordinary Notas
 * objects in page coordinates; only the original PDF and page order are new. */
(()=>{
  'use strict';
  const C=N.core,{S,M}=C,W=720,GAP=28,TOP=32,MAX_BYTES=32*1024*1024,MAX_PAGES=200,ROTS=[0,90,180,270];
  /* decoded pages are the memory hog: about 40 million pixels in all, which
     still lets the page under a pinch be drawn at the screen's own sharpness */
  const PIXEL_BUDGET=40e6,PAGE_PIXELS=16e6;
  let libraries,active=null,loading=null,epoch=0,busy=false,sideOpen=false,paintQueued=false,fitNext='page';
  const bitmaps=new Map(),pending=new Map(),failed=new Set(),thumbs=new Set(),texts=new Map();
  const sc=document.getElementById('scroller');
  const style=document.createElement('style');
  style.textContent=`
    #pdf-nav{position:fixed;z-index:31;left:50%;transform:translateX(-50%);bottom:calc(var(--edge) + var(--safe-b) + 66px);display:flex;align-items:center;gap:2px;padding:5px;border-radius:var(--r-pill);color:var(--graphite);font:500 13px/1 var(--ui);max-width:calc(100vw - 16px);box-sizing:border-box}
    #pdf-nav[hidden],#pdf-pages[hidden],#pdf-find[hidden]{display:none}
    #pdf-nav button,#pdf-pages button,#pdf-find button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:38px;height:38px;padding:0 8px;border-radius:var(--r-pill);color:var(--ink-2);font:500 13px/1 var(--ui);font-size:18px;transition:background-color .15s ease,color .15s ease,transform .18s var(--pop)}
    #pdf-nav button:hover:not(:disabled),#pdf-pages button:hover:not(:disabled),#pdf-find button:hover:not(:disabled){background:var(--tint);color:var(--graphite)}
    #pdf-nav button:active:not(:disabled),#pdf-pages button:active:not(:disabled),#pdf-find button:active:not(:disabled){transform:scale(.92)}
    #pdf-nav button:disabled,#pdf-pages button:disabled,#pdf-find button:disabled{opacity:.32;cursor:default}
    #pdf-nav :focus-visible,#pdf-pages :focus-visible,#pdf-find :focus-visible{outline:2px solid var(--graphite);outline-offset:2px}
    #pdf-nav button[aria-expanded="true"]{background:var(--tint-2);color:var(--graphite)}
    #pdf-nav .pdf-sep{flex:none;width:1px;height:20px;background:var(--rule);margin:0 3px}
    #pdf-count{min-width:58px;text-align:center;font-variant-numeric:tabular-nums;color:var(--graphite);white-space:nowrap}
    #pdf-nav #pdf-save{background:var(--graphite);color:var(--paper);padding:0 14px 0 12px;margin-left:3px}
    #pdf-nav #pdf-save:hover:not(:disabled){background:var(--graphite);color:var(--paper);opacity:.88}
    #pdf-save span{font-size:13px}
    #pdf-find{position:fixed;z-index:31;left:50%;transform:translateX(-50%);bottom:calc(var(--edge) + var(--safe-b) + 122px);display:flex;align-items:center;gap:2px;padding:5px 5px 5px 14px;border-radius:var(--r-pill);width:min(400px,calc(100vw - 16px));box-sizing:border-box}
    #pdf-find i.lead{font-size:16px;color:var(--ink-2);flex:none}
    #pdf-find input{flex:1;min-width:0;height:38px;border:0;background:transparent;color:var(--graphite);font:400 15px var(--ui);padding:0 8px;outline:none}
    #pdf-find input:focus-visible{outline:none}#pdf-find input::-webkit-search-cancel-button{display:none}
    #pdf-find:focus-within{box-shadow:inset 0 1px 1px var(--glass-edge),0 0 0 2px var(--graphite),var(--shadow)}
    #pdf-find-count{flex:none;min-width:48px;text-align:right;font:500 12px var(--ui);color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap;padding-right:4px}
    #pdf-pages{position:fixed;z-index:30;left:calc(var(--lib-off,0px) + var(--edge) + var(--safe-l));top:calc(var(--bar) + 12px);bottom:calc(var(--edge) + var(--safe-b) + 178px);width:172px;box-sizing:border-box;display:flex;flex-direction:column;border-radius:var(--r-card);color:var(--graphite)}
    #pdf-pages header{display:flex;align-items:center;gap:2px;padding:8px 6px 6px 14px;flex:none}
    #pdf-pages header strong{flex:1;font:600 13px var(--ui)}
    #pdf-pages header button{min-width:34px;height:34px;font-size:16px}
    #pdf-page-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:4px 12px 12px;display:grid;align-content:start;gap:10px;scrollbar-width:thin}
    .pdf-item{display:grid;gap:6px}
    #pdf-pages .pdf-thumb{display:grid;justify-items:center;gap:6px;height:auto;padding:6px;border-radius:12px;font:500 11px var(--ui);color:var(--ink-2)}
    #pdf-pages .pdf-thumb[aria-current="page"]{background:var(--tint-2);color:var(--graphite)}
    #pdf-pages .pdf-thumb[aria-current="page"] .pdf-mini{box-shadow:0 0 0 2px var(--graphite)}
    .pdf-mini{width:112px;height:auto;display:block;background:#fff;border-radius:3px;box-shadow:0 0 0 1px var(--rule),0 1px 4px rgba(0,0,0,.08)}
    .pdf-acts{display:flex;justify-content:center;gap:0;padding:2px;border-radius:var(--r-pill);background:var(--tint)}
    #pdf-pages .pdf-acts button{flex:1;min-width:0;height:32px;padding:0;font-size:15px}
    #pdf-pages .pdf-acts button.danger:hover:not(:disabled){color:var(--red)}
    @media (min-width:840px) and (pointer:fine){
      #pdf-nav{left:auto;right:calc(var(--edge) + var(--safe-r));transform:none;bottom:calc(var(--edge) + var(--safe-b))}
      #pdf-find{left:auto;right:calc(var(--edge) + var(--safe-r));transform:none;bottom:calc(var(--edge) + var(--safe-b) + 58px)}
      #pdf-pages{bottom:calc(var(--edge) + var(--safe-b) + 112px)}
    }
    @media not ((min-width:840px) and (pointer:fine)){
      body.pdf-notebook #offline-status{bottom:calc(var(--edge) + var(--safe-b) + 120px)}
      body.pdf-notebook #local-status{bottom:calc(var(--edge) + var(--safe-b) + 156px)}
    }
    @media (max-width:520px){#pdf-save span{display:none}#pdf-nav #pdf-save{padding:0 10px}#pdf-nav button{min-width:36px}#pdf-count{min-width:50px}#pdf-pages{width:140px}.pdf-mini{width:92px}}
    body.pdf-notebook #lines .txt{color:var(--pdf-text-ink,#1d1d1f)}
    body.pdf-notebook #lines .line.tutor .txt{color:var(--nota)}
    /* the PDF's own words, invisible over the page: drag over them with the
       text tool to select and copy, as in any PDF reader */
    #pdf-tl{position:absolute;left:0;top:0;width:${W}px;pointer-events:none}
    body[data-tool="text"] #pdf-tl{pointer-events:auto}
    .pdf-tl-page{position:absolute;left:0;overflow:hidden}
    #pdf-tl .textLayer{position:absolute;left:0;top:0;text-align:initial;overflow:clip;line-height:1;-webkit-text-size-adjust:none;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;caret-color:transparent;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size));-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}
    #pdf-tl .textLayer[data-main-rotation="90"]{transform:rotate(90deg) translateY(-100%)}
    #pdf-tl .textLayer[data-main-rotation="180"]{transform:rotate(180deg) translate(-100%,-100%)}
    #pdf-tl .textLayer[data-main-rotation="270"]{transform:rotate(270deg) translateX(-100%)}
    #pdf-tl .textLayer :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%}
    #pdf-tl .textLayer > :not(.markedContent),#pdf-tl .textLayer .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
    #pdf-tl .textLayer .markedContent{display:contents}
    #pdf-tl .textLayer span[role=img]{-webkit-user-select:none;user-select:none;cursor:default}
    #pdf-tl .textLayer ::selection{background:rgba(47,111,179,.28);color:transparent}
    #pdf-tl .textLayer br::selection{background:transparent}
    #pdf-tl .textLayer .endOfContent{display:block;position:absolute;inset:100% 0 0;z-index:0;cursor:default;-webkit-user-select:none;user-select:none}
  `;
  document.head.appendChild(style);
  const nav=document.createElement('nav');nav.id='pdf-nav';nav.className='glass';nav.hidden=true;nav.setAttribute('aria-label','PDF pages');
  nav.innerHTML='<button id="pdf-toggle" type="button" title="pages" aria-label="show pages" aria-expanded="false" aria-controls="pdf-pages"><i class="ph ph-squares-four" aria-hidden="true"></i></button><span class="pdf-sep" aria-hidden="true"></span>'+
    '<button id="pdf-prev" type="button" title="previous page (Page Up)" aria-label="previous page"><i class="ph ph-caret-up" aria-hidden="true"></i></button><span id="pdf-count" aria-live="polite"></span><button id="pdf-next" type="button" title="next page (Page Down)" aria-label="next page"><i class="ph ph-caret-down" aria-hidden="true"></i></button><span class="pdf-sep" aria-hidden="true"></span>'+
    '<button id="pdf-fit" type="button"><i class="ph" aria-hidden="true"></i></button><button id="pdf-search" type="button" title="search the PDF (Ctrl+F)" aria-label="search the PDF" aria-expanded="false" aria-controls="pdf-find"><i class="ph ph-magnifying-glass" aria-hidden="true"></i></button>'+
    '<button id="pdf-save" type="button" title="save annotated PDF" aria-label="save annotated PDF"><i class="ph ph-download-simple" aria-hidden="true"></i><span>save PDF</span></button>';
  document.body.appendChild(nav);
  const find=document.createElement('div');find.id='pdf-find';find.className='glass';find.hidden=true;find.setAttribute('role','search');
  find.innerHTML='<i class="ph ph-magnifying-glass lead" aria-hidden="true"></i><input id="pdf-find-input" type="search" placeholder="search this PDF" aria-label="search this PDF" autocomplete="off" spellcheck="false"><span id="pdf-find-count" aria-live="polite"></span>'+
    '<button id="pdf-find-prev" type="button" title="previous match (Shift+Enter)" aria-label="previous match"><i class="ph ph-caret-up" aria-hidden="true"></i></button><button id="pdf-find-next" type="button" title="next match (Enter)" aria-label="next match"><i class="ph ph-caret-down" aria-hidden="true"></i></button><button id="pdf-find-close" type="button" title="close search (Esc)" aria-label="close search"><i class="ph ph-x" aria-hidden="true"></i></button>';
  document.body.appendChild(find);
  const side=document.createElement('aside');side.id='pdf-pages';side.className='glass';side.hidden=true;side.setAttribute('aria-label','PDF pages');
  side.innerHTML='<header><strong>pages</strong><button id="pdf-add" type="button" title="insert a blank page after this one" aria-label="insert a blank page after this page"><i class="ph ph-file-plus" aria-hidden="true"></i></button><button id="pdf-close" type="button" title="close" aria-label="close pages"><i class="ph ph-x" aria-hidden="true"></i></button></header><div id="pdf-page-list"></div>';
  document.body.appendChild(side);
  const acts=document.createElement('div');acts.className='pdf-acts';acts.setAttribute('role','group');
  acts.innerHTML='<button id="pdf-up" type="button" title="move page up" aria-label="move page up"><i class="ph ph-arrow-up" aria-hidden="true"></i></button><button id="pdf-down" type="button" title="move page down" aria-label="move page down"><i class="ph ph-arrow-down" aria-hidden="true"></i></button><button id="pdf-rotate" type="button" title="rotate page" aria-label="rotate page clockwise"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i></button><button id="pdf-delete" class="danger" type="button" title="delete page" aria-label="delete page"><i class="ph ph-trash" aria-hidden="true"></i></button>';
  const layerRoot=document.createElement('div');layerRoot.id='pdf-tl';layerRoot.setAttribute('aria-hidden','true');
  const $=id=>document.getElementById(id),act=id=>acts.querySelector('#'+id);

  /* ---- geometry: pages stack down the column, each W wide ---- */
  function indexAt(pages,y){
    let lo=0,hi=pages.length-1;
    while(lo<hi){const mid=(lo+hi+1)>>1;if(pages[mid].y<=y)lo=mid;else hi=mid-1;}
    return lo;
  }
  function pageAt(y,x){
    if(!S.pdf||x!==undefined&&(x<0||x>W))return null;
    const p=S.pdf.pages[indexAt(S.pdf.pages,y)];return p&&y>=p.y&&y<p.y+p.h?p:null;
  }
  /* the page a thing belongs to: the one it sits on, else the nearer neighbour */
  function ownerIn(pages,y){
    const i=indexAt(pages,y),p=pages[i],next=pages[i+1];
    return next&&y>=p.y+p.h&&next.y-y<y-(p.y+p.h)?i+1:i;
  }
  function clip(ctx,st){
    if(!S.pdf||!st?.pts?.length)return false;
    const p=S.pdf.pages[ownerIn(S.pdf.pages,st.pts[1])];
    ctx.save();ctx.beginPath();ctx.rect(0,p.y,W,p.h);ctx.clip();return true;
  }
  function current(){
    if(!S.pdf)return 0;
    const y=(sc.scrollTop+Math.min(160,M.vh/3))/M.zoom;
    return indexAt(S.pdf.pages,y);
  }
  function position(pages){let y=TOP;for(const p of pages){p.y=y;y+=p.h+GAP;}return y;}
  function validate(value){
    if(value==null)return null;
    if(!value||typeof value!=='object'||typeof value.data!=='string'||value.data.length>Math.ceil(MAX_BYTES/3)*4||!/^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(value.data)||value.data.length%4||!Array.isArray(value.pages)||!value.pages.length||value.pages.length>MAX_PAGES)throw Error('this note contains invalid PDF data.');
    const ids=new Set();
    const pages=value.pages.map(p=>{
      if(!p||typeof p.id!=='string'||p.id.length>100||ids.has(p.id)||!Number.isFinite(p.h)||p.h<60||p.h>10000||!(p.source===null||Number.isInteger(p.source)&&p.source>=0&&p.source<MAX_PAGES)||p.rot!==undefined&&!ROTS.includes(p.rot))throw Error('this note contains invalid PDF pages.');
      ids.add(p.id);return {id:p.id,source:p.source,h:p.h,y:0,...(p.rot?{rot:p.rot}:{})};
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
  function open(){
    const pdf=S.pdf,token=epoch;
    if(!loading)loading=documentFor(pdf).then(doc=>{if(token!==epoch){doc.loadingTask.destroy();return null;}active=doc;return doc;}).catch(e=>{if(token===epoch)loading=null;throw e;});
    return loading;
  }
  function reset(){
    epoch++;active?.loadingTask.destroy();active=null;loading=null;
    for(const b of bitmaps.values())b.cv.width=b.cv.height=0;
    bitmaps.clear();pending.clear();failed.clear();thumbs.clear();texts.clear();clearLayers();closeFind();
  }
  /* a page as the reader sees it: the PDF's own turn plus the one given here */
  function view(page,p,k){
    const rotation=((page.rotate||0)+(p.rot||0))%360,base=page.getViewport({scale:1,rotation});
    return page.getViewport({scale:k*W/base.width,rotation});
  }
  async function renderPage(p,k){
    const doc=await open();if(!doc)throw Error('stale');
    const page=await doc.getPage(p.source+1),viewport=view(page,p,k),cv=document.createElement('canvas');
    cv.width=Math.ceil(viewport.width);cv.height=Math.ceil(viewport.height);
    await page.render({canvasContext:cv.getContext('2d'),viewport,background:'white'}).promise;
    return cv;
  }

  /* ---- drawing: each page at the sharpness the current zoom needs ---- */
  function sharpness(p){
    const want=Math.max(1,M.zoom*(M.dpr||devicePixelRatio||1)),stepped=Math.pow(2,Math.ceil(Math.log2(want)*2)/2);
    return Math.min(Math.sqrt(PAGE_PIXELS/(W*p.h)),stepped);
  }
  function onScreen(p,margin=0){const top=sc.scrollTop/M.zoom-margin,bottom=(sc.scrollTop+M.vh)/M.zoom+margin;return p.y+p.h>=top&&p.y<=bottom;}
  function trim(keep){
    let total=0;for(const b of bitmaps.values())total+=b.cv.width*b.cv.height;
    for(const [id,b] of bitmaps){
      if(total<=PIXEL_BUDGET)break;
      const p=S.pdf?.pages.find(x=>x.id===id);if(id===keep||p&&onScreen(p,200))continue;
      total-=b.cv.width*b.cv.height;b.cv.width=b.cv.height=0;bitmaps.delete(id);
    }
  }
  function request(p){
    if(!p||p.source===null||!S.pdf||failed.has(p.id)||pending.has(p.id))return;
    const k=sharpness(p),have=bitmaps.get(p.id),rot=p.rot||0;
    if(have&&have.rot===rot&&have.k>=k*.99)return;
    const token=epoch;pending.set(p.id,k);
    renderPage(p,k).then(cv=>{
      if(token!==epoch){cv.width=cv.height=0;return;}
      const old=bitmaps.get(p.id);if(old)old.cv.width=old.cv.height=0;
      bitmaps.delete(p.id);bitmaps.set(p.id,{cv,k,rot});trim(p.id);paintThumb(p);N.ink.render();
    }).catch(e=>{if(token!==epoch||e?.message==='stale')return;failed.add(p.id);C.toast(e?.message||'could not render this PDF page.',6000);})
      .finally(()=>{if(token===epoch)pending.delete(p.id);});
  }
  function queueVisible(){
    if(paintQueued)return;paintQueued=true;requestAnimationFrame(()=>{
      paintQueued=false;if(!S.pdf)return;
      for(const p of S.pdf.pages)if(onScreen(p,500))request(p);
      if(sideOpen){const r=side.getBoundingClientRect();for(const b of side.querySelectorAll('.pdf-thumb')){const br=b.getBoundingClientRect();if(br.bottom>=r.top-200&&br.top<=r.bottom+200)requestThumb(S.pdf.pages.find(p=>p.id===b.dataset.page));}}
      syncLayers();
    });
  }
  function draw(ctx){
    refresh();if(!S.pdf)return;
    for(const p of S.pdf.pages){
      if(!onScreen(p))continue;
      ctx.fillStyle='#fff';ctx.fillRect(0,p.y,W,p.h);
      const b=bitmaps.get(p.id);if(b&&b.cv.width&&b.rot===(p.rot||0))ctx.drawImage(b.cv,0,p.y,W,p.h);
      request(p);
      ctx.strokeStyle='rgba(60,60,67,.22)';ctx.lineWidth=1/M.zoom;ctx.strokeRect(0,p.y,W,p.h);
    }
    drawHits(ctx);queueVisible();
  }
  async function paintBackground(ctx,top,height){
    if(!S.pdf)return;const pdf=S.pdf;
    const doc=await open();if(!doc||pdf!==S.pdf)throw Error('the note changed during export.');
    for(const p of pdf.pages){
      if(p.y+p.h<=top||p.y>=top+height)continue;ctx.fillStyle='white';ctx.fillRect(0,p.y,W,p.h);if(p.source===null)continue;
      const cv=await renderPage(p,Math.min(2,Math.sqrt(12e6/(W*p.h))));
      try{if(pdf!==S.pdf)throw Error('the note changed during export.');ctx.drawImage(cv,0,p.y,W,p.h);}finally{cv.width=cv.height=0;}
    }
  }

  /* ---- the page list ---- */
  let shown=null,shape='';
  function refresh(){
    const pdf=S.pdf||null;
    if(shown!==pdf){const was=!!shown;reset();shown=pdf;shape='';if(was!==!!pdf)N.ink?.setPen?.({});}
    document.body.classList.toggle('pdf-notebook',!!pdf);document.body.style.setProperty('--pdf-text-ink',S.settings.textColor||'#1d1d1f');nav.hidden=!pdf;side.hidden=!pdf||!sideOpen;
    if(!pdf){find.hidden=true;return;}
    const signature=pdf.pages.map(p=>p.id+':'+(p.rot||0)+':'+Math.round(p.h)).join('|');
    if(shape!==signature){
      shape=signature;thumbs.clear();const list=$('pdf-page-list');list.replaceChildren();
      pdf.pages.forEach((p,i)=>{
        const item=document.createElement('div');item.className='pdf-item';
        const b=document.createElement('button');b.type='button';b.className='pdf-thumb';b.dataset.page=p.id;b.setAttribute('aria-label','go to page '+(i+1)+(p.source===null?', blank':''));
        const cv=document.createElement('canvas');cv.className='pdf-mini';const dpr=Math.min(2,M.dpr||1);cv.width=Math.round(112*dpr);cv.height=Math.round(112*dpr*p.h/W);cv.setAttribute('aria-hidden','true');
        const x=cv.getContext('2d');x.fillStyle='white';x.fillRect(0,0,cv.width,cv.height);
        b.append(cv,document.createTextNode((i+1)+(p.source===null?' · blank':'')));b.onclick=()=>go(i);item.append(b);list.append(item);paintThumb(p);
      });
      layerKey='';syncLayers();if(find.hidden===false&&query)search(query,true);
    }
    updateCounter();
  }
  function paintThumb(p,cv){
    const mini=side.querySelector('[data-page="'+CSS.escape(p.id)+'"] canvas');if(!mini)return;
    const b=cv?{cv,rot:p.rot||0}:bitmaps.get(p.id);if(!b||b.rot!==(p.rot||0)||!b.cv.width)return;
    mini.getContext('2d').drawImage(b.cv,0,0,mini.width,mini.height);thumbs.add(p.id);
  }
  function requestThumb(p){
    if(!p||p.source===null||thumbs.has(p.id)||failed.has(p.id))return;
    if(bitmaps.get(p.id)?.rot===(p.rot||0)){paintThumb(p);return;}
    thumbs.add(p.id);const token=epoch;
    renderPage(p,.34).then(cv=>{if(token===epoch)paintThumb(p,cv);cv.width=cv.height=0;}).catch(()=>{if(token===epoch)thumbs.delete(p.id);});
  }
  function updateCounter(){
    if(!S.pdf)return;const n=S.pdf.pages.length,i=Math.min(current(),n-1);
    $('pdf-count').textContent=(i+1)+' / '+n;$('pdf-prev').disabled=i===0;$('pdf-next').disabled=i===n-1;$('pdf-add').disabled=n>=MAX_PAGES;
    let here=null;
    for(const b of side.querySelectorAll('.pdf-thumb')){if(b.dataset.page===S.pdf.pages[i].id){b.setAttribute('aria-current','page');here=b;}else b.removeAttribute('aria-current');}
    if(here&&acts.parentNode!==here.parentNode){here.parentNode.append(acts);if(sideOpen)here.scrollIntoView({block:'nearest'});}
    act('pdf-up').disabled=i===0;act('pdf-down').disabled=i===n-1;act('pdf-delete').disabled=n<=1;
    const fit=$('pdf-fit'),label=fitNext==='page'?'fit the whole page':'fit the page width';
    fit.title=label;fit.setAttribute('aria-label',label);fit.firstChild.className='ph '+(fitNext==='page'?'ph-frame-corners':'ph-arrows-out-line-horizontal');
  }
  function setSide(on){sideOpen=on;side.hidden=!on||!S.pdf;$('pdf-toggle').setAttribute('aria-expanded',String(on));if(on){updateCounter();queueVisible();}else if(side.contains(document.activeElement))$('pdf-toggle').focus();}
  function go(i){if(!S.pdf)return;const p=S.pdf.pages[Math.max(0,Math.min(S.pdf.pages.length-1,i))];sc.scrollTop=Math.max(0,p.y*M.zoom-24);updateCounter();N.ink.render();}
  function fit(){
    if(!S.pdf)return;const i=current(),p=S.pdf.pages[i],width=(M.vw-24)/W;
    C.setZoom(Math.max(.2,Math.min(3,fitNext==='page'?Math.min(width,(M.vh-150)/p.h):width)));
    fitNext=fitNext==='page'?'width':'page';go(i);
  }

  /* ---- page edits: annotations travel with their page, and undo puts all back ---- */
  function edit(label,change,focus){
    if(!S.pdf||busy)return;N.ink.finishInput();
    const pdf=S.pdf,before={pages:pdf.pages.map(p=>({...p})),strokes:S.strokes.slice(),lines:S.lines.slice(),images:S.images.slice()};
    const old=before.pages.map(p=>({...p})),result=change(old.map(p=>({...p})));if(!result)return;
    const pages=result.pages;position(pages);
    const byId=new Map(pages.map(p=>[p.id,p]));
    const route=y=>{const i=ownerIn(old,y),r=result.route(i,old[i]);if(!r)return null;return {from:old[i],to:byId.get(r.id),map:r.map,k:r.k||1,turn:r.turn||0};};
    const move=(r,x,y)=>{const [nx,ly]=r.map?r.map(x,y-r.from.y):[x,y-r.from.y];return [nx,r.to.y+ly];};
    const strokes=[],lines=[],images=[];
    for(const st of before.strokes){
      const r=route(st.pts[1]);if(!r)continue;
      if(!r.map&&r.to.y===r.from.y){strokes.push(st);continue;}
      const pts=st.pts.slice();for(let j=0;j<pts.length;j+=3){const [nx,ny]=move(r,pts[j],pts[j+1]);pts[j]=nx;pts[j+1]=ny;}
      strokes.push({...st,pts,bbox:N.ink.bboxOf(pts),rev:(st.rev||0)+1});
    }
    for(const l of before.lines){
      const r=route(l.y);if(!r)continue;
      if(!r.map&&r.to.y===r.from.y){lines.push(l);continue;}
      const [x,y]=move(r,l.x||0,l.y);lines.push({...l,x:Math.max(0,Math.min(W-80,x)),y});
    }
    for(const im of before.images){
      const r=route(im.y+im.h/2);if(!r)continue;
      if(!r.map&&r.to.y===r.from.y){images.push(im);continue;}
      const [cx,cy]=move(r,im.x+im.w/2,im.y+im.h/2),w=im.w*r.k,h=im.h*r.k,rot=(im.rot||0)+r.turn;
      images.push({...im,x:cx-w/2,y:cy-h/2,w,h,...(rot?{rot}:{})});
    }
    const after={pages,strokes,lines,images};
    C.act(label,()=>apply(after),()=>apply(before));
    if(focus!==undefined)go(focus);
  }
  function apply(state){
    const pdf=S.pdf;if(!pdf)return;
    pdf.pages=state.pages.map(p=>({...p}));position(pdf.pages);
    S.strokes=state.strokes.slice();S.lines=state.lines.slice();S.images=state.images.slice();
    S.selection=[];S.imageSelection=null;S.docH=pdf.pages.at(-1).y+pdf.pages.at(-1).h+TOP;
    shape='';N.ui.paintAll();N.ink.showSelBar?.();queueVisible();
  }
  function insertBlank(index=current()+1){
    if(!S.pdf||S.pdf.pages.length>=MAX_PAGES)return;
    const at=Math.max(0,Math.min(S.pdf.pages.length,index));
    edit('insert blank PDF page',pages=>{const prev=pages[Math.max(0,at-1)];pages.splice(at,0,{id:C.uid(),source:null,h:prev.h,y:0});return {pages,route:(i,p)=>({id:p.id})};},at);
  }
  function movePage(i,by){
    if(!S.pdf)return;const j=i+by;if(j<0||j>=S.pdf.pages.length)return;
    edit('move PDF page',pages=>{[pages[i],pages[j]]=[pages[j],pages[i]];return {pages,route:(k,p)=>({id:p.id})};},j);
  }
  function rotatePage(i){
    if(!S.pdf)return;
    edit('rotate PDF page',pages=>{
      const p=pages[i],h=W*W/p.h;if(h<60||h>10000){C.toast('this page is too long to turn.',5000);return null;}
      const k=W/p.h,rot=((p.rot||0)+90)%360,{rot:was,...rest}=p;pages[i]={...rest,h,...(rot?{rot}:{})};
      /* a quarter turn clockwise, scaled so the turned page is W wide again */
      return {pages,route:(j,o)=>j===i?{id:o.id,k,turn:Math.PI/2,map:(x,ly)=>[(o.h-ly)*k,x*k]}:{id:o.id}};
    },i);
  }
  function deletePage(i){
    if(!S.pdf)return;
    if(S.pdf.pages.length<=1){C.toast('a PDF keeps at least one page.',4000);return;}
    edit('delete PDF page',pages=>{pages.splice(i,1);return {pages,route:(j,p)=>j===i?null:{id:p.id}};},Math.min(i,S.pdf.pages.length-2));
    C.toast('page deleted. undo brings it back.',4500);
  }

  /* ---- search the PDF's own text ---- */
  let query='',hits=[],hitAt=-1,searchToken=0;
  async function textOf(doc,p){
    if(!texts.has(p.source))texts.set(p.source,doc.getPage(p.source+1).then(page=>page.getTextContent()).catch(e=>{texts.delete(p.source);throw e;}));
    return texts.get(p.source);
  }
  async function search(q,keep){
    const token=++searchToken,want=q.trim().toLowerCase(),was=keep&&hits[hitAt];
    query=q;hits=[];hitAt=-1;updateFind();N.ink.render();
    if(!want||!S.pdf)return;
    const pdf=S.pdf;let doc;try{doc=await open();}catch(e){return;}
    for(const p of pdf.pages){
      if(p.source===null)continue;
      let tc,page;try{[tc,page]=await Promise.all([textOf(doc,p),doc.getPage(p.source+1)]);}catch(e){continue;}
      if(token!==searchToken||pdf!==S.pdf)return;
      const vp=view(page,p,1),spans=[];let str='';
      for(const it of tc.items){if(typeof it.str!=='string')continue;spans.push({start:str.length,it});str+=it.str+(it.hasEOL?' ':'');}
      const low=str.toLowerCase();
      for(let at=low.indexOf(want);at>=0;at=low.indexOf(want,at+want.length)){
        const end=at+want.length,rects=[];
        for(const {start,it} of spans){
          const len=it.str.length;if(!len||start>=end||start+len<=at)continue;
          const [a,b,c,d,e,f]=it.transform,s0=Math.max(0,at-start)/len,s1=Math.min(len,end-start)/len,run=Math.hypot(a,b)||1,up=Math.hypot(c,d)||1,h=it.height||up;
          const ux=a/run,uy=b/run,vx=c/up,vy=d/up,corners=[];
          for(const s of [s0*it.width,s1*it.width])for(const t of [-.22*h,.92*h])corners.push(vp.convertToViewportPoint(e+ux*s+vx*t,f+uy*s+vy*t));
          const xs=corners.map(q=>q[0]),ys=corners.map(q=>q[1]);
          rects.push([Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]);
        }
        if(rects.length)hits.push({page:p.id,rects});
      }
      if(hits.length&&hitAt<0&&!was){hitAt=0;show(false);}
      updateFind();
    }
    if(was){const i=hits.findIndex(h=>h.page===was.page&&h.rects[0][1]>=was.rects[0][1]-1);hitAt=hits.length?Math.max(0,i):-1;updateFind();N.ink.render();}
  }
  function updateFind(){
    const out=$('pdf-find-count');
    out.textContent=!query.trim()?'':hits.length?(hitAt+1)+' / '+hits.length:'no matches';
    $('pdf-find-prev').disabled=$('pdf-find-next').disabled=hits.length<2;
  }
  function show(scroll=true){
    const h=hits[hitAt];if(!h)return;updateFind();
    const p=S.pdf?.pages.find(x=>x.id===h.page);if(!p)return;
    const [x0,y0,x1,y1]=h.rects[0],top=(p.y+y0)*M.zoom,bottom=(p.y+y1)*M.zoom;
    if(scroll||top<sc.scrollTop||bottom>sc.scrollTop+M.vh-140)sc.scrollTop=Math.max(0,top-M.vh*.35);
    const left=M.colLeft+x0*M.zoom,right=M.colLeft+x1*M.zoom;
    if(left<sc.scrollLeft||right>sc.scrollLeft+M.vw)sc.scrollLeft=Math.max(0,left-M.vw*.3);
    updateCounter();N.ink.render();
  }
  function step(by){if(!hits.length)return;hitAt=(hitAt+by+hits.length)%hits.length;show();}
  function drawHits(ctx){
    if(find.hidden||!hits.length)return;
    ctx.save();ctx.globalCompositeOperation='multiply';
    hits.forEach((h,i)=>{
      const p=S.pdf.pages.find(x=>x.id===h.page);if(!p||!onScreen(p))return;
      ctx.fillStyle=i===hitAt?'rgba(255,170,0,.55)':'rgba(255,224,102,.55)';
      for(const [x0,y0,x1,y1] of h.rects)ctx.fillRect(x0,p.y+y0,x1-x0,y1-y0);
    });
    ctx.restore();
  }
  function openFind(){
    if(!S.pdf)return;find.hidden=false;$('pdf-search').setAttribute('aria-expanded','true');
    const input=$('pdf-find-input');input.focus();input.select();if(query)N.ink.render();
  }
  function closeFind(){
    if(find.hidden)return;find.hidden=true;$('pdf-search').setAttribute('aria-expanded','false');searchToken++;
    if(find.contains(document.activeElement))$('pdf-search').focus();N.ink.render();
  }

  /* ---- the PDF's text, laid invisibly over the visible pages ---- */
  let layerKey='';
  const layers=new Map();
  function clearLayers(){for(const l of layers.values())l.task?.cancel?.();layers.clear();layerRoot.replaceChildren();layerKey='';}
  function syncLayers(){
    if(!S.pdf){if(layerRoot.isConnected)layerRoot.remove();return;}
    const host=document.getElementById('textlayer');
    if(host&&layerRoot.parentNode!==host)host.prepend(layerRoot);
    const want=S.pdf.pages.filter(p=>p.source!==null&&onScreen(p,400));
    const key=want.map(p=>p.id+':'+(p.rot||0)+':'+p.y).join('|');
    if(key===layerKey)return;layerKey=key;
    const keep=new Set(want.map(p=>p.id+':'+(p.rot||0)+':'+p.y));
    for(const [k,l] of layers)if(!keep.has(k)){l.task?.cancel?.();l.el.remove();layers.delete(k);}
    for(const p of want){const k=p.id+':'+(p.rot||0)+':'+p.y;if(!layers.has(k))buildLayer(p,k);}
  }
  async function buildLayer(p,k){
    const token=epoch,el=document.createElement('div');el.className='pdf-tl-page';el.style.top=p.y+'px';el.style.width=W+'px';el.style.height=p.h+'px';
    const entry={el,task:null};layers.set(k,entry);layerRoot.append(el);
    try{
      const [lib]=await libs(),doc=await open();if(!doc||token!==epoch||layers.get(k)!==entry)return;
      const [page,tc]=await Promise.all([doc.getPage(p.source+1),textOf(doc,p)]);if(token!==epoch||layers.get(k)!==entry)return;
      const vp=view(page,p,1),layer=document.createElement('div');layer.className='textLayer';
      layer.style.setProperty('--total-scale-factor',String(vp.scale));layer.style.setProperty('--scale-round-x','1px');layer.style.setProperty('--scale-round-y','1px');
      el.append(layer);entry.task=new lib.TextLayer({textContentSource:tc,container:layer,viewport:vp});await entry.task.render();
    }catch(e){if(layers.get(k)===entry){el.remove();layers.delete(k);}}
  }

  /* ---- import ---- */
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
      M.zoom=Math.max(.2,Math.min(1,(M.vw-24)/W));fitNext='page';N.ui.paintAll();N.ui.refreshTitle();C.markDirty();
      C.saveView(S.id,0,0,M.zoom);C.setActive(S.id);if(!await C.save())throw Error('PDF opened but could not be saved. retry saving before closing.');N.library?.close();N.library?.changed();
      C.toast('PDF ready. write or highlight on the pages; drag the margins to scroll.',6500);return true;
    }catch(e){C.toast(e.message||'could not import this PDF.',7000);return false;}
    finally{busy=false;await doc?.loadingTask.destroy();}
  }
  function choose(){const input=document.createElement('input');input.type='file';input.accept='.pdf,application/pdf';input.hidden=true;document.body.appendChild(input);input.onchange=()=>{const f=input.files?.[0];input.remove();if(f)importFile(f);};input.oncancel=()=>input.remove();input.click();}

  /* ---- export: the original pages, with ink written into them as lines ---- */
  const probe=document.createElement('canvas').getContext('2d');
  function rgbOf(lib,css){probe.fillStyle='#000';probe.fillStyle=css;const v=probe.fillStyle,m=/^#([0-9a-f]{6})$/i.exec(v)||null;if(m){const n=parseInt(m[1],16);return lib.rgb((n>>16&255)/255,(n>>8&255)/255,(n&255)/255);}const r=/rgba?\(([^)]+)\)/.exec(v);const c=r?r[1].split(',').map(Number):[29,29,31];return lib.rgb(c[0]/255,c[1]/255,c[2]/255);}
  /* page space, y down and W wide, onto the PDF page as a reader shows it:
     its crop box, turned by its rotation */
  function matrixFor(page){
    const box=page.getCropBox(),r=((page.getRotation().angle%360)+360)%360,bx=box.x,by=box.y,bw=box.width,bh=box.height,s=(r%180?bh:bw)/W;
    return r===90?[0,s,s,0,bx,by]:r===180?[-s,0,0,s,bx+bw,by]:r===270?[0,-s,-s,0,bx+bw,by+bh]:[s,0,0,-s,bx,by+bh];
  }
  const n2=v=>Math.round(v*100)/100;
  function inkOps(lib,page,p,strokes){
    const o=lib,ops=[],weight=st=>st.author==='user'?1.3:1;
    let multiply=null;
    for(const st of strokes){
      const pts=st.pts,mark=st.author==='mark',color=rgbOf(lib,st.color||(mark?'#FFE066':N.ink.inkColor(st.author)));
      ops.push(o.pushGraphicsState());
      if(mark){multiply=multiply||page.node.newExtGState('NotasMark',page.doc.context.obj({Type:'ExtGState',BM:'Multiply'}));ops.push(o.setGraphicsState(multiply));}
      if(pts.length<6){
        const r=mark?st.w/2:st.w*.6*weight(st),x=pts[0],y=pts[1]-p.y,k=.5523*r;
        ops.push(o.setFillingColor(color),o.moveTo(n2(x+r),n2(y)),o.appendBezierCurve(n2(x+r),n2(y+k),n2(x+k),n2(y+r),n2(x),n2(y+r)),o.appendBezierCurve(n2(x-k),n2(y+r),n2(x-r),n2(y+k),n2(x-r),n2(y)),
          o.appendBezierCurve(n2(x-r),n2(y-k),n2(x-k),n2(y-r),n2(x),n2(y-r)),o.appendBezierCurve(n2(x+k),n2(y-r),n2(x+r),n2(y-k),n2(x+r),n2(y)),o.closePath(),o.fill());
      }else{
        ops.push(o.setStrokingColor(color),o.setLineCap(o.LineCapStyle.Round),o.setLineJoin(o.LineJoinStyle.Round));
        if(mark){
          ops.push(o.setLineWidth(st.w),o.moveTo(n2(pts[0]),n2(pts[1]-p.y)));
          for(let i=3;i<pts.length;i+=3)ops.push(o.lineTo(n2(pts[i]),n2(pts[i+1]-p.y)));
          ops.push(o.stroke());
        }else{
          /* the same runs of equal width the screen draws */
          let width=-1,open=false;
          for(let i=3;i<pts.length;i+=3){
            const w=Math.round(st.w*weight(st)*(.55+.9*pts[i+2])/.25)*.25;
            if(w!==width){if(open)ops.push(o.stroke());ops.push(o.setLineWidth(w),o.moveTo(n2(pts[i-3]),n2(pts[i-2]-p.y)));width=w;open=true;}
            ops.push(o.lineTo(n2(pts[i]),n2(pts[i+1]-p.y)));
          }
          if(open)ops.push(o.stroke());
        }
      }
      ops.push(o.popGraphicsState());
    }
    return ops;
  }
  /* typed lines also go in as invisible words over their picture, so the
     saved PDF can be searched and its notes copied */
  function textOps(lib,page,font,charset,p,lines){
    const typeFont=(getComputedStyle(document.documentElement).getPropertyValue('--type')||'').trim()||'ui-monospace, monospace';
    probe.font='400 16px '+typeFont;
    for(const l of lines){
      const left=(l.x||0)+2,max=Math.max(80,W-(l.x||0))-4;let y=l.y-p.y+3;
      for(const para of String(l.text).split(/\r?\n/)){
        const pieces=/\s/.test(para)?(para.match(/\S+\s*/g)||[]):Array.from(para),rows=[];let row='';
        for(const piece of pieces){const next=row+piece;if(row&&probe.measureText(next).width>max){rows.push(row.trimEnd());row=piece.trimStart();}else row=next;}
        if(row||!pieces.length)rows.push(row.trimEnd());
        for(const text of rows){
          const safe=Array.from(text).filter(ch=>charset.has(ch.codePointAt(0))).join('');
          const wide=safe&&font.widthOfTextAtSize(safe,16),seen=probe.measureText(text).width;
          if(safe&&wide>0){
            page.pushOperators(lib.pushGraphicsState(),lib.concatTransformationMatrix(seen/wide,0,0,-1,n2(left),n2(y+13)));
            page.drawText(safe,{x:0,y:0,size:16,font,opacity:0});
            page.pushOperators(lib.popGraphicsState());
          }
          y+=22.4;
        }
      }
    }
  }
  function rasterNeeded(p){
    const top=p.y,bottom=p.y+p.h,on=(a,b)=>b>top&&a<bottom;
    if(S.images.some(im=>{const b=C.imageBounds(im);return on(b[1],b[3]);}))return true;
    if(S.lines.some(l=>l.text&&ownerIn(S.pdf.pages,l.y)===S.pdf.pages.indexOf(p)))return true;
    return [...document.querySelectorAll('#margin .chip, #margin .plot')].some(el=>{const y=parseFloat(el.style.top)||0;return on(y,y+el.offsetHeight);});
  }
  async function exportFile(){
    if(!S.pdf||busy)return null;busy=true;$('pdf-save').disabled=true;
    try{
      N.ink.finishInput();await document.fonts.ready;const pdf=S.pdf,id=S.id,revision=C.revision;
      const check=()=>{if(S.id!==id||S.pdf!==pdf||C.revision!==revision)throw Error('the note changed during export. try saving the PDF again.');};
      C.toast('saving PDF…',30000);const [,lib]=await libs();check();
      const source=await lib.PDFDocument.load(bytes(pdf.data)),out=await lib.PDFDocument.create();
      const font=await out.embedFont(lib.StandardFonts.Helvetica),charset=new Set(font.getCharacterSet());
      /* one copy of all the pages, so fonts and pictures they share are kept once */
      const used=pdf.pages.filter(p=>p.source!==null),copies=await out.copyPages(source,used.map(p=>p.source)),copyOf=new Map(used.map((p,i)=>[p.id,copies[i]]));check();
      let loaded=null;
      for(const [index,p] of pdf.pages.entries()){
        check();let page;
        if(p.source===null)page=out.addPage([595.28,595.28*p.h/W]);
        else{page=out.addPage(copyOf.get(p.id));if(p.rot)page.setRotation(lib.degrees((page.getRotation().angle+p.rot)%360));}
        const m=matrixFor(page),own=x=>ownerIn(pdf.pages,x)===index;
        if(rasterNeeded(p)){
          loaded=loaded||await Promise.all(S.images.map(im=>new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve({im,el});el.onerror=()=>reject(Error('an image could not be loaded. retry saving the PDF.'));el.src=im.src;})));check();
          const cv=await N.ui.renderExport({bounds:{left:0,top:p.y,width:W,height:p.h},top:p.y,height:p.h,loaded,transparent:true,noPdf:true,noStrokes:true,check});
          try{
            check();const png=await new Promise(r=>cv.toBlob(r,'image/png'));if(!png)throw Error('could not render PDF annotations.');
            const image=await out.embedPng(await png.arrayBuffer());
            page.pushOperators(lib.pushGraphicsState(),lib.concatTransformationMatrix(...m),lib.concatTransformationMatrix(1,0,0,-1,0,p.h));
            page.drawImage(image,{x:0,y:0,width:W,height:p.h});
            page.pushOperators(lib.popGraphicsState());
          }finally{cv.width=cv.height=0;}
        }
        const strokes=S.strokes.filter(st=>st.pts?.length>=3&&(st.author==='user'||st.author==='ai'||st.author==='mark')&&own(st.pts[1]));
        strokes.sort((a,b)=>(b.author==='mark')-(a.author==='mark'));
        const lines=S.lines.filter(l=>l.text&&own(l.y));
        if(strokes.length||lines.length){
          page.pushOperators(lib.pushGraphicsState(),lib.concatTransformationMatrix(...m),lib.rectangle(0,0,W,p.h),lib.clip(),lib.endPath());
          page.pushOperators(...inkOps(lib,page,p,strokes));
          textOps(lib,page,font,charset,p,lines);
          page.pushOperators(lib.popGraphicsState());
        }
      }
      check();out.setTitle(S.title||pdf.name);const data=await out.save();check();const blob=new Blob([data],{type:'application/pdf'}),url=URL.createObjectURL(blob);N.ui.download((S.title||'document')+'.pdf',url);setTimeout(()=>URL.revokeObjectURL(url),60000);await C.save();C.toast('annotated PDF saved.');return data;
    }catch(e){C.toast(e.message||'could not save this PDF.',7000);return null;}
    finally{busy=false;$('pdf-save').disabled=false;}
  }

  /* ---- wiring ---- */
  $('pdf-toggle').onclick=()=>setSide(!sideOpen);$('pdf-close').onclick=()=>setSide(false);$('pdf-prev').onclick=()=>go(current()-1);$('pdf-next').onclick=()=>go(current()+1);$('pdf-add').onclick=()=>insertBlank();$('pdf-save').onclick=()=>exportFile();
  $('pdf-fit').onclick=fit;$('pdf-search').onclick=()=>find.hidden?openFind():closeFind();
  act('pdf-up').onclick=()=>movePage(current(),-1);act('pdf-down').onclick=()=>movePage(current(),1);act('pdf-rotate').onclick=()=>rotatePage(current());act('pdf-delete').onclick=()=>deletePage(current());
  $('pdf-find-prev').onclick=()=>step(-1);$('pdf-find-next').onclick=()=>step(1);$('pdf-find-close').onclick=closeFind;
  let typing=0;
  $('pdf-find-input').addEventListener('input',e=>{clearTimeout(typing);const q=e.target.value;typing=setTimeout(()=>search(q),160);});
  $('pdf-find-input').addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();clearTimeout(typing);if(e.target.value!==query)search(e.target.value);else step(e.shiftKey?-1:1);}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeFind();}
  });
  side.addEventListener('scroll',queueVisible,{passive:true});sc.addEventListener('scroll',()=>{updateCounter();queueVisible();},{passive:true});
  document.addEventListener('keydown',e=>{
    if(!S.pdf||document.querySelector('.sheet:not(.leave)'))return;
    const mod=e.ctrlKey||e.metaKey;
    if(mod&&!e.altKey&&e.key.toLowerCase()==='f'){e.preventDefault();openFind();return;}
    if(e.key==='Escape'&&sideOpen&&!find.contains(e.target)){setSide(false);return;}
    if(mod||e.altKey||N.ink.isTyping(e)||find.contains(e.target))return;
    if(e.key==='PageDown'){e.preventDefault();go(current()+1);}
    else if(e.key==='PageUp'){e.preventDefault();go(current()-1);}
  });
  /* With the text tool the ink canvas steps aside, so a mouse or pen press in
     the margins drags the document here instead of starting a selection. */
  let drag=null;
  document.addEventListener('pointerdown',e=>{
    if(!S.pdf||S.tool!=='text'||e.pointerType==='touch'||e.button!==0||!e.isPrimary)return;
    if(!e.target.closest?.('#scroller')||e.target.closest('.line,.chip,.plot,input,textarea,button,a'))return;
    const w=N.ink.toWorld(e);if(pageAt(w.y,w.x))return;
    e.preventDefault();e.stopPropagation();drag={id:e.pointerId,x:e.clientX,y:e.clientY};
  },true);
  addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;sc.scrollLeft-=e.clientX-drag.x;sc.scrollTop-=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;e.preventDefault();},{passive:false});
  for(const type of ['pointerup','pointercancel'])addEventListener(type,e=>{if(drag&&e.pointerId===drag.id){drag=null;e.stopPropagation();}},true);
  document.addEventListener('selectstart',e=>{if(drag)e.preventDefault();},true);
  document.addEventListener('drop',e=>{const file=[...(e.dataTransfer?.files||[])].find(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name));if(file){e.preventDefault();e.stopImmediatePropagation();importFile(file);}},{capture:true});
  N.pdf={validate,draw,refresh,pageAt,current,go,choose,importFile,insertBlank,movePage,rotatePage,deletePage,exportFile,paintBackground,libs,clip,fit,search,openFind,closeFind,width:W};
})();
