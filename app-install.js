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
function show(opening=false){
  const N=window.N;if(!N?.ui)return;
  const opened=standalone();
  const box=N.ui.openSheet('<h2>'+(opened?'Notas app':opening||installed||running?'Open Notas as an app':'Download Notas as an app')+'</h2>'+
    '<div class="app-guide"><p>'+(opened?'You’re already using Notas as an app.':opening?'Your browser could not switch to the app. Use the options below, or keep writing here.':'Add Notas to your Home Screen and open it like your other apps.')+'</p>'+
    (!opened?'<div class="app-actions">'+(running?'<button type="button" class="app-primary" id="app-open-now">Open in app</button>':'')+(deferred?'<button type="button" class="app-primary" id="app-install-now">Download as an app</button>':'')+'</div>':'')+
    '<label class="app-device">Instructions for <select id="app-device"><option value="android">Android</option><option value="apple">iPad / iPhone</option><option value="desktop">Computer</option></select></label>'+
    '<div id="app-device-steps"></div>'+
    '<details'+(opening||installed||running||shared?' open':'')+'><summary>Already downloaded the app?</summary><p>Use your browser’s “Open in app” option if it appears. On Android, check the ⋮ menu; on a computer, check the address bar. Your browser decides whether links can open in the app.</p><p>On iPad or iPhone, open Notas from your Home Screen. Safari cannot reliably send this page to the app.</p>'+
    (shared?'<p>To keep this shared invitation, copy its link below. Open the Notas app, choose … → open a shared link, and paste it there.</p><button type="button" id="app-copy-link">Copy shared link</button><p id="app-copy-status" role="status"></p>':'')+
    '</details><p class="sheet-notes">Notes stay in the browser or app where you created them. Installation does not move your existing notes between browsers. On iPad and iPhone, export and import notes if you need them in the app.</p></div>',{fit:true});
  const select=box.querySelector('#app-device');select.value=apple?'apple':android?'android':'desktop';
  const steps=()=>{
    box.querySelector('#app-device-steps').innerHTML=select.value==='apple'
      ?'<ol><li>Open this Notas address in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong> (the square with an upward arrow). Tap <strong>View More</strong> if needed.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Keep <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.</li></ol><p class="sheet-notes">Choose Add to Home Screen, rather than Add Bookmark. Then tap the Notas icon on your Home Screen.</p>'
      :select.value==='android'
      ?'<ol><li>Open this Notas address in <strong>Chrome</strong>.</li><li>Tap <strong>⋮</strong> beside the address bar.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. In some versions, choose <strong>Install and create shortcut → Install</strong>.</li><li>Tap <strong>Install</strong> and follow the instructions.</li></ol>'
      :'<ol><li>Open Notas in <strong>Chrome</strong> or <strong>Edge</strong>.</li><li>Click the install icon in the address bar, or choose <strong>Install Notas</strong> / <strong>Install this site as an app</strong> from the browser menu.</li><li>Confirm <strong>Install</strong>.</li></ol><p class="sheet-notes">On a Mac in Safari, choose File → Add to Dock.</p>';
  };
  select.onchange=steps;steps();
  const launch=box.querySelector('#app-open-now');if(launch)launch.onclick=openApp;
  const download=box.querySelector('#app-install-now');if(download)download.onclick=install;
  const copy=box.querySelector('#app-copy-link');if(copy)copy.onclick=async()=>{
    try{await navigator.clipboard.writeText(entryURL);box.querySelector('#app-copy-status').textContent='Link copied. Paste it in the app’s “open a shared link” menu.';}
    catch{box.querySelector('#app-copy-status').textContent='Copy the link from this field:';const input=document.createElement('input');input.value=entryURL;input.readOnly=true;input.setAttribute('aria-label','shared link');box.querySelector('#app-copy-status').appendChild(input);input.select();}
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
  const box=N.ui.openSheet('<h2>Open a shared link</h2><div class="app-guide"><p>Paste a Notas invitation to open the shared note here.</p><form id="app-shared-form"><label for="app-shared-url">Shared link</label><input id="app-shared-url" type="url" required autocomplete="off" spellcheck="false"><p id="app-shared-status" role="status"></p><button type="submit" class="app-primary">Open shared note</button></form></div>',{fit:true});
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
window.N.appInstall={show,openShared,start(){
  started=true;
  if(standalone()){write('notas.app.installed','1');return;}
  render();refresh();
  navigator.serviceWorker?.addEventListener('controllerchange',refresh);
  window.addEventListener('focus',refresh);
}};
})();
