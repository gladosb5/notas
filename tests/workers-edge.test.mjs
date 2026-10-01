import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

for(const name of ['ink-worker.js','text-worker.js','bg-worker.js'])test(`${name}: validates messages and serializes requests`,async()=>{
 const messages=[],events=[];
 const context=vm.createContext({URL,URLSearchParams,ArrayBuffer,Uint8ClampedArray,TextDecoder,console,
   navigator:{},importScripts(){},ort:{env:{wasm:{}}},
   pause:()=>new Promise(r=>setTimeout(r,5)),record:x=>events.push(x),
   self:{location:{href:'http://localhost/'+name,search:''},NOTAS_INK_FEATURES:{},postMessage:m=>messages.push(m)}});
 vm.runInContext(readFileSync(new URL('../'+name,import.meta.url),'utf8'),context);
 vm.runInContext(`self.onmessage({data:null});self.onmessage({data:{id:'invalid',type:'recognize'}});`,context);
 await vm.runInContext('requestQueue',context);
 assert.ok(messages.some(m=>m.id==='invalid'&&m.error&&!/TypeError|undefined/.test(m.error)),JSON.stringify(messages));
 messages.length=0;
 vm.runInContext(name==='bg-worker.js'?
  `prefetch=async id=>{record('start:'+id);await pause();record('end:'+id);return 'downloaded';};matte=async id=>{record('start:'+id);await pause();record('end:'+id);return {alpha:new Uint8ClampedArray(4)};};self.onmessage({data:{id:1,prefetch:true}});self.onmessage({data:{id:2}});`:
  `setup=async()=>{};${name==='ink-worker.js'?'recognizeInk':'recognize'}=async()=>{record('start');await pause();record('end');return {text:'ok'};};for(let id=1;id<=2;id++)self.onmessage({data:{id,type:'recognize',strokes:[{pts:[1,2,.5]}]}});`,context);
 await vm.runInContext('requestQueue',context);
 assert.deepEqual(messages.map(m=>m.id),[1,2]);
 assert.deepEqual(events,name==='bg-worker.js'?['start:1','end:1','start:2','end:2']:['start','end','start','end']);
});
