// Local convolutional handwriting recognizer. See assets/recognition-MODEL.md.
'use strict';
importScripts('./cnn-v1-runtime.js');
let model,predict;
async function setup() {
  if(model)return;
  const [metaRes,weightsRes]=await Promise.all([fetch('./cnn-v1.json'),fetch('./cnn-v1.f32')]);
  if(!metaRes.ok||!weightsRes.ok)throw new Error('Recognition files are unavailable. Reconnect and retry setup.');
  const meta=await metaRes.json();
  predict=NotasCNN.createPredictor(meta,await weightsRes.arrayBuffer());model=meta;
}
function classify(component,width,rgbaInput) {
  const w=component.x2-component.x+1,h=component.y2-component.y+1;
  const src=new OffscreenCanvas(w,h),ctx=src.getContext('2d');
  const pixels=ctx.createImageData(w,h);
  for(const i of component.pixels){
    const j=((Math.floor(i/width)-component.y)*w+(i%width-component.x))*4;
    const ink=rgbaInput?255-(rgbaInput[i*4]+rgbaInput[i*4+1]+rgbaInput[i*4+2])/3:255;
    pixels.data[j]=pixels.data[j+1]=pixels.data[j+2]=ink;pixels.data[j+3]=255;
  }
  ctx.putImageData(pixels,0,0);
  const out=new OffscreenCanvas(32,32),ox=out.getContext('2d',{willReadFrequently:true});
  ox.fillStyle='black';ox.fillRect(0,0,32,32);
  const scale=24/Math.max(w,h),nw=Math.max(1,Math.round(w*scale)),nh=Math.max(1,Math.round(h*scale));
  ox.drawImage(src,Math.floor((32-nw)/2),Math.floor((32-nh)/2),nw,nh);
  const rgba=ox.getImageData(0,0,32,32).data;
  const logits=predict(Float32Array.from({length:1024},(_,i)=>rgba[i*4]/255));
  const max=Math.max(...logits),exps=Array.from(logits,x=>Math.exp(x-max)),sum=exps.reduce((a,b)=>a+b,0);
  const alternatives=exps.map((v,i)=>({text:model.classes[i],score:v/sum})).sort((a,b)=>b.score-a.score);
  return {...component,w,h,text:alternatives[0].text,score:alternatives[0].score,alternatives:alternatives.slice(0,3)};
}

function components(rgba,w,h) {
  const ink=new Uint8Array(w*h), queue=new Int32Array(w*h), result=[];
  for(let i=0;i<ink.length;i++) ink[i]=rgba[i*4+3]>100 && (rgba[i*4]+rgba[i*4+1]+rgba[i*4+2])/3<215 ? 1:0;
  for(let i=0;i<ink.length;i++) {
    if(!ink[i]) continue;
    let head=0,tail=1;queue[0]=i;ink[i]=0;
    const part={x:w,y:h,x2:0,y2:0,pixels:[]};
    while(head<tail) {
      const p=queue[head++], x=p%w,y=Math.floor(p/w);
      part.pixels.push(p);part.x=Math.min(part.x,x);part.x2=Math.max(part.x2,x);part.y=Math.min(part.y,y);part.y2=Math.max(part.y2,y);
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
        if(!dx&&!dy || x+dx<0 || x+dx>=w || y+dy<0 || y+dy>=h) continue;
        const n=p+dy*w+dx;
        if(ink[n]){ink[n]=0;queue[tail++]=n;}
      }
    }
    if(part.pixels.length>=2) result.push(part);
    if(result.length>64) throw new Error('Select one short expression with the lasso, then Read.');
  }
  return result;
}

