// Gently level recognised words without replacing the writer's strokes.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.NOTAS_INK_REFINE=api;
})(typeof self!=='undefined'?self:globalThis,function(){
'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function quantile(values,q){
  const a=values.slice().sort((x,y)=>x-y),i=(a.length-1)*q,l=Math.floor(i);
  return a.length?a[l]+(a[Math.ceil(i)]-a[l])*(i-l):0;
}
const median=a=>quantile(a,.5);
const round=(v,n)=>Math.round(v*n)/n;

function smoothPts(pts,strength=.65){
  let out=pts.slice();const n=pts.length/3;
  if(n<5)return out;
  for(let pass=0;pass<2;pass++){
    const p=out;out=p.slice();
    for(let i=1;i<n-1;i++){
      const k=i*3,a=Math.max(0,i-2)*3,b=Math.min(n-1,i+2)*3;
      const ux=p[k]-p[a],uy=p[k+1]-p[a+1],vx=p[b]-p[k],vy=p[b+1]-p[k+1];
      const cos=clamp((ux*vx+uy*vy)/(Math.hypot(ux,uy)*Math.hypot(vx,vy)||1),-1,1);
      const corner=clamp(Math.acos(cos)/(Math.PI/3),0,1),alpha=strength*(1-corner);
      for(let j=0;j<2;j++)out[k+j]=p[k+j]+alpha*((p[k-3+j]+2*p[k+j]+p[k+3+j])/4-p[k+j]);
      out[k+2]=p[k+2]+.2*((p[k-1]+2*p[k+2]+p[k+5])/4-p[k+2]);
    }
  }
  out=smoothCurves(out,strength);
  return out.map((v,i)=>round(v,i%3===2?100:10));
}

// Give sustained gentle bends a little more smoothing, leaving corners alone.
function smoothCurves(pts,strength){
  let out=pts;const n=pts.length/3;
  if(n<=10||!strength)return out;
  const bends=new Float64Array(n);
  const bend=(p,i)=>{
    const a=(i-3)*3,k=i*3,b=(i+3)*3,ux=p[k]-p[a],uy=p[k+1]-p[a+1],vx=p[b]-p[k],vy=p[b+1]-p[k+1];
    return Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);
  };
  for(let pass=0;pass<2;pass++){
    const p=out;out=p.slice();
    for(let i=3;i<n-3;i++)bends[i]=bend(p,i);
    for(let i=5;i<n-5;i++){
      const sign=Math.sign(bends[i]);let gentle=!!sign;
      for(let j=i-2;gentle&&j<=i+2;j++)if(bends[j]*sign<.02||Math.abs(bends[j])>.65)gentle=false;
      if(!gentle)continue;
      const k=i*3,alpha=strength*.5;
      for(let j=0;j<2;j++)out[k+j]+=alpha*((p[k-3+j]+2*p[k+j]+p[k+3+j])/4-p[k+j]);
    }
  }
  return out;
}

function turningPoints(paths,hysteresis){
  const tops=[],bottoms=[];
  for(const p of paths){
    if(p.length<2)continue;
    let hi=p[0],lo=p[0],direction=0;
    for(const q of p.slice(1)){
      if(q[1]<hi[1])hi=q;if(q[1]>lo[1])lo=q;
      if(direction<=0&&q[1]-hi[1]>=hysteresis){tops.push(hi);direction=1;lo=q;}
      else if(direction>=0&&lo[1]-q[1]>=hysteresis){bottoms.push(lo);direction=-1;hi=q;}
    }
    if(direction>0)bottoms.push(lo);else if(direction<0)tops.push(hi);
  }
  return {tops,bottoms};
}

