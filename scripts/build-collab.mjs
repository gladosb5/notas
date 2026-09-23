// Bundles the collaboration libraries the page loads on demand from
// ./assets/collab.js: Yjs (the merged document), y-websocket (the link to
// the note's room on the worker) and y-indexeddb (the document on this
// device, so a reopened shared note is there before the network is). One
// classic script exposing window.Yjs, like the other vendored libraries.
import { build } from 'esbuild';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const entry=`export * as Y from 'yjs';
export { WebsocketProvider } from './collab-provider.mjs';
export { IndexeddbPersistence } from 'y-indexeddb';
`;
const result=await build({
  stdin:{contents:entry,resolveDir:root,sourcefile:'collab-entry.js'},
  bundle:true,format:'iife',globalName:'Yjs',minify:true,target:['es2020'],
  write:false,legalComments:'none',logLevel:'silent'
});
const versions={};
for(const name of ['yjs','y-websocket','y-indexeddb'])versions[name]=JSON.parse(await readFile(path.join(root,'node_modules',name,'package.json'),'utf8')).version;
const banner='/* '+Object.entries(versions).map(([n,v])=>n+' '+v).join(', ')+'. MIT. Built by scripts/build-collab.mjs. */\n';
await writeFile(path.join(root,'assets','collab.js'),banner+result.outputFiles[0].text);
console.log('assets/collab.js: '+(result.outputFiles[0].text.length/1024).toFixed(0)+' KB, '+Object.entries(versions).map(([n,v])=>n+'@'+v).join(' '));
