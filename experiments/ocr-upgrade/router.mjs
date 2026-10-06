// Experimental, no persistent preference or production UI. Script evidence is
// a fallible general OCR reading, never a declaration about the original ink.
export function likelyChinese(reading,{kind='text'}={}){
  if(kind!=='text'||!Number.isFinite(reading?.confidence)||reading.confidence<.9)return false;
  const text=String(reading.text||'');
  if(/[\p{Script=Latin}\p{Script=Hiragana}\p{Script=Katakana}\p{N}=+×÷\\]/u.test(text))return false;
  const letters=Array.from(text).filter(c=>/\p{L}/u.test(c));
  return letters.length>=4&&letters.filter(c=>/\p{Script=Han}/u.test(c)).length/letters.length>=.95;
}

export async function recognizeText(crop,{specialist=false,kind='text',workerFactory=url=>new Worker(url)}={}){
  if(kind!=='text')throw Error('Text routing requires a text crop; math stays on the math pipeline.');
  const run=async url=>{
    const worker=workerFactory(url);
    try{
      return await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Recognition timeout')),90000);
        worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message||'Worker failure'));};
        worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data);};
        // Retain the original crop for a specialist retry. Termination releases
        // the general session before the specialist can allocate any memory.
        worker.postMessage({id:1,type:'recognize',...crop,buffer:crop.buffer.slice(0)});
      });
    }finally{worker.terminate();}
  };
  const general=await run('/text-worker.js');
  if(!specialist||!likelyChinese(general,{kind}))return {...general,model:'small',route:'general'};
  try{
    const chinese=await run('/experiments/ocr-upgrade/pylaia-worker.js');
    const length=Array.from(String(chinese.text||'')).length,base=Array.from(general.text).length;
    if(!likelyChinese(chinese)||/[�]/u.test(chinese.text)||length<base*.65||length>base*1.5)
      return {...general,model:'small',route:'specialist-unusable'};
    return {...chinese,model:'pylaia-experimental',route:'likely-chinese'};
  }catch{return {...general,model:'small',route:'specialist-failed'};}
}