function formatSymbols(input,depth=0) {
  if(depth>5) throw new Error('This layout is too complex. Type the expression to calculate it.');
  let symbols=input.map(s=>({...s}));
  // Resolve actual fraction bars before combining the two bars of an equals sign.
  for(const bar of [...symbols].filter(s=>s.text==='-').sort((a,b)=>b.w-a.w)) {
    if(!symbols.includes(bar)) continue;
    const over=symbols.filter(s=>s!==bar && (s.x+s.x2)/2>=bar.x && (s.x+s.x2)/2<=bar.x2 && s.y2<bar.y && bar.y-s.y2<bar.w*1.8);
    const under=symbols.filter(s=>s!==bar && (s.x+s.x2)/2>=bar.x && (s.x+s.x2)/2<=bar.x2 && s.y>bar.y2 && s.y-bar.y2<bar.w*1.8);
    if(over.length && under.length && !over.every(s=>s.text==='-') && !under.every(s=>s.text==='-')) {
      const numerator=formatSymbols(over,depth+1),denominator=formatSymbols(under,depth+1);
      const selected=[bar,...over,...under];
      const fraction={...bar,text:`\\frac{${numerator}}{${denominator}}`,y:Math.min(...selected.map(s=>s.y)),y2:Math.max(...selected.map(s=>s.y2))};
      fraction.h=fraction.y2-fraction.y+1;
      symbols=symbols.filter(s=>!selected.includes(s));symbols.push(fraction);
    }
  }
  symbols.sort((a,b)=>a.x-b.x || a.y-b.y);
  for(let i=0;i<symbols.length;i++) {
    const a=symbols[i];
    if(a.text!=='-') continue;
    const dots=symbols.filter(s=>s.text==='.' && Math.abs((s.x+s.x2-a.x-a.x2)/2)<a.w*.3 && Math.abs((s.y+s.y2-a.y-a.y2)/2)<a.w);
    if(dots.some(s=>s.y2<a.y) && dots.some(s=>s.y>a.y2)) {
      a.text='\\div';symbols=symbols.filter(s=>!dots.includes(s));continue;
    }
    const j=symbols.findIndex((b,k)=>k!==i && b.text==='-' && Math.min(a.x2,b.x2)-Math.max(a.x,b.x)>.65*Math.min(a.w,b.w) && Math.abs(a.y-b.y)<Math.max(a.w,b.w)*.8);
    if(j>=0){a.text='=';a.y=Math.min(a.y,symbols[j].y);a.y2=Math.max(a.y2,symbols[j].y2);symbols.splice(j,1);i=-1;}
  }
  let text='';
  for(let i=0;i<symbols.length;i++) {
    const a=symbols[i];
    if(a.text==='\\sqrt') {
      const inner=[];
      while(i+1<symbols.length && symbols[i+1].x<a.x2+Math.max(6,a.w*.15)) inner.push(symbols[++i]);
      if(!inner.length && i+1<symbols.length) inner.push(symbols[++i]);
      if(!inner.length) throw new Error('Finish the square root, or type its expression.');
      text+=`\\sqrt{${formatSymbols(inner,depth+1)}}`;continue;
    }
    text+=a.text;
    if(!['+','-','=','\\times','\\div','.','('].includes(a.text)) {
      const raised=[];
      while(i+1<symbols.length && symbols[i+1].y2<a.y+a.h*.55 && symbols[i+1].h<a.h*.85) raised.push(symbols[++i]);
      if(raised.length) text+=`^{${formatSymbols(raised,depth+1)}}`;
    }
  }
  return text;
}

self.onmessage=async ({data})=>{
  const {id,type}=data;
  try {
    await setup();
    if(type==='setup'){self.postMessage({id,ready:true});return;}
    const {width,height,buffer}=data;
    if(!width || !height || width*height>600000) throw new Error('Select a smaller expression.');
    const rgba=new Uint8ClampedArray(buffer),parts=components(rgba,width,height);
    if(!parts.length) throw new Error('No dark handwriting found.');
    const sizes=parts.map(p=>p.y2-p.y+1).sort((a,b)=>a-b), typical=Math.max(12,sizes[Math.floor(sizes.length*.7)]);
    const symbols=parts.map(p=>{
      const w=p.x2-p.x+1,h=p.y2-p.y+1;
      if(w<typical*.18 && h<typical*.18) return {...p,w,h,text:'.',score:1};
      if(w>h*3.5) return {...p,w,h,text:'-',score:1};
      return classify(p,width,rgba);
    });
    const latex=formatSymbols(symbols),alternatives=[];
    // Offer likely single-symbol corrections without silently changing algebra.
    const candidates=[];
    for(let i=0;i<symbols.length;i++)for(const choice of (symbols[i].alternatives||[]).slice(1)){
      try{
        const changed=symbols.map((s,j)=>j===i?{...s,text:choice.text}:s);
        candidates.push({latex:formatSymbols(changed),score:choice.score/symbols[i].score});
      }catch{}
    }
    // A handwritten cross can mean the variable x or multiplication.
    if(symbols.some(s=>s.text==='x'))candidates.push({latex:formatSymbols(symbols.map(s=>s.text==='x'?{...s,text:'\\times'}:s)),score:.2});
    for(const candidate of candidates.sort((a,b)=>b.score-a.score)){
      if(candidate.latex!==latex&&!alternatives.includes(candidate.latex))alternatives.push(candidate.latex);
      if(alternatives.length===3)break;
    }
    self.postMessage({id,latex,alternatives,confidence:Math.min(...symbols.map(s=>s.score)),symbolCount:symbols.length});
  } catch(error){self.postMessage({id,error:error.message});}
};
