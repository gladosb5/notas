/* App installation and optional handoff. A browser tab is never evidence
   that the app is absent; launching a closed app is browser-controlled. */
(function(){
'use strict';
const entryURL=location.href;
const scope=new URL('./',location.href);
const manifestURL=new URL('./manifest.webmanifest',scope).href;
const standalone=()=>navigator.standalone===true||['standalone','fullscreen','minimal-ui'].some(mode=>matchMedia('(display-mode: '+mode+')').matches);
const apple=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const android=/Android/i.test(navigator.userAgent);
let deferred=null,started=false,installed=false,running=false,banner=null,dismissed=false,busy=false;
const read=key=>{try{return localStorage.getItem(key);}catch{return null;}};
const write=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
const shared=new URL(entryURL).searchParams.has('share');
const needsAppleHandoff=apple&&/^[a-z0-9]{8,40}$/.test(new URL(entryURL).searchParams.get('share')||'')&&!standalone();

// Safari cannot launch the Home Screen app. Offer the real manual route
// before joining the note or asking for a nickname in the browser.
function chooseSharedDestination(){
  if(!needsAppleHandoff)return Promise.resolve();
  return new Promise(resolve=>{
    const N=window.N;
    const box=N.ui.openSheet('<h2>Open this note in the app</h2><div class="app-guide"><p>Safari keeps shared links in the browser. To use your installed Notas app:</p><ol><li>Tap <strong>Copy shared link</strong> below.</li><li>Open <strong>Notas from your Home Screen</strong>.</li><li>In Notas, choose <strong>… → open a shared link → Paste and open</strong>. Allow Paste if asked.</li></ol><div class="app-actions"><button type="button" class="app-primary" id="apple-shared-copy">Copy shared link</button><button type="button" id="apple-shared-stay">Stay in browser</button></div><p id="apple-shared-status" role="status" aria-live="polite"></p><details><summary>Need to download Notas?</summary><p>In Safari, tap Share (then View More if needed) → Add to Home Screen. Keep Open as Web App on if shown, then tap Add.</p></details></div>',{fit:true});
    box.dataset.appleShared='true';
    const finish=()=>{clearInterval(watcher);dismiss();resolve();};
    const watcher=setInterval(()=>{if(!box.isConnected)finish();},100);
    box.querySelector('#apple-shared-stay').onclick=()=>{N.ui.closeSheet(true);finish();};
    box.querySelector('#apple-shared-copy').onclick=async()=>{
      const status=box.querySelector('#apple-shared-status');
      try{
        await navigator.clipboard.writeText(entryURL);
        status.textContent='Copied. Open Notas from your Home Screen, then use “open a shared link → Paste and open”.';
      }catch{
        status.textContent='Touch and hold this link, then choose Copy:';
        const input=document.createElement('input');input.value=entryURL;input.readOnly=true;
        input.setAttribute('aria-label','shared link to copy');status.appendChild(input);input.focus();input.select();
      }
    };
  });
}

function hide(){banner?.remove();banner=null;}
function dismiss(){dismissed=true;write('notas.app.dismissed',String(Date.now()));hide();}
function request(type,extra={}){
  return new Promise(resolve=>{
    const worker=navigator.serviceWorker?.controller;
    if(!worker)return resolve(null);
    const channel=new MessageChannel();
    const timer=setTimeout(()=>{channel.port1.close();resolve(null);},type==='NOTAS_APP_OPEN'?20000:6000);
    channel.port1.onmessage=({data})=>{clearTimeout(timer);channel.port1.close();resolve(data);};
    try{worker.postMessage({type,...extra},[channel.port2]);}catch{clearTimeout(timer);channel.port1.close();resolve(null);}
  });
}
async function refresh(){
  if(!started||standalone()){hide();return;}
  const result=await request('NOTAS_APP_FIND');running=result?.found===true;
  try{
    const apps=await navigator.getInstalledRelatedApps?.();
    installed=!!apps?.some(app=>app.platform==='webapp'&&new URL(app.url||'',scope).href===manifestURL);
  }catch{}
  render();
}
function render(){
  hide();
  if(!started||standalone()||dismissed)return;
  const last=Number(read('notas.app.dismissed'));
  // A shared invitation gets a fresh, per-visit choice. Other visits wait a week.
  if(!shared&&last>0&&Date.now()-last<7*86400000)return;
  banner=document.createElement('aside');banner.id='app-recommendation';banner.setAttribute('aria-label','notas app');
  const open=running||installed||(!deferred&&read('notas.app.installed')==='1');
  banner.innerHTML='<div><strong>'+(open?'Use Notas as an app':'Download Notas as an app')+'</strong><p>'+(shared?'Open this shared note in the app, or keep writing here.':'Keep Notas a tap away on your Home Screen.')+'</p></div><div class="app-actions"><button type="button" class="app-primary" id="app-recommend-action">'+(running?'Open in app':open?'How to open':'Download as an app')+'</button><button type="button" id="app-stay">'+(shared?'Stay in browser':'Not now')+'</button></div>';
  banner.querySelector('#app-recommend-action').onclick=()=>running?openApp():show();
  banner.querySelector('#app-stay').onclick=dismiss;
  document.body.appendChild(banner);
}
async function install(){
  if(!deferred)return show();
  const event=deferred;deferred=null;
  const button=document.querySelector('#app-install-now');if(button)button.disabled=true;
  try{
    await event.prompt();
    const choice=await event.userChoice;
    if(choice?.outcome==='accepted'){hide();window.N.ui.closeSheet();}
    else{dismiss();show();}
  }catch{show();}
}
async function openApp(){
  if(busy)return;
  busy=true;
  try{
    const C=window.N.core;
    window.N.ink.finishInput();C.flushView();
    if(await C.save()!==true||C.S.dirty){C.toast('Save your note before switching to the app.',6000);return;}
    const result=await request('NOTAS_APP_OPEN',{url:entryURL,shared});
    if(result?.opened){dismiss();window.N.ui.closeSheet();}
    else{running=false;show(true);}
  }finally{busy=false;}
}
const DEVICES=[['apple','iPhone & iPad','ph-apple-logo'],['android','Android','ph-android-logo'],['desktop','Computer','ph-desktop']];
const STEPS={
  apple:['<ol><li>Open this Notas address in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong> <i class="ph ph-export" aria-hidden="true"></i>. Tap <strong>View More</strong> if needed.</li><li>Choose <strong>Add to Home Screen</strong>, not Add Bookmark.</li><li>Keep <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.</li></ol>','Notas then opens from its icon on your Home Screen.'],
  android:['<ol><li>Open this Notas address in <strong>Chrome</strong>.</li><li>Tap <strong>⋮</strong> beside the address bar.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. Some versions say <strong>Install and create shortcut → Install</strong>.</li><li>Tap <strong>Install</strong>.</li></ol>','Notas then opens from your Home screen and app list.'],
  desktop:['<ol><li>Open Notas in <strong>Chrome</strong> or <strong>Edge</strong>.</li><li>Click the install icon in the address bar, or choose <strong>Install Notas</strong> / <strong>Install this site as an app</strong> from the browser menu.</li><li>Confirm <strong>Install</strong>.</li></ol>','On a Mac in Safari, choose File → Add to Dock.']
};
function show(opening=false){
  const N=window.N;if(!N?.ui)return;
  const opened=standalone(),toOpen=!opened&&(opening||installed||running);
  // How to reach an app that is already on this device. Browsers, not Notas,
  // decide whether a tab can be handed over.
  const openHelp='<p>Use your browser’s <strong>Open in app</strong> option if it appears: on Android it is in the ⋮ menu, on a computer in the address bar. Your browser decides whether links can open in the app.</p><p>On iPad or iPhone, open Notas from your Home Screen. Safari cannot reliably send this page to the app.</p>'+
    (shared?'<p>To keep this shared invitation, copy its link. In the Notas app, choose … → open a shared link, and paste it there.</p><div class="app-actions"><button type="button" id="app-copy-link"><i class="ph ph-copy" aria-hidden="true"></i>Copy shared link</button></div><p id="app-copy-status" class="app-status" role="status"></p>':'');
  const actions=running||deferred?'<div class="app-actions app-lead">'+(running?'<button type="button" class="app-primary" id="app-open-now"><i class="ph ph-arrow-square-out" aria-hidden="true"></i>Open in app</button>':'')+(deferred&&!opened?'<button type="button" class="app-primary" id="app-install-now"><i class="ph ph-download-simple" aria-hidden="true"></i>Download as an app</button>':'')+'</div>':'';
  const box=N.ui.openSheet('<h2>'+(opened?'Notas app':toOpen?'Open Notas as an app':'Download Notas as an app')+'</h2>'+
    '<div class="app-guide"><div class="app-hero"><img src="./assets/icon-192.png" alt="" width="52" height="52"><p>'+(opened?'You’re already using Notas as an app.':opening?'Your browser could not switch to the app. Open it yourself, or keep writing here.':toOpen?'Notas is set up as an app. Open it to keep writing in its own window.':'Open Notas from your Home Screen or app list, in its own window, like your other apps.')+'</p></div>'+
    (opened?'':actions)+
    (toOpen?'<section class="app-card" aria-labelledby="app-open-title"><h3 id="app-open-title">Opening the app</h3>'+openHelp+'</section>':'')+
    '<section class="app-card" aria-labelledby="app-steps-title"><h3 id="app-steps-title">'+(opened||toOpen?'Download on another device':'How to download')+'</h3>'+
    '<div class="app-seg" id="app-device" role="radiogroup" aria-label="Instructions for">'+DEVICES.map(([value,label,icon])=>'<label><input type="radio" name="app-device" value="'+value+'"><i class="ph '+icon+'" aria-hidden="true"></i><span>'+label+'</span></label>').join('')+'</div>'+
    '<div id="app-device-steps" aria-live="polite"></div></section>'+
    (opened||toOpen?'':'<details'+(shared?' open':'')+'><summary>Already downloaded the app?</summary>'+openHelp+'</details>')+
    '<p class="app-foot"><i class="ph ph-info" aria-hidden="true"></i><span>Notes stay in the browser or app where you created them. Installing does not move them between browsers. On iPad and iPhone, export and import notes to bring them into the app.</span></p></div>',{fit:true});
  const device=apple?'apple':android?'android':'desktop';
  const steps=()=>{
    const value=box.querySelector('#app-device input:checked').value,[list,tip]=STEPS[value];
    box.querySelector('#app-device-steps').innerHTML=list+'<p class="app-tip">'+tip+'</p>';
  };
  box.querySelector('#app-device input[value="'+device+'"]').checked=true;
  box.querySelector('#app-device').onchange=steps;steps();
  const launch=box.querySelector('#app-open-now');if(launch)launch.onclick=openApp;
  const download=box.querySelector('#app-install-now');if(download)download.onclick=install;
  const copy=box.querySelector('#app-copy-link');if(copy)copy.onclick=async()=>{
    const status=box.querySelector('#app-copy-status');
    try{await navigator.clipboard.writeText(entryURL);status.textContent='Link copied. Paste it in the app’s “open a shared link” menu.';}
    catch{status.textContent='Copy the link from this field:';const input=document.createElement('input');input.value=entryURL;input.readOnly=true;input.setAttribute('aria-label','shared link');status.appendChild(input);input.select();}
  };
}
// Receive only messages from this origin's service worker, never window messages.
navigator.serviceWorker?.addEventListener('message',async event=>{
  const port=event.ports[0];if(!port)return;
  if(event.data?.type==='NOTAS_APP_STATUS'){port.postMessage({ready:started&&standalone()});return;}
  if(event.data?.type!=='NOTAS_APP_HANDOFF')return;
  let url;
  try{url=new URL(event.data.url);if(url.origin!==scope.origin||![scope.pathname,scope.pathname+'notas.html'].includes(url.pathname)||url.username||url.password)throw Error();}catch{port.postMessage({opened:false});return;}
  if(!started||!standalone()){port.postMessage({opened:false});return;}
  if(event.data.shared){
    const N=window.N,C=N.core;N.ink.finishInput();C.flushView();
    if(await C.save()!==true||C.S.dirty){C.toast('Save your note, then try opening the shared link again.',6000);port.postMessage({opened:false});return;}
    // A full navigation uses the normal collaboration entry path, including
    // invitation generation and host fragment, after saving the current note.
    port.postMessage({opened:true});location.assign(url.href);
  }else port.postMessage({opened:true});
});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event;installed=false;render();});
window.addEventListener('appinstalled',()=>{deferred=null;installed=true;write('notas.app.installed','1');hide();});
window.N=window.N||{};
function openShared(){
  const N=window.N;
  const box=N.ui.openSheet('<h2>Open a shared link</h2><div class="app-guide"><p>Paste a Notas invitation to open the shared note here.</p><form id="app-shared-form"><label for="app-shared-url">Shared link</label><input id="app-shared-url" type="url" required autocomplete="off" spellcheck="false"><p id="app-shared-status" role="status"></p><div class="app-actions"><button type="button" id="app-paste-link" class="app-primary">Paste and open</button><button type="submit">Open shared note</button></div></form></div>',{fit:true});
  box.querySelector('#app-paste-link').onclick=async()=>{
    try{
      const text=await navigator.clipboard.readText();
      box.querySelector('#app-shared-url').value=text.trim();
      box.querySelector('#app-shared-form').requestSubmit();
    }catch{
      box.querySelector('#app-shared-status').textContent='Touch and hold the link field, choose Paste, then tap Open shared note.';
      box.querySelector('#app-shared-url').focus();
    }
  };
  box.querySelector('#app-shared-form').onsubmit=async event=>{
    event.preventDefault();
    const status=box.querySelector('#app-shared-status');let url;
    try{
      url=new URL(box.querySelector('#app-shared-url').value.trim());
      if(url.origin!==scope.origin||![scope.pathname,scope.pathname+'notas.html'].includes(url.pathname)||url.username||url.password||!/^[a-z0-9]{8,40}$/.test(url.searchParams.get('share')||''))throw Error();
    }catch{status.textContent='Paste a shared Notas link from this same site.';return;}
    const button=box.querySelector('[type="submit"]');button.disabled=true;
    try{
      N.ink.finishInput();N.core.flushView();
      if(await N.core.save()!==true||N.core.S.dirty){status.textContent='Save your current note, then try again.';return;}
      location.assign(url.href);
    }finally{button.disabled=false;}
  };
  box.querySelector('#app-shared-url').focus();
}
window.N.appInstall={show,openShared,needsAppleHandoff,chooseSharedDestination,start(){
  started=true;
  if(standalone()){write('notas.app.installed','1');return;}
  render();refresh();
  navigator.serviceWorker?.addEventListener('controllerchange',refresh);
  window.addEventListener('focus',refresh);
}};
})();
