/* qpdf in a thread of its own. An encrypted PDF (restricted, or locked with a
   password) is rewritten unlocked so pdf-lib can save the annotated copy. Each
   job gets a fresh instance: qpdf is a command-line program and is run once. */
'use strict';
importScripts('./qpdf.js');
self.onmessage=async({data:job})=>{
  const log=[];
  try{
    /* this build binds its output to the console when an instance is made */
    console.log=console.error=console.warn=(...s)=>log.push(s.join(' '));
    const q=await Module({locateFile:name=>new URL(name,self.location.href).href});
    q.FS.writeFile('/in.pdf',job.data);job.data=null;
    let code;
    try{code=q.callMain(['--decrypt',...(job.password?['--password='+job.password]:[]),'/in.pdf','/out.pdf']);}catch(e){code=typeof e?.status==='number'?e.status:2;}
    /* 3 is qpdf's "done, with warnings": the file is written */
    if(code!==0&&code!==3)throw Error(log.join('\n')||'qpdf could not read this PDF.');
    const out=q.FS.readFile('/out.pdf');
    self.postMessage({ok:true,data:out},[out.buffer]);
  }catch(e){
    const said=log.join('\n')+'\n'+String(e?.message||e);
    self.postMessage({ok:false,password:/invalid password|password/i.test(said),error:said.trim().slice(0,400)});
  }
};