function wordMetrics(strokes,slope=0){
  let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
  for(const st of strokes)for(let i=0;i<st.pts.length;i+=3){const x=st.pts[i],y=st.pts[i+1];l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
  if(!Number.isFinite(l))return null;
  let top=Infinity,bottom=-Infinity;
  const cx=(l+r)/2,paths=strokes.map(st=>{
    const p=[];for(let i=0;i<st.pts.length;i+=3){
      const y=st.pts[i+1]-slope*(st.pts[i]-cx);top=Math.min(top,y);bottom=Math.max(bottom,y);p.push([st.pts[i],y]);
    }return p;
  });
  const height=Math.max(1,bottom-top);
  const {tops,bottoms}=turningPoints(paths,Math.max(2,height*.14));
  const reliable=tops.length>=2&&bottoms.length>=2;
  const baseline=reliable?median(bottoms.map(p=>p[1])):bottom;
  const midline=reliable?quantile(tops.map(p=>p[1]),.65):top;
  const core=clamp(baseline-midline,height*.3,height*.9);
  return {cx,baseline,midline,core,reliable,bbox:[l,t,r,b],bottoms:bottoms.map(p=>[p[0],p[1]+slope*(p[0]-cx)])};
}

function fitLine(points,core){
  if(!points.length)return {slope:0,intercept:0};
  // Distant pairs give jitter little say; the median resists descenders.
  const slopes=[];
  let samples=points;
  if(points.length>96){
    const ordered=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    samples=Array.from({length:96},(_,index)=>ordered[Math.round(index*(ordered.length-1)/95)]);
  }
  for(let i=0;i<samples.length;i++)for(let j=i+1;j<samples.length;j++){
    const dx=samples[j][0]-samples[i][0];if(Math.abs(dx)>core)slopes.push((samples[j][1]-samples[i][1])/dx);
  }
  let slope=median(slopes),intercept=median(points.map(p=>p[1]-slope*p[0]));
  const residuals=points.map(p=>Math.abs(p[1]-slope*p[0]-intercept));
  const limit=Math.max(core*.3,median(residuals)*2.5,1);
  const kept=points.filter(p=>Math.abs(p[1]-slope*p[0]-intercept)<=limit);
  const mx=median(kept.map(p=>p[0])),my=median(kept.map(p=>p[1]));
  let xx=0,xy=0;for(const p of kept){xx+=(p[0]-mx)**2;xy+=(p[0]-mx)*(p[1]-my);}
  if(xx>core*core){slope=xy/xx;intercept=median(kept.map(p=>p[1]-slope*p[0]));}
  return {slope,intercept};
}

function strokeBlobs(strokes,slope,core){
  const c=1/Math.hypot(1,slope);
  const intervals=strokes.map((st,index)=>{
    let l=Infinity,r=-Infinity;
    for(let i=0;i<st.pts.length;i+=3){const x=(st.pts[i]+slope*st.pts[i+1])*c;l=Math.min(l,x);r=Math.max(r,x);}
    return {l,r,st,index};
  }).filter(p=>Number.isFinite(p.l)).sort((a,b)=>a.l-b.l||a.index-b.index);
  // Dots, crossbars and touching pen lifts belong to the same glyph blob.
  const blobs=[];
  for(const p of intervals){
    const last=blobs.at(-1);
    if(last&&p.l-last.r<=core*.12){last.r=Math.max(last.r,p.r);last.items.push(p);}
    else blobs.push({l:p.l,r:p.r,items:[p]});
  }
  return blobs;
}

function splitWords(strokes){
  const m=wordMetrics(strokes);if(!m)return [];
  let fitted=fitLine(m.bottoms,m.core);
  if(!m.reliable&&strokes.length>1){
    const local=strokes.map(st=>wordMetrics([st])).filter(part=>part&&part.bbox[3]-part.bbox[1]>=2);
    if(local.length>1)fitted=fitLine(local.flatMap(part=>part.bottoms.length?part.bottoms:[[part.cx,part.baseline]]),median(local.map(part=>part.core)));
  }
  const {slope}=fitted,core=wordMetrics(strokes,slope).core,blobs=strokeBlobs(strokes,slope,core);
  const letterGaps=[];
  for(let i=1;i<blobs.length;i++){
    const a=blobs[i-1],b=blobs[i],gap=b.l-a.r;
    // Joined cursive words are too wide to estimate letter spacing.
    if(gap<core&&a.r-a.l<core*2&&b.r-b.l<core*2)letterGaps.push(gap);
  }
  const space=Math.max(core*.55,median(letterGaps)*1.6),words=[];let items=[];
  const flush=()=>{if(items.length)words.push(items.sort((a,b)=>a.index-b.index).map(p=>p.st));items=[];};
  for(let i=0;i<blobs.length;i++){
    if(i&&blobs[i].l-blobs[i-1].r>space)flush();
    items.push(...blobs[i].items);
  }
  flush();return words;
}

// Trust body turns near the word's writing band, not dots or tall stems alone.
function letterMetrics(strokes,m,slope){
  const paths=strokes.map(st=>{
    let top=Infinity,bottom=-Infinity;const p=[];
    for(let i=0;i<st.pts.length;i+=3){
      const y=st.pts[i+1]-slope*(st.pts[i]-m.cx);top=Math.min(top,y);bottom=Math.max(bottom,y);p.push([st.pts[i],y]);
    }
    return bottom-top>=m.core*.5&&top<m.baseline-m.core*.3&&bottom>m.midline+m.core*.3?p:null;
  }).filter(Boolean);
  const {tops,bottoms}=turningPoints(paths,Math.max(2,m.core*.14));
  const closed=paths.some(p=>p.length>8&&Math.hypot(p[0][0]-p.at(-1)[0],p[0][1]-p.at(-1)[1])<m.core*.2);
  if(!tops.length||!bottoms.length||(!closed&&tops.length<2&&bottoms.length<2))return null;
  const support=p=>bottoms.filter(q=>Math.abs(q[1]-p[1])<m.core*.18).length;
  const foot=bottoms.slice().sort((a,b)=>support(b)-support(a)||Math.abs(a[1]-m.baseline)-Math.abs(b[1]-m.baseline))[0];
  const base=median(bottoms.filter(p=>Math.abs(p[1]-foot[1])<m.core*.18).map(p=>p[1]));
  const top=tops.slice().sort((a,b)=>Math.abs(a[1]-(base-m.core))-Math.abs(b[1]-(base-m.core)))[0][1],core=base-top;
  if(Math.abs(base-m.baseline)>m.core*.7||core<m.core*.6||core>m.core*1.6)return null;
  return {baseline:base,core};
}

// Settle separate letter bodies; detached marks follow their nearest body.
function evenLetters(strokes,slope){
  const m=wordMetrics(strokes,slope);if(!m?.reliable)return;
  m.core=m.baseline-m.midline;
  if(m.core<2)return;
  const blobs=strokeBlobs(strokes,slope,m.core).map(b=>({...b,m:letterMetrics(b.items.map(p=>p.st),m,slope)}));
  const bodies=blobs.filter(b=>b.m&&b.r-b.l<=m.core*3);
  if(bodies.length<2)return;
  for(const b of blobs)if(!b.m&&b.items.every(({st})=>{
    let top=Infinity,bottom=-Infinity;
    for(let i=0;i<st.pts.length;i+=3){const y=st.pts[i+1]-slope*(st.pts[i]-m.cx);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    return bottom-top<m.core*.45||bottom<m.midline+m.core*.15||top>m.baseline-m.core*.15;
  })){
    const nearest=bodies.slice().sort((a,c)=>Math.max(0,a.l-b.r,b.l-a.r)-Math.max(0,c.l-b.r,b.l-c.r))[0];
    if(nearest&&Math.max(0,nearest.l-b.r,b.l-nearest.r)<m.core*.75)nearest.items.push(...b.items);
  }
  for(const b of bodies){
    const scale=clamp(1+.65*(m.core/b.m.core-1),.88,1.12),dy=clamp((m.baseline-b.m.baseline)*.65,-m.core*.35,m.core*.35);
    for(const {st} of b.items)for(let i=0;i<st.pts.length;i+=3){
      const y=st.pts[i+1]-slope*(st.pts[i]-m.cx);
      st.pts[i+1]+=dy+(y-b.m.baseline)*(scale-1);
    }
  }
}

// Long, straight, near-vertical runs tell us the writer's lean along the line.
function wordSlant(strokes,slope,core){
  const samples=[],c=1/Math.hypot(1,slope);let weight=0;
  for(const st of strokes){
    const p=st.pts;let start=0,length=0;
    for(let i=3;i<p.length;i+=3){
      length+=Math.hypot(p[i]-p[i-3],p[i+1]-p[i-2]);
      if(length<core*.6)continue;
      const dx=(p[i]-p[start]+slope*(p[i+1]-p[start+1]))*c,dy=(p[i+1]-p[start+1]-slope*(p[i]-p[start]))*c;
      if(Math.abs(dy)>core*.5&&Math.abs(dx)<Math.abs(dy)*.6&&Math.hypot(dx,dy)>length*.985){
        samples.push({angle:Math.atan(dx/dy),weight:Math.abs(dy)});weight+=Math.abs(dy);
      }
      start=i;length=0;
    }
  }
  if(weight<core*1.2)return null;
  samples.sort((a,b)=>a.angle-b.angle);let sum=0;
  for(const sample of samples){sum+=sample.weight;if(sum>=weight/2)return sample.angle;}
  return null;
}

// Shear around the baseline toward the line's own lean, never toward upright.
function matchSlant(strokes,slope,baseline,cx,slant,target){
  if(slant===null||target===null)return;
  const angle=slant+clamp((target-slant)*.65,-Math.PI/22.5,Math.PI/22.5),shear=Math.tan(angle)-Math.tan(slant),c=1/Math.hypot(1,slope);
  for(const st of strokes)for(let i=0;i<st.pts.length;i+=3){
    const y=(st.pts[i+1]-baseline-slope*(st.pts[i]-cx))*c,dx=shear*y*c;
    st.pts[i]+=dx;st.pts[i+1]+=slope*dx;
  }
}

// Ease a tiny returning loop gap shut, only after a full letter-sized turn.
function closeLoop(pts,core){
  const n=pts.length/3;if(n<10)return;
  const end=(n-1)*3,endX=pts[end],endY=pts[end+1];let length=0,best=null;
  let left=endX,right=endX,top=endY,bottom=endY,area=0,turn=0;
  for(let i=n-2;i>=0;i--){
    const k=i*3;length+=Math.hypot(pts[k+3]-pts[k],pts[k+4]-pts[k+1]);
    if(length>core*9)break;
    left=Math.min(left,pts[k]);right=Math.max(right,pts[k]);top=Math.min(top,pts[k+1]);bottom=Math.max(bottom,pts[k+1]);
    area+=(pts[k]-endX)*(pts[k+4]-endY)-(pts[k+3]-endX)*(pts[k+1]-endY);
    if(k+3<end){
      const ux=pts[k+3]-pts[k],uy=pts[k+4]-pts[k+1],vx=pts[k+6]-pts[k+3],vy=pts[k+7]-pts[k+4];
      turn+=Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);
    }
    const gap=Math.hypot(pts[end]-pts[k],pts[end+1]-pts[k+1]);
    if(length<core*2||gap>core*.18||best&&gap>=best.gap)continue;
    const w=right-left,h=bottom-top;
    if(Math.min(w,h)<core*.45||Math.max(w,h)>core*2.5||gap>Math.min(w,h)*.16||Math.abs(area)/2<w*h*.45||Math.abs(turn)<Math.PI*1.65)continue;
    best={k,gap};
  }
  if(!best||best.gap<.05)return;
  const dx=pts[best.k]-pts[end],dy=pts[best.k+1]-pts[end+1],reach=core*.6;let distance=0,nextX=pts[end],nextY=pts[end+1];
  for(let i=end;i>best.k;i-=3){
    if(i<end)distance+=Math.hypot(nextX-pts[i],nextY-pts[i+1]);
    nextX=pts[i];nextY=pts[i+1];
    if(distance>=reach)break;
    const t=1-distance/reach,ease=t*t*(3-2*t);pts[i]+=dx*ease;pts[i+1]+=dy*ease;
  }
}

// Flat strokes are split at spaces; nested arrays already name the words.
function refineLine(line,freshIds,opts={}){
  const words=Array.isArray(line[0])?line:splitWords(line);
  const entries=words.map(strokes=>({strokes,m:wordMetrics(strokes),fresh:strokes.length>0&&strokes.every(st=>freshIds.has(st.id))})).filter(e=>e.m);
  const fresh=entries.filter(e=>e.fresh);if(!fresh.length)return null;
  const core=median(entries.map(e=>e.m.core));
  const fitted=fitLine(fresh.flatMap(e=>e.m.bottoms),core),angle=Math.atan(fitted.slope);
  // Measure heights across the line, rather than across the page axes.
  for(const e of entries)e.m=wordMetrics(e.strokes,fitted.slope);
  const settled=entries.filter(e=>!e.fresh),anchors=settled.length?settled:entries;
  let target;
  if(settled.length){
    const points=settled.map(e=>[e.m.cx,e.m.baseline]);
    const span=Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]));
    target=span>core*3?fitLine(points,core):{slope:0,intercept:median(points.map(p=>p[1]))};
  }else{
    const centre=(Math.min(...entries.map(e=>e.m.bbox[0]))+Math.max(...entries.map(e=>e.m.bbox[2])))/2;
    const slope=Math.abs(angle)>Math.PI/18?fitted.slope:0;
    target={slope,intercept:fitted.intercept+(fitted.slope-slope)*centre};
  }
  const targetCore=median(anchors.map(e=>e.m.core)),plans=new Map();
  for(const e of entries)e.slant=wordSlant(e.strokes,fitted.slope,e.m.core);
  const slants=anchors.map(e=>e.slant).filter(v=>v!==null),targetSlant=slants.length?median(slants):null;
  for(const e of fresh){
    const m=e.m,dy=target.slope*m.cx+target.intercept-m.baseline;
    // A long sloping line can move far when levelled; only stray words stay put.
    const offset=settled.length?dy:fitted.slope*m.cx+fitted.intercept-m.baseline;
    if(Math.abs(offset)>m.core*1.2)continue;
    const rotate=fresh.length===1&&m.bbox[2]-m.bbox[0]<m.core*3?0:Math.atan(target.slope)-angle;
    const scale=entries.length>1&&m.reliable?clamp(Math.sqrt(targetCore/m.core),.86,1.16):1;
    plans.set(e,{dy:dy*.88,rotate,scale});
  }
  // Enlarging a word must not close up the space the writer left.
  const ordered=entries.slice().sort((a,b)=>a.m.cx-b.m.cx);
  for(let i=1;i<ordered.length;i++){
    const a=ordered[i-1],b=ordered[i],gap=b.m.bbox[0]-a.m.bbox[2];
    const growth=e=>Math.max(0,(plans.get(e)?.scale||1)-1)*(e.m.bbox[2]-e.m.bbox[0])/2;
    if(growth(a)+growth(b)>Math.max(0,gap*.3))for(const e of [a,b])if(plans.has(e))plans.get(e).scale=1;
  }
  const result=new Map();let largest=0;
  for(const [e,plan] of plans){
    const m=e.m,c=Math.cos(plan.rotate),s=Math.sin(plan.rotate);
    const strokes=e.strokes.map(st=>{
      const pts=smoothPts(st.pts,opts.strength??.65);
      for(let i=0;i<pts.length;i+=3){
        const x=(pts[i]-m.cx)*plan.scale,y=(pts[i+1]-m.baseline)*plan.scale;
        pts[i]=m.cx+x*c-y*s;pts[i+1]=m.baseline+plan.dy+x*s+y*c;
      }
      return {...st,pts};
    });
    const slope=Math.tan(angle+plan.rotate),baseline=m.baseline+plan.dy;
    evenLetters(strokes,slope);
    matchSlant(strokes,slope,baseline,m.cx,e.slant,targetSlant);
    for(let j=0;j<strokes.length;j++){
      const st=e.strokes[j],pts=strokes[j].pts;closeLoop(pts,m.core*plan.scale);
      for(let i=0;i<pts.length;i++){
        pts[i]=round(pts[i],i%3===2?100:10);
      }
      for(let i=0;i<pts.length;i+=3)largest=Math.max(largest,Math.hypot(pts[i]-st.pts[i],pts[i+1]-st.pts[i+1]));
      if(pts.some((v,i)=>v!==st.pts[i]))result.set(st.id,pts);
    }
  }
  return largest>=(opts.minDisplacement??.6)&&result.size?result:null;
}
return {refineLine,splitWords,wordMetrics,smoothPts};
});
