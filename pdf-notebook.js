/* PDF pages are locked paper. Ink, text and pictures remain ordinary Notas
 * objects in page coordinates; only the original PDF and page order are new. */
(()=>{
  'use strict';
  const C=N.core,{S,M}=C,W=720,GAP=28,TOP=32,MAX_PAGES=20000,ROTS=[0,90,180,270];
  /* There is no size limit of Notas's own. The original file is kept once,
     apart from the note, so saving a note never rewrites it; what remains is
     the device's space, and an ArrayBuffer's reach. A browser with no
     IndexedDB keeps PDFs inside its few megabytes of localStorage. */
  const HARD_BYTES=2*1024**3-1,SMALL_BYTES=3*1024*1024,BLOB='notas.pdfdata.';
  /* decoded pages are the memory hog: about 40 million pixels in all, which
     still lets the page under a pinch be drawn at the screen's own sharpness */
  const PIXEL_BUDGET=40e6,PAGE_PIXELS=16e6;
  let libraries,active=null,loading=null,epoch=0,busy=false,sideOpen=false,paintQueued=false,fitNext='page';
  const bitmaps=new Map(),pending=new Map(),failed=new Set(),thumbs=new Set(),texts=new Map(),annots=new Map(),held=new Map();
  const sc=document.getElementById('scroller');
  const style=document.createElement('style');
  style.textContent=`
    #pdf-nav{position:fixed;z-index:31;left:50%;transform:translateX(-50%);bottom:calc(var(--edge) + var(--safe-b) + 66px);display:flex;align-items:center;gap:2px;padding:5px;border-radius:var(--r-pill);color:var(--graphite);font:500 13px/1 var(--ui);max-width:calc(100vw - 16px);box-sizing:border-box}
    #pdf-nav[hidden],#pdf-pages[hidden],#pdf-find[hidden],#pdf-ask[hidden],#pdf-ask-chip[hidden],#pdf-outline[hidden],#pdf-page-list[hidden]{display:none}
    #pdf-nav button,#pdf-pages button,#pdf-find button,#pdf-ask button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:38px;height:38px;padding:0 8px;border-radius:var(--r-pill);color:var(--ink-2);font:500 13px/1 var(--ui);font-size:18px;transition:background-color .15s ease,color .15s ease,transform .18s var(--pop)}
    #pdf-nav button:hover:not(:disabled),#pdf-pages button:hover:not(:disabled),#pdf-find button:hover:not(:disabled),#pdf-ask button:hover:not(:disabled){background:var(--tint);color:var(--graphite)}
    #pdf-nav button:active:not(:disabled),#pdf-pages button:active:not(:disabled),#pdf-find button:active:not(:disabled),#pdf-ask button:active:not(:disabled){transform:scale(.92)}
    #pdf-nav button:disabled,#pdf-pages button:disabled,#pdf-find button:disabled,#pdf-ask button:disabled{opacity:.32;cursor:default}
    #pdf-nav :focus-visible,#pdf-pages :focus-visible,#pdf-find :focus-visible,#pdf-ask :focus-visible,#pdf-ask-chip:focus-visible{outline:2px solid var(--graphite);outline-offset:2px}
    #pdf-nav button[aria-expanded="true"],#pdf-pages header button[aria-pressed="true"]{background:var(--tint-2);color:var(--graphite)}
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
    #pdf-page-list,#pdf-outline{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:4px 12px 12px;display:grid;align-content:start;gap:10px;scrollbar-width:thin}
    .pdf-item{display:grid;gap:6px}
    #pdf-pages .pdf-thumb{display:grid;justify-items:center;gap:6px;height:auto;padding:6px;border-radius:12px;font:500 11px var(--ui);color:var(--ink-2)}
    #pdf-pages .pdf-thumb[aria-current="page"]{background:var(--tint-2);color:var(--graphite)}
    #pdf-pages .pdf-thumb[aria-current="page"] .pdf-mini{box-shadow:0 0 0 2px var(--graphite)}
    .pdf-mini{width:112px;display:block;background:#fff;border-radius:3px;overflow:hidden;box-shadow:0 0 0 1px var(--rule),0 1px 4px rgba(0,0,0,.08)}
    .pdf-mini canvas{display:block;width:100%;height:100%}
    .pdf-acts{display:flex;justify-content:center;gap:0;padding:2px;border-radius:var(--r-pill);background:var(--tint)}
    #pdf-pages .pdf-acts button{flex:1;min-width:0;height:32px;padding:0;font-size:15px}
    #pdf-pages .pdf-acts button.danger:hover:not(:disabled){color:var(--red)}
    #pdf-outline{gap:2px;padding:4px 8px 12px}
    #pdf-pages #pdf-outline button{display:block;width:100%;height:auto;min-height:34px;padding:8px 8px 8px calc(8px + var(--depth,0) * 12px);text-align:left;font:400 13px/1.35 var(--ui);color:var(--graphite);border-radius:10px;overflow-wrap:anywhere}
    #pdf-pages #pdf-outline button[data-depth="0"]{font-weight:500}
    #pdf-ask-chip{position:fixed;z-index:34;display:inline-flex;align-items:center;height:36px;padding:0 15px;border-radius:var(--r-pill);background:var(--graphite);color:var(--paper);font:500 13px var(--ui);box-shadow:var(--shadow);animation:pdf-chip-in .18s ease-out both}
    @keyframes pdf-chip-in{from{opacity:0;translate:0 4px}to{opacity:1;translate:0 0}}
    :root{--pdf-chat-width:480px;--pdf-chat-ease:cubic-bezier(.22,1,.36,1)}
    #pdf-ask{position:fixed;z-index:33;left:auto;right:calc(var(--edge) + var(--safe-r));top:calc(var(--bar) + 12px);bottom:calc(var(--edge) + var(--safe-b));width:var(--pdf-chat-width);box-sizing:border-box;display:flex;flex-direction:column;border-radius:20px;border:1px solid var(--rule);background:var(--panel);color:var(--graphite);font:400 14px/1.8 var(--ui);overflow:hidden;animation:pdf-chat-in .4s var(--pdf-chat-ease) both}
    #pdf-ask.leaving{pointer-events:none;animation:pdf-chat-out .36s cubic-bezier(.4,0,.2,1) both}
    @keyframes pdf-chat-in{from{opacity:0;translate:20px 0}to{opacity:1;translate:0 0}}
    @keyframes pdf-chat-out{to{opacity:0;translate:24px 0;scale:.985}}
    #pdf-ask header{display:flex;align-items:center;gap:4px;min-height:65px;padding:10px 15px 8px 23px;flex:none}
    #pdf-ask header strong{flex:1;font:600 17px var(--ui);letter-spacing:-.4px}
    #pdf-ask header button{min-width:32px;width:32px;height:32px;font-size:17px}
    #pdf-ask header #pdf-ask-new{width:auto;min-width:0;padding:0 10px;font:400 13px var(--ui);white-space:nowrap}
    #pdf-ask-messages{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:20px 23px 8px;scrollbar-width:thin;scrollbar-color:var(--ink-3) transparent;-webkit-user-select:text;user-select:text}
    #pdf-ask .pdf-message{margin:0 0 25px;overflow-wrap:anywhere;animation:pdf-message-in .25s var(--pdf-chat-ease) both;-webkit-user-select:text;user-select:text}
    #pdf-ask .pdf-message.user{margin-left:28px;padding:12px 16px;background:var(--tint);border-radius:15px 15px 4px 15px;line-height:1.65;white-space:pre-wrap}
    #pdf-ask .pdf-message p{margin:0 0 13px}#pdf-ask .pdf-message p:last-child{margin-bottom:0}
    #pdf-ask .pdf-message ol,#pdf-ask .pdf-message ul{padding-left:22px;margin:15px 0}
    #pdf-ask .pdf-message li{padding:0 0 8px 4px}#pdf-ask .pdf-message li::marker{color:var(--nota);font-size:12px}
    #pdf-ask .pdf-message strong{font-weight:600}#pdf-ask .pdf-message code{font:13px var(--mono);white-space:pre-wrap}
    #pdf-ask .pdf-message pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:var(--tint);border-radius:10px}
    #pdf-ask .pdf-message .katex-display{max-width:100%;overflow:auto;font-size:1em}
    #pdf-ask .pdf-message.wait{color:var(--ink-2)}#pdf-ask .pdf-message.error{color:var(--nota)}
    @keyframes pdf-message-in{from{opacity:0;translate:0 6px}to{opacity:1;translate:0 0}}
    #pdf-ask .pdf-message-actions{display:flex;margin-top:12px}
    #pdf-ask .pdf-message-actions button{min-width:28px;width:28px;height:28px;font-size:14px}
    #pdf-ask-compose{flex:none;padding:13px 14px 14px;background:var(--panel);position:relative}
    #pdf-ask form{margin:0;padding:13px 13px 10px;border-radius:15px;border:1px solid var(--rule);background:var(--panel)}
    #pdf-ask form:focus-within{border-color:var(--ink-2);box-shadow:0 0 0 3px var(--tint)}
    #pdf-ask textarea{display:block;box-sizing:border-box;width:100%;resize:none;border:0;background:transparent;color:var(--graphite);font:400 16px/1.6 var(--ui);outline:none;min-height:55px;max-height:170px;overflow-y:auto;padding:0 2px;caret-color:var(--graphite);scrollbar-width:thin;-webkit-user-select:text;user-select:text}
    #pdf-ask textarea:focus-visible{outline:none}
    #pdf-ask textarea::placeholder{color:var(--ink-2);opacity:1}
    #pdf-ask .pdf-compose-bottom{display:flex;justify-content:space-between;align-items:center;min-height:34px;padding-top:5px}
    #pdf-ask .pdf-compose-hint{font:400 11px var(--ui);color:var(--ink-2)}
    #pdf-ask form button.go{background:var(--graphite);color:var(--paper);min-width:34px;width:34px;height:34px;font-size:18px;padding:0}
    #pdf-ask form button.go:disabled{background:var(--tint);color:var(--ink-2);opacity:1}
    #pdf-ask #pdf-ask-latest{position:absolute;right:22px;top:-32px;min-width:0;height:28px;padding:0 10px;border:1px solid var(--rule);background:var(--panel);font:400 11px var(--ui);box-shadow:var(--shadow)}
    #pdf-context-highlight,.pdf-context-retired{position:absolute;inset:0;pointer-events:none;z-index:4;mix-blend-mode:multiply}
    #pdf-context-highlight > span,.pdf-context-retired > span{position:absolute;background:rgba(0,0,0,calc(var(--pdf-context-opacity,1) * .16));pointer-events:none}
    body:has(#pdf-ask:not([hidden])) #app-recommendation,body:has(#pdf-find:not([hidden])) #app-recommendation{display:none}
    @media(min-width:1100px) and (pointer:fine){
      body.pdf-chat-open #scroller{right:calc(var(--pdf-chat-width) + var(--edge) * 2 + var(--safe-r))}
      body.pdf-chat-open #pdf-nav{right:calc(var(--pdf-chat-width) + var(--edge) * 2 + var(--safe-r))}
      body.pdf-chat-wide{--pdf-chat-width:min(560px,45vw)}
    }
    @media(max-width:1099px),(pointer:coarse){
      #pdf-ask{left:12px;right:12px;top:24%;bottom:calc(12px + var(--safe-b));width:auto;max-width:600px;margin-left:auto;margin-right:auto;animation-name:pdf-chat-sheet-in}
      #pdf-ask.wide{top:calc(var(--bar) + 8px)}#pdf-ask.leaving{animation-name:pdf-chat-sheet-out}
      #pdf-ask header{min-height:55px}#pdf-ask textarea{max-height:120px}
      #pdf-ask-compose{padding-bottom:max(12px,var(--safe-b))}
      body.pdf-chat-open #pdf-nav{visibility:hidden}
      @keyframes pdf-chat-sheet-in{from{opacity:0;translate:0 25px}to{opacity:1;translate:0 0}}
      @keyframes pdf-chat-sheet-out{to{opacity:0;translate:0 42px}}
    }
    @media(prefers-reduced-motion:reduce){#pdf-ask,#pdf-ask-chip,#pdf-ask .pdf-message{animation-duration:.01ms!important}}
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
    .pdf-pass-note{min-height:1.4em;margin:6px 2px 0!important;font-size:13px!important}
    .pdf-pass-note.bad{color:var(--red)!important}
    body.pdf-notebook #lines .txt{color:var(--pdf-text-ink,#1d1d1f)}
    body.pdf-notebook #lines .line.tutor .txt{color:var(--nota)}
    /* the PDF's own words, invisible over the page: drag over them with the
       text tool to select and copy, as in any PDF reader. Its links and form
       fields sit on top, also for the text tool. */
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
    #pdf-tl .textLayer ::selection{background:rgba(0,0,0,.16);color:transparent}
    #pdf-tl .textLayer br::selection{background:transparent}
    #pdf-tl .textLayer.selecting .endOfContent{top:0}
    #pdf-tl .textLayer .endOfContent{display:block;position:absolute;inset:100% 0 0;z-index:0;cursor:default;-webkit-user-select:none;user-select:none}
    #pdf-tl .pdf-link{position:absolute;z-index:2;border-radius:2px}
    body[data-tool="text"] #pdf-tl .pdf-link:hover{background:rgba(47,111,179,.12);box-shadow:inset 0 -1.5px 0 rgba(47,111,179,.6)}
    #pdf-tl .pdf-field{position:absolute;z-index:3;box-sizing:border-box;margin:0;border:0;border-radius:2px;padding:0 3px;background:transparent;color:transparent;caret-color:#1d1d1f;font-family:Helvetica,Arial,sans-serif;resize:none;outline:none;-webkit-user-select:text;user-select:text;appearance:none;-webkit-appearance:none}
    body[data-tool="text"] #pdf-tl .pdf-field{background:rgba(47,111,179,.07);box-shadow:inset 0 0 0 1px rgba(47,111,179,.32);cursor:text}
    body[data-tool="text"] #pdf-tl button.pdf-field,body[data-tool="text"] #pdf-tl select.pdf-field{cursor:pointer}
    #pdf-tl .pdf-field:focus{background:#fff;color:#1d1d1f;box-shadow:inset 0 0 0 2px #2F6FB3}
    #pdf-tl select.pdf-field:focus{color:transparent;background:rgba(47,111,179,.07)}
    #pdf-tl select.pdf-field option{color:#1d1d1f;background:#fff}
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
  side.innerHTML='<header><strong id="pdf-side-title">pages</strong><button id="pdf-outline-btn" type="button" hidden title="contents" aria-label="show contents" aria-pressed="false"><i class="ph ph-list-bullets" aria-hidden="true"></i></button><button id="pdf-add" type="button" title="insert a blank page after this one" aria-label="insert a blank page after this page"><i class="ph ph-file-plus" aria-hidden="true"></i></button><button id="pdf-close" type="button" title="close" aria-label="close pages"><i class="ph ph-x" aria-hidden="true"></i></button></header><div id="pdf-page-list"></div><nav id="pdf-outline" hidden aria-label="contents"></nav>';
  document.body.appendChild(side);
  const acts=document.createElement('div');acts.className='pdf-acts';acts.setAttribute('role','group');
  acts.innerHTML='<button id="pdf-up" type="button" title="move page up" aria-label="move page up"><i class="ph ph-arrow-up" aria-hidden="true"></i></button><button id="pdf-down" type="button" title="move page down" aria-label="move page down"><i class="ph ph-arrow-down" aria-hidden="true"></i></button><button id="pdf-rotate" type="button" title="rotate page" aria-label="rotate page clockwise"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i></button><button id="pdf-delete" class="danger" type="button" title="delete page" aria-label="delete page"><i class="ph ph-trash" aria-hidden="true"></i></button>';
  const chip=document.createElement('button');chip.id='pdf-ask-chip';chip.type='button';chip.hidden=true;chip.textContent='ask nota';
  document.body.appendChild(chip);
  const askBox=document.createElement('section');askBox.id='pdf-ask';askBox.hidden=true;askBox.setAttribute('aria-label','ask nota');
  askBox.innerHTML='<header><strong>nota</strong><button id="pdf-ask-new" type="button" title="new chat" aria-label="new chat">new chat</button><button id="pdf-ask-expand" type="button" title="expand chat" aria-label="expand chat" aria-pressed="false"><i class="ph ph-arrows-out-simple" aria-hidden="true"></i></button><button id="pdf-ask-close" type="button" title="close (Esc)" aria-label="close"><i class="ph ph-x" aria-hidden="true"></i></button></header>'+
    '<div id="pdf-ask-messages" role="log" aria-label="conversation with nota" aria-live="off"></div><div id="pdf-ask-compose"><button id="pdf-ask-latest" type="button" hidden>latest reply <i class="ph ph-arrow-down" aria-hidden="true"></i></button>'+
    '<form id="pdf-ask-form"><textarea id="pdf-ask-input" rows="2" placeholder="ask about this passage…" aria-label="your question about this passage" autocomplete="off" enterkeyhint="send"></textarea><div class="pdf-compose-bottom"><span class="pdf-compose-hint">Shift + Enter for a new line</span><button class="go" id="pdf-ask-send" type="submit" title="ask" aria-label="ask" disabled><i class="ph ph-arrow-up" aria-hidden="true"></i></button></div></form></div><span id="pdf-ask-status" role="status" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)"></span>';
  document.body.appendChild(askBox);
  const layerRoot=document.createElement('div');layerRoot.id='pdf-tl';
  const $=id=>document.getElementById(id),act=id=>acts.querySelector('#'+id);
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const mb=n=>(n/1048576).toFixed(n<10485760?1:0)+' MB';

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
  function clip(ctx,st,pdf=S.pdf){
    if(!pdf?.pages?.length||!st?.pts?.length)return false;
    const p=pdf.pages[ownerIn(pdf.pages,st.pts[1])];
    ctx.save();ctx.beginPath();ctx.rect(0,p.y,W,p.h);ctx.clip();return true;
  }
  /* the index of the page a stroke belongs to, so highlights can be grouped
     per page and clipped together */
  function pageOf(st,pdf=S.pdf){
    return pdf?.pages?.length&&st?.pts?.length?ownerIn(pdf.pages,st.pts[1]):-1;
  }
  function current(){
    if(!S.pdf)return 0;
    const y=(sc.scrollTop+Math.min(160,M.vh/3))/M.zoom;
    return indexAt(S.pdf.pages,y);
  }
  function position(pages){let y=TOP;for(const p of pages){p.y=y;y+=p.h+GAP;}return y;}
  function validate(value){
    if(value==null)return null;
    const inline=typeof value?.data==='string';
    if(!value||typeof value!=='object'||(inline?value.data.length>Math.ceil(HARD_BYTES/3)*4||!/^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(value.data)||value.data.length%4:!/^[0-9a-f]{64}$/.test(value.ref||''))||!Array.isArray(value.pages)||!value.pages.length||value.pages.length>MAX_PAGES)throw Error('this note contains invalid PDF data.');
    const ids=new Set();
    const pages=value.pages.map(p=>{
      if(!p||typeof p.id!=='string'||p.id.length>100||ids.has(p.id)||!Number.isFinite(p.h)||p.h<60||p.h>10000||!(p.source===null||Number.isInteger(p.source)&&p.source>=0&&p.source<MAX_PAGES)||p.rot!==undefined&&!ROTS.includes(p.rot))throw Error('this note contains invalid PDF pages.');
      ids.add(p.id);return {id:p.id,source:p.source,h:p.h,y:0,...(p.rot?{rot:p.rot}:{})};
    });
    position(pages);
    let fields;
    if(value.fields!==undefined){
      const f=value.fields,keys=f&&typeof f==='object'&&!Array.isArray(f)?Object.keys(f):null;
      if(!keys||keys.length>5000||keys.some(k=>k.length>500||!(typeof f[k]==='boolean'||typeof f[k]==='string'&&f[k].length<=100000)))throw Error('this note contains invalid PDF form data.');
      if(keys.length)fields=Object.fromEntries(keys.map(k=>[k,f[k]]));
    }
    return {name:typeof value.name==='string'?value.name.slice(0,500):'document.pdf',...(inline?{data:value.data}:{ref:value.ref,...(Number.isFinite(value.size)?{size:value.size}:{})}),pages,...(fields?{fields}:{})};
  }
  function bytes(data){const raw=atob(data),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
  function base64(data){let s='';for(let i=0;i<data.length;i+=32768)s+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(s);}

  /* ---- the original file: stored once under its own SHA-256, beside the notes ---- */
  function canStore(){return !C.Store.lsOnly&&!!window.idbKeyval;}
  async function sha256(b){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function keep(ref,b){held.delete(ref);held.set(ref,b);while(held.size>2)held.delete(held.keys().next().value);}
  async function bytesOf(pdf){
    if(pdf.data)return bytes(pdf.data);
    if(held.has(pdf.ref))return held.get(pdf.ref);
    let v=null;try{v=canStore()?await idbKeyval.get(BLOB+pdf.ref):null;}catch(e){}
    if(!v?.blob)throw Error('this PDF is no longer on this device. import it again, or restore a backup that includes it.');
    const b=new Uint8Array(await v.blob.arrayBuffer());keep(pdf.ref,b);return b;
  }
  async function put(b){
    const ref=await sha256(b);
    let have=null;try{have=await idbKeyval.get(BLOB+ref);}catch(e){}
    if(!have?.blob){
      try{await idbKeyval.set(BLOB+ref,{v:1,at:Date.now(),size:b.length,blob:new Blob([b],{type:'application/pdf'})});}
      catch(e){throw Error('there is not enough space on this device for this PDF ('+mb(b.length)+').');}
    }
    keep(ref,b);return ref;
  }
  /* a PDF carried inside an imported backup moves to its own record */
  async function stash(pdf){
    if(!pdf?.data||!canStore())return pdf;
    const b=bytes(pdf.data),ref=await put(b),{data,...rest}=pdf;return {...rest,ref,size:b.length};
  }
  /* and goes back inside a note that leaves the device */
  async function inline(doc){
    if(!doc?.pdf?.ref||doc.pdf.data)return doc;
    const b=await bytesOf(doc.pdf),{ref,size,...rest}=doc.pdf;return {...doc,pdf:{...rest,data:base64(b)}};
  }
  /* notes made before the PDF lived apart are moved on their first opening;
     an encrypted original from then is unlocked on the way */
  async function migrate(pdf){
    if(!pdf.data||!canStore())return;
    try{
      let b=bytes(pdf.data);
      if(locked(b))try{b=await unlock(b,pdf.name,false);}catch(e){}
      const ref=await put(b);
      if(S.pdf!==pdf||!pdf.data)return;
      delete pdf.data;pdf.ref=ref;pdf.size=b.length;C.markDirty();
    }catch(e){}
  }
  /* a stored PDF that no note, copy or rescue refers to any more goes, an
     hour after it was stored at the earliest */
  async function collect(){
    if(!canStore())return;
    const keys=await idbKeyval.keys(),blobs=keys.filter(k=>typeof k==='string'&&k.startsWith(BLOB));if(!blobs.length)return;
    const used=new Set(held.keys());if(S.pdf?.ref)used.add(S.pdf.ref);
    const scan=t=>{for(const m of String(t||'').matchAll(/"ref":"([0-9a-f]{64})"/g))used.add(m[1]);};
    for(const k of keys){if(typeof k!=='string'||k.startsWith(BLOB)||k.startsWith('notas.thumb.'))continue;try{const v=await idbKeyval.get(k);if(v&&typeof v==='object')scan(JSON.stringify(v));}catch(e){}}
    try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('notas.'))scan(localStorage.getItem(k));}}catch(e){return;}
    for(const k of blobs){
      const ref=k.slice(BLOB.length);if(used.has(ref))continue;
      let v=null;try{v=await idbKeyval.get(k);}catch(e){}
      if(v&&Date.now()-(v.at||0)<36e5)continue;
      try{await idbKeyval.del(k);}catch(e){}
    }
  }

  /* ---- encrypted PDFs: qpdf, in a worker, writes them unlocked ---- */
  function locked(b){
    const t=[47,69,110,99,114,121,112,116];  // "/Encrypt"
    outer:for(let i=b.indexOf(47);i>=0&&i<=b.length-8;i=b.indexOf(47,i+1)){for(let j=1;j<8;j++)if(b[i+j]!==t[j])continue outer;return true;}
    return false;
  }
  function qpdf(b,password){
    return new Promise((resolve,reject)=>{
      const w=new Worker(new URL('./assets/pdf/qpdf/worker.js',location.href)),copy=b.slice();
      w.onmessage=({data})=>{w.terminate();data.ok?resolve(data.data):reject(Object.assign(Error(data.error),{password:data.password}));};
      w.onerror=e=>{e.preventDefault?.();w.terminate();reject(Error('could not load the PDF unlocker. check your connection, then try again.'));};
      w.postMessage({data:copy,password},[copy.buffer]);
    });
  }
  async function unlock(b,name,ask){
    let password='',tries=0;
    for(;;){
      try{return await qpdf(b,password);}
      catch(e){
        if(!e.password||!ask)throw Error(e.password?'this PDF needs its password.':'could not unlock this PDF.');
        password=await askPassword(name,tries++>0);
        if(password===null)throw Object.assign(Error('the PDF was not opened.'),{cancelled:true});
      }
    }
  }
  function askPassword(name,wrong){
    return new Promise(resolve=>{
      const box=N.ui.openSheet('<h2>password needed</h2><form class="lib-form"><p>'+esc(name)+' is locked. enter its password to open it. notas keeps an unlocked copy with this note, on this device.</p>'+
        '<input class="keyin" type="password" aria-label="PDF password" placeholder="password" autocomplete="off" enterkeyhint="go"><p class="pdf-pass-note'+(wrong?' bad':'')+'" role="status">'+(wrong?'that password did not open it. try again.':'')+'</p>'+
        '<div class="sheet-act"><button class="sheet-cta" type="submit">open</button></div></form>',{fit:true});
      let done=false;
      const finish=v=>{if(done)return;done=true;clearInterval(watch);resolve(v);};
      const watch=setInterval(()=>{if(!box.isConnected)finish(null);},150);
      box.querySelector('form').onsubmit=e=>{e.preventDefault();const v=box.querySelector('input').value;finish(v);N.ui.closeSheet(true);};
      setTimeout(()=>box.querySelector('input')?.focus(),30);
    });
  }

  async function libs(){
    if(!libraries)libraries=Promise.all([
      import('./assets/pdf/pdf.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc=new URL('./assets/pdf/pdf.worker.mjs',location.href).href;return lib;}),
      new Promise((resolve,reject)=>{if(window.PDFLib)return resolve(window.PDFLib);const s=document.createElement('script');s.src='./assets/pdf/pdf-lib.js';s.onload=()=>resolve(window.PDFLib);s.onerror=()=>{s.remove();reject(Error('could not load PDF tools.'));};document.head.appendChild(s);})
    ]).catch(e=>{libraries=null;throw e;});
    return libraries;
  }
  async function documentFrom(b){
    const [lib]=await libs();
    /* PDF.js takes the buffer it is given: it gets a copy */
    const task=lib.getDocument({data:b.slice(),cMapUrl:new URL('./assets/pdf/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('./assets/pdf/standard_fonts/',location.href).href,wasmUrl:new URL('./assets/pdf/wasm/',location.href).href,isEvalSupported:false,enableXfa:false});
    task.onPassword=()=>task.destroy();
    try{return await task.promise;}catch(e){throw Error(/password|destroy/i.test(String(e))?'this PDF needs its password. import it again to enter it.':'could not open this PDF. check that the file is a valid PDF.');}
  }
  function open(){
    const pdf=S.pdf,token=epoch;
    if(!loading)loading=bytesOf(pdf).then(documentFrom).then(doc=>{if(token!==epoch){doc.loadingTask.destroy();return null;}active=doc;return doc;}).catch(e=>{if(token===epoch)loading=null;throw e;});
    return loading;
  }
  function reset(){
    epoch++;active?.loadingTask.destroy();active=null;loading=null;
    for(const b of bitmaps.values())b.cv.width=b.cv.height=0;
    bitmaps.clear();pending.clear();failed.clear();thumbs.clear();texts.clear();annots.clear();clearLayers();closeFind();closeAsk(true);chatSession=null;passage=null;outlineFor=null;
  }
  /* a page as the reader sees it: the PDF's own turn plus the one given here */
  function view(page,p,k){
    const rotation=((page.rotate||0)+(p.rot||0))%360,base=page.getViewport({scale:1,rotation});
    return page.getViewport({scale:k*W/base.width,rotation});
  }
  function annotationsOf(doc,p){
    if(!annots.has(p.source))annots.set(p.source,doc.getPage(p.source+1).then(page=>page.getAnnotations({intent:'display'})).catch(()=>[]));
    return annots.get(p.source);
  }
  async function renderPage(p,k){
    const doc=await open();if(!doc)throw Error('stale');
    const [lib]=await libs(),page=await doc.getPage(p.source+1),viewport=view(page,p,k),cv=document.createElement('canvas');
    await fill(doc,p);
    cv.width=Math.ceil(viewport.width);cv.height=Math.ceil(viewport.height);
    /* form fields are drawn with the values filled in here */
    await page.render({canvasContext:cv.getContext('2d'),viewport,background:'white',annotationMode:lib.AnnotationMode.ENABLE_STORAGE}).promise;
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
      bitmaps.delete(p.id);bitmaps.set(p.id,{cv,k,rot});trim(p.id);thumbs.delete(p.id);paintThumb(p);N.ink.render();
    }).catch(e=>{if(token!==epoch||e?.message==='stale')return;failed.add(p.id);C.toast(e?.message||'could not render this PDF page.',6000);})
      .finally(()=>{if(token===epoch)pending.delete(p.id);});
  }
  function queueVisible(){
    if(paintQueued)return;paintQueued=true;requestAnimationFrame(()=>{
      paintQueued=false;if(!S.pdf)return;
      for(const p of S.pdf.pages)if(onScreen(p,500))request(p);
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
    drawHits(ctx);queueVisible();paintChatHighlight();
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

  /* Draw stored PDFs for note thumbnails, including PDFs from inactive notes. */
  async function paintThumbBackground(ctx,pdf,top,height){
    if(!pdf?.pages)return;
    const current=pdf===S.pdf;
    const doc=current?await open():await bytesOf(pdf).then(documentFrom);
    if(!doc)return;
    try{
      for(const p of pdf.pages){
        if(p.y+p.h<=top||p.y>=top+height)continue;
        ctx.fillStyle='#fff';ctx.fillRect(0,p.y,W,p.h);
        if(p.source===null)continue;
        const page=await doc.getPage(p.source+1),viewport=view(page,p,Math.min(1,Math.sqrt(3e6/(W*p.h))));
        const cv=document.createElement('canvas');
        cv.width=Math.ceil(viewport.width);cv.height=Math.ceil(viewport.height);
        try{
          await page.render({canvasContext:cv.getContext('2d'),viewport,background:'white'}).promise;
          ctx.drawImage(cv,0,p.y,W,p.h);
        }finally{cv.width=cv.height=0;}
      }
    }finally{if(!current)await doc.loadingTask.destroy();}
  }

  /* ---- the page list: thumbnails are drawn only while they are in view ---- */
  let shown=null,shape=null,thumbOf=new Map(),here=null,watcher=null,thumbQueue=[],thumbsBusy=0;
  function refresh(){
    const pdf=S.pdf||null;
    if(shown!==pdf){const was=!!shown;reset();shown=pdf;shape=null;if(was!==!!pdf)N.ink?.setPen?.({});if(pdf?.data)migrate(pdf);}
    document.body.classList.toggle('pdf-notebook',!!pdf);document.body.style.setProperty('--pdf-text-ink',S.settings.textColor||'#1d1d1f');nav.hidden=!pdf;side.hidden=!pdf||!sideOpen;
    if(!pdf){find.hidden=true;chip.hidden=true;return;}
    if(shape!==pdf.pages){
      shape=pdf.pages;thumbs.clear();thumbQueue=[];thumbOf=new Map();here=null;
      const list=$('pdf-page-list');list.replaceChildren();watcher?.disconnect();
      watcher=new IntersectionObserver(seen,{root:list,rootMargin:'400px 0px'});
      const dpr=Math.min(2,M.dpr||1);
      pdf.pages.forEach((p,i)=>{
        const item=document.createElement('div');item.className='pdf-item';
        const b=document.createElement('button');b.type='button';b.className='pdf-thumb';b.dataset.page=p.id;b.setAttribute('aria-label','go to page '+(i+1)+(p.source===null?', blank':''));
        const mini=document.createElement('div');mini.className='pdf-mini';mini.style.aspectRatio=W+' / '+p.h;mini.dataset.w=Math.round(112*dpr);mini.dataset.h=Math.round(112*dpr*p.h/W);
        b.append(mini,document.createTextNode((i+1)+(p.source===null?' · blank':'')));b.onclick=()=>go(i);item.append(b);list.append(item);thumbOf.set(p.id,b);watcher.observe(mini);
      });
      layerKey='';syncLayers();if(find.hidden===false&&query)search(query,true);
    }
    updateCounter();
  }
  function seen(entries){
    for(const e of entries){
      const mini=e.target,id=mini.parentNode?.dataset.page,p=S.pdf?.pages.find(x=>x.id===id);if(!p)continue;
      if(e.isIntersecting){
        if(!mini.firstChild){const cv=document.createElement('canvas');cv.width=+mini.dataset.w;cv.height=+mini.dataset.h;cv.setAttribute('aria-hidden','true');mini.append(cv);}
        if(!paintThumb(p)&&p.source!==null&&!thumbQueue.includes(p))thumbQueue.push(p);
      }else{mini.replaceChildren();thumbs.delete(p.id);thumbQueue=thumbQueue.filter(x=>x!==p);}
    }
    pumpThumbs();
  }
  function paintThumb(p,cv){
    const mini=thumbOf.get(p.id)?.querySelector('canvas');if(!mini)return false;
    const b=cv?{cv,rot:p.rot||0}:bitmaps.get(p.id);if(!b||b.rot!==(p.rot||0)||!b.cv.width)return false;
    mini.getContext('2d').drawImage(b.cv,0,0,mini.width,mini.height);thumbs.add(p.id);return true;
  }
  function pumpThumbs(){
    while(thumbsBusy<2&&thumbQueue.length){
      const p=thumbQueue.shift();if(thumbs.has(p.id)||failed.has(p.id)||!thumbOf.get(p.id)?.querySelector('canvas'))continue;
      thumbsBusy++;const token=epoch;
      renderPage(p,.34).then(cv=>{if(token===epoch)paintThumb(p,cv);cv.width=cv.height=0;}).catch(()=>{}).finally(()=>{thumbsBusy--;if(token===epoch)pumpThumbs();});
    }
  }
  function updateCounter(){
    if(!S.pdf)return;const n=S.pdf.pages.length,i=Math.min(current(),n-1);
    $('pdf-count').textContent=(i+1)+' / '+n;$('pdf-prev').disabled=i===0;$('pdf-next').disabled=i===n-1;$('pdf-add').disabled=n>=MAX_PAGES;
    const now=thumbOf.get(S.pdf.pages[i].id);
    if(now!==here){here?.removeAttribute('aria-current');here=now;if(here){here.setAttribute('aria-current','page');here.parentNode.append(acts);if(sideOpen&&!$('pdf-page-list').hidden)here.scrollIntoView({block:'nearest'});}}
    act('pdf-up').disabled=i===0;act('pdf-down').disabled=i===n-1;act('pdf-delete').disabled=n<=1;
    const fit=$('pdf-fit'),label=fitNext==='page'?'fit the whole page':'fit the page width';
    fit.title=label;fit.setAttribute('aria-label',label);fit.firstChild.className='ph '+(fitNext==='page'?'ph-frame-corners':'ph-arrows-out-line-horizontal');
  }
  function setSide(on){sideOpen=on;side.hidden=!on||!S.pdf;$('pdf-toggle').setAttribute('aria-expanded',String(on));if(on){updateCounter();queueVisible();loadOutline();}else if(side.contains(document.activeElement))$('pdf-toggle').focus();}
  function go(i){if(!S.pdf)return;const p=S.pdf.pages[Math.max(0,Math.min(S.pdf.pages.length-1,i))];sc.scrollTop=Math.max(0,p.y*M.zoom-24);updateCounter();N.ink.render();}
  function fit(){
    if(!S.pdf)return;const i=current(),p=S.pdf.pages[i],width=(M.vw-24)/W;
    C.setZoom(Math.max(.2,Math.min(3,fitNext==='page'?Math.min(width,(M.vh-150)/p.h):width)));
    fitNext=fitNext==='page'?'width':'page';go(i);
  }

  /* ---- contents and links: the PDF's own bookmarks and destinations ---- */
  let outlineFor=null,showingOutline=false;
  async function loadOutline(){
    const pdf=S.pdf;if(!pdf||outlineFor===pdf)return;outlineFor=pdf;
    let items=null;try{items=await (await open()).getOutline();}catch(e){}
    if(S.pdf!==pdf)return;
    const list=$('pdf-outline'),button=$('pdf-outline-btn');list.replaceChildren();
    button.hidden=!items?.length;if(!items?.length){showOutline(false);return;}
    let count=0;
    const add=(entries,depth)=>{for(const it of entries){if(++count>2000)return;
      const b=document.createElement('button');b.type='button';b.dataset.depth=depth;b.style.setProperty('--depth',Math.min(depth,6));b.textContent=String(it.title||'untitled').trim()||'untitled';
      b.onclick=()=>{if(it.url)openLink(it.url);else if(it.dest)goDest(it.dest);};list.append(b);
      if(it.items?.length)add(it.items,depth+1);}};
    add(items,0);
  }
  function showOutline(on){
    showingOutline=on;$('pdf-outline').hidden=!on;$('pdf-page-list').hidden=on;$('pdf-add').hidden=on;
    const b=$('pdf-outline-btn');b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',on?'show pages':'show contents');b.title=on?'pages':'contents';
    $('pdf-side-title').textContent=on?'contents':'pages';if(!on)updateCounter();
  }
  async function goDest(dest){
    if(!S.pdf)return;
    try{
      const doc=await open();if(typeof dest==='string')dest=await doc.getDestination(dest);if(!Array.isArray(dest))return;
      const ref=dest[0],index=ref&&typeof ref==='object'?await doc.getPageIndex(ref):Number.isInteger(ref)?ref:null;if(index===null)return;
      const i=S.pdf.pages.findIndex(p=>p.source===index);if(i<0){C.toast('that page is not in this notebook any more.',4500);return;}
      const p=S.pdf.pages[i],kind=dest[1]?.name,top=kind==='XYZ'?dest[3]:kind==='FitH'||kind==='FitBH'?dest[2]:null;let y=0;
      if(Number.isFinite(top)){const page=await doc.getPage(index+1);y=Math.max(0,Math.min(p.h-40,view(page,p,1).convertToViewportPoint(0,top)[1]));}
      sc.scrollTop=Math.max(0,(p.y+y)*M.zoom-24);updateCounter();N.ink.render();
    }catch(e){}
  }
  function openLink(url){
    let u;try{u=new URL(url);}catch(e){return;}
    if(!['http:','https:','mailto:'].includes(u.protocol)){C.toast('notas opens web and email links only.',4000);return;}
    window.open(u.href,'_blank','noopener,noreferrer');
  }

  /* ---- forms: the PDF's own fields, filled with the text tool ---- */
  /* a PDF rectangle as page space: its two corners, turned with the page */
  function box(vp,r){const [x0,y0]=vp.convertToViewportPoint(r[0],r[1]),[x1,y1]=vp.convertToViewportPoint(r[2],r[3]);return [x0,y0,x1,y1];}
  function fieldValue(a){
    const v=S.pdf?.fields?.[a.fieldName];if(v!==undefined)return v;
    if(a.checkBox)return a.fieldValue!=null&&a.fieldValue!=='Off'&&a.fieldValue===a.exportValue;
    if(a.radioButton)return typeof a.fieldValue==='string'&&a.fieldValue!=='Off'?a.fieldValue:'';
    return Array.isArray(a.fieldValue)?String(a.fieldValue[0]??''):String(a.fieldValue??'');
  }
  function stored(a,v){
    return a.checkBox?{value:!!v}:a.radioButton?{value:v===a.buttonValue}:a.fieldType==='Ch'&&a.multiSelect?{value:v?[String(v)]:[]}:{value:String(v??'')};
  }
  const formFields=a=>a.subtype==='Widget'&&a.fieldName&&!a.readOnly&&!a.hidden&&!a.pushButton&&['Tx','Btn','Ch'].includes(a.fieldType);
  /* values set here reach PDF.js's own storage before a page is drawn */
  async function fill(doc,p){
    const f=S.pdf?.fields;if(!f)return;
    for(const a of await annotationsOf(doc,p))if(formFields(a)&&f[a.fieldName]!==undefined)doc.annotationStorage.setValue(a.id,stored(a,f[a.fieldName]));
  }
  function setField(name,value){
    const pdf=S.pdf;if(!pdf)return;const was=pdf.fields?.[name];if(was===value)return;
    const put=v=>{if(S.pdf!==pdf)return;const f={...(pdf.fields||{})};if(v===undefined)delete f[name];else f[name]=v;if(Object.keys(f).length)pdf.fields=f;else delete pdf.fields;fieldsChanged(name);};
    C.act('fill in the form',()=>put(value),()=>put(was));
  }
  async function fieldsChanged(name){
    const pdf=S.pdf,doc=active;if(!pdf)return;
    for(const p of pdf.pages){
      if(p.source===null||!annots.has(p.source))continue;
      const list=(await annots.get(p.source)).filter(a=>formFields(a)&&a.fieldName===name);if(!list.length)continue;
      if(doc&&doc===active)for(const a of list)doc.annotationStorage.setValue(a.id,stored(a,fieldValue(a)));
      const b=bitmaps.get(p.id);if(b)b.k=0;thumbs.delete(p.id);
    }
    for(const el of layerRoot.querySelectorAll('.pdf-field'))if(el.dataset.name===name)showValue(el);
    N.ink.render();
  }
  function showValue(el){
    const a=el._field,v=fieldValue(a);
    if(el.tagName==='BUTTON')el.setAttribute('aria-pressed',String(a.checkBox?!!v:v===a.buttonValue));
    else if(document.activeElement!==el)el.value=String(v??'');
  }
  function fieldControl(a,vp){
    const [x0,y0,x1,y1]=box(vp,a.rect),left=Math.min(x0,x1),top=Math.min(y0,y1),w=Math.abs(x1-x0),h=Math.abs(y1-y0);
    let el;
    if(a.fieldType==='Btn'){
      el=document.createElement('button');el.type='button';el.setAttribute('role',a.checkBox?'checkbox':'radio');
      el.onclick=()=>setField(a.fieldName,a.checkBox?!fieldValue(a):(fieldValue(a)===a.buttonValue?'':a.buttonValue));
    }else if(a.fieldType==='Ch'&&a.options?.length&&!a.multiSelect){
      el=document.createElement('select');
      el.innerHTML='<option value=""></option>'+a.options.map(o=>'<option value="'+esc(o.exportValue)+'">'+esc(o.displayValue??o.exportValue)+'</option>').join('');
      el.onchange=()=>setField(a.fieldName,el.value);
    }else if(a.fieldType==='Tx'){
      el=document.createElement(a.multiLine?'textarea':'input');if(!a.multiLine)el.type=a.password?'password':'text';
      if(a.maxLen)el.maxLength=a.maxLen;el.spellcheck=false;el.autocomplete='off';
      el.style.fontSize=Math.max(8,Math.min(16,(a.multiLine?14:h*.68)))+'px';
      el.onchange=()=>setField(a.fieldName,el.value);
      el.onkeydown=e=>{if(e.key==='Escape'){el.value=String(fieldValue(a));el.blur();}};
      el.addEventListener('blur',()=>{layerKey='';queueVisible();});
    }else return null;
    el.className='pdf-field';el.dataset.name=a.fieldName;el._field=a;
    el.setAttribute('aria-label',a.alternativeText||a.fieldName);
    Object.assign(el.style,{left:left+'px',top:top+'px',width:w+'px',height:h+'px'});
    showValue(el);return el;
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
    shape=null;N.ui.paintAll();N.ink.showSelBar?.();queueVisible();
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
    if(!S.pdf)return;find.hidden=false;$('pdf-search').setAttribute('aria-expanded','true');closeAsk();
    const input=$('pdf-find-input');input.focus();input.select();if(query)N.ink.render();
  }
  function closeFind(){
    if(find.hidden)return;find.hidden=true;$('pdf-search').setAttribute('aria-expanded','false');searchToken++;
    if(find.contains(document.activeElement))$('pdf-search').focus();N.ink.render();
  }

  /* ---- the PDF's text, links and fields, laid over the visible pages ---- */
  let layerKey='';
  const layers=new Map();
  let pdfSelectionPointer=null,previousPDFRange=null;
  const chromiumSelectionVersion=Number(navigator.userAgentData?.brands?.find(b=>b.brand==='Chromium')?.version||/\b(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent)?.[1]||0);
  const modernPDFSelection=CSS.supports('-moz-user-select','none')||chromiumSelectionVersion>=148;
  function clearLayers(){pdfSelectionPointer=null;previousPDFRange=null;for(const l of layers.values())l.task?.cancel?.();layers.clear();layerRoot.replaceChildren();layerKey='';}
  function syncLayers(){
    if(!S.pdf){if(layerRoot.isConnected)layerRoot.remove();return;}
    const host=document.getElementById('textlayer');
    if(host&&layerRoot.parentNode!==host)host.prepend(layerRoot);
    const want=S.pdf.pages.filter(p=>p.source!==null&&onScreen(p,400));
    const key=want.map(p=>p.id+':'+(p.rot||0)+':'+p.y).join('|');
    if(key===layerKey&&layers.size===want.length)return;layerKey=key;
    const keep=new Set(want.map(p=>p.id+':'+(p.rot||0)+':'+p.y));
    /* a field being typed in keeps its page until it is left */
    for(const [k,l] of layers)if(!keep.has(k)){
      if(document.activeElement?.matches?.('.pdf-field')&&l.el.contains(document.activeElement))continue;
      const selection=getSelection();let selected=false;
      for(let i=0;selection&&i<selection.rangeCount;i++)if(selection.getRangeAt(i).intersectsNode(l.el)){selected=true;break;}
      const page=S.pdf.pages.find(p=>p.id===l.el.dataset.page);
      if(selected&&page&&k===page.id+':'+(page.rot||0)+':'+page.y)continue;
      l.task?.cancel?.();l.el.remove();layers.delete(k);
    }
    for(const p of want){const k=p.id+':'+(p.rot||0)+':'+p.y;if(!layers.has(k))buildLayer(p,k);}
  }
  async function buildLayer(p,k){
    const token=epoch,el=document.createElement('div');el.className='pdf-tl-page';el.style.top=p.y+'px';el.style.width=W+'px';el.style.height=p.h+'px';el.dataset.page=p.id;
    const entry={el,task:null,end:null};layers.set(k,entry);
    const next=[...layerRoot.children].find(other=>Number.parseFloat(other.style.top)>p.y);layerRoot.insertBefore(el,next||null);
    try{
      const [lib]=await libs(),doc=await open();if(!doc||token!==epoch||layers.get(k)!==entry)return;
      const [page,tc,list]=await Promise.all([doc.getPage(p.source+1),textOf(doc,p),annotationsOf(doc,p)]);if(token!==epoch||layers.get(k)!==entry)return;
      const vp=view(page,p,1),layer=document.createElement('div');layer.className='textLayer';layer.setAttribute('aria-hidden','true');
      layer.style.setProperty('--total-scale-factor',String(vp.scale));layer.style.setProperty('--scale-round-x','1px');layer.style.setProperty('--scale-round-y','1px');
      el.append(layer);
      for(const a of list){
        if(a.subtype==='Link'&&a.rect&&(a.url||a.dest)){
          const [x0,y0,x1,y1]=box(vp,a.rect),link=document.createElement('a');link.className='pdf-link';
          Object.assign(link.style,{left:Math.min(x0,x1)+'px',top:Math.min(y0,y1)+'px',width:Math.abs(x1-x0)+'px',height:Math.abs(y1-y0)+'px'});
          if(a.url){link.href=a.url;link.title=a.url;link.onclick=e=>{e.preventDefault();openLink(a.url);};}
          else{link.href='#';link.title='go to the linked page';link.onclick=e=>{e.preventDefault();goDest(a.dest);};}
          el.append(link);
        }else if(formFields(a)){const c=fieldControl(a,vp);if(c)el.append(c);}
      }
      entry.task=new lib.TextLayer({textContentSource:tc,container:layer,viewport:vp});await entry.task.render();
      if(token!==epoch||layers.get(k)!==entry)return;
      entry.end=document.createElement('div');entry.end.className='endOfContent';layer.append(entry.end);
    }catch(e){if(layers.get(k)===entry){el.remove();layers.delete(k);}}
  }

  /* Selection-backdrop behavior adapted from PDF.js TextLayerBuilder.
     Copyright 2024 Mozilla Foundation. Licensed under the Apache License,
     Version 2.0; see assets/pdf/LICENSE and https://www.apache.org/licenses/LICENSE-2.0.
     Provided AS IS, without warranties or conditions of any kind.

     PDF.js's viewer keeps a selection backdrop in the text flow while dragging.
     Without it, a blank gap can make the native caret fall back to the layer's
     first DOM position. Keep native selection rather than replacing its range. */
  function resetPDFSelectionEnd(entry){
    const end=entry.end,layer=end?.closest('.textLayer');if(!layer)return;
    layer.append(end);end.style.width='';end.style.height='';layer.classList.remove('selecting');
  }
  function stabilizePDFSelection(){
    const selection=getSelection();
    if(!selection?.rangeCount){for(const entry of layers.values())resetPDFSelectionEnd(entry);previousPDFRange=null;return;}
    for(const entry of layers.values()){
      const layer=entry.end?.closest('.textLayer');if(!layer)continue;
      let active=false;for(let i=0;i<selection.rangeCount;i++)if(selection.getRangeAt(i).intersectsNode(layer)){active=true;break;}
      if(active)layer.classList.add('selecting');else resetPDFSelectionEnd(entry);
    }
    if(modernPDFSelection||pdfSelectionPointer===null)return;
    const range=selection.getRangeAt(0);
    if(!layerRoot.contains(range.startContainer)&&!layerRoot.contains(range.endContainer))return;
    const start=previousPDFRange&&(range.compareBoundaryPoints(Range.END_TO_END,previousPDFRange)===0||range.compareBoundaryPoints(Range.START_TO_END,previousPDFRange)===0);
    let anchor=start?range.startContainer:range.endContainer;if(anchor.nodeType===Node.TEXT_NODE)anchor=anchor.parentElement;
    if(!start&&range.endOffset===0){
      while(anchor&&layerRoot.contains(anchor)){
        while(anchor&&!anchor.previousSibling&&anchor!==layerRoot)anchor=anchor.parentElement;
        if(!anchor||anchor===layerRoot)break;
        anchor=anchor.previousSibling;if(anchor.childNodes.length)break;
      }
    }
    const layer=anchor?.parentElement?.closest('.textLayer'),entry=[...layers.values()].find(entry=>entry.end?.closest('.textLayer')===layer);
    if(entry?.end&&anchor.parentElement){entry.end.style.width=layer.style.width;entry.end.style.height=layer.style.height;entry.end.style.userSelect='text';anchor.parentElement.insertBefore(entry.end,start?anchor:anchor.nextSibling);}
    previousPDFRange=range.cloneRange();
  }
  function finishPDFSelection(){
    if(pdfSelectionPointer===null)return;
    pdfSelectionPointer=null;previousPDFRange=null;
    for(const entry of layers.values())resetPDFSelectionEnd(entry);
    requestAnimationFrame(placeChip);
  }

  /* ---- passage chat: draft selections never replace confirmed context ---- */
  let asking=null,passage=null,chatSession=null,closeTimer,fadeFrame,nearBottom=true;
  const chatSessions=new Map(),readerAnimations=[],highlight=document.createElement('div');
  highlight.id='pdf-context-highlight';highlight.setAttribute('aria-hidden','true');
  const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function saveChat(){
    if(!chatSession)return;
    chatSession.draft=$('pdf-ask-input').value;
    try{sessionStorage.setItem('notas.pdf-chat.'+chatSession.note,JSON.stringify(chatSession));}catch(e){}
  }
  function sessionForNote(){
    if(chatSession?.note===S.id)return chatSession;
    if(!chatSessions.has(S.id)){
      let saved;try{saved=JSON.parse(sessionStorage.getItem('notas.pdf-chat.'+S.id));}catch(e){}
      const valid=saved?.note===S.id&&Array.isArray(saved.messages)&&saved.messages.every(m=>['user','assistant'].includes(m.role)&&typeof m.text==='string')&&Array.isArray(saved.contexts)&&saved.contexts.every(p=>typeof p.text==='string'&&Array.isArray(p.pages)&&Array.isArray(p.boxes)&&p.boxes.every(b=>b&&typeof b.page==='string'&&[b.x,b.y,b.w,b.h].every(Number.isFinite)));
      chatSessions.set(S.id,valid?saved:{note:S.id,contexts:[],messages:[],draft:''});
    }
    return chatSession=chatSessions.get(S.id);
  }
  function selected(){
    const sel=getSelection();if(!S.pdf||!sel||sel.isCollapsed||!sel.rangeCount)return null;
    const range=sel.getRangeAt(0);if(!layerRoot.contains(range.commonAncestorContainer))return null;
    const text=sel.toString().replace(/\s+/g,' ').trim();if(text.length<2)return null;
    const origin=layerRoot.getBoundingClientRect(),boxes=[],pages=new Set(),walk=document.createTreeWalker(layerRoot,NodeFilter.SHOW_TEXT);
    let node;
    while(node=walk.nextNode()){
      const page=node.parentElement.closest('.pdf-tl-page');if(!page||!node.textContent.trim()||!range.intersectsNode(node))continue;
      const p=S.pdf.pages.find(p=>p.id===page.dataset.page);if(!p)continue;
      const part=new Range();part.setStart(node,node===range.startContainer?range.startOffset:0);part.setEnd(node,node===range.endContainer?range.endOffset:node.length);
      for(const r of part.getClientRects())if(r.width>.1&&r.height>.1){pages.add(p.id);boxes.push({page:p.id,rot:p.rot||0,x:(r.left-origin.left)/M.zoom,y:(r.top-origin.top)/M.zoom-p.y,w:r.width/M.zoom,h:r.height/M.zoom});}
    }
    if(!boxes.length)return null;
    return {text:text.slice(0,4000),pages:[...pages],boxes,rect:range.getBoundingClientRect()};
  }
  function placeChip(){
    if(pdfSelectionPointer!==null){chip.hidden=true;return;}
    const draft=selected();if(!draft){chip.hidden=true;return;}
    passage=draft;chip.hidden=false;
    const w=chip.offsetWidth||100,x=Math.max(8,Math.min(innerWidth-w-8,draft.rect.left+draft.rect.width/2-w/2));
    chip.style.left=x+'px';chip.style.top=Math.max(8,Math.min(innerHeight-44,draft.rect.top>70?draft.rect.top-46:draft.rect.bottom+10))+'px';
  }
  function paintChatHighlight(){
    highlight.replaceChildren();
    if(askBox.hidden||!chatSession?.contexts.length)return;
    const host=document.getElementById('canvaswrap');if(highlight.parentNode!==host)host.append(highlight);
    const origin=layerRoot.getBoundingClientRect(),viewport=host.getBoundingClientRect();
    const confirmed=chatSession.contexts.at(-1);
    for(const b of confirmed.boxes){
      const p=S.pdf?.pages.find(p=>p.id===b.page);if(!p||(p.rot||0)!==b.rot||![b.x,b.y,b.w,b.h].every(Number.isFinite))continue;
      const span=document.createElement('span');Object.assign(span.style,{left:(origin.left-viewport.left+b.x*M.zoom)+'px',top:(origin.top-viewport.top+(p.y+b.y)*M.zoom)+'px',width:(b.w*M.zoom)+'px',height:(b.h*M.zoom)+'px'});highlight.append(span);
    }
  }
  function retireChatHighlight(){
    if(!highlight.childElementCount)return;
    const old=highlight.cloneNode(true);old.removeAttribute('id');old.className='pdf-context-retired';document.getElementById('canvaswrap').append(old);
    const motion=old.animate({opacity:[1,0]},{duration:reducedMotion()?0:360,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
    motion.finished.then(()=>old.remove()).catch(()=>old.remove());
  }
  function chatLayout(before){
    readerAnimations.splice(0).forEach(a=>a.cancel());C.layout();N.ink.render();paintChatHighlight();
    const col=document.getElementById('col'),dx=before-col.getBoundingClientRect().left;
    if(reducedMotion()||!matchMedia('(min-width:1100px) and (pointer:fine)').matches||Math.abs(dx)<1)return;
    for(const el of [col,document.getElementById('canvaswrap')])readerAnimations.push(el.animate({translate:[dx+'px 0','0px 0px']},{duration:460,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  function updateChatInput(){
    const input=$('pdf-ask-input'),send=$('pdf-ask-send'),t=s=>N.i18n?N.i18n.t(s):s;input.placeholder=t(chatSession?.contexts.length?'ask about this passage…':'ask nota…');input.setAttribute('aria-label',t(chatSession?.contexts.length?'your question about this passage':'your question for nota'));const fresh=$('pdf-ask-new');fresh.textContent=t('new chat');fresh.title=t('new chat');fresh.setAttribute('aria-label',t('new chat'));askBox.setAttribute('aria-busy',String(!!asking));input.style.height='auto';input.style.height=Math.min(input.scrollHeight,innerWidth<1100?120:170)+'px';
    send.disabled=!asking&&!input.value.trim();send.title=asking?'stop response':'ask';send.setAttribute('aria-label',send.title);send.innerHTML='<i class="ph '+(asking?'ph-stop':'ph-arrow-up')+'" aria-hidden="true"></i>';
  }
  function inlineChat(text){
    const frag=document.createDocumentFragment();
    for(const piece of text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`]+`)/g)){
      if(piece.startsWith('**')&&piece.endsWith('**')){const b=document.createElement('strong');b.textContent=piece.slice(2,-2);frag.append(b);}
      else if(piece.startsWith('`')&&piece.endsWith('`')){const code=document.createElement('code');code.textContent=piece.slice(1,-1);frag.append(code);}
      else if(piece.startsWith('$')&&piece.endsWith('$')&&window.katex){const span=document.createElement('span'),display=piece.startsWith('$$');try{katex.render(piece.slice(display?2:1,display?-2:-1),span,{throwOnError:false,trust:false,maxExpand:1000,maxSize:10,displayMode:display});}catch(e){span.textContent=piece;}frag.append(span);}
      else frag.append(document.createTextNode(piece));
    }
    return frag;
  }
  function formatChat(el,text){
    el.replaceChildren();
    for(const block of text.replace(/^#{1,6}\s+/gm,'').split(/\n\s*\n/)){
      const lines=block.split('\n'),ordered=lines.every(l=>/^\d+[.)]\s/.test(l)),bullet=lines.every(l=>/^[-*]\s/.test(l));
      if(ordered||bullet){const list=document.createElement(ordered?'ol':'ul');for(const line of lines){const li=document.createElement('li');li.append(inlineChat(line.replace(/^(?:\d+[.)]|[-*])\s+/,'')));list.append(li);}el.append(list);}
      else{const p=document.createElement('p');p.style.whiteSpace='pre-wrap';p.append(inlineChat(block));el.append(p);}
    }
  }
  function appendChatMessage(message){
    const el=document.createElement('div');el.className='pdf-message '+message.role+(message.error?' error':'');el.setAttribute('aria-label',message.role==='user'?'you':'nota');
    if(message.role==='user')el.textContent=message.text;else formatChat(el,message.text);
    $('pdf-ask-messages').append(el);return el;
  }
  function copyChatAction(el,message){
    const row=document.createElement('div');row.className='pdf-message-actions';const button=document.createElement('button');button.type='button';button.title='copy answer';button.setAttribute('aria-label','copy answer');button.innerHTML='<i class="ph ph-copy" aria-hidden="true"></i>';
    button.onclick=async()=>{try{await navigator.clipboard.writeText(message.text);button.innerHTML='<i class="ph ph-check" aria-hidden="true"></i>';setTimeout(()=>button.innerHTML='<i class="ph ph-copy" aria-hidden="true"></i>',1500);}catch(e){C.toast('select the answer to copy it.');}};row.append(button);el.append(row);
  }
  function renderChat(){
    const log=$('pdf-ask-messages');log.replaceChildren();
    for(const m of chatSession.messages){const el=appendChatMessage(m);if(m.role==='assistant'&&!m.error)copyChatAction(el,m);}
    $('pdf-ask-input').value=chatSession.draft||'';updateChatInput();
    log.scrollTop=log.scrollHeight;nearBottom=true;$('pdf-ask-latest').hidden=true;
  }
  function newChat(){
    asking?.abort();asking=null;passage=null;chip.hidden=true;
    clearTimeout(closeTimer);cancelAnimationFrame(fadeFrame);
    const selection=getSelection();if(layerRoot.contains(selection?.anchorNode))selection.removeAllRanges();
    highlight.replaceChildren();sc.querySelectorAll('.pdf-context-retired').forEach(el=>el.remove());sc.style.setProperty('--pdf-context-opacity','1');
    chatSession={note:S.id,contexts:[],messages:[],draft:''};chatSessions.set(S.id,chatSession);
    renderChat();saveChat();$('pdf-ask-input').focus({preventScroll:true});
    $('pdf-ask-status').textContent=N.i18n?N.i18n.t('new chat started.'):'new chat started.';
  }
  function openAsk(){
    if(!S.pdf)return;
    const opening=askBox.hidden||askBox.classList.contains('leaving'),session=sessionForNote(),draft=passage;
    if(draft){
      if(!opening&&session.contexts.at(-1)?.text!==draft.text)retireChatHighlight();
      session.contexts=session.contexts.filter(p=>!(p.text===draft.text&&p.pages.join()===draft.pages.join()));
      const {rect,...context}=draft;session.contexts.push(context);session.contexts=session.contexts.slice(-12);
    }
    passage=null;chip.hidden=true;closeFind();clearTimeout(closeTimer);cancelAnimationFrame(fadeFrame);sc.style.setProperty('--pdf-context-opacity','1');
    const before=document.getElementById('col').getBoundingClientRect().left;
    askBox.classList.remove('leaving');askBox.inert=false;askBox.hidden=false;document.body.classList.add('pdf-chat-open');document.body.classList.toggle('pdf-chat-wide',askBox.classList.contains('wide'));
    if(opening)renderChat();else updateChatInput();paintChatHighlight();chatLayout(before);saveChat();
    if(opening)$('pdf-ask-input').focus({preventScroll:true});
    $('pdf-ask-status').textContent=draft?'passage added to the conversation.':'';
  }
  function closeAsk(immediate=false){
    saveChat();asking?.abort();asking=null;chip.hidden=true;passage=null;
    clearTimeout(closeTimer);cancelAnimationFrame(fadeFrame);
    const wasOpen=!askBox.hidden,before=document.getElementById('col').getBoundingClientRect().left;
    document.body.classList.remove('pdf-chat-open','pdf-chat-wide');
    if(askBox.hidden||immediate||reducedMotion()){
      askBox.hidden=true;askBox.classList.remove('leaving');highlight.replaceChildren();sc.querySelectorAll('.pdf-context-retired').forEach(e=>e.remove());if(wasOpen&&!immediate)chatLayout(before);return;
    }
    askBox.classList.add('leaving');askBox.inert=true;
    const selection=getSelection();if(layerRoot.contains(selection?.anchorNode))selection.removeAllRanges();
    if(askBox.contains(document.activeElement)){if(!sc.hasAttribute('tabindex'))sc.tabIndex=-1;sc.focus({preventScroll:true});}
    chatLayout(before);
    function fade(){if(askBox.hidden||!askBox.classList.contains('leaving'))return;sc.style.setProperty('--pdf-context-opacity',getComputedStyle(askBox).opacity);fadeFrame=requestAnimationFrame(fade);}
    fadeFrame=requestAnimationFrame(fade);
    closeTimer=setTimeout(()=>{cancelAnimationFrame(fadeFrame);askBox.hidden=true;askBox.classList.remove('leaving');highlight.replaceChildren();sc.querySelectorAll('.pdf-context-retired').forEach(e=>e.remove());},380);
  }
  async function ask(question){
    if(asking){asking.abort();return;}
    const session=sessionForNote(),pdf=S.pdf;
    if(!pdf)return;
    question=question.trim()||'Explain this passage simply and briefly.';
    const contexts=session.contexts.map(p=>({...p})),previous=session.messages.filter(m=>!m.error).slice(-16).map(m=>(m.role==='user'?'User: ':'Nota: ')+m.text).join('\n\n').slice(-5000);
    const q=(contexts.length?'The person selected these passages in a PDF they are reading:\n'+contexts.map((p,i)=>(i+1)+'. """\n'+p.text+'\n"""').join('\n\n').slice(-6000)+'\n\n':'')+(previous?'Earlier conversation (use this for follow-up questions):\n'+previous+'\n\n':'')+'They ask: '+question+'\nReply directly in readable paragraphs. Do not add an introductory heading or subtitle.';
    const control=new AbortController();let chatRenderFrame=null;asking=control;
    session.messages.push({role:'user',text:question});appendChatMessage(session.messages.at(-1));
    const answer={role:'assistant',text:''};session.messages.push(answer);const out=appendChatMessage(answer);out.classList.add('wait');out.textContent='nota is reading…';out.id='pdf-ask-reply';
    document.querySelectorAll('#pdf-ask-messages [id="pdf-ask-reply"]').forEach(el=>{if(el!==out)el.removeAttribute('id');});
    $('pdf-ask-input').value='';session.draft='';updateChatInput();paintChatHighlight();saveChat();nearBottom=true;$('pdf-ask-messages').scrollTop=$('pdf-ask-messages').scrollHeight;
    function paint(){chatRenderFrame=null;if(!out.isConnected||chatSession!==session)return;out.classList.remove('wait');formatChat(out,answer.text);if(nearBottom)$('pdf-ask-messages').scrollTop=$('pdf-ask-messages').scrollHeight;else $('pdf-ask-latest').hidden=false;}
    try{
      if(!N.nota?.askText)throw Error('nota is not available in this build.');
      let context='';const pages=[...new Set(contexts.flatMap(c=>c.pages))].slice(-6);
      for(const id of pages){if(control.signal.aborted)break;try{const p=pdf.pages.find(p=>p.id===id);if(p?.source!=null){const tc=await textOf(await open(),p);context+=tc.items.map(i=>typeof i.str==='string'?i.str+(i.hasEOL?'\n':''):'').join('')+'\n\n';}}catch(e){}}
      if(control.signal.aborted)return;
      const result=await N.nota.askText(q.slice(0,45000),context.slice(0,12000),piece=>{if(control.signal.aborted||S.pdf!==pdf||chatSession!==session)return;answer.text+=piece;if(!chatRenderFrame)chatRenderFrame=requestAnimationFrame(paint);},control.signal);
      if(!answer.text&&typeof result==='string')answer.text=result;
      if(!answer.text&&!control.signal.aborted)throw Error('nota returned an empty answer. try again.');
    }catch(e){if(!control.signal.aborted){answer.error=true;answer.text=(answer.text?answer.text+'\n\n':'')+(e?.message||'nota could not answer. try again.');out.classList.add('error');}}
    finally{
      if(chatRenderFrame){cancelAnimationFrame(chatRenderFrame);chatRenderFrame=null;}
      if(chatSession===session){if(answer.text){paint();if(!answer.error)copyChatAction(out,answer);}else{out.remove();session.messages=session.messages.filter(m=>m!==answer);}session.messages=session.messages.slice(-40);saveChat();$('pdf-ask-status').textContent=control.signal.aborted?'response stopped.':'nota has replied.';}
      if(asking===control){asking=null;updateChatInput();}
    }
  }

  /* ---- import ---- */
  async function roomFor(size){
    let e=null;try{e=await navigator.storage?.estimate?.();}catch(err){}
    if(e?.quota&&e.quota-(e.usage||0)<size*1.2+20e6)throw Error('there is not enough space on this device for this PDF ('+mb(size)+'). free some space, then try again.');
  }
  async function importFile(file){
    if(busy||N.ui.changing)return false;busy=true;const original=S.id;let doc;
    try{
      if(!file.size)throw Error('that file is empty.');
      if(file.size>HARD_BYTES)throw Error('choose a PDF under 2 GB.');
      if(!canStore()&&file.size>SMALL_BYTES)throw Error('this browser can only keep PDFs up to 3 MB. open it in another browser for larger ones.');
      await roomFor(file.size);
      C.toast('opening PDF…',60000);let data=new Uint8Array(await file.arrayBuffer());
      if(!new TextDecoder().decode(data.subarray(0,1024)).includes('%PDF-'))throw Error('that file is not a PDF.');
      const name=file.name||'document.pdf';
      if(locked(data)){C.toast('unlocking PDF…',60000);data=await unlock(data,name,true);C.toast('opening PDF…',60000);}
      const pdf={name,pages:[]};doc=await documentFrom(data);
      if(doc.numPages>MAX_PAGES)throw Error('choose a PDF with up to '+MAX_PAGES+' pages.');
      for(let i=1;i<=doc.numPages;i++){
        const page=await doc.getPage(i),vp=page.getViewport({scale:1}),h=W*vp.height/vp.width;page.cleanup();
        if(!Number.isFinite(h)||h<60||h>10000)throw Error('this PDF has an unsupported page size.');pdf.pages.push({id:C.uid(),source:i-1,h,y:0});
        if(i%100===0)C.toast('reading pages… '+i+' / '+doc.numPages,60000);
      }
      position(pdf.pages);if(S.id!==original)throw Error('the note changed while opening the PDF. import it again.');
      if(canStore()){pdf.ref=await put(data);pdf.size=data.length;}else pdf.data=base64(data);
      await N.ui.newNote();if(S.id===original)throw Error('save the current note before opening a PDF.');
      S.pdf=pdf;S.title=pdf.name.replace(/\.pdf$/i,'');S.lines=[];S.docH=pdf.pages.at(-1).y+pdf.pages.at(-1).h+TOP;
      M.zoom=Math.max(.2,Math.min(1,(M.vw-24)/W));fitNext='page';N.ui.paintAll();N.ui.refreshTitle();C.markDirty();
      C.saveView(S.id,0,0,M.zoom);C.setActive(S.id);if(!await C.save())throw Error('PDF opened but could not be saved. retry saving before closing.');N.library?.close();N.library?.changed();
      try{navigator.storage?.persist?.();}catch(e){}
      C.toast('PDF ready. write or highlight on the pages; drag the margins to scroll.',6500);return true;
    }catch(e){C.toast(e.message||'could not import this PDF.',7000);return false;}
    finally{busy=false;await doc?.loadingTask.destroy();}
  }
  function choose(){const input=document.createElement('input');input.type='file';input.accept='.pdf,application/pdf';input.hidden=true;document.body.appendChild(input);input.onchange=()=>{const f=input.files?.[0];input.remove();if(f)importFile(f);};input.oncancel=()=>input.remove();input.click();}

  /* ---- export: the original document itself, pages in their new order, with
     ink written into them as lines. Its bookmarks, links and form stay. ---- */
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
    /* Highlights of one colour are one stroked path: a PDF paints a path's
       subpaths as their union, so where marks meet or cross the page is
       multiplied once, as on screen, and no darker discs appear. */
    const groups=new Map();
    for(const st of strokes)if(st.author==='mark'){const k=(st.color||'#FFE066')+'|'+st.w;(groups.get(k)||groups.set(k,[]).get(k)).push(st);}
    for(const list of groups.values()){
      multiply=multiply||page.node.newExtGState('NotasMark',page.doc.context.obj({Type:'ExtGState',BM:'Multiply'}));
      ops.push(o.pushGraphicsState(),o.setGraphicsState(multiply),o.setStrokingColor(rgbOf(lib,list[0].color||'#FFE066')),
        o.setLineCap(o.LineCapStyle.Round),o.setLineJoin(o.LineJoinStyle.Round),o.setLineWidth(list[0].w));
      for(const st of list){
        const pts=st.pts;ops.push(o.moveTo(n2(pts[0]),n2(pts[1]-p.y)));
        if(pts.length<6)ops.push(o.lineTo(n2(pts[0]+.01),n2(pts[1]-p.y)));
        else for(let i=3;i<pts.length;i+=3)ops.push(o.lineTo(n2(pts[i]),n2(pts[i+1]-p.y)));
      }
      ops.push(o.stroke(),o.popGraphicsState());
    }
    for(const st of strokes){
      if(st.author==='mark')continue;
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
  function fillForm(lib,out,fields){
    let form;try{form=out.getForm();}catch(e){return;}
    for(const [name,v] of Object.entries(fields)){
      try{
        const f=form.getField(name);
        if(f instanceof lib.PDFTextField)f.setText(String(v)||undefined);
        else if(f instanceof lib.PDFCheckBox)v?f.check():f.uncheck();
        else if(f instanceof lib.PDFRadioGroup||f instanceof lib.PDFDropdown||f instanceof lib.PDFOptionList)v?f.select(String(v)):f.clear();
      }catch(e){}
    }
  }
  async function exportFile(){
    if(!S.pdf||busy)return null;busy=true;$('pdf-save').disabled=true;
    try{
      N.ink.finishInput();await document.fonts.ready;const pdf=S.pdf,id=S.id,revision=C.revision;
      const check=()=>{if(S.id!==id||S.pdf!==pdf||C.revision!==revision)throw Error('the note changed during export. try saving the PDF again.');};
      C.toast('saving PDF…',60000);const [,lib]=await libs();check();
      let source=await bytesOf(pdf),out;check();
      try{out=await lib.PDFDocument.load(source,{updateMetadata:false});}
      catch(e){if(!/encrypted/i.test(String(e?.message)))throw e;source=await unlock(source,pdf.name,true);check();out=await lib.PDFDocument.load(source,{updateMetadata:false});}
      const originals=out.getPages();
      for(let i=out.getPageCount()-1;i>=0;i--)out.removePage(i);
      const font=await out.embedFont(lib.StandardFonts.Helvetica),charset=new Set(font.getCharacterSet());
      let loaded=null;
      for(const [index,p] of pdf.pages.entries()){
        check();let page;
        if(p.source===null)page=out.addPage([595.28,595.28*p.h/W]);
        else{page=originals[p.source];out.addPage(page);if(p.rot)page.setRotation(lib.degrees((page.getRotation().angle+p.rot)%360));}
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
      const filled=!!(pdf.fields&&Object.keys(pdf.fields).length);if(filled)fillForm(lib,out,pdf.fields);
      check();out.setTitle(S.title||pdf.name);
      let data;try{data=await out.save({updateFieldAppearances:filled});}catch(e){if(!filled)throw e;data=await out.save({updateFieldAppearances:false});}
      check();const blob=new Blob([data],{type:'application/pdf'}),url=URL.createObjectURL(blob);N.ui.download((S.title||'document')+'.pdf',url);setTimeout(()=>URL.revokeObjectURL(url),60000);await C.save();C.toast('annotated PDF saved.');return data;
    }catch(e){if(!e?.cancelled)C.toast(e.message||'could not save this PDF.',7000);return null;}
    finally{busy=false;$('pdf-save').disabled=false;}
  }

  /* ---- PDFs from outside: opened with Notas, or shared to it ---- */
  async function whenReady(){
    for(let i=0;i<1200;i++){if(document.getElementById('preparing')?.classList.contains('done')&&S.id&&!N.ui?.changing)return true;await new Promise(r=>setTimeout(r,100));}
    return false;
  }
  const isPdf=f=>f&&(f.type==='application/pdf'||/\.pdf$/i.test(f.name||''));
  /* files opened with Notas reach only the installed app; a browser tab never
     sets a consumer (one set there disturbed restoring the page's position) */
  const installed=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: minimal-ui)').matches;
  if(installed&&'launchQueue' in window)window.launchQueue.setConsumer(async params=>{
    const files=params?.files||[];if(!files.length||!await whenReady())return;
    for(const handle of files){try{const f=await handle.getFile();if(isPdf(f))await importFile(f);}catch(e){}}
  });
  (async()=>{
    const u=new URL(location.href),said=u.searchParams.get('shared-pdf');if(said===null)return;
    u.searchParams.delete('shared-pdf');history.replaceState(history.state,'',u.pathname+u.search+u.hash);
    if(!await whenReady())return;
    if(said!=='1'){C.toast(said==='none'?'only PDFs can be shared to notas.':'the shared PDF did not arrive. share it again.',6000);return;}
    try{
      const cache=await caches.open('notas-shared'),key=new URL('./shared-pdf',location.href).href,res=await cache.match(key);
      if(!res){C.toast('the shared PDF did not arrive. share it again.',6000);return;}
      const name=decodeURIComponent(res.headers.get('X-File-Name')||'shared.pdf'),file=new File([await res.blob()],name,{type:'application/pdf'});
      await cache.delete(key);await importFile(file);
    }catch(e){C.toast('the shared PDF could not be opened.',6000);}
  })();

  /* ---- wiring ---- */
  $('pdf-toggle').onclick=()=>setSide(!sideOpen);$('pdf-close').onclick=()=>setSide(false);$('pdf-prev').onclick=()=>go(current()-1);$('pdf-next').onclick=()=>go(current()+1);$('pdf-add').onclick=()=>insertBlank();$('pdf-save').onclick=()=>exportFile();
  $('pdf-fit').onclick=fit;$('pdf-search').onclick=()=>find.hidden?openFind():closeFind();$('pdf-outline-btn').onclick=()=>showOutline(!showingOutline);
  act('pdf-up').onclick=()=>movePage(current(),-1);act('pdf-down').onclick=()=>movePage(current(),1);act('pdf-rotate').onclick=()=>rotatePage(current());act('pdf-delete').onclick=()=>deletePage(current());
  $('pdf-find-prev').onclick=()=>step(-1);$('pdf-find-next').onclick=()=>step(1);$('pdf-find-close').onclick=closeFind;
  let typing=0;
  $('pdf-find-input').addEventListener('input',e=>{clearTimeout(typing);const q=e.target.value;typing=setTimeout(()=>search(q),160);});
  $('pdf-find-input').addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();clearTimeout(typing);if(e.target.value!==query)search(e.target.value);else step(e.shiftKey?-1:1);}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeFind();}
  });
  chip.addEventListener('pointerdown',e=>e.preventDefault());chip.onclick=openAsk;
  $('pdf-ask-close').onclick=()=>closeAsk();
  $('pdf-ask-new').onclick=newChat;
  N.i18n?.onChange(updateChatInput);
  $('pdf-ask-form').onsubmit=e=>{e.preventDefault();ask($('pdf-ask-input').value);};
  $('pdf-ask-input').maxLength=4000;
  $('pdf-ask-input').addEventListener('input',()=>{updateChatInput();saveChat();});
  $('pdf-ask-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!asking&&e.target.value.trim())ask(e.target.value);}});
  askBox.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeAsk();}});
  $('pdf-ask-expand').onclick=()=>{const before=document.getElementById('col').getBoundingClientRect().left,wide=askBox.classList.toggle('wide');document.body.classList.toggle('pdf-chat-wide',wide);$('pdf-ask-expand').setAttribute('aria-pressed',String(wide));$('pdf-ask-expand').setAttribute('aria-label',wide?'reduce chat':'expand chat');chatLayout(before);};
  $('pdf-ask-messages').addEventListener('scroll',()=>{const log=$('pdf-ask-messages');nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<65;if(nearBottom)$('pdf-ask-latest').hidden=true;},{passive:true});
  $('pdf-ask-latest').onclick=()=>{const log=$('pdf-ask-messages');log.scrollTop=log.scrollHeight;nearBottom=true;$('pdf-ask-latest').hidden=true;};
  let chipFrame=0;
  document.addEventListener('selectionchange',()=>{stabilizePDFSelection();if(chipFrame)return;chipFrame=requestAnimationFrame(()=>{chipFrame=0;placeChip();});});
  document.addEventListener('pointerdown',e=>{const layer=e.target.closest?.('#pdf-tl .textLayer');if(!S.pdf||S.tool!=='text'||!layer||e.button!==0||e.pointerType==='touch')return;pdfSelectionPointer=e.pointerId;previousPDFRange=null;layer.classList.add('selecting');chip.hidden=true;},true);
  for(const type of ['pointerup','pointercancel'])document.addEventListener(type,e=>{if(e.pointerId===pdfSelectionPointer)finishPDFSelection();},true);
  addEventListener('blur',finishPDFSelection);
  document.addEventListener('keyup',()=>{if(pdfSelectionPointer===null)for(const entry of layers.values())resetPDFSelectionEnd(entry);});
  sc.addEventListener('scroll',()=>{if(!chip.hidden)placeChip();},{passive:true});
  addEventListener('resize',()=>{if(!askBox.hidden){C.layout();N.ink.render();updateChatInput();paintChatHighlight();}chip.hidden=true;});
  function fitChatKeyboard(){
    const v=visualViewport;if(!v)return;
    if(!askBox.hidden&&innerWidth<1100&&v.height<innerHeight-100){askBox.style.top=(v.offsetTop+8)+'px';askBox.style.bottom='auto';askBox.style.height=Math.max(150,v.height-20)+'px';}
    else{askBox.style.top='';askBox.style.bottom='';askBox.style.height='';}
  }
  window.visualViewport?.addEventListener('resize',fitChatKeyboard);window.visualViewport?.addEventListener('scroll',fitChatKeyboard);
  addEventListener('pagehide',saveChat);
  sc.addEventListener('scroll',()=>{updateCounter();queueVisible();},{passive:true});
  document.addEventListener('keydown',e=>{
    if(!S.pdf||document.querySelector('.sheet:not(.leave)'))return;
    const mod=e.ctrlKey||e.metaKey;
    if(mod&&!e.altKey&&e.key.toLowerCase()==='f'){e.preventDefault();openFind();return;}
    if(e.key==='Escape'&&sideOpen&&!find.contains(e.target)&&!askBox.contains(e.target)){setSide(false);return;}
    if(mod||e.altKey||N.ink.isTyping(e)||find.contains(e.target)||askBox.contains(e.target)||e.target.closest?.('.pdf-field'))return;
    if(e.key==='PageDown'){e.preventDefault();go(current()+1);}
    else if(e.key==='PageUp'){e.preventDefault();go(current()-1);}
  });
  /* With the text tool the ink canvas steps aside, so a mouse or pen press in
     the margins drags the document here instead of starting a selection. */
  let drag=null;
  document.addEventListener('pointerdown',e=>{
    if(!S.pdf||S.tool!=='text'||e.pointerType==='touch'||e.button!==0||!e.isPrimary)return;
    if(!e.target.closest?.('#scroller')||e.target.closest('.line,.chip,.plot,input,textarea,select,button,a'))return;
    const w=N.ink.toWorld(e);if(pageAt(w.y,w.x))return;
    e.preventDefault();e.stopPropagation();drag={id:e.pointerId,x:e.clientX,y:e.clientY};
  },true);
  /* a press on a form field or link is the field's, never a new typed line */
  document.addEventListener('pointerdown',e=>{if(S.pdf&&e.target.closest?.('#pdf-tl .pdf-field,#pdf-tl .pdf-link'))e.stopPropagation();},true);
  document.addEventListener('pointerup',e=>{if(S.pdf&&e.target.closest?.('#pdf-tl .pdf-field,#pdf-tl .pdf-link'))e.stopPropagation();},true);
  addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;sc.scrollLeft-=e.clientX-drag.x;sc.scrollTop-=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;e.preventDefault();},{passive:false});
  for(const type of ['pointerup','pointercancel'])addEventListener(type,e=>{if(drag&&e.pointerId===drag.id){drag=null;e.stopPropagation();}},true);
  document.addEventListener('selectstart',e=>{if(drag)e.preventDefault();},true);
  document.addEventListener('drop',e=>{const file=[...(e.dataTransfer?.files||[])].find(isPdf);if(file){e.preventDefault();e.stopImmediatePropagation();importFile(file);}},{capture:true});
  /* stored originals nothing refers to any more are cleared once a session,
     well after start-up */
  setTimeout(()=>{const run=()=>collect().catch(()=>{});window.requestIdleCallback?requestIdleCallback(run,{timeout:30000}):run();},90000);
  N.pdf={validate,draw,refresh,pageAt,current,go,choose,importFile,insertBlank,movePage,rotatePage,deletePage,exportFile,paintBackground,paintThumbBackground,libs,clip,pageOf,fit,search,openFind,closeFind,
    bytesOf,stash,inline,collect,setField,goDest,showOutline,openAsk,closeAsk,width:W};
})();
