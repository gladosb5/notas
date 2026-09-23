// Local symbol network; preprocessing follows Maciej Caputa's MIT recognizer.
// See assets/recognition-LICENSE.txt. No GPU, framework, or remote inference.
'use strict';
let model;
async function setup() {
  if (model) return;
  const [metaRes, weightsRes] = await Promise.all([fetch('./assets/symbols.json'), fetch('./assets/symbols.f32')]);
  if (!metaRes.ok || !weightsRes.ok) throw new Error('Recognition files are unavailable. Reconnect and retry setup.');
  const meta = await metaRes.json(), buffer = await weightsRes.arrayBuffer();
  if (buffer.byteLength !== meta.bytes) throw new Error('Incomplete recognition files. Retry setup.');
  const data = new Float32Array(buffer), a = meta.input * meta.hidden, b = a + meta.hidden, c = b + meta.hidden * meta.output;
  model = { ...meta, w1: data.subarray(0,a), b1:data.subarray(a,b), w2:data.subarray(b,c), b2:data.subarray(c) };
}

function thin(white) {
  const p = Uint8Array.from(white, x => 1-x);
  for (let iteration=0; iteration<32; iteration++) {
    let changed = false;
    for (let pass=0; pass<2; pass++) {
      const remove=[];
      for (let y=1;y<31;y++) for(let x=1;x<31;x++) {
        const i=y*32+x;
        if(!p[i]) continue;
        const n=[p[i-32],p[i-31],p[i+1],p[i+33],p[i+32],p[i+31],p[i-1],p[i-33]];
        const sum=n.reduce((a,b)=>a+b,0);
        let transitions=0;
        for(let j=0;j<8;j++) if(!n[j] && n[(j+1)%8]) transitions++;
        if(sum<2 || sum>6 || transitions!==1) continue;
        if(pass===0 ? (!n[0]||!n[2]||!n[4]) && (!n[2]||!n[4]||!n[6])
                    : (!n[0]||!n[2]||!n[6]) && (!n[0]||!n[4]||!n[6])) remove.push(i);
      }
      for(const i of remove) p[i]=0;
      changed ||= remove.length>0;
    }
    if(!changed) break;
  }
  return Float32Array.from(p, x=>1-x);
}

function classify(component, width) {
  const w=component.x2-component.x+1, h=component.y2-component.y+1;
  const src=new OffscreenCanvas(w,h), ctx=src.getContext('2d');
  const pixels=ctx.createImageData(w,h);
  pixels.data.fill(255);
  for(const i of component.pixels) {
    const j=((Math.floor(i/width)-component.y)*w+(i%width-component.x))*4;
    pixels.data[j]=pixels.data[j+1]=pixels.data[j+2]=0;
  }
  ctx.putImageData(pixels,0,0);
  const out=new OffscreenCanvas(128,128), ox=out.getContext('2d',{willReadFrequently:true});
  const scale=128/Math.max(w,h);
  let cx=0,cy=0;
  for(const i of component.pixels){cx+=i%width-component.x;cy+=Math.floor(i/width)-component.y;}
  cx=cx/component.pixels.length;cy=cy/component.pixels.length;
  ox.fillStyle='white';ox.fillRect(0,0,128,128);
  ox.drawImage(src,w>=h?0:64-cx*scale,h>=w?0:64-cy*scale,w*scale,h*scale);
  const rgba=ox.getImageData(0,0,128,128).data, input=new Float32Array(1024);
  for(let y=0;y<32;y++) for(let x=0;x<32;x++) {
    let sum=0;
    for(let v=0;v<4;v++) for(let u=0;u<4;u++) sum+=rgba[((y*4+v)*128+x*4+u)*4]/255;
    input[y*32+x]=Math.round(sum/16);
  }
  const image=thin(input), hidden=new Float32Array(model.b1);
  // Row-major traversal avoids 1024 strided walks through the weights.
  for(let j=0;j<model.input;j++) if(image[j]) {
    const base=j*model.hidden;
    for(let i=0;i<model.hidden;i++) hidden[i]+=model.w1[base+i];
  }
  const logits=new Float32Array(model.b2);
  for(let j=0;j<model.hidden;j++) if(hidden[j]>0) for(let i=0;i<model.output;i++) logits[i]+=hidden[j]*model.w2[j*model.output+i];
  const max=Math.max(...logits), exps=Array.from(logits,x=>Math.exp(x-max)), sum=exps.reduce((a,b)=>a+b,0);
  const alternatives=exps.map((v,i)=>({text:model.classes[i],score:v/sum})).sort((a,b)=>b.score-a.score);
  return {...component,w,h,text:alternatives[0].text,score:alternatives[0].score,alternatives:alternatives.slice(0,3)};
}

function components(rgba,w,h) {
  const ink=new Uint8Array(w*h), queue=new Int32Array(w*h), result=[];
  for(let i=0;i<ink.length;i++) ink[i]=rgba[i*4+3]>100 && (rgba[i*4]+rgba[i*4+1]+rgba[i*4+2])/3<170 ? 1:0;
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
    const parts=components(new Uint8ClampedArray(buffer),width,height);
    if(!parts.length) throw new Error('No dark handwriting found.');
    const sizes=parts.map(p=>p.y2-p.y+1).sort((a,b)=>a-b), typical=Math.max(12,sizes[Math.floor(sizes.length*.7)]);
    const symbols=parts.map(p=>{
      const w=p.x2-p.x+1,h=p.y2-p.y+1;
      if(w<typical*.18 && h<typical*.18) return {...p,w,h,text:'.',score:1};
      if(w>h*3.5) return {...p,w,h,text:'-',score:1};
      return classify(p,width);
    });
    self.postMessage({id,latex:formatSymbols(symbols),confidence:Math.min(...symbols.map(s=>s.score)),symbolCount:symbols.length});
  } catch(error){self.postMessage({id,error:error.message});}
};
